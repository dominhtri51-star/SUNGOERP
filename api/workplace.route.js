const express = require('express');
const router = express.Router();
const pool = require('../config/database');

/**
 * TỰ ĐỘNG KHỞI TẠO CƠ SỞ DỮ LIỆU WORKPLACE
 */
(async () => {
    try {
        if (pool && typeof pool.query === 'function') {
            await pool.query(`
                -- 1. Bảng kênh phòng ban & nhóm làm việc
                CREATE TABLE IF NOT EXISTS workplace_channels (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    slug VARCHAR(100) UNIQUE NOT NULL,
                    description TEXT,
                    icon VARCHAR(50) DEFAULT 'fa-hashtag',
                    type VARCHAR(20) DEFAULT 'PUBLIC', -- 'PUBLIC', 'GROUP', 'ANNOUNCEMENT'
                    is_announcement_only BOOLEAN DEFAULT FALSE,
                    allowed_roles JSONB DEFAULT '[]'::jsonb,
                    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                -- 2. Bảng thành viên tham gia nhóm chỉ định (Admin phân công)
                CREATE TABLE IF NOT EXISTS workplace_channel_members (
                    channel_id INTEGER REFERENCES workplace_channels(id) ON DELETE CASCADE,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (channel_id, user_id)
                );

                -- 3. Bảng tin nhắn / bài đăng / tài liệu
                CREATE TABLE IF NOT EXISTS workplace_messages (
                    id SERIAL PRIMARY KEY,
                    channel_id INTEGER REFERENCES workplace_channels(id) ON DELETE CASCADE,
                    sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    sender_name VARCHAR(255) NOT NULL,
                    sender_role VARCHAR(50) DEFAULT 'SALE',
                    recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    content TEXT NOT NULL,
                    attachments JSONB DEFAULT '[]'::jsonb,
                    is_pinned BOOLEAN DEFAULT FALSE,
                    priority VARCHAR(20) DEFAULT 'NORMAL',
                    reactions JSONB DEFAULT '{}'::jsonb,
                    reply_to_id INTEGER REFERENCES workplace_messages(id) ON DELETE SET NULL,
                    reply_to_sender VARCHAR(255),
                    reply_to_content TEXT,
                    is_edited BOOLEAN DEFAULT FALSE,
                    is_recalled BOOLEAN DEFAULT FALSE,
                    message_type VARCHAR(20) DEFAULT 'TEXT',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                -- Đảm bảo các cột mới tồn tại nếu bảng đã được tạo trước đó
                ALTER TABLE workplace_messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES workplace_messages(id) ON DELETE SET NULL;
                ALTER TABLE workplace_messages ADD COLUMN IF NOT EXISTS reply_to_sender VARCHAR(255);
                ALTER TABLE workplace_messages ADD COLUMN IF NOT EXISTS reply_to_content TEXT;
                ALTER TABLE workplace_messages ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT FALSE;
                ALTER TABLE workplace_messages ADD COLUMN IF NOT EXISTS is_recalled BOOLEAN DEFAULT FALSE;
                ALTER TABLE workplace_messages ADD COLUMN IF NOT EXISTS message_type VARCHAR(20) DEFAULT 'TEXT';

                -- 3.1. Bảng lưu Web Push Subscription cho PWA Mobile
                CREATE TABLE IF NOT EXISTS user_push_subscriptions (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    endpoint TEXT NOT NULL UNIQUE,
                    p256dh TEXT NOT NULL,
                    auth TEXT NOT NULL,
                    user_agent TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                -- 4. Chỉ mục B-Tree tăng tốc truy vấn
                CREATE INDEX IF NOT EXISTS idx_wp_msg_channel_id ON workplace_messages(channel_id, id DESC);
                CREATE INDEX IF NOT EXISTS idx_wp_msg_recipient ON workplace_messages(recipient_id, sender_id, id DESC);
                CREATE INDEX IF NOT EXISTS idx_wp_msg_pinned ON workplace_messages(channel_id, is_pinned);
                CREATE INDEX IF NOT EXISTS idx_wp_chan_members ON workplace_channel_members(channel_id, user_id);
                CREATE INDEX IF NOT EXISTS idx_push_user_id ON user_push_subscriptions(user_id);

                -- 5. Khởi tạo sẵn các kênh mặc định
                INSERT INTO workplace_channels (name, slug, description, icon, type, is_announcement_only)
                VALUES
                    ('Thông Báo Toàn Công Ty', 'thong-bao', 'Kênh phát hành các thông báo chỉ đạo, chính sách và quyết định từ Ban Giám Đốc', 'fa-bullhorn', 'ANNOUNCEMENT', TRUE),
                    ('Phòng Kinh Doanh & Bán Hàng', 'kinh-doanh', 'Trao đổi nội bộ phòng Kinh Doanh, tư vấn khách hàng, báo giá và chốt đơn hàng', 'fa-briefcase', 'PUBLIC', FALSE),
                    ('Kỹ Thuật & Thi Công EPC', 'ky-thuat', 'Trao đổi bản vẽ, khảo sát mái, xử lý kỹ thuật và tiến độ thi công', 'fa-tools', 'PUBLIC', FALSE),
                    ('Kho Vận & Đóng Gói WMS', 'kho-van', 'Điều phối xuất nhập kho, giao vận thiết bị pin mặt trời và inverter', 'fa-boxes', 'PUBLIC', FALSE),
                    ('Kế Toán & Tài Chính', 'ke-toan', 'Đối soát thanh toán, tạm ứng, xuất hóa đơn VAT và thu hồi công nợ', 'fa-wallet', 'PUBLIC', FALSE),
                    ('Giao Lưu & Trò Chuyện Chung', 'giao-luu', 'Góc thư giãn, sinh nhật và giao lưu gắn kết giữa các thành viên SUNGO', 'fa-coffee', 'PUBLIC', FALSE)
                ON CONFLICT (slug) DO NOTHING;

                -- 6. Tạo sẵn nhóm phối hợp mẫu: "Sale 🤝 Kho Vận (Xử Lý Hàng Gấp)"
                INSERT INTO workplace_channels (name, slug, description, icon, type, is_announcement_only)
                VALUES
                    ('Sale 🤝 Kho Vận (Xử Lý Hàng Gấp)', 'sale-kho-van-gap', 'Kênh phối hợp tức thời giữa đội Kinh Doanh và Thủ Kho: Kiểm tồn thực tế và xuất hàng hỏa tốc', 'fa-handshake', 'GROUP', FALSE)
                ON CONFLICT (slug) DO NOTHING;
            `);

            // Tự động thêm các nhân viên Sale và Kho vào nhóm phối hợp mẫu nếu có
            const sampleGroupRes = await pool.query("SELECT id FROM workplace_channels WHERE slug = 'sale-kho-van-gap' LIMIT 1");
            if (sampleGroupRes.rows.length > 0) {
                const groupId = sampleGroupRes.rows[0].id;
                // Thêm admin và các tài khoản sale, kho vào nhóm
                await pool.query(`
                    INSERT INTO workplace_channel_members (channel_id, user_id)
                    SELECT $1, id FROM users WHERE role IN ('ADMIN', 'SUPER_ADMIN', 'GIAM_DOC', 'SALE', 'SALE_ADMIN', 'SALES', 'NHAN_VIEN_KHO', 'WAREHOUSE')
                    ON CONFLICT (channel_id, user_id) DO NOTHING;
                `, [groupId]);
            }

            // Tạo bài đăng chào mừng đầu tiên trong kênh thông báo nếu chưa có
            const chanRes = await pool.query("SELECT id FROM workplace_channels WHERE slug = 'thong-bao' LIMIT 1");
            if (chanRes.rows.length > 0) {
                const chanId = chanRes.rows[0].id;
                const countRes = await pool.query("SELECT COUNT(*) FROM workplace_messages WHERE channel_id = $1", [chanId]);
                if (parseInt(countRes.rows[0].count, 10) === 0) {
                    await pool.query(`
                        INSERT INTO workplace_messages (channel_id, sender_name, sender_role, content, is_pinned, priority)
                        VALUES ($1, 'Ban Giám Đốc SUNGO', 'GIAM_DOC', 
                        '🎉 CHÀO MỪNG TOÀN THỂ CÁN BỘ NHÂN VIÊN ĐẾN VỚI KHÔNG GIAN LÀM VIỆC NỘI BỘ SUNGO WORKPLACE!\n\nKể từ hôm nay, toàn bộ thông báo chỉ đạo, chính sách kinh doanh và trao đổi công việc giữa các phòng ban sẽ được tập trung chính thức về phân hệ Workplace nội bộ này nhằm đảm bảo an toàn tuyệt đối thông tin bảo mật và tốc độ tương tác cao nhất. Chúc toàn thể anh chị em làm việc hiệu quả và bùng nổ doanh số!\n\nTrân trọng,\nBan Giám Đốc Cổ Phần Công Nghệ Năng Lượng SUNGO.',
                        TRUE, 'IMPORTANT');
                    `, [chanId]);
                }
            }
            console.log("🔌 [Workplace Engine] Khởi tạo CSDL Workplace thành công!");
        }
    } catch (e) {
        console.error("⚠️ [Workplace Engine] Lỗi khởi tạo CSDL:", e.message);
    }
})();

