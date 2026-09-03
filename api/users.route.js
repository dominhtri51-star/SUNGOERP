const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { generateToken, requireRole } = require('../middlewares/auth.middleware');

const usersFile = path.join(__dirname, '../data/users.json');

const DEFAULT_USERS = [
    { id: 2, emp_id: 'EMP002', username: 'minhtri', password: '123456', full_name: 'Minh Trí', role: 'ADMIN', custom_modules: [] },
    { id: 3, emp_id: 'TC001', username: 'thauthicong', password: '123456', full_name: 'Đội Thi Công Solar Fast', role: 'NHA_THAU_THI_CONG', custom_modules: [] },
    { id: 4, emp_id: 'GS001', username: 'thaugiamsat', password: '123456', full_name: 'Đơn Vị Giám Sát EPC Pro', role: 'NHA_THAU_GIAM_SAT', custom_modules: [] },
    { id: 5, emp_id: 'NCC001', username: 'nhacungcap', password: '123456', full_name: 'Nhà Cung Cấp Pin & Inverter SunPower', role: 'NHA_CUNG_CAP', custom_modules: [] }
];

// Đảm bảo bảng users luôn tồn tại
const initUsers = async () => {
    try {
        const dataDir = path.join(__dirname, '../data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

        if (pool && typeof pool.query === 'function') {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    emp_id VARCHAR(50),
                    username VARCHAR(100) UNIQUE NOT NULL,
                    password VARCHAR(255) NOT NULL,
                    full_name VARCHAR(255),
                    role VARCHAR(50) DEFAULT 'ADMIN',
                    custom_modules JSONB DEFAULT '[]'::jsonb,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            await pool.query(`
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='custom_modules') THEN
                        ALTER TABLE users ADD COLUMN custom_modules JSONB DEFAULT '[]'::jsonb;
                    END IF;
                END $$;
            `);
        }
    } catch(e) {
        console.error("Lỗi init users DB:", e.message);
    }
};
initUsers();

// Helper đọc và xử lý custom_modules
function formatUserRow(row) {
    if (!row) return null;
    let customMods = [];
    if (row.custom_modules) {
        if (Array.isArray(row.custom_modules)) {
            customMods = row.custom_modules;
        } else if (typeof row.custom_modules === 'string') {
            try { customMods = JSON.parse(row.custom_modules); } catch(e) { customMods = []; }
        }
    }
    return {
        id: row.id,
        emp_id: row.emp_id,
        username: row.username,
        full_name: row.full_name,
        role: row.role,
        custom_modules: customMods
    };
}

// Lấy danh sách tài khoản
router.get('/', async (req, res) => {
    try {
        if (pool && typeof pool.query === 'function') {
            const { rows } = await pool.query("SELECT id, emp_id, username, full_name, role, custom_modules FROM users ORDER BY id DESC");
            if (rows) return res.json({ success: true, data: rows.map(formatUserRow) });
        }
    } catch(e) {}
    
    // Fallback file
    try {
        if (fs.existsSync(usersFile)) {
            const fileUsers = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
            return res.json({ success: true, data: fileUsers.map(formatUserRow) });
        }
    } catch(e) {}
    return res.json({ success: true, data: [] });
});

// Kiểm tra Đăng nhập (POST /api/users/login)
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const cleanUser = (username || '').trim().toLowerCase();
        const rawPass = String(password || '');
        
        // 1. Xác thực trực tiếp qua CSDL PostgreSQL
        let dbQueried = false;
        try {
            if (pool && typeof pool.query === 'function') {
                const { rows } = await pool.query(
                    "SELECT id, emp_id, username, password, full_name, role, custom_modules FROM users WHERE LOWER(username) = $1",
                    [cleanUser]
                );
                dbQueried = true;
                if (rows && rows.length > 0) {
                    const uRow = rows[0];
                    let isMatch = false;

                    // Kiểm tra mật khẩu bằng bcrypt hoặc plaintext
                    if (uRow.password && (uRow.password.startsWith('$2a$') || uRow.password.startsWith('$2b$'))) {
                        isMatch = await bcrypt.compare(rawPass, uRow.password);
                    } else if (uRow.password === rawPass) {
                        isMatch = true;
                        // Tự động nâng cấp mã hóa sang bcrypt cho tài khoản cũ (Lazy Migration)
                        try {
                            const salt = await bcrypt.genSalt(10);
                            const hashed = await bcrypt.hash(rawPass, salt);
                            await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hashed, uRow.id]);
                            console.log(`🔒 [Security] Đã tự động nâng cấp mã hóa bcrypt cho tài khoản: ${cleanUser}`);
                        } catch(hErr) {}
                    }

                    if (isMatch) {
                        const token = generateToken(uRow);
                        return res.json({ 
                            success: true, 
                            token,
                            user: formatUserRow(uRow) 
                        });
                    }
                }
            }
        } catch(dbErr) {
            console.warn("DB login fallback sang local data:", dbErr.message);
        }

        // Nếu DB đã truy vấn thành công nhưng không tìm thấy user -> Trả về lỗi sai thông tin đăng nhập ngay (không fallback tài khoản mẫu)
        if (dbQueried) {
            return res.status(401).json({ success: false, error: "Sai tên đăng nhập hoặc mật khẩu!" });
        }

        // 2. Chỉ fallback đọc file nếu CSDL thực sự mất kết nối
        if (fs.existsSync(usersFile)) {
            try {
                const fileUsers = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
                const match = fileUsers.find(u => (u.username || '').toLowerCase() === cleanUser);
                if (match) {
                    let isMatch = false;
                    if (match.password && (match.password.startsWith('$2a$') || match.password.startsWith('$2b$'))) {
                        isMatch = await bcrypt.compare(rawPass, match.password);
                    } else if (match.password === rawPass) {
                        isMatch = true;
                    }
                    if (isMatch) {
                        const token = generateToken(match);
                        return res.json({
                            success: true,
                            token,
                            user: formatUserRow(match)
                        });
                    }
                }
            } catch(e) {}
        }

        return res.status(401).json({ success: false, error: "Sai tên đăng nhập hoặc mật khẩu!" });
    } catch(e) { 
        console.error("Lỗi API LOGIN:", e.message);
        res.status(500).json({ success: false, error: "Lỗi đăng nhập: " + e.message }); 
    }
});

