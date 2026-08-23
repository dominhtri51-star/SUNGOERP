const express = require('express');
const router = express.Router();
const pool = require('../config/database.js'); 

// 1. Lấy danh sách toàn bộ bảo hành (Bổ sung 'id' vào json_build_object)
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT w.*, p.product_name,
            COALESCE(
                (SELECT json_agg(json_build_object('id', i.id, 'detail', i.detail, 'status', i.status) ORDER BY i.created_at ASC) 
                 FROM warranty_issues i 
                 WHERE i.serial_number = w.serial_number), 
                '[]'::json
            ) AS issues
            FROM warranties w 
            JOIN products p ON w.sku = p.sku 
            ORDER BY w.activated_at DESC
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 2. Tìm kiếm 1 thiết bị theo Serial (Bổ sung 'id' vào json_build_object)
router.get('/:serial', async (req, res) => {
    try {
        const result = await pool.query(`
             SELECT w.*, p.product_name,
             COALESCE(
                (SELECT json_agg(json_build_object('id', i.id, 'detail', i.detail, 'status', i.status) ORDER BY i.created_at ASC) 
                 FROM warranty_issues i 
                 WHERE i.serial_number = w.serial_number), 
                '[]'::json
             ) AS issues
             FROM warranties w 
             JOIN products p ON w.sku = p.sku 
             WHERE w.serial_number = $1
            `,
            [req.params.serial]
        );
        if (result.rows.length === 0) {
            return res.json({ success: true, found: false });
        }
        res.json({ success: true, found: true, data: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 3. Thêm chi tiết lỗi mới
router.post('/:serial/issues', async (req, res) => {
    try {
        const { detail, status } = req.body;
        const serial = req.params.serial;
        
        await pool.query(
            `INSERT INTO warranty_issues (serial_number, detail, status, created_at) 
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
            [serial, detail, status]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// API MỚI 4: Cập nhật thông tin lỗi đã có
router.put('/issues/:id', async (req, res) => {
    try {
        const { detail, status } = req.body;
        const id = req.params.id;
        
        await pool.query(
            `UPDATE warranty_issues SET detail = $1, status = $2 WHERE id = $3`,
            [detail, status, id]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 5. Kích hoạt bảo hành
router.post('/', async (req, res) => {
    try {
        const { serial_number, sku, customer_name } = req.body;
        const result = await pool.query(
            `INSERT INTO warranties (serial_number, sku, customer_name, activated_at) 
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING *`,
            [serial_number, sku, customer_name || 'Khách lẻ']
        );
        res.json({ success: true, warranty: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ success: false, error: 'Mã Serial này đã được kích hoạt!' });
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;