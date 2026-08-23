const express = require('express');
const router = express.Router();
const pool = require('../config/database');

const initTable = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS cash_transactions (
                id SERIAL PRIMARY KEY,
                code VARCHAR(50),
                type VARCHAR(10),
                target_name VARCHAR(255),
                amount NUMERIC(15,2),
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
    } catch(e) { console.log("Lỗi init bảng cash_transactions:", e.message); }
};
initTable();

router.get('/cash', async (req, res) => {
    try {
        // Lấy 100 giao dịch mới nhất
        const transRes = await pool.query("SELECT * FROM cash_transactions ORDER BY id DESC LIMIT 100");
        
        // Tính tổng Quỹ Tiền Mặt (Thu - Chi)
        const sumRes = await pool.query(`
            SELECT 
                SUM(CASE WHEN type = 'THU' THEN amount ELSE 0 END) as total_thu,
                SUM(CASE WHEN type = 'CHI' THEN amount ELSE 0 END) as total_chi
            FROM cash_transactions
        `);
        const totalThu = sumRes.rows[0].total_thu || 0;
        const totalChi = sumRes.rows[0].total_chi || 0;
        const currentCash = totalThu - totalChi;

        // Tự động tính Nợ Phải Thu (từ Orders: Tổng tiền - Đã trả)
        let totalReceivable = 0;
        try {
            const debtRes = await pool.query("SELECT SUM(total_amount - COALESCE(paid_amount,0)) as debt FROM orders WHERE status != 'CANCELLED' AND status != 'RETURNED'");
            totalReceivable = debtRes.rows[0].debt || 0;
        } catch (e) {}

        res.json({
            success: true,
            summary: {
                total_cash: currentCash,
                total_receivable: totalReceivable,
                total_payable: 0 // Mockup cho nợ nhà cung cấp
            },
            transactions: transRes.rows
        });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/cash', async (req, res) => {
    try {
        const { type, target_name, amount, notes } = req.body;
        const code = (type === 'THU' ? 'PT-' : 'PC-') + Date.now().toString().slice(-6); // Sinh mã PT/PC tự động
        
        await pool.query(
            "INSERT INTO cash_transactions (code, type, target_name, amount, notes) VALUES ($1, $2, $3, $4, $5)",
            [code, type, target_name, amount, notes]
        );
        res.json({ success: true, code });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;