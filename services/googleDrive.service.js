try { require('dotenv').config(); } catch (e) {}
const { google } = require('googleapis');
const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');
const stream = require('stream');
const fileOptimizer = require('./fileOptimizer.service');

/**
 * ENTERPRISE MULTI-TIER STORAGE SERVICE (SUNGO ERP)
 * 1. Google Cloud Storage (GCS) - Lưu trữ đám mây vĩnh viễn, CDN tốc độ cao, không bao giờ mất file khi Cloud Run scale/redeploy.
 * 2. Google Drive (Dự phòng cho tài liệu chia sẻ Workspace).
 * 3. Local Optimized Storage (Ổ cứng cục bộ nén ảnh 90%).
 */

const KEY_FILE_PATH = process.env.GOOGLE_DRIVE_KEY_PATH || path.join(__dirname, '../config/google-service-account.json');
const DEFAULT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '';
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'sungo-erp-uploads';
const GCP_PROJECT_ID = process.env.GOOGLE_PROJECT_ID || 'sungo-erp';

class GoogleDriveService {
    constructor() {
        this.drive = null;
        this.authType = null;
        this.accountIdentifier = null;

        // GCS Client
        this.gcs = null;
        this.gcsBucket = null;
        this.gcsBucketName = GCS_BUCKET_NAME;

        this.init();
    }

    /**
     * Khởi tạo kết nối Google Cloud Storage & Google Drive API
     */
    init() {
        // A. KHỞI TẠO GOOGLE CLOUD STORAGE (GCS)
        try {
            let gcsOptions = { projectId: GCP_PROJECT_ID };

            if (fs.existsSync(KEY_FILE_PATH)) {
                gcsOptions.keyFilename = KEY_FILE_PATH;
                console.log('☁️ [GCS Storage] Sử dụng Service Account Key File:', KEY_FILE_PATH);
            } else if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
                try {
                    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON.trim();
                    gcsOptions.credentials = raw.startsWith('{') ? JSON.parse(raw) : JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
                    console.log('☁️ [GCS Storage] Sử dụng Service Account từ ENV');
                } catch(e) {
                    console.warn('⚠️ [GCS Storage] Lỗi parse GOOGLE_SERVICE_ACCOUNT_JSON:', e.message);
                }
            }

            this.gcs = new Storage(gcsOptions);
            this.gcsBucket = this.gcs.bucket(this.gcsBucketName);
            console.log(`✅ [GCS Storage] Đã kết nối Google Cloud Storage Bucket: ${this.gcsBucketName}`);
        } catch (gcsErr) {
            console.warn('⚠️ [GCS Storage] Không thể khởi tạo GCS:', gcsErr.message);
            this.gcs = null;
            this.gcsBucket = null;
        }

