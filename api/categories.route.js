const express = require('express');
const router = express.Router();
const pool = require('../config/database.js');

pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        parent_id INTEGER DEFAULT NULL
    );
`).catch(console.error);

router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM categories ORDER BY id ASC');
        res.json({ success: true, data: result.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/', async (req, res) => {
    try {
        const result = await pool.query('INSERT INTO categories (name, parent_id) VALUES ($1, $2) RETURNING *', [req.body.name, req.body.parent_id || null]);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.put('/:id', async (req, res) => {
    try {
        const result = await pool.query('UPDATE categories SET name = $1 WHERE id = $2 RETURNING *', [req.body.name, req.params.id]);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.delete('/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM categories WHERE id = $1 OR parent_id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
