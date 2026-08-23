const express = require('express');
const router = express.Router();
const pool = require('./db');

pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_code VARCHAR(50) UNIQUE NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        customer_phone VARCHAR(50),
        total_amount NUMERIC NOT NULL,
        total_cost NUMERIC DEFAULT 0,
        profit NUMERIC DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Đã Hoàn Tất',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        sku VARCHAR(50),
        product_name VARCHAR(255),
        qty INTEGER NOT NULL,
        cost_price NUMERIC DEFAULT 0,
        price NUMERIC NOT NULL,
        total NUMERIC NOT NULL
    );
`).catch(console.error);

router.post('/', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { customer_name, customer_phone, items } = req.body;
        
        let total_amount = 0;
        let total_cost = 0;

        // Tính tổng tiền bán và tổng giá vốn
        for (let item of items) {
            // Lấy giá vốn (import_price) từ bảng products gốc
            const prodRes = await client.query(`SELECT import_price FROM products WHERE sku = $1`, [item.sku]);
            const cost_price = prodRes.rowCount > 0 ? parseFloat(prodRes.rows[0].import_price || 0) : 0;
            
            item.cost_price = cost_price;
            total_amount += (item.quantity * item.price);
            total_cost += (item.quantity * cost_price);
        }

        const profit = total_amount - total_cost;
        const order_code = 'ORD-' + Date.now().toString().slice(-6);

        // Lưu Đơn hàng
        const orderRes = await client.query(
            `INSERT INTO orders (order_code, customer_name, customer_phone, total_amount, total_cost, profit) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, order_code`,
            [order_code, customer_name, customer_phone, total_amount, total_cost, profit]
        );
        const orderId = orderRes.rows[0].id;

        // Lưu chi tiết từng món
        for (let item of items) {
            await client.query(
                `INSERT INTO order_items (order_id, sku, product_name, qty, cost_price, price, total) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [orderId, item.sku, item.product_name, item.quantity, item.cost_price, item.price, item.quantity * item.price]
            );
        }

        // TÍNH ĐIỂM THƯỞNG: 1 ĐIỂM = 1 VNĐ (trích từ 1% Lợi Nhuận)
        // Ví dụ: Lợi nhuận 10.000.000đ -> 1% = 100.000đ -> Tích 100.000 Điểm.
        if (customer_phone && profit > 0) {
            const points_earned = Math.floor(profit * 0.01);
            
            // Tìm khách hàng có sđt này trong CRM để cộng điểm
            const custRes = await client.query(`SELECT id, points, total_spent FROM customers WHERE phone = $1`, [customer_phone]);
            if (custRes.rowCount > 0) {
                const newPoints = parseInt(custRes.rows[0].points || 0) + points_earned;
                const newTotalSpent = parseFloat(custRes.rows[0].total_spent || 0) + total_amount;
                
                await client.query(
                    `UPDATE customers SET points = $1, total_spent = $2 WHERE id = $3`,
                    [newPoints, newTotalSpent, custRes.rows[0].id]
                );
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, order_code: orderRes.rows[0].order_code });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM orders ORDER BY created_at DESC`);
        res.json({ success: true, data: result.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
