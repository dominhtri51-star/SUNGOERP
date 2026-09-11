const webpush = require('web-push');
const pool = require('../config/database');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BPlD-xB7amdWZ6CmMdmy0rPG6-YSe7MBibWaXu4l-KM95OYrjGmufKT8TIC04nobqwBvH89aq9kiUJ3UXztC2os';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'VpEZsOFt8FWxvx6HtbfBUmzT5PaoqEDFwzUAn-r_wTI';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@sungo.vn';

try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} catch (e) {
    console.warn('[PushService] Khởi tạo VAPID warning:', e.message);
}

/**
 * Lấy VAPID Public Key để trình duyệt đăng ký PushManager
 */
function getPublicKey() {
    return VAPID_PUBLIC_KEY;
}

/**
 * Lưu đăng ký Web Push từ trình duyệt
 */
async function saveSubscription(userId, subscription, userAgent = '') {
    if (!subscription || !subscription.endpoint) return null;
    const endpoint = subscription.endpoint;
    const p256dh = subscription.keys ? subscription.keys.p256dh : '';
    const auth = subscription.keys ? subscription.keys.auth : '';

    const res = await pool.query(`
        INSERT INTO user_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (endpoint) 
        DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent, updated_at = NOW()
        RETURNING *
    `, [userId ? parseInt(userId, 10) : null, endpoint, p256dh, auth, userAgent]);

    return res.rows[0];
}

/**
 * Gửi thông báo đẩy ngầm tới danh sách người dùng (Mobile Background Notification)
 * @param {number[]|null} targetUserIds - null nếu gửi cho tất cả
 * @param {Object} payload - { title, body, url, icon, badge, tag }
 * @param {number} [excludeUserId] - Loại trừ người gửi
 */
async function sendPushToUsers(targetUserIds, payload, excludeUserId = null) {
    try {
        let query = `SELECT id, user_id, endpoint, p256dh, auth FROM user_push_subscriptions`;
        const params = [];

        if (Array.isArray(targetUserIds) && targetUserIds.length > 0) {
            params.push(targetUserIds);
            query += ` WHERE user_id = ANY($${params.length})`;
            if (excludeUserId) {
                params.push(parseInt(excludeUserId, 10));
                query += ` AND user_id != $${params.length}`;
            }
        } else if (excludeUserId) {
            params.push(parseInt(excludeUserId, 10));
            query += ` WHERE (user_id IS NULL OR user_id != $${params.length})`;
        }

        const subsRes = await pool.query(query, params);
        if (subsRes.rows.length === 0) return { sent: 0, failed: 0 };

        const stringPayload = JSON.stringify({
            title: payload.title || '💬 SUNGO Workplace',
            body: payload.body || 'Bạn có tin nhắn mới',
            url: payload.url || '/dashboard.html#workplace',
            icon: payload.icon || '/icons/icon-192.png',
            badge: payload.badge || '/icons/icon-192.png',
            tag: payload.tag || 'sungo-wp-msg'
        });

        let sentCount = 0;
        let expiredEndpoints = [];

        for (const sub of subsRes.rows) {
            const pushConfig = {
                endpoint: sub.endpoint,
                keys: {
                    p256dh: sub.p256dh,
                    auth: sub.auth
                }
            };

            try {
                await webpush.sendNotification(pushConfig, stringPayload, {
                    TTL: 86400,
                    urgency: 'high'
                });
                sentCount++;
            } catch (pushErr) {
                if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
                    expiredEndpoints.push(sub.endpoint);
                }
            }
        }

        if (expiredEndpoints.length > 0) {
            await pool.query(`DELETE FROM user_push_subscriptions WHERE endpoint = ANY($1)`, [expiredEndpoints]);
        }

        return { sent: sentCount, expired: expiredEndpoints.length };
    } catch (e) {
        console.warn('[PushService] sendPushToUsers warning:', e.message);
        return { sent: 0, error: e.message };
    }
}

module.exports = {
    getPublicKey,
    saveSubscription,
    sendPushToUsers
};
