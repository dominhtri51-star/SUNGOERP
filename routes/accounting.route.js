const express = require('express');
const router = express.Router();
const pool = require('./db');

// Cập nhật cấu trúc DB cũ (thêm cột Đã Thanh Toán) và Tạo bảng Sổ Quỹ
pool.query(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_amount NUMERIC DEFAULT 0;
    ALTER TABLE imports ADD COLUMN IF NOT EXISTS paid_amount NUMERIC DEFAULT 0;

    CREATE TABLE IF NOT EXISTS cashbook (
        id SERIAL PRIMARY KEY,
        trans_date DATE NOT NULL,
        trans_type VARCHAR(20), -- 'IN' (Thu), 'OUT' (Chi)
        amount NUMERIC NOT NULL,
        currency VARCHAR(10) DEFAULT 'VND',
        payment_method VARCHAR(50), -- 'BANK', 'CASH'
        category VARCHAR(100), 
        ref_id VARCHAR(50), -- Mã Đơn Hàng hoặc PO
        partner_name VARCHAR(255),
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
`).catch(console.error);

// 1. Lấy dữ liệu Tổng quan Dashboard (Sổ quỹ & Nợ)
router.get('/dashboard', async (req, res) => {
    try {
        // Tồn quỹ
        const cashQuery = await pool.query(`
            SELECT currency, payment_method, trans_type, SUM(amount) as total 
            FROM cashbook GROUP BY currency, payment_method, trans_type
        `);
        let funds = { bank_vnd: 0, bank_usd: 0, cash_vnd: 0 };
        
        cashQuery.rows.forEach(r => {
            let val = parseFloat(r.total);
            if(r.trans_type === 'OUT') val = -val;
            
            if(r.currency === 'VND' && r.payment_method === 'BANK') funds.bank_vnd += val;
            if(r.currency === 'VND' && r.payment_method === 'CASH') funds.cash_vnd += val;
            if(r.currency === 'USD' && r.payment_method === 'BANK') funds.bank_usd += val;
        });

        // Nợ Phải Thu (AR - Khách hàng)
        const arQuery = await pool.query(`SELECT SUM(total_amount - paid_amount) as debt FROM orders WHERE total_amount > paid_amount AND status != 'Đã Hủy'`);
        const total_ar = parseFloat(arQuery.rows[0].debt || 0);

        // Nợ Phải Trả (AP - Nhà cung cấp / Nhập khẩu)
        const apVndQuery = await pool.query(`SELECT SUM(total_amount - paid_amount) as debt FROM imports WHERE currency = 'VND' AND total_amount > paid_amount`);
        const apUsdQuery = await pool.query(`SELECT SUM(total_amount - paid_amount) as debt FROM imports WHERE currency = 'USD' AND total_amount > paid_amount`);
        
        res.json({ success: true, data: { 
            funds, total_ar, 
            total_ap_vnd: parseFloat(apVndQuery.rows[0].debt || 0), 
            total_ap_usd: parseFloat(apUsdQuery.rows[0].debt || 0) 
        }});
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 2. Lấy danh sách Sổ Quỹ (Giao dịch dòng tiền)
router.get('/cashbook', async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM cashbook ORDER BY trans_date DESC, created_at DESC`);
        res.json({ success: true, data: result.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 3. Lấy Công Nợ Phải Thu (Khách hàng)
router.get('/ar', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT order_code as ref_id, customer_name as partner_name, total_amount, paid_amount, (total_amount - paid_amount) as debt, 'VND' as currency, created_at 
            FROM orders WHERE total_amount > paid_amount AND status != 'Đã Hủy' ORDER BY created_at DESC
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 4. Lấy Công Nợ Phải Trả (Nhà cung cấp Nhập khẩu)
router.get('/ap', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT po_code as ref_id, supplier_name as partner_name, total_amount, paid_amount, (total_amount - paid_amount) as debt, currency, created_at 
            FROM imports WHERE total_amount > paid_amount ORDER BY created_at DESC
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 5. Ghi nhận Thu / Chi (Hạch toán)
router.post('/transaction', async (req, res) => {
    try {
        const { trans_date, trans_type, amount, currency, payment_method, category, ref_id, partner_name, description } = req.body;
        const amt = parseFloat(amount);

        // Lưu vào Sổ Quỹ
        const result = await pool.query(
            `INSERT INTO cashbook (trans_date, trans_type, amount, currency, payment_method, category, ref_id, partner_name, description) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [trans_date, trans_type, amt, currency, payment_method, category, ref_id || '', partner_name || '', description]
        );

        // Tự động cấn trừ Công Nợ nếu có mã tham chiếu (ref_id)
        if(ref_id) {
            if(trans_type === 'IN' && category === 'Thu Tiền Hàng') {
                await pool.query(`UPDATE orders SET paid_amount = paid_amount + $1 WHERE order_code = $2`, [amt, ref_id]);
            } else if (trans_type === 'OUT' && category === 'Thanh Toán NCC') {
                await pool.query(`UPDATE imports SET paid_amount = paid_amount + $1 WHERE po_code = $2`, [amt, ref_id]);
            }
        }

        res.json({ success: true, data: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
