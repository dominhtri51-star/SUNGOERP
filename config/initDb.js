const pool = require("./database");
const fs = require("fs");
const path = require("path");

async function autoInitDatabase() {
    console.log("🔄 Đang kiểm tra và tự động khởi tạo CSDL...");
    try {
        // 1. Tạo bảng users nếu chưa có
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

        // 2. Tạo sẵn các tài khoản mặc định
        await pool.query(`
            INSERT INTO users (emp_id, username, password, full_name, role) VALUES
            ('EMP001', 'admin', '123456', 'Quản Trị Viên', 'ADMIN'),
            ('EMP002', 'minhtri', '123456', 'Minh Trí', 'ADMIN')
            ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password;
        `);
        console.log("✅ Đã khởi tạo bảng users và tài khoản admin/minhtri (pass: 123456) thành công!");

        // 3. Thực thi file schema.sql để tạo tất cả các bảng còn lại
        const schemaPath = path.join(__dirname, "..", "database", "schema.sql");
        if (fs.existsSync(schemaPath)) {
            const schemaSql = fs.readFileSync(schemaPath, "utf8");
            await pool.query(schemaSql);
            console.log("✅ Toàn bộ 16 bảng CSDL đã được khởi tạo tự động!");
        }
    } catch (err) {
        console.error("⚠️ Cảnh báo khởi tạo CSDL:", err.message);
    }
}

module.exports = autoInitDatabase;
