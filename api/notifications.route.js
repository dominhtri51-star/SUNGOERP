const express = require('express');
const router = express.Router();
const notificationService = require('../services/notification.service');

/**
 * 1. GET /api/notifications/stream
 * Server-Sent Events (SSE) stream kết nối thời gian thực
 */
router.get('/stream', (req, res) => {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, error: 'Chưa đăng nhập!' });
    }

    // Thiết lập headers chuẩn cho Server-Sent Events
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    res.write(': connected\n\n');

    // Đăng ký client vào service
    notificationService.registerSSEClient(req.user, res);
});

/**
 * 2. GET /api/notifications
 * Lấy danh sách thông báo của người dùng hiện tại
 */
router.get('/', async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ success: false, error: 'Chưa đăng nhập!' });
        }

        const { limit = 50 } = req.query;
        const [notifications, unreadCount] = await Promise.all([
            notificationService.getNotificationsForUser(req.user.id, req.user.role, limit),
            notificationService.getUnreadCount(req.user.id, req.user.role)
        ]);

        res.json({
            success: true,
            data: notifications,
            unread_count: unreadCount
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 3. GET /api/notifications/unread-count
 * Lấy nhanh số lượng thông báo chưa đọc
 */
router.get('/unread-count', async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ success: false, error: 'Chưa đăng nhập!' });
        }

        const count = await notificationService.getUnreadCount(req.user.id, req.user.role);
        res.json({ success: true, unread_count: count });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 4. POST /api/notifications/:id/read
 * Đánh dấu 1 thông báo là đã đọc
 */
router.post('/:id/read', async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ success: false, error: 'Chưa đăng nhập!' });
        }

        const success = await notificationService.markAsRead(req.user.id, req.params.id);
        const unreadCount = await notificationService.getUnreadCount(req.user.id, req.user.role);

        res.json({ success, unread_count: unreadCount });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 5. POST /api/notifications/read-all
 * Đánh dấu toàn bộ thông báo là đã đọc
 */
router.post('/read-all', async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ success: false, error: 'Chưa đăng nhập!' });
        }

        const success = await notificationService.markAllAsRead(req.user.id, req.user.role);
        res.json({ success, unread_count: 0 });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 6. POST /api/notifications/test
 * Gửi thông báo thử nghiệm
 */
router.post('/test', async (req, res) => {
    try {
        const { type = 'MESSAGE', title = 'Thông báo thử nghiệm', body = 'Đây là nội dung thử nghiệm hệ thống thông báo', link = '#workplace' } = req.body;
        const notif = await notificationService.createNotification({
            type,
            title,
            body,
            link,
            sender_id: req.user ? req.user.id : null,
            sender_name: req.user ? (req.user.full_name || req.user.username) : 'Hệ Thống',
            target_roles: [],
            data: { is_test: true }
        });

        res.json({ success: true, data: notif });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
