const express = require('express');
const router = express.Router();
const pool = require('../config/database.js');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Cấu hình Multer để nhận file XML
const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'public/uploads/') },
    filename: function (req, file, cb) { 
        cb(null, 'einvoice-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Khởi tạo Table (như cũ)
pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
        id SERIAL PRIMARY KEY,
        expense_date DATE NOT NULL,
        category VARCHAR(100),
        description TEXT,
        vendor_name VARCHAR(255),
        vendor_tax_code VARCHAR(50),
        has_invoice BOOLEAN DEFAULT false,
        invoice_no VARCHAR(50),
        amount_before_tax NUMERIC DEFAULT 0,
        vat_rate INTEGER DEFAULT 0,
        vat_amount NUMERIC DEFAULT 0,
        total_amount NUMERIC DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
`).catch(console.error);

router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM invoices ORDER BY created_at DESC`);
        res.json({ success: true, data: result.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/sync-pending', async (req, res) => {
    try {
        const orders = await pool.query(`SELECT * FROM orders WHERE status = 'Đã Hoàn Tất'`);
        for (let o of orders.rows) {
            const check = await pool.query(`SELECT id FROM invoices WHERE ref_id = $1`, [o.order_code]);
            if (check.rowCount === 0) {
                const crm = await pool.query(`SELECT * FROM customers WHERE phone = $1`, [o.customer_phone]);
                const cData = crm.rowCount > 0 ? crm.rows[0] : {};
                if(cData.tax_code) {
                    const vatAmount = parseFloat(o.total_amount) * 0.08; 
                    await pool.query(
                        `INSERT INTO invoices (ref_type, ref_id, customer_name, tax_code, company_name, company_address, vat_email, total_amount, vat_rate, vat_amount) 
                         VALUES ('ORDER', $1, $2, $3, $4, $5, $6, $7, 8, $8)`,
                        [o.order_code, cData.full_name, cData.tax_code, cData.company_name, cData.company_address, cData.vat_email, o.total_amount, vatAmount]
                    );
                }
            }
        }
        res.json({ success: true, message: 'Đã đồng bộ đơn hàng chờ xuất VAT' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/:id/issue', async (req, res) => {
    try {
        const { provider } = req.body;
        const invNo = '00' + Math.floor(10000 + Math.random() * 90000);
        const result = await pool.query(
            `UPDATE invoices SET status = 'Đã Phát Hành', provider = $1, invoice_no = $2, issued_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *`,
            [provider, invNo, req.params.id]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/manual', async (req, res) => {
    try {
        const { invoice_no, issued_at, company_name, tax_code, total_amount, vat_rate, vat_amount } = req.body;
        const result = await pool.query(
            `INSERT INTO invoices (ref_type, ref_id, company_name, tax_code, total_amount, vat_rate, vat_amount, invoice_no, status, provider, issued_at) 
             VALUES ('MANUAL', 'Nhập Tay', $1, $2, $3, $4, $5, $6, 'Đã Phát Hành', 'VinInvoice (Ngoài hệ thống)', $7) RETURNING *`,
            [company_name, tax_code, total_amount, vat_rate, vat_amount, invoice_no, issued_at]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/expenses', async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM expenses ORDER BY expense_date DESC, id DESC`);
        res.json({ success: true, data: result.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/expenses', async (req, res) => {
    try {
        const { expense_date, category, description, vendor_name, vendor_tax_code, has_invoice, invoice_no, amount_before_tax, vat_rate, vat_amount, total_amount } = req.body;
        const result = await pool.query(
            `INSERT INTO expenses (expense_date, category, description, vendor_name, vendor_tax_code, has_invoice, invoice_no, amount_before_tax, vat_rate, vat_amount, total_amount) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [expense_date, category, description, vendor_name||'', vendor_tax_code||'', has_invoice, invoice_no||'', amount_before_tax, vat_rate, vat_amount, total_amount]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// API ĐỌC FILE XML TỪ TỔNG CỤC THUẾ
router.post('/upload-xml', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'Chưa chọn file XML' });
    
    try {
        const xmlData = fs.readFileSync(req.file.path, 'utf8');
        
        // Dùng Regex bóc tách các trường cơ bản của HĐĐT chuẩn TCT
        const getTag = (tag) => {
            const match = xmlData.match(new RegExp(`<${tag}>(.*?)</${tag}>`));
            return match ? match[1] : '';
        };

        const invoice_no = getTag('SHDon') || '00' + Math.floor(Math.random()*100000);
        const vendor_name = getTag('TenNBan') || getTag('Ten') || 'Nhà Cung Cấp (Từ XML)';
        const vendor_tax_code = getTag('MSTNBan') || getTag('MST') || 'Unknown';
        const total_amount = parseFloat(getTag('TgTTTBSo') || getTag('TongTien') || 0);
        const vat_amount = parseFloat(getTag('TgTThue') || 0);
        const amount_before_tax = total_amount - vat_amount;
        const issue_date_str = getTag('TDLap') || new Date().toISOString(); 
        
        // Lưu thẳng vào bảng Expenses (Chi phí Đầu vào)
        const result = await pool.query(
            `INSERT INTO expenses (expense_date, category, description, vendor_name, vendor_tax_code, has_invoice, invoice_no, amount_before_tax, vat_rate, vat_amount, total_amount) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [new Date(issue_date_str.split('T')[0]), 'Nhập Hàng', 'Đồng bộ từ file XML TCT', vendor_name, vendor_tax_code, true, invoice_no, amount_before_tax, vat_amount > 0 ? 8 : 0, vat_amount, total_amount]
        );

        res.json({ success: true, data: result.rows[0], message: 'Đã đọc thành công Hóa đơn XML!' });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Lỗi parse file XML: ' + err.message });
    }
});

module.exports = router;
