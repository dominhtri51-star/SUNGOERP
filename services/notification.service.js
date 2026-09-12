const pool = require('../config/database');

/**
 * Quản lý danh sách kết nối SSE đang hoạt động
 * Map<userId, Set<{ res, role, userId }>>
 */
const activeClients = new Map();

/**
 * Đăng ký client nhận Server-Sent Events (SSE)
 */
function registerSSEClient(user, res) {
    if (!user || !user.id) return;
    const userId = parseInt(user.id, 10);
    const role = String(user.role || '').toUpperCase().trim();

    const clientObj = { res, role, userId };

    if (!activeClients.has(userId)) {
        activeClients.set(userId, new Set());
    }
    activeClients.get(userId).add(clientObj);

    // Xóa khi ngắt kết nối
    res.on('close', () => {
        const clientSet = activeClients.get(userId);
        if (clientSet) {
            clientSet.delete(clientObj);
            if (clientSet.size === 0) {
                activeClients.delete(userId);
            }
        }
    });
}

// Gửi tín hiệu Heartbeat ping định kỳ 20 giây chống ngắt kết nối (Cloud Run / Nginx)
setInterval(() => {
    for (const [userId, clientSet] of activeClients.entries()) {
        for (const client of clientSet) {
            try {
                client.res.write(': ping\n\n');
            } catch (e) {
                // Ignore write error on closed sockets
            }
        }
    }
}, 20000);

/**
 * Kiểm tra xem một vai trò người dùng có khớp với danh sách vai trò mục tiêu không
 */
function roleMatches(userRole, targetRoles) {
    const uRole = String(userRole || '').toUpperCase().trim();
    // Ban Giám Đốc và Admin luôn có quyền nhận thông báo chung
    if (uRole === 'ADMIN' || uRole === 'SUPER_ADMIN' || uRole === 'GIAM_DOC') {
        return true;
    }
    if (!Array.isArray(targetRoles) || targetRoles.length === 0) {
        return true; // Rỗng nghĩa là phát cho tất cả
    }
    const upperTargets = targetRoles.map(r => String(r).toUpperCase().trim());
    return upperTargets.includes(uRole);
}

/**
 * Tạo và phát sóng thông báo mới
 * @param {Object} opts
 * @param {string} opts.type - 'MESSAGE' | 'ORDER' | 'QUOTATION' | 'SYSTEM'
 * @param {string} opts.title - Tiêu đề ngắn gọn
 * @param {string} opts.body - Nội dung chi tiết
 * @param {string} [opts.link] - Đường link điều hướng (ví dụ: '#workplace', '#order-history?order_id=123')
 * @param {number} [opts.sender_id] - ID người gửi (nếu có)
 * @param {string} [opts.sender_name] - Tên người gửi
 * @param {number} [opts.recipient_id] - ID người nhận đích danh (nếu là thông báo cá nhân)
 * @param {string[]} [opts.target_roles] - Mảng các vai trò được nhận (ví dụ: ['SALE', 'ADMIN'])
 * @param {Object} [opts.data] - Dữ liệu mở rộng (order_id, code, ...)
 */
