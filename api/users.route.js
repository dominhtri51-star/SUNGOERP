const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const fs = require('fs');
const path = require('path');

const usersFile = path.join(__dirname, '../data/users.json');

const DEFAULT_USERS = [
    { id: 1, emp_id: 'EMP001', username: 'admin', password: '123456', full_name: 'Quản Trị Viên', role: 'ADMIN', custom_modules: [] },
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
        if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, JSON.stringify(DEFAULT_USERS, null, 2), 'utf8');

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

            await pool.query(`
                INSERT INTO users (emp_id, username, password, full_name, role, custom_modules) VALUES
                ('EMP001', 'admin', '123456', 'Quản Trị Viên', 'ADMIN', '[]'::jsonb),
                ('EMP002', 'minhtri', '123456', 'Minh Trí', 'ADMIN', '[]'::jsonb),
                ('TC001', 'thauthicong', '123456', 'Đội Thi Công Solar Fast', 'NHA_THAU_THI_CONG', '[]'::jsonb),
                ('GS001', 'thaugiamsat', '123456', 'Đơn Vị Giám Sát EPC Pro', 'NHA_THAU_GIAM_SAT', '[]'::jsonb),
                ('NCC001', 'nhacungcap', '123456', 'Nhà Cung Cấp Pin & Inverter SunPower', 'NHA_CUNG_CAP', '[]'::jsonb)
                ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = EXCLUDED.role, full_name = EXCLUDED.full_name;
            `);
        }
    } catch(e) {
        console.error("Lỗi init users DB (sử dụng fallback file):", e.message);
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
        await initUsers();
        if (pool && typeof pool.query === 'function') {
            const { rows } = await pool.query("SELECT id, emp_id, username, full_name, role, custom_modules FROM users ORDER BY id DESC");
            if (rows && rows.length > 0) return res.json({ success: true, data: rows.map(formatUserRow) });
        }
    } catch(e) {}
    
    // Fallback file
    try {
        const fileUsers = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
        return res.json({ success: true, data: fileUsers.map(formatUserRow) });
    } catch(e) {
        return res.json({ success: true, data: DEFAULT_USERS.map(formatUserRow) });
    }
});

