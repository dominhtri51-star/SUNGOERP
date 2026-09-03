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
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                -- 4. Chỉ mục B-Tree tăng tốc truy vấn
                CREATE INDEX IF NOT EXISTS idx_wp_msg_channel_id ON workplace_messages(channel_id, id DESC);
                CREATE INDEX IF NOT EXISTS idx_wp_msg_recipient ON workplace_messages(recipient_id, sender_id, id DESC);
                CREATE INDEX IF NOT EXISTS idx_wp_msg_pinned ON workplace_messages(channel_id, is_pinned);
                CREATE INDEX IF NOT EXISTS idx_wp_chan_members ON workplace_channel_members(channel_id, user_id);

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
            WHERE c.type IN ('PUBLIC', 'ANNOUNCEMENT')
               OR (c.type = 'GROUP' AND (EXISTS(SELECT 1 FROM workplace_channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = $1) OR $2 = TRUE))
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
 * 3. GET /api/workplace/channels/:id/members (Lấy danh sách thành viên của một nhóm)
 */
router.get('/channels/:id/members', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT u.id, u.username, u.full_name, u.role, u.emp_id,
                   COALESCE(e.position, u.role) as position,
                   COALESCE(e.department_role, '') as department,
                   cm.added_at
            FROM workplace_channel_members cm
            JOIN users u ON cm.user_id = u.id
            LEFT JOIN employees e ON UPPER(e.emp_code) = UPPER(u.emp_id)
            WHERE cm.channel_id = $1
            ORDER BY u.full_name ASC
        `, [id]);

        res.json({ success: true, data: result.rows });
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
            return res.status(403).json({ success: false, error: 'Chỉ Ban Giám Đốc hoặc Quản trị viên mới được chỉnh sửa thành viên nhóm!' });
        }

        const { id } = req.params;
        const { member_ids } = req.body;

        if (!Array.isArray(member_ids)) {
            return res.status(400).json({ success: false, error: 'Danh sách thành viên không hợp lệ!' });
        }

        // Xóa các thành viên cũ không có trong danh sách mới
        await pool.query(`DELETE FROM workplace_channel_members WHERE channel_id = $1`, [id]);

        // Luôn đảm bảo admin có trong nhóm
        let finalMembers = [...member_ids];
        if (!finalMembers.includes(req.user.id)) finalMembers.push(req.user.id);

        if (finalMembers.length > 0) {
            const memberInserts = finalMembers.map(uid => `(${id}, ${parseInt(uid, 10)}, ${req.user.id})`).join(', ');
            await pool.query(`
                INSERT INTO workplace_channel_members (channel_id, user_id, added_by)
                VALUES ${memberInserts}
                ON CONFLICT (channel_id, user_id) DO NOTHING;
            `);
        }

        res.json({ success: true, message: 'Cập nhật danh sách thành viên nhóm thành công!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 5. GET /api/workplace/messages
 * Lấy tin nhắn theo kênh/nhóm hoặc theo người nhắn 1-1
 * Query: ?channel_id=1 hoặc ?direct_user_id=5
 */
router.get('/messages', async (req, res) => {
    try {
        const { channel_id, direct_user_id, before_id, limit = 50 } = req.query;
        const currentUserId = req.user ? req.user.id : -1;
        const isAdmin = req.user && isLeaderOrAdmin(req.user.role);
        const queryLimit = Math.min(parseInt(limit, 10) || 50, 100);

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

            if (chanCheck.rows[0].type === 'GROUP' && !isAdmin) {
                const memberCheck = await pool.query(
                    "SELECT 1 FROM workplace_channel_members WHERE channel_id = $1 AND user_id = $2",
                    [chanId, currentUserId]
                );
                if (memberCheck.rows.length === 0) {
                    return res.status(403).json({ success: false, error: 'Bạn không thuộc danh sách thành viên của nhóm này!' });
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

        res.json({
            success: true,
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
        const { channel_id, direct_user_id, content, attachments, priority = 'NORMAL', is_pinned = false } = req.body;
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
                if (chan.type === 'GROUP' && !isAdmin) {
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

        const shouldPin = is_pinned && isAdmin;

        // Chèn tin nhắn mới
        const insertRes = await pool.query(`
            INSERT INTO workplace_messages (
                channel_id, sender_id, sender_name, sender_role, 
                recipient_id, content, attachments, priority, is_pinned
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
            shouldPin
        ]);

        const newMsg = insertRes.rows[0];
        res.json({ success: true, data: newMsg, message: 'Gửi tin nhắn thành công!' });
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

        const msgRes = await pool.query("SELECT reactions FROM workplace_messages WHERE id = $1", [id]);
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
        res.json({ success: true, is_pinned: newPinned, message: newPinned ? 'Đã ghim thông báo lên đầu kênh!' : 'Đã gỡ ghim thông báo!' });
    } catch (err) {
        console.error('Lỗi pin:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 9. DELETE /api/workplace/messages/:id
 * Thu hồi tin nhắn (Chính chủ hoặc Quản trị viên)
 */
router.delete('/messages/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const msgRes = await pool.query("SELECT sender_id FROM workplace_messages WHERE id = $1", [id]);
        if (msgRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy tin nhắn' });

        const isOwner = req.user && req.user.id === msgRes.rows[0].sender_id;
        const isAdmin = req.user && isLeaderOrAdmin(req.user.role);

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ success: false, error: 'Bạn không có quyền thu hồi tin nhắn của người khác!' });
        }

        await pool.query("DELETE FROM workplace_messages WHERE id = $1", [id]);
        res.json({ success: true, message: 'Đã thu hồi tin nhắn thành công!' });
    } catch (err) {
        console.error('Lỗi delete message:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