async function createNotification({
    type,
    title,
    body,
    link = '',
    sender_id = null,
    sender_name = '',
    recipient_id = null,
    target_roles = [],
    data = {}
}) {
    try {
        const cleanType = String(type || 'SYSTEM').toUpperCase().trim();
        const cleanTitle = String(title || 'Thông báo mới').trim();
        const cleanBody = String(body || '').trim();
        const safeRoles = Array.isArray(target_roles) ? target_roles : [];
        const safeData = (typeof data === 'object' && data !== null) ? data : {};

        // 1. Ghi vào CSDL PostgreSQL
        let insertedNotif = null;
        try {
            const insertRes = await pool.query(`
                INSERT INTO app_notifications (
                    type, title, body, link, sender_id, sender_name, recipient_id, target_roles, data
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING *
            `, [
                cleanType,
                cleanTitle,
                cleanBody,
                link,
                sender_id ? parseInt(sender_id, 10) : null,
                sender_name || '',
                recipient_id ? parseInt(recipient_id, 10) : null,
                JSON.stringify(safeRoles),
                JSON.stringify(safeData)
            ]);
            insertedNotif = insertRes.rows[0];
        } catch (dbErr) {
            console.error('⚠️ [NotificationService] Lỗi insert DB:', dbErr.message);
            insertedNotif = {
                id: Date.now(),
                type: cleanType,
                title: cleanTitle,
                body: cleanBody,
                link,
                sender_id,
                sender_name,
                recipient_id,
                target_roles: safeRoles,
                data: safeData,
                created_at: new Date().toISOString()
            };
        }

        invalidateUnreadCountCache();

        const payload = {
            id: insertedNotif.id,
            type: insertedNotif.type,
            title: insertedNotif.title,
            body: insertedNotif.body,
            link: insertedNotif.link,
            sender_id: insertedNotif.sender_id,
            sender_name: insertedNotif.sender_name,
            recipient_id: insertedNotif.recipient_id,
            data: insertedNotif.data,
            created_at: insertedNotif.created_at,
            is_read: false
        };

        const sseMessage = `event: notification\ndata: ${JSON.stringify(payload)}\n\n`;

        // 2. Phát sóng thời gian thực qua SSE
        for (const [uId, clientSet] of activeClients.entries()) {
            for (const client of clientSet) {
                try {
                    // Không gửi lại thông báo cho chính người tạo sự kiện (trừ khi cố ý)
                    if (sender_id && client.userId === parseInt(sender_id, 10)) {
                        continue;
                    }

                    // Nếu là thông báo đích danh 1 người
                    if (recipient_id) {
                        if (client.userId === parseInt(recipient_id, 10)) {
                            client.res.write(sseMessage);
                        }
                        continue;
                    }

                    // Nếu là thông báo theo vai trò hoặc toàn công ty
                    if (roleMatches(client.role, safeRoles)) {
                        client.res.write(sseMessage);
                    }
                } catch (sendErr) {
                    console.warn(`[NotificationService] Lỗi gửi SSE tới user ${uId}:`, sendErr.message);
                }
            }
        }

        return insertedNotif;
    } catch (err) {
        console.error('❌ [NotificationService] Lỗi createNotification:', err.message);
        return null;
    }
}

/**
 * Lấy danh sách thông báo cho người dùng kèm trạng thái đã đọc
 */
async function getNotificationsForUser(userId, userRole, limit = 50) {
    try {
        const uId = parseInt(userId, 10);
        const uRole = String(userRole || '').toUpperCase().trim();
        const maxLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);

        const res = await pool.query(`
            SELECT n.*,
                   (CASE WHEN r.read_at IS NOT NULL THEN TRUE ELSE FALSE END) AS is_read
            FROM app_notifications n
            LEFT JOIN app_notification_reads r ON n.id = r.notification_id AND r.user_id = $1
            WHERE (n.recipient_id = $1 
               OR (n.recipient_id IS NULL AND (
                   n.target_roles = '[]'::jsonb 
                   OR n.target_roles ? $2 
                   OR $2 = 'ADMIN' 
                   OR $2 = 'SUPER_ADMIN' 
                   OR $2 = 'GIAM_DOC'
               )))
            ORDER BY n.created_at DESC
            LIMIT $3
        `, [uId, uRole, maxLimit]);

        return res.rows;
    } catch (err) {
        console.error('❌ [NotificationService] Lỗi getNotificationsForUser:', err.message);
        return [];
    }
}

// ========================================================
// BỘ NHỚ ĐỆM RAM CHO UNREAD COUNT (Giảm 80% query app_notifications)
// ========================================================
const unreadCountCache = new Map(); // key: `${userId}_${userRole}` -> { count, expiresAt }
const UNREAD_CACHE_TTL_MS = 60 * 1000; // 60 giây (tự động invalidate ngay khi có thông báo mới hoặc đọc thông báo)