// Kiểm tra Đăng nhập (POST /api/users/login)
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        await initUsers();
        
        // 1. Thử qua DB
        try {
            if (pool && typeof pool.query === 'function') {
                const { rows } = await pool.query(
                    "SELECT id, emp_id, username, full_name, role, custom_modules FROM users WHERE username = $1 AND password = $2",
                    [username, password]
                );
                if (rows && rows.length > 0) {
                    return res.json({ success: true, user: formatUserRow(rows[0]) });
                }
            }
        } catch(dbErr) {
            console.warn("DB login fallback sang local data");
        }

        // 2. Fallback sang local list
        let userList = DEFAULT_USERS;
        try {
            if (fs.existsSync(usersFile)) {
                userList = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
            }
        } catch(e) {}

        const match = userList.find(u => u.username === username && u.password === password);
        if (match) {
            return res.json({
                success: true,
                user: formatUserRow(match)
            });
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
                    "UPDATE users SET custom_modules = $1 WHERE id = $2 OR user_id = $2",
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

// Tạo tài khoản mới (POST) - Tự động liên kết hồ sơ nhân viên
router.post('/', async (req, res) => {
    try {
        const { emp_id, username, password, full_name, role, custom_modules } = req.body;
        const finalEmpId = (emp_id || '').trim().toUpperCase();
        const customMods = Array.isArray(custom_modules) ? custom_modules : [];
        
        let newUser = null;
        if (pool && typeof pool.query === 'function') {
            const userRes = await pool.query(
                "INSERT INTO users (emp_id, username, password, full_name, role, custom_modules) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
                [finalEmpId, username, password, full_name, role, JSON.stringify(customMods)]
            );
            newUser = formatUserRow(userRes.rows[0]);

            // Tự động liên kết với bảng employees nếu có mã nhân viên trùng khớp
            if (finalEmpId) {
                await pool.query(
                    "UPDATE employees SET user_id = $1 WHERE UPPER(emp_code) = $2",
                    [newUser.id, finalEmpId]
                );
            }
        }

        // Cập nhật file fallback
        try {
            let fileUsers = fs.existsSync(usersFile) ? JSON.parse(fs.readFileSync(usersFile, 'utf8')) : [];
            const newId = (fileUsers.length > 0 ? Math.max(...fileUsers.map(u => u.id || 0)) : 0) + 1;
            const newLocalUser = {
                id: newUser ? newUser.id : newId,
                emp_id: finalEmpId,
                username,
                password,
                full_name,
                role,
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

// Cập nhật tài khoản / Đổi mật khẩu (PUT) - Đồng bộ hồ sơ nhân viên
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { emp_id, username, password, full_name, role, custom_modules } = req.body;
        const finalEmpId = (emp_id || '').trim().toUpperCase();

        if (pool && typeof pool.query === 'function') {
            if (password) {
                // Có nhập mật khẩu mới -> Cập nhật cả mật khẩu
                if (custom_modules !== undefined) {
                    await pool.query(
                        "UPDATE users SET emp_id = $1, username = $2, full_name = $3, role = $4, password = $5, custom_modules = $6 WHERE id = $7 OR user_id = $7",
                        [finalEmpId, username, full_name, role, password, JSON.stringify(custom_modules), id]
                    );
                } else {
                    await pool.query(
                        "UPDATE users SET emp_id = $1, username = $2, full_name = $3, role = $4, password = $5 WHERE id = $6 OR user_id = $6",
                        [finalEmpId, username, full_name, role, password, id]
                    );
                }
            } else {
                // Để trống mật khẩu -> Chỉ cập nhật thông tin
                if (custom_modules !== undefined) {
                    await pool.query(
                        "UPDATE users SET emp_id = $1, username = $2, full_name = $3, role = $4, custom_modules = $5 WHERE id = $6 OR user_id = $6",
                        [finalEmpId, username, full_name, role, JSON.stringify(custom_modules), id]
                    );
                } else {
                    await pool.query(
                        "UPDATE users SET emp_id = $1, username = $2, full_name = $3, role = $4 WHERE id = $5 OR user_id = $5",
                        [finalEmpId, username, full_name, role, id]
                    );
                }
            }

            // Đồng bộ liên kết với bảng employees
            if (finalEmpId) {
                await pool.query(
                    "UPDATE employees SET user_id = $1 WHERE UPPER(emp_code) = $2",
                    [id, finalEmpId]
                );
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
                    fileUsers[targetIdx].role = role;
                    if (password) fileUsers[targetIdx].password = password;
                    if (custom_modules !== undefined) fileUsers[targetIdx].custom_modules = custom_modules;
                    fs.writeFileSync(usersFile, JSON.stringify(fileUsers, null, 2), 'utf8');
                }
            }
        } catch(fErr) {}

        res.json({ success: true });
    } catch(e) { 
        console.error("Lỗi API PUT /api/users:", e.message);
        res.status(500).json({ success: false, error: e.message }); 
    }
});

// Xóa tài khoản
router.delete('/:id', async (req, res) => {
    try {
        if (pool && typeof pool.query === 'function') {
            await pool.query("DELETE FROM users WHERE id = $1", [req.params.id]);
        }
        try {
            if (fs.existsSync(usersFile)) {
                let fileUsers = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
                fileUsers = fileUsers.filter(u => String(u.id) !== String(req.params.id));
                fs.writeFileSync(usersFile, JSON.stringify(fileUsers, null, 2), 'utf8');
            }
        } catch(fErr) {}

        res.json({ success: true });
    } catch(e) { 
        res.status(500).json({ success: false, error: e.message }); 
    }
});

module.exports = router;