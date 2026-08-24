const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const fs = require('fs');
const path = require('path');

const usersFile = path.join(__dirname, '../data/users.json');

const DEFAULT_USERS = [
    { id: 1, emp_id: 'EMP001', username: 'admin', password: '123456', full_name: 'Quản Trị Viên', role: 'ADMIN' },
    { id: 2, emp_id: 'EMP002', username: 'minhtri', password: '123456', full_name: 'Minh Trí', role: 'ADMIN' },
    { id: 3, emp_id: 'TC001', username: 'thauthicong', password: '123456', full_name: 'Đội Thi Công Solar Fast', role: 'NHA_THAU_THI_CONG' },
    { id: 4, emp_id: 'GS001', username: 'thaugiamsat', password: '123456', full_name: 'Đơn Vị Giám Sát EPC Pro', role: 'NHA_THAU_GIAM_SAT' },
    { id: 5, emp_id: 'NCC001', username: 'nhacungcap', password: '123456', full_name: 'Nhà Cung Cấp Pin & Inverter SunPower', role: 'NHA_CUNG_CAP' }
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
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            await pool.query(`
                INSERT INTO users (emp_id, username, password, full_name, role) VALUES
                ('EMP001', 'admin', '123456', 'Quản Trị Viên', 'ADMIN'),
                ('EMP002', 'minhtri', '123456', 'Minh Trí', 'ADMIN'),
                ('TC001', 'thauthicong', '123456', 'Đội Thi Công Solar Fast', 'NHA_THAU_THI_CONG'),
                ('GS001', 'thaugiamsat', '123456', 'Đơn Vị Giám Sát EPC Pro', 'NHA_THAU_GIAM_SAT'),
                ('NCC001', 'nhacungcap', '123456', 'Nhà Cung Cấp Pin & Inverter SunPower', 'NHA_CUNG_CAP')
                ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = EXCLUDED.role, full_name = EXCLUDED.full_name;
            `);
        }
    } catch(e) {
        console.error("Lỗi init users DB (sử dụng fallback file):", e.message);
    }
};
initUsers();

// Lấy danh sách tài khoản
router.get('/', async (req, res) => {
    try {
        await initUsers();
        if (pool && typeof pool.query === 'function') {
            const { rows } = await pool.query("SELECT id, emp_id, username, full_name, role FROM users ORDER BY id DESC");
            if (rows && rows.length > 0) return res.json({ success: true, data: rows });
        }
    } catch(e) {}
    
    // Fallback file
    try {
        const fileUsers = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
        return res.json({ success: true, data: fileUsers.map(u => ({ id: u.id, emp_id: u.emp_id, username: u.username, full_name: u.full_name, role: u.role })) });
    } catch(e) {
        return res.json({ success: true, data: DEFAULT_USERS.map(u => ({ id: u.id, emp_id: u.emp_id, username: u.username, full_name: u.full_name, role: u.role })) });
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
                    "SELECT id, emp_id, username, full_name, role FROM users WHERE username = $1 AND password = $2",
                    [username, password]
                );
                if (rows && rows.length > 0) {
                    return res.json({ success: true, user: rows[0] });
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
                user: {
                    id: match.id,
                    emp_id: match.emp_id,
                    username: match.username,
                    full_name: match.full_name,
                    role: match.role
                }
            });
        }

        return res.status(401).json({ success: false, error: "Sai tên đăng nhập hoặc mật khẩu!" });
    } catch(e) { 
        console.error("Lỗi API LOGIN:", e.message);
        res.status(500).json({ success: false, error: "Lỗi đăng nhập: " + e.message }); 
    }
});


// Tạo tài khoản mới (POST)
router.post('/', async (req, res) => {
    try {
        const { emp_id, username, password, full_name, role } = req.body;
        await pool.query(
            "INSERT INTO users (emp_id, username, password, full_name, role) VALUES ($1, $2, $3, $4, $5)",
            [emp_id, username, password, full_name, role]
        );
        res.json({ success: true });
    } catch(e) { 
        console.error("Lỗi API POST /api/users:", e.message);
        res.status(500).json({ success: false, error: "Tên đăng nhập đã tồn tại hoặc lỗi DB: " + e.message }); 
    }
});

// Cập nhật tài khoản / Đổi mật khẩu (PUT) - TÍNH NĂNG MỚI
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { emp_id, username, password, full_name, role } = req.body;

        if (password) {
            // Có nhập mật khẩu mới -> Cập nhật cả mật khẩu
            await pool.query(
                "UPDATE users SET emp_id = $1, username = $2, full_name = $3, role = $4, password = $5 WHERE id = $6",
                [emp_id, username, full_name, role, password, id]
            );
        } else {
            // Để trống mật khẩu -> Chỉ cập nhật thông tin
            await pool.query(
                "UPDATE users SET emp_id = $1, username = $2, full_name = $3, role = $4 WHERE id = $5",
                [emp_id, username, full_name, role, id]
            );
        }
        res.json({ success: true });
    } catch(e) { 
        console.error("Lỗi API PUT /api/users:", e.message);
        res.status(500).json({ success: false, error: e.message }); 
    }
});

// Xóa tài khoản
router.delete('/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM users WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch(e) { 
        res.status(500).json({ success: false, error: e.message }); 
    }
});

module.exports = router;