// Cập nhật riêng quyền bổ sung (PUT /api/users/:id/permissions)
router.put('/:id/permissions', async (req, res) => {
    try {
        const { id } = req.params;
        const { custom_modules } = req.body;
        const customMods = Array.isArray(custom_modules) ? custom_modules : [];

        // 1. Cập nhật DB nếu có
        let updatedInDb = false;
        if (pool && typeof pool.query === 'function') {
            try {
                await pool.query(
                    "UPDATE users SET custom_modules = $1 WHERE id = $2",
                    [JSON.stringify(customMods), id]
                );
                updatedInDb = true;
            } catch(dbErr) {
                console.warn("DB update permissions fallback:", dbErr.message);
            }
        }

        // 2. Đồng bộ file JSON
        try {
            if (fs.existsSync(usersFile)) {
                const fileUsers = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
                const targetIdx = fileUsers.findIndex(u => String(u.id) === String(id));
                if (targetIdx !== -1) {
                    fileUsers[targetIdx].custom_modules = customMods;
                    fs.writeFileSync(usersFile, JSON.stringify(fileUsers, null, 2), 'utf8');
                }
            }
        } catch(fErr) {}

        res.json({ success: true, custom_modules: customMods });
    } catch(e) {
        console.error("Lỗi API PUT /api/users/:id/permissions:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Tạo tài khoản mới (POST) - Chỉ Admin được phép tạo & Tự động băm mật khẩu bcrypt
router.post('/', async (req, res) => {
    try {
        if (!req.user || !['ADMIN', 'SUPER_ADMIN', 'GIAM_DOC'].includes(String(req.user.role || '').toUpperCase())) {
            return res.status(403).json({ success: false, error: 'Chỉ Quản trị viên cấp cao mới có quyền tạo tài khoản người dùng!' });
        }

        const { emp_id, username, password, full_name, role, custom_modules } = req.body;
        const cleanUser = (username || '').trim().toLowerCase();
        if (!cleanUser) return res.status(400).json({ success: false, error: 'Tên đăng nhập không được để trống!' });

        const finalEmpId = (emp_id || '').trim().toUpperCase();
        const customMods = Array.isArray(custom_modules) ? custom_modules : [];
        const rawPassword = String(password || '123456');
        const hashedPassword = await bcrypt.hash(rawPassword, 10);
        
        let newUser = null;
        if (pool && typeof pool.query === 'function') {
            const userRes = await pool.query(
                "INSERT INTO users (emp_id, username, password, full_name, role, custom_modules) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
                [finalEmpId, cleanUser, hashedPassword, full_name, role || 'SALE', JSON.stringify(customMods)]
            );
            newUser = formatUserRow(userRes.rows[0]);

            // Tự động liên kết với bảng employees nếu có mã nhân viên trùng khớp
            if (finalEmpId) {
                try {
                    await pool.query(
                        "UPDATE employees SET user_id = $1 WHERE UPPER(emp_code) = $2",
                        [newUser.id, finalEmpId]
                    );
                } catch(empErr) {}
            }
        }

        // Cập nhật file fallback
        try {
            let fileUsers = fs.existsSync(usersFile) ? JSON.parse(fs.readFileSync(usersFile, 'utf8')) : [];
            const newId = (fileUsers.length > 0 ? Math.max(...fileUsers.map(u => u.id || 0)) : 0) + 1;
            const newLocalUser = {
                id: newUser ? newUser.id : newId,
                emp_id: finalEmpId,
                username: cleanUser,
                password: hashedPassword,
                full_name,
                role: role || 'SALE',
                custom_modules: customMods
            };
            fileUsers.push(newLocalUser);
            fs.writeFileSync(usersFile, JSON.stringify(fileUsers, null, 2), 'utf8');
            if (!newUser) newUser = formatUserRow(newLocalUser);
        } catch(fErr) {}

        res.json({ success: true, user: newUser });
    } catch(e) { 
        console.error("Lỗi API POST /api/users:", e.message);
        res.status(500).json({ success: false, error: "Tên đăng nhập đã tồn tại hoặc lỗi DB: " + e.message }); 
    }
});

// Cập nhật tài khoản / Đổi mật khẩu (PUT) - Kiểm tra quyền và băm mật khẩu
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const targetId = parseInt(id, 10);
        const isAdmin = req.user && ['ADMIN', 'SUPER_ADMIN', 'GIAM_DOC'].includes(String(req.user.role || '').toUpperCase());
        const isSelf = req.user && req.user.id === targetId;

        if (!isAdmin && !isSelf) {
            return res.status(403).json({ success: false, error: 'Bạn không có quyền chỉnh sửa thông tin của tài khoản này!' });
        }

        const { emp_id, username, password, full_name, role, custom_modules } = req.body;
        const finalEmpId = (emp_id || '').trim().toUpperCase();
        // Không cho phép non-admin tự nâng role của mình
        const finalRole = isAdmin ? (role || req.user.role) : undefined;

        let hashedPassword = null;
        if (password && String(password).trim()) {
            hashedPassword = await bcrypt.hash(String(password).trim(), 10);
        }

        if (pool && typeof pool.query === 'function') {
            if (hashedPassword) {
                // Có nhập mật khẩu mới -> Cập nhật cả mật khẩu đã băm
                if (isAdmin && custom_modules !== undefined) {
                    await pool.query(
                        "UPDATE users SET emp_id = $1, username = $2, full_name = $3, role = COALESCE($4, role), password = $5, custom_modules = $6 WHERE id = $7",
                        [finalEmpId, username, full_name, finalRole, hashedPassword, JSON.stringify(custom_modules), targetId]
                    );
                } else {
                    await pool.query(
                        "UPDATE users SET emp_id = $1, username = $2, full_name = $3, role = COALESCE($4, role), password = $5 WHERE id = $6",
                        [finalEmpId, username, full_name, finalRole, hashedPassword, targetId]
                    );
                }
            } else {
                // Để trống mật khẩu -> Chỉ cập nhật thông tin
                if (isAdmin && custom_modules !== undefined) {
                    await pool.query(
                        "UPDATE users SET emp_id = $1, username = $2, full_name = $3, role = COALESCE($4, role), custom_modules = $5 WHERE id = $6",
                        [finalEmpId, username, full_name, finalRole, JSON.stringify(custom_modules), targetId]
                    );
                } else {
                    await pool.query(
                        "UPDATE users SET emp_id = $1, username = $2, full_name = $3, role = COALESCE($4, role) WHERE id = $5",
                        [finalEmpId, username, full_name, finalRole, targetId]
                    );
                }
            }

            // Đồng bộ liên kết với bảng employees
            if (finalEmpId) {
                try {
                    await pool.query(
                        "UPDATE employees SET user_id = $1 WHERE UPPER(emp_code) = $2",
                        [targetId, finalEmpId]
                    );
                } catch(empErr) {}
            }
        }

        // Cập nhật file fallback
        try {
            if (fs.existsSync(usersFile)) {
                const fileUsers = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
                const targetIdx = fileUsers.findIndex(u => String(u.id) === String(id));
                if (targetIdx !== -1) {
                    fileUsers[targetIdx].emp_id = finalEmpId;
                    fileUsers[targetIdx].username = username;
                    fileUsers[targetIdx].full_name = full_name;
                    if (finalRole) fileUsers[targetIdx].role = finalRole;
                    if (hashedPassword) fileUsers[targetIdx].password = hashedPassword;
                    if (isAdmin && custom_modules !== undefined) fileUsers[targetIdx].custom_modules = custom_modules;
                    fs.writeFileSync(usersFile, JSON.stringify(fileUsers, null, 2), 'utf8');
                }
            }
        } catch(fErr) {}

        res.json({ success: true, message: 'Cập nhật tài khoản thành công!' });
    } catch(e) { 
        console.error("Lỗi API PUT /api/users:", e.message);
        res.status(500).json({ success: false, error: e.message }); 
    }
});

// Xóa tài khoản (Chỉ Admin được phép & Không cho phép tự xóa chính mình)
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const numId = parseInt(id, 10) || -1;
        const isAdmin = req.user && ['ADMIN', 'SUPER_ADMIN', 'GIAM_DOC'].includes(String(req.user.role || '').toUpperCase());

        if (!isAdmin) {
            return res.status(403).json({ success: false, error: 'Chỉ Quản trị viên mới có quyền xóa tài khoản!' });
        }
        if (req.user.id === numId) {
            return res.status(400).json({ success: false, error: 'Bạn không thể tự xóa tài khoản đang đăng nhập của chính mình!' });
        }

        if (pool && typeof pool.query === 'function') {
            try {
                await pool.query("UPDATE employees SET user_id = NULL WHERE user_id = $1", [numId]);
            } catch(empErr) {}
            await pool.query("DELETE FROM users WHERE id = $1 OR username = $2", [numId, id]);
        }
        try {
            if (fs.existsSync(usersFile)) {
                let fileUsers = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
                fileUsers = fileUsers.filter(u => String(u.id) !== String(id) && u.username !== id);
                fs.writeFileSync(usersFile, JSON.stringify(fileUsers, null, 2), 'utf8');
            }
        } catch(fErr) {}

        res.json({ success: true, message: 'Đã xóa tài khoản thành công!' });
    } catch(e) { 
        console.error("Lỗi API DELETE /api/users:", e.message);
        res.status(500).json({ success: false, error: e.message }); 
    }
});

module.exports = router;