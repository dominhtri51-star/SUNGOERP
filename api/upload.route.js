const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const googleDriveService = require('../services/googleDrive.service');

const ALLOWED_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif', 'avif',
    'pdf', 'xlsx', 'xls', 'csv', 'doc', 'docx', 'txt', 'zip'
]);
const BLOCKED_EXTENSIONS = new Set([
    'html', 'htm', 'xhtml', 'svg', 'xml', 'exe', 'bat', 'cmd', 'sh', 'php', 'js', 'vbs', 'scr', 'msi', 'bin'
]);

function isSafeFile(originalname) {
    if (!originalname) return false;
    const parts = originalname.toLowerCase().split('.');
    if (parts.length < 2) return false;
    const ext = parts.pop();
    if (BLOCKED_EXTENSIONS.has(ext)) return false;
    return ALLOWED_EXTENSIONS.has(ext);
}

// Sử dụng MemoryStorage để nhận buffer trực tiếp và chuyển tới Google Drive / Local Storage Service
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // Tối đa 50MB
});

// Middleware linh hoạt nhận field 'image', 'file', hoặc 'proof_file'
const uploadFlexible = upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'file', maxCount: 1 },
    { name: 'proof_file', maxCount: 1 },
    { name: 'signed_file', maxCount: 1 }
]);

/**
 * GET /api/upload/drive-status
 * Kiểm tra trạng thái kết nối Google Drive API
 */
router.get('/drive-status', async (req, res) => {
    try {
        const status = await googleDriveService.checkStatus();
        res.json({ success: true, ...status });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /api/upload
 * Upload 1 file ảnh hoặc tài liệu
 */
router.post('/', uploadFlexible, async (req, res) => {
    try {
        const file = req.files?.image?.[0] || req.files?.file?.[0] || req.files?.proof_file?.[0] || req.files?.signed_file?.[0] || req.file;

        if (!file) {
            return res.status(400).json({ success: false, error: 'Chưa nhận được file upload!' });
        }

        if (!isSafeFile(file.originalname)) {
            return res.status(400).json({
                success: false,
                error: '⛔ Định dạng file không được phép tải lên! Hệ thống chỉ hỗ trợ ảnh (.jpg, .png, .webp, .heic) và tài liệu (.pdf, .xlsx, .docx).'
            });
        }

        const subfolder = String(req.body.subfolder || 'general').replace(/[^a-zA-Z0-9_-]/g, '') || 'general';
        const result = await googleDriveService.uploadFile({
            buffer: file.buffer,
            originalname: file.originalname,
            mimetype: file.mimetype,
            subfolder: subfolder
        });

        res.json({
            success: true,
            url: result.url,
            storage: result.storage,
            fileId: result.fileId || null,
            webViewLink: result.webViewLink || null,
            downloadUrl: result.downloadUrl || null,
            fileName: result.fileName
        });
    } catch (error) {
        console.error('LỖI UPLOAD FILE:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/upload/from-url
 * Tải ảnh từ URL (Google Drive, CDN ngoài, web) và lưu trữ vĩnh viễn trên Cloud Storage
 */
router.post('/from-url', async (req, res) => {
    try {
        let { url, subfolder = 'products' } = req.body;
        if (!url || typeof url !== 'string') {
            return res.status(400).json({ success: false, error: 'Thiếu đường dẫn URL ảnh!' });
        }

        url = url.trim();

        // Chuyển đổi nếu là link Google Drive
        const driveMatch1 = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i);
        const driveMatch2 = url.match(/drive\.google\.com\/(?:open|uc)\?(?:.*&)?id=([a-zA-Z0-9_-]+)/i);
        const fileId = (driveMatch1 && driveMatch1[1]) || (driveMatch2 && driveMatch2[1]);
        
        let fetchUrl = url;
        if (fileId) {
            // Dùng direct download link của Google Drive
            fetchUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
        }

        const response = await fetch(fetchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) {
            // Thử fallback link download dự phòng của Drive
            if (fileId) {
                const fallbackRes = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}`);
                if (fallbackRes.ok) {
                    const arrayBuf = await fallbackRes.arrayBuffer();
                    const buffer = Buffer.from(arrayBuf);
                    const mime = fallbackRes.headers.get('content-type') || 'image/jpeg';
                    const result = await googleDriveService.uploadFile({
                        buffer,
                        originalname: `drive_${fileId}.jpg`,
                        mimetype: mime,
                        subfolder: subfolder
                    });
                    return res.json({ success: true, ...result });
                }
            }
            return res.status(400).json({ success: false, error: `Không thể tải ảnh từ URL (Mã lỗi: ${response.status})` });
        }

        const arrayBuf = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        
        let ext = '.jpg';
        if (contentType.includes('png')) ext = '.png';
        else if (contentType.includes('webp')) ext = '.webp';
        else if (contentType.includes('gif')) ext = '.gif';

        const fileName = fileId ? `drive_${fileId}${ext}` : `imported_${Date.now()}${ext}`;

        const result = await googleDriveService.uploadFile({
            buffer,
            originalname: fileName,
            mimetype: contentType,
            subfolder: subfolder
        });

        res.json({
            success: true,
            url: result.url,
            storage: result.storage,
            fileName: result.fileName,
            downloadUrl: result.downloadUrl
        });
    } catch (error) {
        console.error('LỖI UPLOAD TỪ URL:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/upload/multiple
 * Upload nhiều file cùng lúc
 */
router.post('/multiple', upload.array('files', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, error: 'Chưa nhận được file nào!' });
        }

        const unsafeFile = req.files.find(f => !isSafeFile(f.originalname));
        if (unsafeFile) {
            return res.status(400).json({
                success: false,
                error: `⛔ File "${unsafeFile.originalname}" không được phép tải lên!`
            });
        }

        const subfolder = String(req.body.subfolder || 'general').replace(/[^a-zA-Z0-9_-]/g, '') || 'general';
        const uploadPromises = req.files.map(file =>
            googleDriveService.uploadFile({
                buffer: file.buffer,
                originalname: file.originalname,
                mimetype: file.mimetype,
                subfolder: subfolder
            })
        );

        const results = await Promise.all(uploadPromises);
        res.json({
            success: true,
            files: results
        });
    } catch (error) {
        console.error('LỖI UPLOAD MULTIPLE:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
