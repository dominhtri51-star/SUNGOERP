const express = require('express');
const router = express.Router();
const pool = require('./db');

router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`SELECT w.*, p.product_name FROM warranties w JOIN products p ON w.sku = p.sku ORDER BY w.activated_at DESC`);
        res.json({ success: true, data: result.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/', async (req, res) => {
    try {
        const { serial_number, sku, customer_name, warranty_months } = req.body;
        const result = await pool.query(
            `INSERT INTO warranties (serial_number, sku, customer_name, warranty_months, activated_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) RETURNING *`,
            [serial_number, sku, customer_name || 'Khách lẻ', warranty_months || 120]
        );
        res.json({ success: true, warranty: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ success: false, error: 'Mã Serial này đã được kích hoạt!' });
        res.status(500).json({ success: false, error: err.message });
    }
});
module.exports = router;
