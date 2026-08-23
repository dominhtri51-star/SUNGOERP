const express = require('express');
const router = express.Router();
const pool = require('../config/database');

router.post('/', async (req, res) => {
    try {
        const { full_name, phone, address, vip_level, vat_taxcode, vat_company } = req.body;
        const finalName = full_name || 'Khách Mới';
        const finalPhone = phone || '';
        const code = 'KH' + Date.now() + Math.floor(Math.random() * 1000);
        
        // TẠO MỚI 100%, KHÔNG UPDATE DÙ TRÙNG SỐ
        const insert = await pool.query(`
            INSERT INTO customers (customer_code, name, full_name, phone, address, vip_level, tier, vat_taxcode, vat_company)
            VALUES ($1, $2, $2, $3, $4, $5, $5, $6, $7) RETURNING id
        `, [code, finalName, finalPhone, address||'', vip_level||1, vat_taxcode||'', vat_company||'']);
        res.json({ success: true, id: insert.rows[0].id });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { full_name, phone, address, vip_level, reward_points, vat_taxcode, vat_company, vat_address, vat_email } = req.body;
        await pool.query(`
            UPDATE customers SET 
                name = $1, full_name = $1, phone = $2, address = $3, vip_level = $4, tier = $4, reward_points = $5,
                vat_company = $6, vat_taxcode = $7, vat_address = $8, vat_email = $9
            WHERE id = $10
        `, [full_name, phone, address||'', vip_level||1, reward_points||0, vat_company||'', vat_taxcode||'', vat_address||'', vat_email||'', id]);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

module.exports = router;
