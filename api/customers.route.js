const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// TÌM KIẾM KHÁCH HÀNG (DÙNG CHO POS / AUTOCOMPLETE)
router.get('/search', async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q) return res.json([]);
        const { rows } = await pool.query(`
            SELECT id, 
                   COALESCE(NULLIF(name, ''), full_name, 'Khách Lẻ') as name, 
                   COALESCE(NULLIF(full_name, ''), name, 'Khách Lẻ') as full_name, 
                   phone, address, customer_code, nickname, 
                   vat_company, vat_taxcode, vat_address, vat_email, 
                   reward_points, COALESCE(current_debt, 0) as current_debt, total_sales, 
                   COALESCE(tier, vip_level, 1) as customer_tier,
                   COALESCE(tier, vip_level, 1) as vip_level,
                   COALESCE(tier, vip_level, 1) as tier
            FROM customers 
            WHERE name ILIKE $1 OR full_name ILIKE $1 OR phone ILIKE $1 OR nickname ILIKE $1 OR customer_code ILIKE $1 OR vat_taxcode ILIKE $1 OR vat_company ILIKE $1 OR address ILIKE $1
            ORDER BY id DESC
            LIMIT 20
        `, [`%${q}%`]);
        res.json(rows);
    } catch (e) {
        res.json([]);
    }
});

