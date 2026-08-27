const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const stream = require('stream');

/**
 * GOOGLE DRIVE STORAGE SERVICE
 * Tự động đồng bộ file lên Google Drive qua Service Account.
 * Tự động fallback về lưu trữ cục bộ (Local Storage) nếu chưa cấu hình Google Drive hoặc khi mất kết nối.
 */

// Đường dẫn file cấu hình Service Account
const KEY_FILE_PATH = process.env.GOOGLE_DRIVE_KEY_PATH || path.join(__dirname, '../config/google-service-account.json');
// ID Thư mục cha mặc định trên Google Drive
const DEFAULT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '';

class GoogleDriveService {
    constructor() {
        this.drive = null;
        this.serviceAccountEmail = null;
        this.init();
    }

    /**
     * Khởi tạo kết nối Google Drive API nếu có file key
     */
    init() {
        try {
            if (fs.existsSync(KEY_FILE_PATH)) {
                const keyContent = JSON.parse(fs.readFileSync(KEY_FILE_PATH, 'utf-8'));
                this.serviceAccountEmail = keyContent.client_email || null;

                const auth = new google.auth.GoogleAuth({
                    keyFile: KEY_FILE_PATH,
                    scopes: ['https://www.googleapis.com/auth/drive']
                });

                this.drive = google.drive({ version: 'v3', auth });
                console.log(`☁️ [Google Drive] Đã kết nối Service Account: ${this.serviceAccountEmail}`);
            } else {
                console.log('ℹ️ [Google Drive] Chưa tìm thấy file key (config/google-service-account.json). Đang dùng chế độ Local Storage.');
            }
        } catch (error) {
            console.error('⚠️ [Google Drive] Lỗi khi khởi tạo kết nối Google Drive:', error.message);
            this.drive = null;
        }
    }

    /**
     * Kiểm tra xem Google Drive đã được cấu hình và sẵn sàng chưa
     */
    isConfigured() {
        return !!this.drive && fs.existsSync(KEY_FILE_PATH);
    }

    /**
     * Kiểm tra trạng thái kết nối và thông tin cấu hình Google Drive
     */
    async checkStatus() {
        if (!this.isConfigured()) {
            return {
                configured: false,
                mode: 'LOCAL_STORAGE',
                message: 'Chưa cấu hình Google Service Account. Hệ thống đang lưu file tại máy chủ cục bộ (public/uploads/).',
                keyFilePath: KEY_FILE_PATH,
                folderIdConfigured: !!DEFAULT_FOLDER_ID
            };
        }

        try {
            const about = await this.drive.about.get({ fields: 'user, storageQuota' });
            let folderInfo = null;

            if (DEFAULT_FOLDER_ID) {
                try {
                    const folderRes = await this.drive.files.get({
                        fileId: DEFAULT_FOLDER_ID,
                        fields: 'id, name, mimeType, capabilities'
                    });
                    folderInfo = folderRes.data;
                } catch (folderErr) {
                    folderInfo = { error: 'Không tìm thấy hoặc không có quyền truy cập Folder ID này: ' + folderErr.message };
                }
            }

            return {
                configured: true,
                mode: 'GOOGLE_DRIVE',
                serviceAccountEmail: this.serviceAccountEmail,
                storageQuota: about.data.storageQuota,
                targetFolderId: DEFAULT_FOLDER_ID || 'ROOT (Chưa chỉ định Folder ID cụ thể)',
                targetFolderInfo: folderInfo,
                message: 'Google Drive API đã sẵn sàng hoạt động!'
            };
        } catch (error) {
            return {
                configured: false,
                mode: 'ERROR_FALLBACK_LOCAL',
                error: error.message,
                message: 'Không thể kết nối đến Google Drive API: ' + error.message
            };
        }
    }

    /**
     * Upload buffer lên Google Drive hoặc Local Storage nếu chưa cấu hình
     * @param {Object} options
     * @param {Buffer} options.buffer - Nội dung file
     * @param {string} options.originalname - Tên gốc của file
     * @param {string} options.mimetype - Định dạng file (image/png, application/pdf...)
     * @param {string} [options.subfolder] - Thư mục con (ví dụ: 'contracts', 'audits', 'proofs')
     * @param {string} [options.customFolderId] - ID thư mục Drive tùy chỉnh nếu muốn chỉ định
     */
    async uploadFile({ buffer, originalname, mimetype, subfolder = 'general', customFolderId = null }) {
        if (!buffer || !Buffer.isBuffer(buffer)) {
            throw new Error('File buffer không hợp lệ hoặc rỗng!');
        }

        // Tên file duy nhất
        const ext = path.extname(originalname || '') || (mimetype && mimetype.includes('png') ? '.png' : '.jpg');
        const cleanName = path.basename(originalname || 'file', ext).replace(/[^a-zA-Z0-9_-]/g, '_');
        const uniqueFileName = `${Date.now()}_${cleanName}${ext}`;

        // 1. NẾU ĐÃ CẤU HÌNH GOOGLE DRIVE -> ĐẨY LÊN DRIVE
        if (this.isConfigured()) {
            try {
                const targetFolder = customFolderId || DEFAULT_FOLDER_ID;
                const bufferStream = new stream.PassThrough();
                bufferStream.end(buffer);

                const fileMetadata = {
                    name: uniqueFileName,
                    parents: targetFolder ? [targetFolder] : undefined
                };

                const media = {
                    mimeType: mimetype || 'application/octet-stream',
                    body: bufferStream
                };

                const res = await this.drive.files.create({
                    requestBody: fileMetadata,
                    media: media,
                    fields: 'id, name, webViewLink, webContentLink, size, thumbnailLink'
                });

                const fileId = res.data.id;

                // Tự động cấp quyền 'anyone' có link xem được
                try {
                    await this.drive.permissions.create({
                        fileId: fileId,
                        requestBody: {
                            role: 'reader',
                            type: 'anyone'
                        }
                    });
                } catch (permErr) {
                    console.warn(`⚠️ [Google Drive] Cấp quyền công khai cho file ${fileId} bị lỗi:`, permErr.message);
                }

                // URL xem ảnh hoặc tài liệu
                const isImage = mimetype && mimetype.startsWith('image/');
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
                    thumbnailUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`,
                    size: buffer.length
                };
            } catch (driveErr) {
                console.error(`⚠️ [Google Drive] Lỗi khi upload lên Drive, chuyển sang lưu Local:`, driveErr.message);
            }
        }

        // 2. FALLBACK LƯU TRỮ LOCAL
        return this.saveToLocalStorage(buffer, uniqueFileName, subfolder);
    }

    /**
     * Lưu file vào ổ cứng local (public/uploads/{subfolder}/)
     */
    saveToLocalStorage(buffer, fileName, subfolder = 'general') {
        const localDir = path.join(__dirname, '../public/uploads', subfolder);
        if (!fs.existsSync(localDir)) {
            fs.mkdirSync(localDir, { recursive: true });
        }

        const filePath = path.join(localDir, fileName);
        fs.writeFileSync(filePath, buffer);

        const localUrl = `/uploads/${subfolder}/${fileName}`;
        return {
            success: true,
            storage: 'local',
            fileName: fileName,
            url: localUrl,
            size: buffer.length
        };
    }
}

// Export singleton instance
module.exports = new GoogleDriveService();
