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
                   reward_points, 
                   COALESCE((SELECT SUM(total_amount - paid_amount) FROM orders WHERE customer_id = customers.id AND status NOT IN ('CANCELLED', 'RETURNED')), 0) as current_debt,
                   COALESCE((SELECT SUM(total_amount) FROM orders WHERE customer_id = customers.id AND status NOT IN ('CANCELLED', 'RETURNED')), 0) as total_sales,
                   COALESCE(debt_limit, 0) as debt_limit,
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

// LẤY DANH SÁCH KHÁCH HÀNG (KÈM CHỈ SỐ QUÀ TẶNG & TRI ÂN & HẠN MỨC NỢ)
router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT c.id, 
                   COALESCE(NULLIF(c.name, ''), c.full_name, 'Khách Lẻ') as name, 
                   COALESCE(NULLIF(c.full_name, ''), c.name, 'Khách Lẻ') as full_name, 
                   c.phone, c.address, c.customer_code, c.nickname, 
                   c.vat_company, c.vat_taxcode, c.vat_address, c.vat_email, 
                   c.reward_points, 
                   COALESCE((SELECT SUM(total_amount - paid_amount) FROM orders WHERE customer_id = c.id AND status NOT IN ('CANCELLED', 'RETURNED')), 0) as current_debt,
                   COALESCE((SELECT SUM(total_amount) FROM orders WHERE customer_id = c.id AND status NOT IN ('CANCELLED', 'RETURNED')), 0) as total_sales,
                   COALESCE(c.debt_limit, 0) as debt_limit,
                   COALESCE(c.tier, c.vip_level, 1) as customer_tier,
                   COALESCE(c.tier, c.vip_level, 1) as vip_level,
                   COALESCE(c.tier, c.vip_level, 1) as tier,
                   COALESCE(g.total_gifts_count, 0)::int as total_gifts_count,
                   COALESCE(g.total_gifts_value, 0)::numeric as total_gifts_value,
                   g.last_gift_date,
                   g.last_gift_name,
                   g.last_gift_occasion
            FROM customers c
            LEFT JOIN (
                SELECT customer_id,
                       COUNT(id) as total_gifts_count,
                       SUM(COALESCE(gift_value, 0)) as total_gifts_value,
                       MAX(gift_date) as last_gift_date,
                       (ARRAY_AGG(gift_name ORDER BY gift_date DESC, id DESC))[1] as last_gift_name,
                       (ARRAY_AGG(COALESCE(occasion, 'Tri ân') ORDER BY gift_date DESC, id DESC))[1] as last_gift_occasion
                FROM customer_gifts
                GROUP BY customer_id
            ) g ON c.id = g.customer_id
            ORDER BY c.id DESC
        `);
        res.json({ success: true, data: rows });
    } catch (e) {
        res.json({ success: false, error: e.message, data: [] });
    }
});

// TẠO MỚI TỪ CRM (TẠO MỚI 100%, KHÔNG CÒN TÍNH NĂNG GHI ĐÈ)
router.post('/', async (req, res) => {
    try {
        const { name, full_name, phone, address, nickname, vat_company, vat_taxcode, vat_address, vat_email, debt_limit } = req.body;
        const finalName = name || full_name || 'Khách Mới';
        const finalPhone = phone || '';
        const code = 'KH' + Date.now() + Math.floor(Math.random() * 1000);
        const finalDebtLimit = parseFloat(debt_limit) || 0;
        
        const insert = await pool.query(`
            INSERT INTO customers (customer_code, name, full_name, phone, address, nickname, vat_company, vat_taxcode, vat_address, vat_email, tier, vip_level, debt_limit)
            VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, 1, 1, $10) RETURNING id
        `, [code, finalName, finalPhone, address||'', nickname||'', vat_company||'', vat_taxcode||'', vat_address||'', vat_email||'', finalDebtLimit]);
        
        const newId = insert.rows[0].id;
        const customerData = {
            id: newId,
            customer_code: code,
            name: finalName,
            full_name: finalName,
            phone: finalPhone,
            address: address || '',
            nickname: nickname || '',
            vat_company: vat_company || '',
            vat_taxcode: vat_taxcode || '',
            vat_address: vat_address || '',
            vat_email: vat_email || '',
            vip_level: 1,
            tier: 1,
            customer_tier: 1,
            reward_points: 0,
            current_debt: 0,
            debt_limit: finalDebtLimit,
            total_sales: 0,
            total_gifts_count: 0,
            total_gifts_value: 0,
            last_gift_date: null,
            last_gift_name: null,
            last_gift_occasion: null
        };
        
        res.json({ success: true, id: newId, data: customerData });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// CẬP NHẬT HỒ SƠ & VAT
router.put('/:id/profile', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, nickname, address, vat_company, vat_taxcode, vat_address, vat_email } = req.body;
        await pool.query(`
            UPDATE customers SET 
                name = $1, full_name = $1, phone = $2, nickname = $3, address = $4,
                vat_company = $5, vat_taxcode = $6, vat_address = $7, vat_email = $8
            WHERE id = $9
        `, [name, phone, nickname, address, vat_company, vat_taxcode, vat_address, vat_email, id]);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// CẬP NHẬT HẠNG & HẠN MỨC CÔNG NỢ & ĐIỂM (CÔNG NỢ TỒN ĐỌNG TỰ ĐỘNG ĐỒNG BỘ TỪ ĐƠN HÀNG, KHÔNG SỬA TAY)
router.put('/:id/tier', async (req, res) => {
    try {
        const { id } = req.params;
        const { tier, points, debt_limit } = req.body;
        const tierVal = parseInt(tier) || 1;
        const debtLimitVal = Math.max(0, parseFloat(debt_limit) || 0);

        await pool.query(`
            UPDATE customers SET 
                tier = $1, 
                vip_level = $1, 
                reward_points = $2,
                debt_limit = $3,
                current_debt = (SELECT COALESCE(SUM(total_amount - paid_amount), 0) FROM orders WHERE customer_id = $4 AND status NOT IN ('CANCELLED', 'RETURNED')),
                total_sales = (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE customer_id = $4 AND status NOT IN ('CANCELLED', 'RETURNED'))
            WHERE id = $4
        `, [tierVal, parseFloat(points) || 0, debtLimitVal, id]);
        
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// XÓA KHÁCH HÀNG
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM customers WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// LẤY LỊCH SỬ ĐƠN HÀNG & GIAO DỊCH THANH TOÁN CHI TIẾT
router.get('/:id/transactions', async (req, res) => {
    try {
        const custId = req.params.id;
        
        // 1. Lấy thông tin khách hàng kèm hạn mức nợ
        const custRes = await pool.query('SELECT name, full_name, COALESCE(debt_limit, 0) as debt_limit, reward_points FROM customers WHERE id = $1', [custId]);
        const cust = custRes.rows[0];
        const custName = cust ? (cust.full_name || cust.name) : null;
        
        // 2. Lấy danh sách toàn bộ đơn hàng chi tiết
        const ordersRes = await pool.query(`
            SELECT 
                id,
                order_code,
                created_at,
                COALESCE(total_amount, 0) as total_amount,
                COALESCE(paid_amount, 0) as paid_amount,
                (COALESCE(total_amount, 0) - COALESCE(paid_amount, 0)) as debt_amount,
                status,
                payment_method,
                notes
            FROM orders 
            WHERE customer_id = $1
            ORDER BY id DESC
        `, [custId]);

        // 3. Lấy lịch sử Thu/Chi từ sổ quỹ (Móc theo tên khách hàng)
        let cashRes = { rows: [] };
        if (custName) {
            try {
                cashRes = await pool.query(`
                    SELECT 
                        id,
                        code,
                        created_at,
                        type,
                        COALESCE(CAST(amount AS NUMERIC), 0) as amount,
                        notes,
                        payment_method
                    FROM cash_transactions 
                    WHERE target_name ILIKE $1
                    ORDER BY id DESC
                `, [`%${custName}%`]);
            } catch (tableError) {
                // Bỏ qua nếu bảng cash_transactions chưa tạo
            }
        }

        // 4. Tính toán tổng hợp công nợ chuẩn xác
        const validOrders = ordersRes.rows.filter(o => !['CANCELLED', 'RETURNED'].includes(o.status));
        const totalSales = validOrders.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);
        const totalPaid = validOrders.reduce((sum, o) => sum + parseFloat(o.paid_amount || 0), 0);
        const currentDebt = validOrders.reduce((sum, o) => sum + parseFloat(o.debt_amount || 0), 0);
        const unpaidOrders = validOrders.filter(o => parseFloat(o.debt_amount || 0) > 0);
        const debtLimit = parseFloat(cust ? cust.debt_limit : 0) || 0;
        const isExceeded = debtLimit > 0 && currentDebt >= debtLimit;

        // 5. Gộp dòng thời gian tổng hợp (Timeline)
        const timeline = [
            ...ordersRes.rows.map(o => ({
                type: 'ORDER',
                id: o.id,
                code: o.order_code,
                created_at: o.created_at,
                total_amount: o.total_amount,
                paid_amount: o.paid_amount,
                debt_amount: o.debt_amount,
                status: o.status,
                payment_method: o.payment_method,
                note: o.notes
            })),
            ...cashRes.rows.map(c => ({
                type: 'CASH',
                id: c.id,
                code: c.code,
                created_at: c.created_at,
                total_amount: c.amount,
                paid_amount: c.amount,
                debt_amount: 0,
                status: c.type === 'THU' ? 'ĐÃ THU' : 'ĐÃ CHI',
                payment_method: c.payment_method,
                note: c.notes
            }))
        ];
        timeline.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        res.json({ 
            success: true, 
            summary: {
                total_sales: totalSales,
                total_paid: totalPaid,
                current_debt: currentDebt,
                debt_limit: debtLimit,
                is_exceeded: isExceeded,
                unpaid_count: unpaidOrders.length,
                total_orders_count: ordersRes.rows.length
            },
            orders: ordersRes.rows,
            payments: cashRes.rows,
            data: timeline
        });

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
            'SELECT id, customer_id, gift_name, gift_value, occasion, giver_name, note, gift_date FROM customer_gifts WHERE customer_id = $1 ORDER BY gift_date DESC, id DESC',
            [req.params.id]
        );
        res.json({ success: true, data: rows });
    } catch (e) {
        res.json({ success: false, error: e.message, data: [] });
    }
});

router.post('/:id/gifts', async (req, res) => {
    try {
        const { gift_name, gift_value, occasion, giver_name, note, gift_date } = req.body;
        if (!gift_name || !gift_name.trim()) return res.json({ success: false, error: 'Tên quà tặng không được để trống' });
        
        const finalOccasion = occasion && occasion.trim() ? occasion.trim() : 'Tri ân khách hàng';
        const finalGiver = giver_name && giver_name.trim() ? giver_name.trim() : 'SUNGO Team';
        const finalDate = gift_date ? new Date(gift_date) : new Date();

        const insert = await pool.query(
            'INSERT INTO customer_gifts (customer_id, gift_name, gift_value, occasion, giver_name, note, gift_date) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, gift_date',
            [req.params.id, gift_name.trim(), parseFloat(gift_value) || 0, finalOccasion, finalGiver, note || '', finalDate]
        );
        res.json({ success: true, id: insert.rows[0].id, data: insert.rows[0] });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

router.delete('/:id/gifts/:giftId', async (req, res) => {
    try {
        const { id, giftId } = req.params;
        await pool.query('DELETE FROM customer_gifts WHERE id = $1 AND customer_id = $2', [giftId, id]);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

module.exports = router;
