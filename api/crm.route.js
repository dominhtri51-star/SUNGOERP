const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Endpoint BATCH / BULK IMPORT SIÊU TỐC CHO EXCEL & QUICK UPLOAD KHÁCH HÀNG
router.post('/bulk', async (req, res) => {
    const client = await pool.connect();
    try {
        const { items } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, error: 'Danh sách khách hàng trống!' });
        }

        await client.query('BEGIN');

        let insertedCount = 0;
        let updatedCount = 0;

        for (let idx = 0; idx < items.length; idx++) {
            const item = items[idx];
            const rawName = item.name || item.full_name || '';
            const finalName = String(rawName).trim();
            const rawPhone = item.phone ? String(item.phone).trim() : '';
            const rawCode = item.customer_code ? String(item.customer_code).trim().toUpperCase() : '';
            const nickname = item.nickname ? String(item.nickname).trim() : '';
            const address = item.address ? String(item.address).trim() : '';
            const vatCompany = item.vat_company ? String(item.vat_company).trim() : '';
            const vatTaxcode = item.vat_taxcode ? String(item.vat_taxcode).trim() : '';
            const vatAddress = item.vat_address ? String(item.vat_address).trim() : '';
            const vatEmail = item.vat_email ? String(item.vat_email).trim() : '';
            
            let tier = parseInt(item.tier || item.vip_level || item.customer_tier) || 1;
            if (tier < 1 || tier > 6) tier = 1;
            
            const debtLimit = Math.max(0, parseFloat(item.debt_limit) || 0);
            const rewardPoints = Math.max(0, parseFloat(item.reward_points) || 0);

            if (!finalName && !rawPhone && !rawCode) continue;

            const customerName = finalName || (rawPhone ? 'Khách ' + rawPhone : 'Khách Mới');

            let existing = null;
            if (rawCode) {
                const findByCode = await client.query('SELECT id, customer_code FROM customers WHERE UPPER(customer_code) = $1 LIMIT 1', [rawCode]);
                if (findByCode.rows.length > 0) {
                    existing = findByCode.rows[0];
                }
            }
            if (!existing && rawPhone) {
                const findByPhone = await client.query('SELECT id, customer_code FROM customers WHERE phone = $1 OR phone = $2 LIMIT 1', [rawPhone, rawPhone.replace(/\s+/g, '')]);
                if (findByPhone.rows.length > 0) {
                    existing = findByPhone.rows[0];
                }
            }
            if (!existing && vatTaxcode && vatTaxcode.length >= 8) {
                const findByTax = await client.query('SELECT id, customer_code FROM customers WHERE vat_taxcode = $1 LIMIT 1', [vatTaxcode]);
                if (findByTax.rows.length > 0) {
                    existing = findByTax.rows[0];
                }
            }

            if (existing) {
                await client.query(`
                    UPDATE customers SET 
                        name = COALESCE(NULLIF($1, ''), name),
                        full_name = COALESCE(NULLIF($1, ''), full_name, name),
                        phone = CASE WHEN $2 <> '' THEN $2 ELSE phone END,
                        nickname = CASE WHEN $3 <> '' THEN $3 ELSE nickname END,
                        address = CASE WHEN $4 <> '' THEN $4 ELSE address END,
                        vat_company = CASE WHEN $5 <> '' THEN $5 ELSE vat_company END,
                        vat_taxcode = CASE WHEN $6 <> '' THEN $6 ELSE vat_taxcode END,
                        vat_address = CASE WHEN $7 <> '' THEN $7 ELSE vat_address END,
                        vat_email = CASE WHEN $8 <> '' THEN $8 ELSE vat_email END,
                        tier = CASE WHEN $9 > 0 THEN $9 ELSE tier END,
                        vip_level = CASE WHEN $9 > 0 THEN $9 ELSE vip_level END,
                        debt_limit = CASE WHEN $10 > 0 THEN $10 ELSE debt_limit END,
                        reward_points = CASE WHEN $11 > 0 THEN $11 ELSE reward_points END
                    WHERE id = $12
                `, [
                    customerName, rawPhone, nickname, address, 
                    vatCompany, vatTaxcode, vatAddress, vatEmail, 
                    tier, debtLimit, rewardPoints, existing.id
                ]);
                updatedCount++;
            } else {
                const finalCode = rawCode || ('KH' + Date.now().toString(36).toUpperCase() + (idx + 1).toString().padStart(2, '0'));
                await client.query(`
                    INSERT INTO customers (
                        customer_code, name, full_name, phone, nickname, address,
                        vat_company, vat_taxcode, vat_address, vat_email,
                        tier, vip_level, debt_limit, reward_points
                    ) VALUES (
                        $1, $2, $2, $3, $4, $5,
                        $6, $7, $8, $9,
                        $10, $10, $11, $12
                    )
                `, [
                    finalCode, customerName, rawPhone, nickname, address,
                    vatCompany, vatTaxcode, vatAddress, vatEmail,
                    tier, debtLimit, rewardPoints
                ]);
                insertedCount++;
            }
        }

        await client.query('COMMIT');
        res.json({
            success: true,
            total: insertedCount + updatedCount,
            inserted: insertedCount,
            updated: updatedCount,
            message: `Đã xử lý thành công ${insertedCount + updatedCount} khách hàng (Thêm mới: ${insertedCount}, Cập nhật: ${updatedCount})!`
        });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// TÌM KIẾM KHÁCH HÀNG CRM
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
                   COALESCE(customers.current_debt, 0) as current_debt,
                   COALESCE(customers.payable_debt, 0) as payable_debt,
                   COALESCE(customers.total_sales, customers.total_spent, 0) as total_sales,
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

