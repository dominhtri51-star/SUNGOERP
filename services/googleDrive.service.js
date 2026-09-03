const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const stream = require('stream');
const fileOptimizer = require('./fileOptimizer.service');

/**
 * GOOGLE DRIVE & LOCAL OPTIMIZED STORAGE SERVICE
 * Tự động nén hình ảnh (giảm 90% dung lượng) và lưu trữ đa kênh:
 * 1. Google Drive (Nếu có OAuth2 hoặc Service Account).
 * 2. Optimized Local Storage (Ổ cứng máy chủ với dung lượng siêu nhẹ, chống tràn disk).
 */

const KEY_FILE_PATH = process.env.GOOGLE_DRIVE_KEY_PATH || path.join(__dirname, '../config/google-service-account.json');
const DEFAULT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '';

class GoogleDriveService {
    constructor() {
        this.drive = null;
        this.authType = null;
        this.accountIdentifier = null;
        this.init();
    }

    /**
     * Khởi tạo kết nối Google Drive API
     */
    init() {
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
                console.log('☁️ [Google Drive] Đã kết nối Google Drive qua OAuth2.');
                return;
            }

            // 2. Kiểm tra Service Account qua Biến môi trường (Dành cho Cloud Run / Docker)
            if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
                let credentials;
                try {
                    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON.trim();
                    if (raw.startsWith('{')) {
                        credentials = JSON.parse(raw);
                    } else {
                        credentials = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
                    }
                } catch (parseErr) {
                    console.error('⚠️ [Google Drive] Lỗi parse GOOGLE_SERVICE_ACCOUNT_JSON:', parseErr.message);
                }

                if (credentials) {
                    this.accountIdentifier = credentials.client_email || null;
                    const auth = new google.auth.GoogleAuth({
                        credentials,
                        scopes: ['https://www.googleapis.com/auth/drive']
                    });
                    this.drive = google.drive({ version: 'v3', auth });
                    this.authType = 'SERVICE_ACCOUNT';
                    console.log(`☁️ [Google Drive] Đã nạp Service Account từ Env: ${this.accountIdentifier}`);
                    return;
                }
            }

            // 3. Kiểm tra Service Account qua file
            if (fs.existsSync(KEY_FILE_PATH)) {
                const keyContent = JSON.parse(fs.readFileSync(KEY_FILE_PATH, 'utf-8'));
                this.accountIdentifier = keyContent.client_email || null;

                const auth = new google.auth.GoogleAuth({
                    keyFile: KEY_FILE_PATH,
                    scopes: ['https://www.googleapis.com/auth/drive']
                });

                this.drive = google.drive({ version: 'v3', auth });
                this.authType = 'SERVICE_ACCOUNT';
                console.log(`☁️ [Google Drive] Đã nạp Service Account từ File: ${this.accountIdentifier}`);
                return;
            }

            console.log('ℹ️ [Storage Engine] Đang chạy chế độ Optimized Local Storage (Tự động nén ảnh 90%).');
        } catch (error) {
            console.error('⚠️ [Storage Engine] Lỗi khởi tạo Drive, dùng Local Storage:', error.message);
            this.drive = null;
        }
    }

    isConfigured() {
        return !!this.drive;
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
            storageMode: this.isConfigured() ? this.authType : 'LOCAL_OPTIMIZED'
        };
    }

    /**
     * Kiểm tra trạng thái chi tiết của hệ thống lưu trữ
     */
    async checkStatus() {
        const stats = this.getStorageStats();

        if (!this.isConfigured()) {
            return {
                configured: false,
                mode: 'LOCAL_OPTIMIZED',
                message: 'Hệ thống đang hoạt động ở chế độ Local Siêu Nhẹ (Tự động nén ảnh 90% chống tràn đĩa).',
                storageStats: stats
            };
        }

        try {
            const about = await this.drive.about.get({ fields: 'user, storageQuota' });
            return {
                configured: true,
                mode: this.authType,
                user: about.data.user,
                storageQuota: about.data.storageQuota,
                storageStats: stats,
                message: 'Google Drive API đang hoạt động!'
            };
        } catch (error) {
            return {
                configured: false,
                mode: 'ERROR_FALLBACK_LOCAL',
                error: error.message,
                storageStats: stats,
                message: 'Chế độ dự phòng: Tự động lưu trữ cục bộ có tối ưu dung lượng.'
            };
        }
    }

    /**
     * Upload buffer với cơ chế TỰ ĐỘNG NÉN và chuyển kênh thông minh
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

        // 2. NẾU CÓ GOOGLE DRIVE -> ĐẨY LÊN GOOGLE DRIVE
        if (this.isConfigured()) {
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
                // Tự động lưu local nếu drive lỗi
            }
        }

        // 3. LƯU LOCAL ĐƯỢC TỐI ƯU SIÊU NHẸ
        return this.saveToLocalStorage(finalBuffer, uniqueFileName, subfolder, optimized.savedPercent);
    }

    saveToLocalStorage(buffer, fileName, subfolder = 'general', savedPercent = 0) {
        const cleanSubfolder = String(subfolder || 'general').replace(/[^a-zA-Z0-9_-]/g, '') || 'general';
        const uploadsRoot = path.resolve(__dirname, '../public/uploads');
        const localDir = path.resolve(uploadsRoot, cleanSubfolder);

        // Chống tuyệt đối Path Traversal
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