// LẤY DANH SÁCH KHÁCH HÀNG
router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT id, 
                   COALESCE(NULLIF(name, ''), full_name, 'Khách Lẻ') as name, 
                   COALESCE(NULLIF(full_name, ''), name, 'Khách Lẻ') as full_name, 
                   phone, address, customer_code, nickname, 
                   vat_company, vat_taxcode, vat_address, vat_email, 
                   reward_points, COALESCE(current_debt, 0) as current_debt, total_sales, 
                   COALESCE(tier, vip_level, 1) as customer_tier,
                   COALESCE(tier, vip_level, 1) as vip_level,
                   COALESCE(tier, vip_level, 1) as tier
            FROM customers 
            ORDER BY id DESC
        `);
        res.json({ success: true, data: rows });
    } catch (e) {
        res.json({ success: false, error: e.message, data: [] });
    }
});

// TẠO MỚI TỪ CRM (TẠO MỚI 100%, KHÔNG CÒN TÍNH NĂNG GHI ĐÈ)
router.post('/', async (req, res) => {
    try {
        const { name, full_name, phone, address, nickname, vat_company, vat_taxcode, vat_address, vat_email } = req.body;
        const finalName = name || full_name || 'Khách Mới';
        const finalPhone = phone || '';
        const code = 'KH' + Date.now() + Math.floor(Math.random() * 1000);
        
        const insert = await pool.query(`
            INSERT INTO customers (customer_code, name, full_name, phone, nickname, address, vat_company, vat_taxcode, vat_address, vat_email)
            VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id
        `, [code, finalName, finalPhone, nickname||'', address||'', vat_company||'', vat_taxcode||'', vat_address||'', vat_email||'']);
        res.json({ success: true, id: insert.rows[0].id });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// CẬP NHẬT HỒ SƠ
router.put('/:id/profile', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, nickname, address, vat_company, vat_taxcode, vat_address, vat_email } = req.body;
        await pool.query(`
            UPDATE customers SET 
                name = $1, full_name = $1, phone = $2, nickname = $3, address = $4,
                vat_company = $5, vat_taxcode = $6, vat_address = $7, vat_email = $8
            WHERE id = $9
        `, [name, phone, nickname||'', address||'', vat_company||'', vat_taxcode||'', vat_address||'', vat_email||'', id]);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// CẬP NHẬT PHÂN HẠNG
router.put('/:id/tier', async (req, res) => {
    try {
        const { id } = req.params;
        const { tier, debt, points } = req.body;
        await pool.query('UPDATE customers SET tier = $1, vip_level = $1, current_debt = $2, reward_points = $3 WHERE id = $4', [tier||1, debt||0, points||0, id]);
        res.json({ success: true });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

// XÓA
router.delete('/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM customers WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

// LẤY LỊCH SỬ GIAO DỊCH (ĐƠN HÀNG + THU CHI) CỦA 1 KHÁCH HÀNG
router.get('/:id/transactions', async (req, res) => {
    try {
        const custId = req.params.id;
        
        // Lấy thông tin khách hàng để đối chiếu Tên trong sổ quỹ
        const custRes = await pool.query('SELECT name, full_name FROM customers WHERE id = $1', [custId]);
        const custName = custRes.rows.length > 0 ? (custRes.rows[0].full_name || custRes.rows[0].name) : null;
        
        // 1. Lấy lịch sử mua hàng (Trừ đơn Hủy/Trả)
        const ordersRes = await pool.query(`
            SELECT 
                'ORDER' as type,
                id as order_id,
                order_code as title,
                created_at,
                notes as note,
                (0 - COALESCE(CAST(total_amount AS NUMERIC), 0)) as amount 
            FROM orders 
            WHERE customer_id = $1 AND status NOT IN ('CANCELLED', 'RETURNED')
        `, [custId]);

        // 2. Lấy lịch sử Thu/Chi từ sổ quỹ (Móc theo tên khách hàng)
        let cashRes = { rows: [] };
        if (custName) {
            try {
                cashRes = await pool.query(`
                    SELECT 
                        'CASH' as type,
                        id as order_id,
                        code as title,
                        created_at,
                        notes as note,
                        CASE WHEN type = 'THU' THEN COALESCE(CAST(amount AS NUMERIC), 0) ELSE (0 - COALESCE(CAST(amount AS NUMERIC), 0)) END as amount
                    FROM cash_transactions 
                    WHERE target_name ILIKE $1
                `, [`%${custName}%`]);
            } catch (tableError) {
                // Bỏ qua nếu bảng cash_transactions chưa tạo
            }
        }

        // 3. Gộp và sắp xếp lịch sử từ mới nhất -> cũ nhất
        let transactions = [...ordersRes.rows, ...cashRes.rows];
        transactions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        res.json({ success: true, data: transactions });

    } catch (e) {
        console.error("API TX ERROR:", e);
        res.json({ success: false, error: e.message });
    }
});

// NHẬT KÝ CHĂM SÓC KHÁCH HÀNG (LOGS)
router.get('/:id/logs', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, customer_id, note, created_at FROM customer_logs WHERE customer_id = $1 ORDER BY created_at DESC',
            [req.params.id]
        );
        res.json({ success: true, data: rows });
    } catch (e) {
        res.json({ success: false, error: e.message, data: [] });
    }
});

router.post('/:id/logs', async (req, res) => {
    try {
        const { note } = req.body;
        if (!note || !note.trim()) return res.json({ success: false, error: 'Ghi chú không được để trống' });
        await pool.query(
            'INSERT INTO customer_logs (customer_id, note) VALUES ($1, $2)',
            [req.params.id, note.trim()]
        );
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// QUÀ TẶNG / TRI ÂN KHÁCH HÀNG (GIFTS)
router.get('/:id/gifts', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, customer_id, gift_name, gift_value, note, gift_date FROM customer_gifts WHERE customer_id = $1 ORDER BY gift_date DESC',
            [req.params.id]
        );
        res.json({ success: true, data: rows });
    } catch (e) {
        res.json({ success: false, error: e.message, data: [] });
    }
});

router.post('/:id/gifts', async (req, res) => {
    try {
        const { gift_name, gift_value, note } = req.body;
        if (!gift_name || !gift_name.trim()) return res.json({ success: false, error: 'Tên quà tặng không được để trống' });
        await pool.query(
            'INSERT INTO customer_gifts (customer_id, gift_name, gift_value, note) VALUES ($1, $2, $3, $4)',
            [req.params.id, gift_name.trim(), parseFloat(gift_value) || 0, note || '']
        );
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

module.exports = router;