// LẤY TẤT CẢ KHÁCH HÀNG (KÈM CHỈ SỐ QUÀ TẶNG & TRI ÂN & HẠN MỨC NỢ)
router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT c.id, 
                   COALESCE(NULLIF(c.name, ''), c.full_name, 'Khách Lẻ') as name, 
                   COALESCE(NULLIF(c.full_name, ''), c.name, 'Khách Lẻ') as full_name, 
                   c.phone, c.address, c.customer_code, c.nickname, 
                   c.vat_company, c.vat_taxcode, c.vat_address, c.vat_email, 
                   c.reward_points, 
                   COALESCE(c.current_debt, 0) as current_debt,
                   COALESCE(c.payable_debt, 0) as payable_debt,
                   COALESCE(c.total_sales, c.total_spent, 0) as total_sales,
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

router.post('/', async (req, res) => {
    try {
        const { full_name, name, phone, address, vip_level, vat_taxcode, vat_company } = req.body;
        const finalName = full_name || name || 'Khách Mới';
        const finalPhone = phone || '';
        const code = 'KH' + Date.now() + Math.floor(Math.random() * 1000);
        const vip = parseInt(vip_level) || 1;
        
        const insert = await pool.query(`
            INSERT INTO customers (customer_code, name, full_name, phone, address, vip_level, tier, vat_taxcode, vat_company)
            VALUES ($1, $2, $2, $3, $4, $5, $5, $6, $7) RETURNING id
        `, [code, finalName, finalPhone, address||'', vip, vat_taxcode||'', vat_company||'']);
        
        const newId = insert.rows[0].id;
        const customerData = {
            id: newId,
            customer_code: code,
            name: finalName,
            full_name: finalName,
            phone: finalPhone,
            address: address || '',
            vip_level: vip,
            tier: vip,
            customer_tier: vip,
            reward_points: 0,
            current_debt: 0,
            total_sales: 0
        };
        
        res.json({ success: true, id: newId, data: customerData });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { full_name, name, phone, address, vip_level, reward_points, vat_taxcode, vat_company, vat_address, vat_email } = req.body;
        const finalName = full_name || name || 'Khách Hàng';
        const vip = parseInt(vip_level) || 1;
        await pool.query(`
            UPDATE customers SET 
                name = $1, full_name = $1, phone = $2, address = $3, vip_level = $4, tier = $4, reward_points = $5,
                vat_company = $6, vat_taxcode = $7, vat_address = $8, vat_email = $9
            WHERE id = $10
        `, [finalName, phone||'', address||'', vip, parseFloat(reward_points)||0, vat_company||'', vat_taxcode||'', vat_address||'', vat_email||'', id]);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

module.exports = router;
