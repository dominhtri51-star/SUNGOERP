const express = require('express');
const router = express.Router();
const pool = require('../config/database');

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

// LẤY TẤT CẢ KHÁCH HÀNG
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
