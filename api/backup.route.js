const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const backupService = require('../services/backup.service');

const BACKUP_DIR = path.join(__dirname, '../backups');
const BACKUP_SECRET_KEY = process.env.BACKUP_SECRET_KEY || 'SUNGO_ERP_BACKUP_SECRET_2026';

// Middleware kiểm tra quyền sao lưu nghiêm ngặt
function verifyBackupAuth(req, res, next) {
    const providedSecret = req.query.secret || req.headers['x-backup-secret'];
    if (providedSecret && providedSecret === BACKUP_SECRET_KEY) {
        return next();
    }
    // Nếu có token user xác thực và là Admin
    if (req.user && ['ADMIN', 'SUPER_ADMIN', 'GIAM_DOC', 'DIRECTOR'].includes(String(req.user.role || '').toUpperCase())) {
        return next();
    }
    return res.status(403).json({
        success: false,
        error: '⛔ TỪ CHỐI TRUY CẬP: Yêu cầu mã xác thực Secret Key hợp lệ hoặc quyền Quản trị viên cấp cao!'
    });
}

/**
 * 1. Kích hoạt tiến trình sao lưu CSDL (Dành cho Google Cloud Scheduler hoặc Web Trigger)
 * GET /api/backup/run?secret=SUNGO_ERP_BACKUP_SECRET_2026
 */
router.get('/run', verifyBackupAuth, async (req, res) => {
    try {
        console.log('⏰ [Backup Engine] Nhận yêu cầu sao lưu hệ thống...');
        const result = await backupService.generateDatabaseDump();
        console.log(`✅ [Backup Engine] Hoàn tất sao lưu ${result.totalRows} dòng dữ liệu vào file ${result.fileName}`);
        
        return res.json({
            success: true,
            message: 'Sao lưu Cơ sở Dữ liệu thành công!',
            data: {
                fileName: result.fileName,
                timestamp: result.timestamp,
                fileSizeFormatted: `${(result.fileSize / 1024).toFixed(2)} KB`,
                totalRows: result.totalRows,
                summary: result.summary,
                driveUpload: result.driveResult ? {
                    status: 'SUCCESS',
                    fileId: result.driveResult.fileId,
                    url: result.driveResult.webViewLink || result.driveResult.url
                } : {
                    status: 'SAVED_LOCAL'
                }
            }
        });
    } catch (err) {
        console.error('❌ [Backup Engine] Lỗi khi tạo bản sao lưu:', err);
        return res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

/**
 * 2. Tải trực tiếp bản sao lưu CSDL mới nhất về máy tính (Yêu cầu xác thực nghiêm ngặt)
 * GET /api/backup/download
 */
router.get('/download', verifyBackupAuth, async (req, res) => {
    try {
        const result = await backupService.generateDatabaseDump();
        res.setHeader('Content-Type', 'application/sql');
        res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
        return res.send(result.sqlDump);
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 3. Xem danh sách các bản sao lưu đã tạo (Yêu cầu xác thực nghiêm ngặt)
 * GET /api/backup/list
 */
router.get('/list', verifyBackupAuth, (req, res) => {
    try {
        if (!fs.existsSync(BACKUP_DIR)) {
            return res.json({ success: true, files: [] });
        }

        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('SUNGO_BACKUP_') && (f.endsWith('.sql') || f.endsWith('.tar.gz')))
            .map(f => {
                const stat = fs.statSync(path.join(BACKUP_DIR, f));
                return {
                    name: f,
                    sizeBytes: stat.size,
                    sizeFormatted: `${(stat.size / 1024).toFixed(2)} KB`,
                    createdAt: stat.mtime
                };
            })
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        return res.json({ success: true, files });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
