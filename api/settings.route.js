const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Khởi tạo bảng Cài đặt hệ thống
const initTable = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS system_settings (
                setting_key VARCHAR(100) PRIMARY KEY,
                setting_value TEXT
            );
        `);
        // Khởi tạo data mặc định nếu chưa có
        await pool.query(`
            INSERT INTO system_settings (setting_key, setting_value) VALUES 
            ('store_name', 'SUNGO ERP - NĂNG LƯỢNG THÔNG MINH'),
            ('store_phone', '09xx.xxx.xxx'),
            ('store_address', 'Tp. Hồ Chí Minh, Việt Nam'),
            ('store_tax', ''),
            ('store_logo', ''),
            ('quote_notes', 'Cảm ơn Quý khách đã tin tưởng và sử dụng sản phẩm của chúng tôi!'),
            ('delivery_notes', 'Hàng hóa đã xuất kho vui lòng kiểm tra kỹ. Không nhận đổi trả nếu không phải lỗi từ Nhà sản xuất.')
            ON CONFLICT DO NOTHING;
        `);
    } catch(e) { console.error("Lỗi tạo bảng system_settings:", e); }
};
initTable();

// Lấy danh sách cấu hình
router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM system_settings');
        const data = {};
        
        rows.forEach(r => { 
            try {
                // Thử dịch ngược chuỗi JSON thành Array/Object (để đọc mảng warehouses)
                data[r.setting_key] = JSON.parse(r.setting_value);
            } catch (err) {
                // Nếu không phải định dạng JSON (các trường text bình thường), thì giữ nguyên
                data[r.setting_key] = r.setting_value; 
            }
        });
        
        res.json({ success: true, data });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// Lưu cấu hình
router.put('/', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        for (const [key, value] of Object.entries(req.body)) {
            // QUAN TRỌNG: Nếu value là Array (danh sách kho) hoặc Object, phải biến nó thành chuỗi JSON trước khi lưu vào cột TEXT
            const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
            
            await client.query(
                'INSERT INTO system_settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value',
                [key, strValue]
            );
        }
        
        await client.query('COMMIT');
        res.json({ success: true });
    } catch(e) {
        await client.query('ROLLBACK');
        console.error("Lỗi API lưu cấu hình:", e);
        res.status(500).json({ success: false, error: e.message });
    } finally { 
        client.release(); 
    }
});

module.exports = router;