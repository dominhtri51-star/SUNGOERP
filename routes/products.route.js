const express = require('express');
const router = express.Router();
const pool = require('./db');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'public/uploads/') },
    filename: function (req, file, cb) { 
        cb(null, 'prod-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// CỨU HỘ DATABASE: Ép tạo thêm cột 'id' tự tăng cho các sản phẩm cũ
pool.query(`
    CREATE TABLE IF NOT EXISTS products (
        sku VARCHAR(100)
    );
    ALTER TABLE products ADD COLUMN IF NOT EXISTS id SERIAL;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS product_name VARCHAR(255) DEFAULT 'Chưa có tên';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS short_desc TEXT DEFAULT '';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(255) DEFAULT 'Khác';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS brand VARCHAR(255) DEFAULT '';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS import_price NUMERIC DEFAULT 0;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS retail_price NUMERIC DEFAULT 0;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS price_vip1 NUMERIC DEFAULT 0;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS price_vip2 NUMERIC DEFAULT 0;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS price_vip3 NUMERIC DEFAULT 0;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS price_vip4 NUMERIC DEFAULT 0;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS price_vip5 NUMERIC DEFAULT 0;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_qty INTEGER DEFAULT 0;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_stock INTEGER DEFAULT 0;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS unit VARCHAR(50) DEFAULT 'Cái';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS gallery TEXT[] DEFAULT '{}'::text[];
    ALTER TABLE products ADD COLUMN IF NOT EXISTS documents TEXT[] DEFAULT '{}'::text[];
`).then(() => console.log("✅ Đã vá lỗi cấu trúc bảng Products")).catch(err => console.error("LỖI KHỞI TẠO BẢNG SẢN PHẨM:", err.message));

router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM products ORDER BY id DESC`);
        res.json({ success: true, data: result.rows });
    } catch (err) { 
        res.status(500).json({ success: false, error: err.message }); 
    }
});

router.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'Không có file' });
    res.json({ success: true, url: `/uploads/${req.file.filename}` });
});

router.post('/', async (req, res) => {
    try {
        const { sku, product_name, short_desc, category, brand, import_price, retail_price, price_vip1, price_vip2, price_vip3, price_vip4, price_vip5, stock_qty, supplier_stock, unit, image_url } = req.body;
        
        const check = await pool.query(`SELECT id FROM products WHERE sku = $1 LIMIT 1`, [sku]);
        let result;
        if (check.rowCount > 0) {
            const existId = check.rows[0].id;
            result = await pool.query(
                `UPDATE products SET 
                    product_name = $1, short_desc = $2, category = $3, brand = $4, 
                    import_price = $5, retail_price = $6, price_vip1 = $7, price_vip2 = $8, 
                    price_vip3 = $9, price_vip4 = $10, price_vip5 = $11, stock_qty = $12, 
                    supplier_stock = $13, unit = $14, image_url = CASE WHEN $15 != '' THEN $15 ELSE image_url END
                 WHERE id = $16 RETURNING *`,
                [product_name, short_desc||'', category||'Khác', brand||'', import_price||0, retail_price||0, price_vip1||0, price_vip2||0, price_vip3||0, price_vip4||0, price_vip5||0, stock_qty||0, supplier_stock||0, unit||'Cái', image_url||'', existId]
            );
        } else {
            result = await pool.query(
                `INSERT INTO products (sku, product_name, short_desc, category, brand, import_price, retail_price, price_vip1, price_vip2, price_vip3, price_vip4, price_vip5, stock_qty, supplier_stock, unit, image_url) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
                [sku, product_name, short_desc||'', category||'Khác', brand||'', import_price||0, retail_price||0, price_vip1||0, price_vip2||0, price_vip3||0, price_vip4||0, price_vip5||0, stock_qty||0, supplier_stock||0, unit||'Cái', image_url||'']
            );
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (err) { 
        res.status(500).json({ success: false, error: err.message }); 
    }
});

router.put('/:id', async (req, res) => {
    try {
        const { sku, product_name, short_desc, category, brand, import_price, retail_price, price_vip1, price_vip2, price_vip3, price_vip4, price_vip5, stock_qty, supplier_stock, unit, image_url } = req.body;
        const result = await pool.query(
            `UPDATE products SET sku=$1, product_name=$2, short_desc=$3, category=$4, brand=$5, import_price=$6, retail_price=$7, price_vip1=$8, price_vip2=$9, price_vip3=$10, price_vip4=$11, price_vip5=$12, stock_qty=$13, supplier_stock=$14, unit=$15, image_url=$16 WHERE id=$17 RETURNING *`,
            [sku, product_name, short_desc||'', category||'Khác', brand||'', import_price||0, retail_price||0, price_vip1||0, price_vip2||0, price_vip3||0, price_vip4||0, price_vip5||0, stock_qty||0, supplier_stock||0, unit||'Cái', image_url||'', req.params.id]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.delete('/:id', async (req, res) => {
    try { await pool.query(`DELETE FROM products WHERE id = $1`, [req.params.id]); res.json({ success: true }); } 
    catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