function invalidateUnreadCountCache(userId = null) {
    if (userId) {
        for (const key of unreadCountCache.keys()) {
            if (key.startsWith(`${userId}_`)) {
                unreadCountCache.delete(key);
            }
        }
    } else {
        unreadCountCache.clear();
    }
}

/**
 * Đếm số lượng thông báo chưa đọc của người dùng
 */
async function getUnreadCount(userId, userRole) {
    try {
        const uId = parseInt(userId, 10);
        const uRole = String(userRole || '').toUpperCase().trim();
        const cacheKey = `${uId}_${uRole}`;
        const now = Date.now();

        const cached = unreadCountCache.get(cacheKey);
        if (cached && now < cached.expiresAt) {
            return cached.count;
        }

        const res = await pool.query(`
            SELECT COUNT(*)::int AS unread_count
            FROM app_notifications n
            LEFT JOIN app_notification_reads r ON n.id = r.notification_id AND r.user_id = $1
            WHERE r.read_at IS NULL
              AND (n.recipient_id = $1 
               OR (n.recipient_id IS NULL AND (
                   n.target_roles = '[]'::jsonb 
                   OR n.target_roles ? $2 
                   OR $2 = 'ADMIN' 
                   OR $2 = 'SUPER_ADMIN' 
                   OR $2 = 'GIAM_DOC'
               )))
        `, [uId, uRole]);

        const count = res.rows[0] ? res.rows[0].unread_count : 0;
        unreadCountCache.set(cacheKey, { count, expiresAt: now + UNREAD_CACHE_TTL_MS });
        return count;
    } catch (err) {
        console.error('❌ [NotificationService] Lỗi getUnreadCount:', err.message);
        return 0;
    }
}

/**
 * Đánh dấu 1 thông báo là đã đọc
 */
async function markAsRead(userId, notificationId) {
    try {
        const uId = parseInt(userId, 10);
        const nId = parseInt(notificationId, 10);

        await pool.query(`
            INSERT INTO app_notification_reads (user_id, notification_id, read_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (user_id, notification_id) DO UPDATE SET read_at = NOW()
        `, [uId, nId]);

        invalidateUnreadCountCache(uId);
        return true;
    } catch (err) {
        console.error('❌ [NotificationService] Lỗi markAsRead:', err.message);
        return false;
    }
}

/**
 * Đánh dấu TẤT CẢ thông báo là đã đọc
 */
async function markAllAsRead(userId, userRole) {
    try {
        const uId = parseInt(userId, 10);
        const uRole = String(userRole || '').toUpperCase().trim();

        const unreadRes = await pool.query(`
            SELECT n.id
            FROM app_notifications n
            LEFT JOIN app_notification_reads r ON n.id = r.notification_id AND r.user_id = $1
            WHERE r.read_at IS NULL
              AND (n.recipient_id = $1 
               OR (n.recipient_id IS NULL AND (
                   n.target_roles = '[]'::jsonb 
                   OR n.target_roles ? $2 
                   OR $2 = 'ADMIN' 
                   OR $2 = 'SUPER_ADMIN' 
                   OR $2 = 'GIAM_DOC'
               )))
        `, [uId, uRole]);

        if (unreadRes.rows.length > 0) {
            const ids = unreadRes.rows.map(r => r.id);
            await pool.query(`
                INSERT INTO app_notification_reads (user_id, notification_id, read_at)
                SELECT $1, unnest($2::int[]), NOW()
                ON CONFLICT (user_id, notification_id) DO NOTHING
            `, [uId, ids]);
        }

        invalidateUnreadCountCache(uId);
        return true;
    } catch (err) {
        console.error('❌ [NotificationService] Lỗi markAllAsRead:', err.message);
        return false;
    }
}

module.exports = {
    registerSSEClient,
    createNotification,
    getNotificationsForUser,
    getUnreadCount,
    markAsRead,
    markAllAsRead
};
