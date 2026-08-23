const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Đảm bảo bảng users luôn tồn tại
const initUsers = async () => {
    try {
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
            ('EMP002', 'minhtri', '123456', 'Minh Trí', 'ADMIN')
            ON CONFLICT (username) DO NOTHING;
        `);
    } catch(e) {
        console.error("Lỗi init users:", e.message);
    }
};
initUsers();

// Lấy danh sách tài khoản
router.get('/', async (req, res) => {
    try {
        // Bỏ created_at để tránh lỗi nếu database không có cột này
        const { rows } = await pool.query("SELECT id, emp_id, username, full_name, role FROM users ORDER BY id DESC");
        res.json({ success: true, data: rows });
    } catch(e) { 
        console.error("Lỗi API GET /api/users:", e.message);
        res.status(500).json({ success: false, error: e.message }); 
    }
});
// Kiểm tra Đăng nhập (POST /api/users/login)
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Truy vấn xem có tài khoản nào khớp user và pass không
        const { rows } = await pool.query(
            "SELECT id, emp_id, username, full_name, role FROM users WHERE username = $1 AND password = $2",
            [username, password]
        );
        
        if (rows.length > 0) {
            // Đăng nhập thành công, trả về thông tin user (ngoại trừ password)
            res.json({ success: true, user: rows[0] });
        } else {
            // Sai tài khoản hoặc mật khẩu
            res.status(401).json({ success: false, error: "Sai tên đăng nhập hoặc mật khẩu!" });
        }
    } catch(e) { 
        console.error("Lỗi API LOGIN:", e.message);
        res.status(500).json({ success: false, error: "Lỗi kết nối CSDL!" }); 
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