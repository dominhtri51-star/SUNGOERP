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
        const { sku, product_name, category, category_id, description, bin_location, stocks, image_url, doc_cocq, doc_datasheet, doc_catalog, doc_manual, import_price, retail_price, price_2, price_3, price_4, price_5, price_6, stock_qty, virtual_stock } = req.body;
        await pool.query(
            `INSERT INTO products (sku, product_name, category, category_id, description, bin_location, stocks, image_url, doc_cocq, doc_datasheet, doc_catalog, doc_manual, import_price, retail_price, price_2, price_3, price_4, price_5, price_6, stock_qty, virtual_stock) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`, 
            [
                sku, 
                product_name, 
                category || 'Khác', 
                category_id || null, 
                description || '', 
                bin_location || '', 
                typeof stocks === 'object' ? JSON.stringify(stocks) : (stocks || '{}'), 
                image_url || '', 
                doc_cocq || '', 
                doc_datasheet || '', 
                doc_catalog || '', 
                doc_manual || '', 
                import_price || 0, 
                retail_price || 0, 
                price_2 || 0, 
                price_3 || 0, 
                price_4 || 0, 
                price_5 || 0, 
                price_6 || 0, 
                stock_qty || 0, 
                virtual_stock || 0
            ]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.put('/:id', async (req, res) => {
    try {
        const { sku, product_name, category, category_id, description, bin_location, stocks, image_url, doc_cocq, doc_datasheet, doc_catalog, doc_manual, import_price, retail_price, price_2, price_3, price_4, price_5, price_6, stock_qty, virtual_stock } = req.body;
        await pool.query(
            `UPDATE products SET 
                sku=$1, product_name=$2, category=$3, category_id=$4, description=$5, bin_location=$6, stocks=$7, 
                image_url=$8, doc_cocq=$9, doc_datasheet=$10, doc_catalog=$11, doc_manual=$12, 
                import_price=$13, retail_price=$14, price_2=$15, price_3=$16, price_4=$17, price_5=$18, price_6=$19, 
                stock_qty=$20, virtual_stock=$21 
             WHERE id=$22`, 
            [
                sku, 
                product_name, 
                category || 'Khác', 
                category_id || null, 
                description || '', 
                bin_location || '', 
                typeof stocks === 'object' ? JSON.stringify(stocks) : (stocks || '{}'), 
                image_url || '', 
                doc_cocq || '', 
                doc_datasheet || '', 
                doc_catalog || '', 
                doc_manual || '', 
                import_price || 0, 
                retail_price || 0, 
                price_2 || 0, 
                price_3 || 0, 
                price_4 || 0, 
                price_5 || 0, 
                price_6 || 0, 
                stock_qty || 0, 
                virtual_stock || 0, 
                req.params.id
            ]
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

router.delete('/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;

