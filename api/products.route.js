const express = require('express');
const router = express.Router();
const pool = require('../config/database');

router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY id DESC');
        res.json({ success: true, data: result.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/', async (req, res) => {
    try {
        const { sku, product_name, category, description, image_url, doc_cocq, doc_datasheet, doc_catalog, doc_manual, import_price, retail_price, price_2, price_3, price_4, price_5, price_6, stock_qty, virtual_stock } = req.body;
        await pool.query(
            `INSERT INTO products (sku, product_name, category, description, image_url, doc_cocq, doc_datasheet, doc_catalog, doc_manual, import_price, retail_price, price_2, price_3, price_4, price_5, price_6, stock_qty, virtual_stock) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`, 
            [sku, product_name, category, description||'', image_url||'', doc_cocq||'', doc_datasheet||'', doc_catalog||'', doc_manual||'', import_price||0, retail_price||0, price_2||0, price_3||0, price_4||0, price_5||0, price_6||0, stock_qty||0, virtual_stock||0]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.put('/:id', async (req, res) => {
    try {
        const { sku, product_name, category, description, image_url, doc_cocq, doc_datasheet, doc_catalog, doc_manual, import_price, retail_price, price_2, price_3, price_4, price_5, price_6, stock_qty, virtual_stock } = req.body;
        await pool.query(
            `UPDATE products SET sku=$1, product_name=$2, category=$3, description=$4, image_url=$5, doc_cocq=$6, doc_datasheet=$7, doc_catalog=$8, doc_manual=$9, import_price=$10, retail_price=$11, price_2=$12, price_3=$13, price_4=$14, price_5=$15, price_6=$16, stock_qty=$17, virtual_stock=$18 WHERE id=$19`, 
            [sku, product_name, category, description||'', image_url||'', doc_cocq||'', doc_datasheet||'', doc_catalog||'', doc_manual||'', import_price||0, retail_price||0, price_2||0, price_3||0, price_4||0, price_5||0, price_6||0, stock_qty||0, virtual_stock||0, req.params.id]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.put('/:id/stock', async (req, res) => {
    try {
        const { stock_qty, virtual_stock } = req.body;
        await pool.query('UPDATE products SET stock_qty=$1, virtual_stock=$2 WHERE id=$3', [stock_qty||0, virtual_stock||0, req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