// Helper kiểm tra quyền Quản trị / Giám đốc
function isLeaderOrAdmin(role) {
    const r = String(role || '').toUpperCase().trim();
    return ['ADMIN', 'SUPER_ADMIN', 'GIAM_DOC', 'DIRECTOR', 'TONG_GIAM_DOC'].includes(r);
}

/**
 * 1. GET /api/workplace/channels
 * Lấy danh sách các kênh công khai + các nhóm mà user được phân công tham gia + Danh bạ nhân viên
 */
router.get('/channels', async (req, res) => {
    try {
        const currentUserId = req.user ? req.user.id : -1;
        const isAdmin = req.user && isLeaderOrAdmin(req.user.role);

        // 1. Lấy danh sách kênh công khai + nhóm được phân công
        let channelQuery = `
            SELECT c.*, 
                   (SELECT COUNT(*) FROM workplace_messages m WHERE m.channel_id = c.id) as total_messages,
                   (SELECT m.content FROM workplace_messages m WHERE m.channel_id = c.id ORDER BY m.id DESC LIMIT 1) as last_message,
                   (SELECT m.created_at FROM workplace_messages m WHERE m.channel_id = c.id ORDER BY m.id DESC LIMIT 1) as last_activity,
                   (SELECT COUNT(*) FROM workplace_channel_members cm WHERE cm.channel_id = c.id) as member_count,
                   EXISTS(SELECT 1 FROM workplace_channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = $1) as is_member
            FROM workplace_channels c
            WHERE $2 = TRUE -- Admin luôn xem được tất cả các kênh để quản lý
               OR (SELECT COUNT(*) FROM workplace_channel_members cm WHERE cm.channel_id = c.id) = 0 -- Mở cho toàn công ty nếu chưa giới hạn thành viên
               OR EXISTS(SELECT 1 FROM workplace_channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = $1) -- Hoặc user là thành viên được chỉ định
            ORDER BY 
               CASE WHEN c.type = 'ANNOUNCEMENT' THEN 1 WHEN c.type = 'PUBLIC' THEN 2 ELSE 3 END,
               c.id ASC
        `;

        const channelsRes = await pool.query(channelQuery, [currentUserId, isAdmin]);

        // 2. Lấy danh bạ người dùng để chat 1-1 (loại bỏ chính mình)
        const usersRes = await pool.query(`
            SELECT u.id, u.username, u.full_name, u.role, u.emp_id,
                   COALESCE(e.position, u.role) as position,
                   COALESCE(e.department_role, '') as department,
                   COALESCE(e.phone, '') as phone
            FROM users u
            LEFT JOIN employees e ON UPPER(e.emp_code) = UPPER(u.emp_id)
            WHERE u.id != $1
            ORDER BY u.full_name ASC
        `, [currentUserId]);

        res.json({
            success: true,
            data: {
                channels: channelsRes.rows,
                direct_users: usersRes.rows,
                is_admin: isAdmin
            }
        });
    } catch (err) {
        console.error('Lỗi GET /api/workplace/channels:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 2. POST /api/workplace/channels (Tạo nhóm mới theo phân công - Dành cho Quản trị viên)
 */
router.post('/channels', async (req, res) => {
    try {
        if (!req.user || !isLeaderOrAdmin(req.user.role)) {
            return res.status(403).json({ success: false, error: 'Chỉ Ban Giám Đốc hoặc Quản trị viên mới được tạo nhóm làm việc mới!' });
        }

        const { name, description, icon, type = 'GROUP', member_ids = [] } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, error: 'Tên nhóm làm việc không được để trống!' });
        }

        // Tạo slug từ name
        const slug = name.trim().toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-") + '-' + Math.floor(Math.random() * 1000);

        const result = await pool.query(`
            INSERT INTO workplace_channels (name, slug, description, icon, type, is_announcement_only, created_by)
            VALUES ($1, $2, $3, $4, $5, FALSE, $6)
            RETURNING *
        `, [name.trim(), slug, description || '', icon || 'fa-users', type || 'GROUP', req.user.id]);

        const newChannel = result.rows[0];

        // Tự động thêm admin người tạo vào nhóm
        let membersToInsert = Array.isArray(member_ids) ? [...member_ids] : [];
        if (!membersToInsert.includes(req.user.id)) {
            membersToInsert.push(req.user.id);
        }

        if (membersToInsert.length > 0) {
            const memberInserts = membersToInsert.map(uid => `(${newChannel.id}, ${parseInt(uid, 10)}, ${req.user.id})`).join(', ');
            await pool.query(`
                INSERT INTO workplace_channel_members (channel_id, user_id, added_by)
                VALUES ${memberInserts}
                ON CONFLICT (channel_id, user_id) DO NOTHING;
            `);
        }

        res.json({ 
            success: true, 
            data: newChannel, 
            message: `Tạo nhóm "${newChannel.name}" với ${membersToInsert.length} thành viên thành công!` 
        });
    } catch (err) {
        console.error('Lỗi POST /api/workplace/channels:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 3. GET /api/workplace/channels/:id/members (Lấy danh sách thành viên của một kênh / nhóm)
 */
router.get('/channels/:id/members', async (req, res) => {
    try {
        const { id } = req.params;
        const chanRes = await pool.query(`SELECT id, name, slug, icon, type, is_announcement_only FROM workplace_channels WHERE id = $1`, [id]);
        if (chanRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy kênh này!' });
        }

        const membersRes = await pool.query(`
            SELECT user_id FROM workplace_channel_members WHERE channel_id = $1
        `, [id]);
        const memberIds = membersRes.rows.map(r => r.user_id);

        const usersRes = await pool.query(`
            SELECT u.id, u.username, u.full_name, u.role, u.emp_id,
                   COALESCE(e.position, u.role) as position,
                   COALESCE(e.department_role, '') as department,
                   COALESCE(e.phone, '') as phone
            FROM users u
            LEFT JOIN employees e ON UPPER(e.emp_code) = UPPER(u.emp_id)
            ORDER BY u.full_name ASC
        `);

        res.json({
            success: true,
            data: {
                channel: chanRes.rows[0],
                member_ids: memberIds,
                users: usersRes.rows
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 4. PUT /api/workplace/channels/:id/members (Cập nhật thành viên nhóm - Dành cho Admin)
 */
router.put('/channels/:id/members', async (req, res) => {
    try {
        if (!req.user || !isLeaderOrAdmin(req.user.role)) {
            return res.status(403).json({ success: false, error: 'Chỉ Ban Giám Đốc hoặc Quản trị viên mới được quản lý thành viên nhóm!' });
        }

        const { id } = req.params;
        const { member_ids } = req.body;

        if (!Array.isArray(member_ids)) {
            return res.status(400).json({ success: false, error: 'Danh sách thành viên không hợp lệ!' });
        }

        // Xóa phân công cũ
        await pool.query(`DELETE FROM workplace_channel_members WHERE channel_id = $1`, [id]);

        // Nếu member_ids có phần tử -> gán thành viên; nếu rỗng -> mở cho toàn công ty
        if (member_ids.length > 0) {
            let finalMembers = [...member_ids];
            if (!finalMembers.includes(req.user.id)) finalMembers.push(req.user.id);

            const memberInserts = finalMembers.map(uid => `(${id}, ${parseInt(uid, 10)}, ${req.user.id})`).join(', ');
            await pool.query(`
                INSERT INTO workplace_channel_members (channel_id, user_id, added_by)
                VALUES ${memberInserts}
                ON CONFLICT (channel_id, user_id) DO NOTHING;
            `);
        }

        res.json({ 
            success: true, 
            message: member_ids.length === 0 
                ? 'Đã mở nhóm này cho toàn bộ nhân viên công ty!' 
                : `Đã cập nhật phân công ${member_ids.length} thành viên cho nhóm!` 
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ========================================================
// SMART CONVERSATION VERSIONING (Tiết kiệm >90% DB Egress)
// Trả về { unchanged: true } từ RAM trong 0.001ms nếu kênh không có tin mới
// ========================================================
const conversationVersions = new Map();

function getConversationKey(channelId, directUserId, currentUserId) {
    if (channelId) return `chan_${channelId}`;
    if (directUserId && currentUserId) {
        const u1 = Math.min(parseInt(directUserId, 10), parseInt(currentUserId, 10));
        const u2 = Math.max(parseInt(directUserId, 10), parseInt(currentUserId, 10));
        return `dm_${u1}_${u2}`;
    }
    return null;
}

function bumpConversationVersion(channelId, directUserId, currentUserId) {
    const key = getConversationKey(channelId, directUserId, currentUserId);
    if (key) {
        conversationVersions.set(key, Date.now());
    }
}

/**
 * 5. GET /api/workplace/messages
 * Lấy tin nhắn theo kênh/nhóm hoặc theo người nhắn 1-1
 * Query: ?channel_id=1 hoặc ?direct_user_id=5 &v=timestamp
 */
router.get('/messages', async (req, res) => {
    try {
        const { channel_id, direct_user_id, before_id, limit = 50, v } = req.query;
        const currentUserId = req.user ? req.user.id : -1;
        const isAdmin = req.user && isLeaderOrAdmin(req.user.role);
        const queryLimit = Math.min(parseInt(limit, 10) || 50, 100);

        const clientVersion = v ? parseInt(v, 10) : null;
        const convKey = getConversationKey(channel_id, direct_user_id, currentUserId);
        const currentVersion = convKey ? (conversationVersions.get(convKey) || 0) : 0;

        // Nếu client gửi version trùng khớp với RAM server và không phải cuộn lên xem tin cũ (before_id)
        // -> Trả về ngay lập tức không cần chạm vào Supabase (0 DB Queries, 0 Byte Egress!)
        if (clientVersion && currentVersion > 0 && clientVersion === currentVersion && !before_id) {
            return res.json({
                success: true,
                unchanged: true,
                v: currentVersion
            });
        }

        let query = '';
        let params = [];

        if (direct_user_id) {
            // Cuộc trò chuyện 1-1 riêng tư giữa 2 nhân viên
            const targetId = parseInt(direct_user_id, 10);
            query = `
                SELECT m.*, 
                       u_sender.username as sender_username,
                       u_sender.full_name as sender_full_name,
                       u_rec.full_name as recipient_full_name
                FROM workplace_messages m
                LEFT JOIN users u_sender ON m.sender_id = u_sender.id
                LEFT JOIN users u_rec ON m.recipient_id = u_rec.id
                WHERE ((m.sender_id = $1 AND m.recipient_id = $2)
                   OR (m.sender_id = $2 AND m.recipient_id = $1))
            `;
            params = [currentUserId, targetId];

            if (before_id) {
                params.push(parseInt(before_id, 10));
                query += ` AND m.id < $${params.length}`;
            }

            params.push(queryLimit);
            query += ` ORDER BY m.id DESC LIMIT $${params.length}`;
        } else if (channel_id) {
            const chanId = parseInt(channel_id, 10);

            // Kiểm tra bảo mật: Nếu là nhóm phân công (GROUP), người dùng phải là thành viên hoặc Admin
            const chanCheck = await pool.query("SELECT type, name FROM workplace_channels WHERE id = $1", [chanId]);
            if (chanCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Không tìm thấy kênh này!' });
            }

            if (!isAdmin) {
                const memberCountRes = await pool.query(
                    "SELECT COUNT(*) FROM workplace_channel_members WHERE channel_id = $1",
                    [chanId]
                );
                const hasRestrictions = parseInt(memberCountRes.rows[0].count, 10) > 0;
                if (hasRestrictions) {
                    const memberCheck = await pool.query(
                        "SELECT 1 FROM workplace_channel_members WHERE channel_id = $1 AND user_id = $2",
                        [chanId, currentUserId]
                    );
                    if (memberCheck.rows.length === 0) {
                        return res.status(403).json({ success: false, error: 'Bạn không thuộc danh sách thành viên của nhóm này!' });
                    }
                }
            }

            query = `
                SELECT m.*, 
                       u.username as sender_username,
                       u.full_name as sender_full_name
                FROM workplace_messages m
                LEFT JOIN users u ON m.sender_id = u.id
                WHERE m.channel_id = $1
            `;
            params = [chanId];

            if (before_id) {
                params.push(parseInt(before_id, 10));
                query += ` AND m.id < $${params.length}`;
            }

            params.push(queryLimit);
            query += ` ORDER BY m.id DESC LIMIT $${params.length}`;
        } else {
            return res.status(400).json({ success: false, error: 'Thiếu tham số channel_id hoặc direct_user_id!' });
        }

        const result = await pool.query(query, params);
        const messages = result.rows.reverse();

        // Lấy thông báo ghim nếu là kênh
        let pinnedMessage = null;
        if (channel_id) {
            const pinRes = await pool.query(`
                SELECT m.*, u.full_name as sender_full_name
                FROM workplace_messages m
                LEFT JOIN users u ON m.sender_id = u.id
                WHERE m.channel_id = $1 AND m.is_pinned = TRUE
                ORDER BY m.id DESC LIMIT 1
            `, [parseInt(channel_id, 10)]);
            if (pinRes.rows.length > 0) {
                pinnedMessage = pinRes.rows[0];
            }
        }

        let versionToReturn = currentVersion;
        if (!versionToReturn) {
            versionToReturn = Date.now();
            if (convKey) conversationVersions.set(convKey, versionToReturn);
        }

        res.json({
            success: true,
            v: versionToReturn,
            data: {
                messages,
                pinned: pinnedMessage
            }
        });
    } catch (err) {
        console.error('Lỗi GET /api/workplace/messages:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 6. POST /api/workplace/messages
 * Gửi tin nhắn mới / Đăng thông báo
 */
router.post('/messages', async (req, res) => {
    try {
        const { 
            channel_id, direct_user_id, content, attachments, priority = 'NORMAL', is_pinned = false,
            reply_to_id, reply_to_sender, reply_to_content, message_type = 'TEXT'
        } = req.body;
        const currentUserId = req.user ? req.user.id : null;
        const senderName = req.user ? (req.user.full_name || req.user.username) : 'Nhân Viên SUNGO';
        const senderRole = req.user ? req.user.role : 'SALE';
        const isAdmin = req.user && isLeaderOrAdmin(req.user.role);

        if (!content || !content.trim()) {
            if (!Array.isArray(attachments) || attachments.length === 0) {
                return res.status(400).json({ success: false, error: 'Nội dung tin nhắn hoặc tài liệu đính kèm không được để trống!' });
            }
        }

        const cleanContent = (content || '').trim();
        const safeAttachments = Array.isArray(attachments) ? attachments : [];
        const cleanMsgType = ['TEXT', 'AUDIO', 'FILE', 'IMAGE', 'ORDER_CARD', 'PRINT_SLIP'].includes(message_type) ? message_type : 'TEXT';

        let finalReplyToId = reply_to_id ? parseInt(reply_to_id, 10) : null;
        let finalReplyToSender = reply_to_sender || null;
        let finalReplyToContent = reply_to_content || null;

        if (finalReplyToId && (!finalReplyToSender || !finalReplyToContent)) {
            try {
                const parentRes = await pool.query("SELECT sender_name, content FROM workplace_messages WHERE id = $1", [finalReplyToId]);
                if (parentRes.rows.length > 0) {
                    finalReplyToSender = finalReplyToSender || parentRes.rows[0].sender_name;
                    finalReplyToContent = finalReplyToContent || parentRes.rows[0].content;
                }
            } catch(e) {}
        }

        // Kiểm tra quyền nếu là kênh chỉ thông báo (Announcement Only)
        if (channel_id) {
            const chanCheck = await pool.query("SELECT is_announcement_only, type, name FROM workplace_channels WHERE id = $1", [channel_id]);
            if (chanCheck.rows.length > 0) {
                const chan = chanCheck.rows[0];
                if (chan.is_announcement_only && !isAdmin) {
                    return res.status(403).json({
                        success: false,
                        error: `⛔ Kênh "${chan.name}" là kênh phát thanh chỉ đạo. Chỉ có Ban Giám Đốc và Quản trị viên mới có quyền đăng thông báo!`
                    });
                }
                if (!isAdmin) {
                    const memberCountRes = await pool.query(
                        "SELECT COUNT(*) FROM workplace_channel_members WHERE channel_id = $1",
                        [channel_id]
                    );
                    const hasRestrictions = parseInt(memberCountRes.rows[0].count, 10) > 0;
                    if (hasRestrictions) {
                        const memberCheck = await pool.query(
                            "SELECT 1 FROM workplace_channel_members WHERE channel_id = $1 AND user_id = $2",
                            [channel_id, currentUserId]
                        );
                        if (memberCheck.rows.length === 0) {
                            return res.status(403).json({ success: false, error: 'Bạn không có quyền gửi tin nhắn vào nhóm này!' });
                        }
                    }
                }
            }
        }

        const shouldPin = is_pinned && isAdmin;

        // Chống spam / gửi lặp tin nhắn (Deduplication trong 2.5 giây)
        const dupCheck = await pool.query(`
            SELECT id, channel_id, recipient_id, content, created_at
            FROM workplace_messages
            WHERE sender_id = $1
              AND (channel_id = $2 OR (channel_id IS NULL AND $2 IS NULL))
              AND (recipient_id = $3 OR (recipient_id IS NULL AND $3 IS NULL))
              AND content = $4
              AND created_at >= NOW() - INTERVAL '2.5 seconds'
            ORDER BY id DESC LIMIT 1
        `, [
            currentUserId,
            channel_id ? parseInt(channel_id, 10) : null,
            direct_user_id ? parseInt(direct_user_id, 10) : null,
            cleanContent
        ]);

        if (dupCheck.rows.length > 0) {
            return res.json({ success: true, data: dupCheck.rows[0], message: 'Tin nhắn đã được gửi thành công!' });
        }

        // Chèn tin nhắn mới (bao gồm reply và message_type)
        const insertRes = await pool.query(`
            INSERT INTO workplace_messages (
                channel_id, sender_id, sender_name, sender_role, 
                recipient_id, content, attachments, priority, is_pinned,
                reply_to_id, reply_to_sender, reply_to_content, message_type
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *
        `, [
            channel_id ? parseInt(channel_id, 10) : null,
            currentUserId,
            senderName,
            senderRole,
            direct_user_id ? parseInt(direct_user_id, 10) : null,
            cleanContent,
            JSON.stringify(safeAttachments),
            priority,
            shouldPin,
            finalReplyToId,
            finalReplyToSender,
            finalReplyToContent,
            cleanMsgType
        ]);

        const newMsg = insertRes.rows[0];

        // Phát thông báo thời gian thực toàn hệ thống
        try {
            const notificationService = require('../services/notification.service');
            let notifTitle = `💬 Tin nhắn từ ${senderName}`;
            let notifLink = direct_user_id ? `#workplace?direct_user_id=${currentUserId}` : `#workplace?channel_id=${channel_id}`;
            let notifBody = cleanContent.length > 80 ? (cleanContent.substring(0, 80) + '...') : cleanContent;

            if (cleanMsgType === 'AUDIO') {
                notifBody = '🎙️ [Tin nhắn thoại ghi âm]';
            } else if (!notifBody && safeAttachments.length > 0) {
                notifBody = `[Đã gửi ${safeAttachments.length} tệp đính kèm / hình ảnh]`;
            }

            if (finalReplyToId && finalReplyToSender) {
                notifBody = `[Trả lời ${finalReplyToSender}]: ${notifBody}`;
            }

            if (channel_id) {
                const chanRes = await pool.query("SELECT name FROM workplace_channels WHERE id = $1", [channel_id]);
                const chanName = chanRes.rows[0] ? chanRes.rows[0].name : 'Kênh chung';
                notifTitle = `💬 [${chanName}] ${senderName}`;
            }

            notificationService.createNotification({
                type: 'MESSAGE',
                title: notifTitle,
                body: notifBody,
                link: notifLink,
                sender_id: currentUserId,
                sender_name: senderName,
                recipient_id: direct_user_id ? parseInt(direct_user_id, 10) : null,
                target_roles: [],
                data: {
                    message_id: newMsg.id,
                    channel_id: channel_id ? parseInt(channel_id, 10) : null,
                    direct_user_id: direct_user_id ? parseInt(direct_user_id, 10) : null
                }
            }).catch(e => console.error('Notification error on message:', e.message));

            // Gửi Web Push Notification chạy ngầm tới điện thoại nếu người nhận tắt màn hình / không mở web
            try {
                const pushService = require('../services/push.service');
                let targetPushUserIds = null;
                if (direct_user_id) {
                    targetPushUserIds = [parseInt(direct_user_id, 10)];
                } else if (channel_id) {
                    const membersRes = await pool.query("SELECT user_id FROM workplace_channel_members WHERE channel_id = $1", [channel_id]);
                    if (membersRes.rows.length > 0) {
                        targetPushUserIds = membersRes.rows.map(r => r.user_id);
                    }
                }
                pushService.sendPushToUsers(targetPushUserIds, {
                    title: notifTitle,
                    body: notifBody,
                    url: `/dashboard.html${notifLink}`,
                    tag: `wp-chan-${channel_id || 'direct'}`
                }, currentUserId).catch(() => {});
            } catch (pushErr) {
                // Ignore push error in background
            }
        } catch (notifErr) {
            console.warn('⚠️ Lỗi gửi thông báo tin nhắn:', notifErr.message);
        }

        res.json({ success: true, data: newMsg, message: 'Gửi tin nhắn thành công!' });
        bumpConversationVersion(channel_id, direct_user_id, currentUserId);
    } catch (err) {
        console.error('Lỗi POST /api/workplace/messages:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 7. POST /api/workplace/messages/:id/reactions
 * Thả cảm xúc biểu cảm (👍, ❤️, 🔥, 👏, 🎉)
 */
router.post('/messages/:id/reactions', async (req, res) => {
    try {
        const { id } = req.params;
        const { emoji } = req.body;
        const currentUserId = req.user ? req.user.id : null;
        const currentUserName = req.user ? (req.user.full_name || req.user.username) : 'Nhân Viên';

        if (!emoji) return res.status(400).json({ success: false, error: 'Thiếu emoji cảm xúc!' });

        const msgRes = await pool.query("SELECT reactions, channel_id, recipient_id, sender_id FROM workplace_messages WHERE id = $1", [id]);
        if (msgRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy tin nhắn' });

        let reactions = msgRes.rows[0].reactions || {};
        if (typeof reactions === 'string') {
            try { reactions = JSON.parse(reactions); } catch(e) { reactions = {}; }
        }

        let userList = reactions[emoji] || [];
        const existingIdx = userList.findIndex(u => (typeof u === 'object' ? u.id === currentUserId : u === currentUserId));

        if (existingIdx !== -1) {
            // Đã thả -> Gỡ cảm xúc (Toggle)
            userList.splice(existingIdx, 1);
            if (userList.length === 0) delete reactions[emoji];
            else reactions[emoji] = userList;
        } else {
            // Thêm cảm xúc mới
            userList.push({ id: currentUserId, name: currentUserName });
            reactions[emoji] = userList;
        }

        await pool.query("UPDATE workplace_messages SET reactions = $1 WHERE id = $2", [JSON.stringify(reactions), id]);
        bumpConversationVersion(msgRes.rows[0].channel_id, msgRes.rows[0].recipient_id, msgRes.rows[0].sender_id);
        res.json({ success: true, reactions });
    } catch (err) {
        console.error('Lỗi reaction:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 8. PUT /api/workplace/messages/:id/pin
 * Ghim / Gỡ ghim thông báo (Chỉ Ban Giám Đốc & Admin)
 */
router.put('/messages/:id/pin', async (req, res) => {
    try {
        if (!req.user || !isLeaderOrAdmin(req.user.role)) {
            return res.status(403).json({ success: false, error: 'Chỉ Ban Giám Đốc hoặc Quản trị viên mới được ghim thông báo!' });
        }

        const { id } = req.params;
        const msgRes = await pool.query("SELECT channel_id, is_pinned FROM workplace_messages WHERE id = $1", [id]);
        if (msgRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy tin nhắn' });

        const currentPinned = msgRes.rows[0].is_pinned;
        const newPinned = !currentPinned;

        if (newPinned && msgRes.rows[0].channel_id) {
            await pool.query("UPDATE workplace_messages SET is_pinned = FALSE WHERE channel_id = $1", [msgRes.rows[0].channel_id]);
        }

        await pool.query("UPDATE workplace_messages SET is_pinned = $1 WHERE id = $2", [newPinned, id]);
        bumpConversationVersion(msgRes.rows[0].channel_id, null, null);
        res.json({ success: true, is_pinned: newPinned, message: newPinned ? 'Đã ghim thông báo lên đầu kênh!' : 'Đã gỡ ghim thông báo!' });
    } catch (err) {
        console.error('Lỗi pin:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 9. PUT /api/workplace/messages/:id
 * Chỉnh sửa nội dung tin nhắn trong vòng 15 phút (Chính chủ hoặc Quản trị viên)
 */
router.put('/messages/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { content } = req.body;
        if (!content || !content.trim()) {
            return res.status(400).json({ success: false, error: 'Nội dung tin nhắn không được để trống!' });
        }

        const msgRes = await pool.query("SELECT id, sender_id, channel_id, recipient_id, created_at, is_recalled FROM workplace_messages WHERE id = $1", [id]);
        if (msgRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy tin nhắn!' });

        const msg = msgRes.rows[0];
        if (msg.is_recalled) {
            return res.status(400).json({ success: false, error: 'Không thể sửa tin nhắn đã thu hồi!' });
        }

        const isOwner = req.user && req.user.id === msg.sender_id;
        const isAdmin = req.user && isLeaderOrAdmin(req.user.role);

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ success: false, error: 'Bạn chỉ có thể chỉnh sửa tin nhắn do chính mình gửi!' });
        }

        // Kiểm tra thời hạn 15 phút đối với nhân viên thường
        if (!isAdmin) {
            const msgTime = new Date(msg.created_at).getTime();
            const now = Date.now();
            const elapsedMinutes = (now - msgTime) / (60 * 1000);
            if (elapsedMinutes > 15) {
                return res.status(403).json({
                    success: false,
                    error: '⛔ Đã quá 15 phút kể từ lúc gửi! Tin nhắn đã bị khóa và không thể chỉnh sửa để bảo đảm tính minh bạch trong trao đổi công việc nội bộ.'
                });
            }
        }

        const cleanContent = content.trim();
        const updateRes = await pool.query(`
            UPDATE workplace_messages 
            SET content = $1, is_edited = TRUE, updated_at = NOW()
            WHERE id = $2
            RETURNING *
        `, [cleanContent, id]);

        bumpConversationVersion(msg.channel_id, msg.recipient_id, msg.sender_id);
        res.json({ success: true, data: updateRes.rows[0], message: 'Đã chỉnh sửa tin nhắn thành công!' });
    } catch (err) {
        console.error('Lỗi PUT /api/workplace/messages/:id:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 10. DELETE /api/workplace/messages/:id
 * Thu hồi tin nhắn trong vòng 15 phút (Chính chủ hoặc Quản trị viên)
 */
router.delete('/messages/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const msgRes = await pool.query("SELECT id, sender_id, channel_id, recipient_id, created_at, is_recalled FROM workplace_messages WHERE id = $1", [id]);
        if (msgRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy tin nhắn!' });

        const msg = msgRes.rows[0];
        const isOwner = req.user && req.user.id === msg.sender_id;
        const isAdmin = req.user && isLeaderOrAdmin(req.user.role);

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ success: false, error: 'Bạn không có quyền thu hồi tin nhắn của người khác!' });
        }

        // Kiểm tra thời hạn 15 phút đối với nhân viên thường
        if (!isAdmin) {
            const msgTime = new Date(msg.created_at).getTime();
            const now = Date.now();
            const elapsedMinutes = (now - msgTime) / (60 * 1000);
            if (elapsedMinutes > 15) {
                return res.status(403).json({
                    success: false,
                    error: '⛔ Đã quá 15 phút kể từ lúc gửi! Tin nhắn đã bị khóa vĩnh viễn để bảo đảm tính minh bạch trong trao đổi công việc nội bộ.'
                });
            }
        }

        // Thực hiện thu hồi: cập nhật is_recalled = TRUE, dọn attachments và cập nhật content
        await pool.query(`
            UPDATE workplace_messages 
            SET is_recalled = TRUE, 
                content = 'Tin nhắn đã được thu hồi', 
                attachments = '[]'::jsonb,
                updated_at = NOW() 
            WHERE id = $1
        `, [id]);

        bumpConversationVersion(msg.channel_id, msg.recipient_id, msg.sender_id);
        res.json({ success: true, message: 'Đã thu hồi tin nhắn thành công!' });
    } catch (err) {
        console.error('Lỗi delete message:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 11. GET /api/workplace/push-config
 * Lấy VAPID public key để kích hoạt Service Worker Web Push
 */
router.get('/push-config', (req, res) => {
    try {
        const pushService = require('../services/push.service');
        res.json({
            success: true,
            publicKey: pushService.getPublicKey()
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * 12. POST /api/workplace/push-subscription
 * Đăng ký thiết bị nhận thông báo ngầm từ PWA
 */
router.post('/push-subscription', async (req, res) => {
    try {
        const { subscription, user_agent } = req.body;
        const currentUserId = req.user ? req.user.id : null;

        if (!subscription || !subscription.endpoint) {
            return res.status(400).json({ success: false, error: 'Thiếu thông tin subscription!' });
        }

        const pushService = require('../services/push.service');
        const saved = await pushService.saveSubscription(currentUserId, subscription, user_agent);

        res.json({ success: true, data: saved, message: 'Đã đăng ký nhận thông báo chạy ngầm thành công!' });
    } catch (e) {
        console.error('Lỗi lưu push subscription:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
