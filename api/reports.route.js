const express = require('express');
const router = express.Router();
const pool = require('../config/database');

router.get('/quick', async (req, res) => {
    try {
        const { period } = req.query; 
        let dateFilter = "1=1"; 
        
        if (period === 'day') dateFilter = "DATE(o.created_at) = CURRENT_DATE";
        else if (period === 'week') dateFilter = "o.created_at >= date_trunc('week', CURRENT_DATE)";
        else if (period === 'month') dateFilter = "o.created_at >= date_trunc('month', CURRENT_DATE)";
        else if (period === 'year') dateFilter = "o.created_at >= date_trunc('year', CURRENT_DATE)";

        const salesQuery = `
            SELECT 
                COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue,
                COALESCE(SUM(oi.quantity * p.import_price), 0) AS cogs
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            JOIN products p ON oi.product_id = p.id
            WHERE o.status = 'COMPLETED' AND ${dateFilter}
        `;
        
        // LIÊN KẾT KHO: Quét toàn bộ tồn kho THỰC TẾ hiện tại
        const invQuery = "SELECT COALESCE(SUM(stock_qty * import_price), 0) AS total_inv_value, COALESCE(SUM(stock_qty), 0) AS total_qty FROM products WHERE stock_qty > 0";
        
        let revenue = 0, cogs = 0, inventoryValue = 0, inventoryQty = 0;
        
        try {
            const salesRes = await pool.query(salesQuery);
            if (salesRes.rows.length > 0) {
                revenue = parseFloat(salesRes.rows[0].revenue) || 0;
                cogs = parseFloat(salesRes.rows[0].cogs) || 0;
            }
        } catch(e) {}

        try {
            const invRes = await pool.query(invQuery);
            if (invRes.rows.length > 0) {
                inventoryValue = parseFloat(invRes.rows[0].total_inv_value) || 0;
                inventoryQty = parseInt(invRes.rows[0].total_qty) || 0;
            }
        } catch(e) { console.log("Lỗi truy vấn kho:", e.message); }

        const profit = revenue - cogs;
        const thu = revenue;
        const chi = cogs;

        res.json({
            success: true,
            data: { revenue, profit, inventoryValue, inventoryQty, thu, chi, period }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;