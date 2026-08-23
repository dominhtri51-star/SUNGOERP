const express = require('express');
const router = express.Router();
const pool = require('./db');
const multer = require('multer');

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'public/uploads/') },
    filename: function (req, file, cb) { cb(null, Date.now() + '-' + file.originalname) }
});
const upload = multer({ storage: storage });

pool.query(`
    CREATE TABLE IF NOT EXISTS contracts (
        id SERIAL PRIMARY KEY,
        contract_code VARCHAR(50) UNIQUE NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        total_value NUMERIC NOT NULL,
        paid_amount NUMERIC DEFAULT 0,
        payment_status VARCHAR(50) DEFAULT 'Chờ Đặt Cọc',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS contract_payments (
        id SERIAL PRIMARY KEY,
        contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
        amount NUMERIC NOT NULL,
        payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        proof_url TEXT,
        note TEXT
    );
`).catch(console.error);

router.get('/', async (req, res) => {
    try {
        const contracts = await pool.query(`SELECT * FROM contracts ORDER BY created_at DESC`);
        for (let c of contracts.rows) {
            const payments = await pool.query(`SELECT * FROM contract_payments WHERE contract_id = $1 ORDER BY payment_date DESC`, [c.id]);
            c.history = payments.rows;
        }
        res.json({ success: true, data: contracts.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/', async (req, res) => {
    try {
        const { contract_code, customer_name, total_value } = req.body;
        const result = await pool.query(
            `INSERT INTO contracts (contract_code, customer_name, total_value) VALUES ($1, $2, $3) RETURNING *`,
            [contract_code, customer_name, total_value]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/:id/pay', upload.single('proof_file'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const amount = parseFloat(req.body.amount);
        const note = req.body.note || '';
        const proof_url = req.file ? `/uploads/${req.file.filename}` : null;

        await client.query(
            `INSERT INTO contract_payments (contract_id, amount, proof_url, note) VALUES ($1, $2, $3, $4)`,
            [id, amount, proof_url, note]
        );

        const current = await client.query(`SELECT total_value, paid_amount FROM contracts WHERE id = $1`, [id]);
        if(current.rowCount === 0) throw new Error('Không tìm thấy Hợp đồng');
        
        const newPaid = parseFloat(current.rows[0].paid_amount) + amount;
        const total = parseFloat(current.rows[0].total_value);
        
        let status = 'Đang Thanh Toán';
        if (newPaid === 0) status = 'Chờ Đặt Cọc';
        else if (newPaid >= total) status = 'Đã Hoàn Tất';

        await client.query(
            `UPDATE contracts SET paid_amount = $1, payment_status = $2 WHERE id = $3`,
            [newPaid, status, id]
        );

        await client.query('COMMIT');
        res.json({ success: true, message: 'Đã lưu chứng từ và cập nhật công nợ.' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

module.exports = router;