        // B. KHỞI TẠO GOOGLE DRIVE API (DỰ PHÒNG HOẶC TIỆN ÍCH PHỤ)
        try {
            // 1. Kiểm tra cấu hình OAuth2
            const clientId = process.env.GOOGLE_CLIENT_ID;
            const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
            const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

            if (clientId && clientSecret && refreshToken) {
                const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:3456/oauth2callback');
                oauth2Client.setCredentials({ refresh_token: refreshToken });

                this.drive = google.drive({ version: 'v3', auth: oauth2Client });
                this.authType = 'OAUTH2';
                this.accountIdentifier = 'OAuth2 Personal Account';
                return;
            }

            // 2. Kiểm tra Service Account cho Drive
            if (fs.existsSync(KEY_FILE_PATH)) {
                const keyContent = JSON.parse(fs.readFileSync(KEY_FILE_PATH, 'utf-8'));
                this.accountIdentifier = keyContent.client_email || null;

                const auth = new google.auth.GoogleAuth({
                    keyFile: KEY_FILE_PATH,
                    scopes: ['https://www.googleapis.com/auth/drive']
                });

                this.drive = google.drive({ version: 'v3', auth });
                this.authType = 'SERVICE_ACCOUNT';
            }
        } catch (error) {
            this.drive = null;
        }
    }

    isConfigured() {
        return !!this.gcsBucket || !!this.drive;
    }

    /**
     * Tính toán dung lượng các thư mục uploads trên host
     */
    getStorageStats() {
        const uploadRoot = path.join(__dirname, '../public/uploads');
        let totalBytes = 0;
        let totalFiles = 0;
        const folderDetails = {};

        function scanDir(dir, relPath = '') {
            if (!fs.existsSync(dir)) return;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    scanDir(fullPath, path.join(relPath, entry.name));
                } else if (entry.isFile() && !entry.name.startsWith('.')) {
                    const stat = fs.statSync(fullPath);
                    totalBytes += stat.size;
                    totalFiles += 1;
                    const folderKey = relPath || 'root';
                    folderDetails[folderKey] = (folderDetails[folderKey] || 0) + stat.size;
                }
            }
        }

        scanDir(uploadRoot);

        const formatBytes = (bytes) => {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
        };

        return {
            totalBytes,
            totalFormatted: formatBytes(totalBytes),
            totalFiles,
            folderDetails,
            storageMode: this.gcsBucket ? 'GOOGLE_CLOUD_STORAGE' : (this.drive ? this.authType : 'LOCAL_OPTIMIZED')
        };
    }

    /**
     * Kiểm tra trạng thái chi tiết của hệ thống lưu trữ
     */
    async checkStatus() {
        const stats = this.getStorageStats();

        if (this.gcsBucket) {
            return {
                configured: true,
                mode: 'GOOGLE_CLOUD_STORAGE',
                bucket: this.gcsBucketName,
                message: `Google Cloud Storage Bucket [${this.gcsBucketName}] đang hoạt động (Lưu trữ vĩnh viễn, CDN tốc độ cao).`,
                storageStats: stats
            };
        }

        if (this.drive) {
            return {
                configured: true,
                mode: this.authType,
                account: this.accountIdentifier,
                message: 'Google Drive API đang hoạt động!',
                storageStats: stats
            };
        }

        return {
            configured: false,
            mode: 'LOCAL_OPTIMIZED',
            message: 'Hệ thống đang hoạt động ở chế độ Local (Tự động nén ảnh 90%).',
            storageStats: stats
        };
    }

    /**
     * Upload file/buffer với cơ chế TỰ ĐỘNG NÉN và ĐẨY LÊN CLOUD STORAGE VĨNH VIỄN
     */
    async uploadFile({ buffer, originalname, mimetype, subfolder = 'general', customFolderId = null }) {
        if (!buffer || !Buffer.isBuffer(buffer)) {
            throw new Error('File buffer không hợp lệ hoặc rỗng!');
        }

        // 1. TỰ ĐỘNG NÉN HÌNH ẢNH (TIẾT KIỆM 90% DUNG LƯỢNG)
        const optimized = await fileOptimizer.optimizeImage(buffer, mimetype);
        const finalBuffer = optimized.buffer;
        const finalMime = optimized.mimetype;

        const ext = path.extname(originalname || '') || (finalMime && finalMime.includes('png') ? '.png' : '.jpg');
        const cleanName = path.basename(originalname || 'file', ext).replace(/[^a-zA-Z0-9_-]/g, '_');
        const uniqueFileName = `${Date.now()}_${cleanName}${ext}`;
        const cleanSubfolder = String(subfolder || 'general').replace(/[^a-zA-Z0-9_-]/g, '') || 'general';

        // 2. ƯU TIÊN 1: GOOGLE CLOUD STORAGE (VĨNH VIỄN, AN TOÀN TRÊN CLOUD RUN, URL CÔNG KHAI TRỰC TIẾP)
        if (this.gcsBucket) {
            try {
                const gcsPath = `${cleanSubfolder}/${uniqueFileName}`;
                const file = this.gcsBucket.file(gcsPath);

                await file.save(finalBuffer, {
                    contentType: finalMime || 'application/octet-stream',
                    metadata: {
                        cacheControl: 'public, max-age=31536000'
                    }
                });

                const publicUrl = `https://storage.googleapis.com/${this.gcsBucketName}/${cleanSubfolder}/${uniqueFileName}`;
                return {
                    success: true,
                    storage: 'google_cloud_storage',
                    fileName: uniqueFileName,
                    url: publicUrl,
                    downloadUrl: publicUrl,
                    savedPercent: optimized.savedPercent,
                    size: finalBuffer.length
                };
            } catch (gcsErr) {
                console.error('⚠️ [GCS Upload Error, thử Drive/Local]:', gcsErr.message);
            }
        }

        // 3. ƯU TIÊN 2: GOOGLE DRIVE (NẾU CÓ CẤU HÌNH VÀ CÒN HOẠT ĐỘNG)
        if (this.drive) {
            try {
                const targetFolder = customFolderId || DEFAULT_FOLDER_ID;
                const bufferStream = new stream.PassThrough();
                bufferStream.end(finalBuffer);

                const fileMetadata = {
                    name: uniqueFileName,
                    parents: targetFolder ? [targetFolder] : undefined
                };

                const media = {
                    mimeType: finalMime || 'application/octet-stream',
                    body: bufferStream
                };

                const res = await this.drive.files.create({
                    requestBody: fileMetadata,
                    media: media,
                    fields: 'id, name, webViewLink, webContentLink, size, thumbnailLink',
                    supportsAllDrives: true
                });

                const fileId = res.data.id;

                try {
                    await this.drive.permissions.create({
                        fileId: fileId,
                        requestBody: { role: 'reader', type: 'anyone' },
                        supportsAllDrives: true
                    });
                } catch (permErr) {}

                const isImage = finalMime && finalMime.startsWith('image/');
                const directUrl = isImage
                    ? `https://lh3.googleusercontent.com/d/${fileId}`
                    : (res.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`);

                return {
                    success: true,
                    storage: 'google_drive',
                    fileId: fileId,
                    fileName: uniqueFileName,
                    url: directUrl,
                    webViewLink: res.data.webViewLink,
                    downloadUrl: res.data.webContentLink,
                    savedPercent: optimized.savedPercent,
                    size: finalBuffer.length
                };
            } catch (driveErr) {
                console.warn('⚠️ [Drive Upload Error, fallback Local]:', driveErr.message);
            }
        }

        // 4. ƯU TIÊN 3: LƯU TRỮ CỤC BỘ (LOCAL OPTIMIZED)
        return this.saveToLocalStorage(finalBuffer, uniqueFileName, cleanSubfolder, optimized.savedPercent);
    }

    saveToLocalStorage(buffer, fileName, subfolder = 'general', savedPercent = 0) {
        const cleanSubfolder = String(subfolder || 'general').replace(/[^a-zA-Z0-9_-]/g, '') || 'general';
        const uploadsRoot = path.resolve(__dirname, '../public/uploads');
        const localDir = path.resolve(uploadsRoot, cleanSubfolder);

        if (!localDir.startsWith(uploadsRoot)) {
            throw new Error('Cảnh báo an ninh: Phát hiện dấu hiệu Path Traversal trái phép!');
        }

        if (!fs.existsSync(localDir)) {
            fs.mkdirSync(localDir, { recursive: true });
        }

        const safeFileName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(localDir, safeFileName);
        fs.writeFileSync(filePath, buffer);

        const localUrl = `/uploads/${cleanSubfolder}/${safeFileName}`;
        return {
            success: true,
            storage: 'local_optimized',
            fileName: safeFileName,
            url: localUrl,
            savedPercent: savedPercent,
            size: buffer.length
        };
    }
}

module.exports = new GoogleDriveService();
