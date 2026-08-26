const express = require('express');
const router = express.Router();
const pool = require('../config/database');

const fs = require('fs');
const path = require('path');

const settingsFile = path.join(__dirname, '../data/settings.json');

const DEFAULT_ROLE_PERMISSIONS = {
    'ADMIN': ['*'],
    'SUPER_ADMIN': ['*'],
    'SALE_ADMIN': ['sale-crm', 'sale-orders', 'order-history', 'return-orders', 'sales-commissions', 'sale-boq', 'boq-list', 'admin-approve', 'inventory-dash', 'bidding-marketplace'],
    'SALE': ['sale-crm', 'sale-orders', 'order-history', 'return-orders', 'sales-commissions', 'sale-boq', 'boq-list'],
    'THU_MUA': ['suppliers', 'import-orders', 'purchases', 'procurement-inventory'],
    'NHAN_VIEN_KHO': ['inventory-dash', 'warehouse-in', 'warehouse-out', 'return-orders'],
    'KE_TOAN': ['accounting-vault', 'accounting-cashbook', 'accounting-cash', 'accounting-payments', 'contract-billing', 'accounting-vat', 'accounting-tax', 'business-health', 'hr-employees', 'sales-commissions', 'debt-kpi', 'payroll-manager', 'finance-loans', 'finance-capital'],
    'KY_THUAT': ['project-list', 'om-schedule', 'warranty-list'],
    'HR': ['hr-employees', 'payroll-manager', 'debt-kpi', 'sales-commissions'],
    'NHA_THAU_THI_CONG': ['contractor-portal', 'contractor-my-profile'],
    'NHA_THAU_GIAM_SAT': ['contractor-portal', 'contractor-my-profile'],
    'NHA_CUNG_CAP': ['contractor-portal', 'contractor-my-profile']
};

// Khởi tạo bảng Cài đặt hệ thống
const initTable = async () => {
    try {
        const dataDir = path.join(__dirname, '../data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

        if (pool && typeof pool.query === 'function') {
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
                ('delivery_notes', 'Hàng hóa đã xuất kho vui lòng kiểm tra kỹ. Không nhận đổi trả nếu không phải lỗi từ Nhà sản xuất.'),
                ('role_permissions', $1)
                ON CONFLICT (setting_key) DO NOTHING;
            `, [JSON.stringify(DEFAULT_ROLE_PERMISSIONS)]);
        }
    } catch(e) { console.error("Lỗi tạo bảng system_settings:", e); }
};
initTable();

// Lấy danh sách cấu hình
router.get('/', async (req, res) => {
    let data = {};
    try {
        if (pool && typeof pool.query === 'function') {
            const { rows } = await pool.query('SELECT * FROM system_settings');
            rows.forEach(r => { 
                try {
                    data[r.setting_key] = JSON.parse(r.setting_value);
                } catch (err) {
                    data[r.setting_key] = r.setting_value; 
                }
            });
        }
    } catch(e) {
        console.warn("DB settings fallback:", e.message);
    }
    
    // Đảm bảo luôn có role_permissions mặc định nếu rỗng
    if (!data.role_permissions || Object.keys(data.role_permissions).length === 0) {
        data.role_permissions = DEFAULT_ROLE_PERMISSIONS;
    }

    // Merge fallback từ file nếu có
    try {
        if (fs.existsSync(settingsFile)) {
            const fileData = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
            data = { ...fileData, ...data };
        }
    } catch(e) {}

    return res.json({ success: true, data });
});

// Lưu cấu hình
router.put('/', async (req, res) => {
    let client;
    try {
        if (pool && typeof pool.connect === 'function') {
            client = await pool.connect();
            await client.query('BEGIN');
            
            for (const [key, value] of Object.entries(req.body)) {
                const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
                await client.query(
                    'INSERT INTO system_settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value',
                    [key, strValue]
                );
            }
            
            await client.query('COMMIT');
        }

        // Đồng bộ lưu ra file JSON fallback
        try {
            const dataDir = path.join(__dirname, '../data');
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
            let current = {};
            if (fs.existsSync(settingsFile)) {
                try { current = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch(e) {}
            }
            current = { ...current, ...req.body };
            fs.writeFileSync(settingsFile, JSON.stringify(current, null, 2), 'utf8');
        } catch(fe) {
            console.warn("Lỗi ghi file settings.json fallback:", fe.message);
        }

        res.json({ success: true });
    } catch(e) {
        if (client) await client.query('ROLLBACK');
        console.error("Lỗi API lưu cấu hình:", e);
        res.status(500).json({ success: false, error: e.message });
    } finally { 
        if (client) client.release(); 
    }
});

module.exports = router;