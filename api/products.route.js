const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Đảm bảo Unique Index và Defaults trên bảng products để hỗ trợ Bulk Upsert siêu tốc
(async () => {
    try {
        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku ON products (sku);
            ALTER TABLE products ALTER COLUMN wholesale_price SET DEFAULT 0;
            ALTER TABLE products ALTER COLUMN wholesale_price DROP NOT NULL;
            ALTER TABLE products ALTER COLUMN unit SET DEFAULT 'Bộ';
            ALTER TABLE products ALTER COLUMN category SET DEFAULT 'Khác';
            ALTER TABLE products ALTER COLUMN retail_price SET DEFAULT 0;
        `);
    } catch (e) {
        console.warn('Init products unique index warning:', e.message);
    }
})();

router.get('/', async (req, res) => {
    try {
        const isPos = req.query.pos === '1' || req.query.compact === '1';
        const canViewCost = req.user && ['ADMIN', 'SUPER_ADMIN', 'GIAM_DOC', 'KE_TOAN', 'THU_MUA'].includes(String(req.user.role || '').toUpperCase());

        let query = 'SELECT * FROM products ORDER BY id DESC';
        if (isPos) {
            query = `
                SELECT id, sku, product_name, category, category_id, 
                       retail_price, price_2, price_3, price_4, price_5, price_6, 
                       stock_qty, virtual_stock, unit, image_url, description
                FROM products 
                ORDER BY id DESC
            `;
        }
        const result = await pool.query(query);
        let rows = result.rows;
        // Bảo vệ bí mật kinh doanh: Chỉ cho phép Admin/Kế toán/Thu mua xem giá vốn nhập hàng
        if (!canViewCost) {
            rows = rows.map(r => {
                const copy = { ...r };
                delete copy.import_price;
                return copy;
            });
        }
        res.json({ success: true, data: rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Endpoint BATCH / BULK IMPORT SIÊU TỐC CHO EXCEL & QUICK UPLOAD
router.post('/bulk', async (req, res) => {
    const client = await pool.connect();
    try {
        const { items } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, error: 'Danh sách sản phẩm trống!' });
        }

        await client.query('BEGIN');

        let insertedCount = 0;
        let updatedCount = 0;

        for (const item of items) {
            const sku = String(item.sku || '').trim().toUpperCase();
            const productName = String(item.product_name || '').trim();
            if (!sku || !productName) continue;

            const category = item.category || 'Khác';
            const categoryId = item.category_id ? parseInt(item.category_id) : null;
            const description = item.description || '';
            const binLocation = item.bin_location || '';
            const stocks = typeof item.stocks === 'object' ? JSON.stringify(item.stocks) : (item.stocks || '{}');
            const imageUrl = item.image_url || '';
            const docCocq = item.doc_cocq || '';
            const docDatasheet = item.doc_datasheet || '';
            const docCatalog = item.doc_catalog || '';
            const docManual = item.doc_manual || '';
            const importPrice = parseFloat(item.import_price) || 0;
            const retailPrice = parseFloat(item.retail_price) || 0;
            const price2 = parseFloat(item.price_2) || 0;
            const price3 = parseFloat(item.price_3) || 0;
            const price4 = parseFloat(item.price_4) || 0;
            const price5 = parseFloat(item.price_5) || 0;
            const price6 = parseFloat(item.price_6) || 0;
            const stockQty = parseInt(item.stock_qty) || 0;
            const virtualStock = parseInt(item.virtual_stock) || 0;
            const unit = item.unit || 'Bộ';
            const accountingCode = item.accounting_code || sku;
            const accountingName = item.accounting_name || productName;
            const vatRate = item.vat_rate !== undefined && item.vat_rate !== null ? parseFloat(item.vat_rate) : 8;

            const upsertQuery = `
                INSERT INTO products (
                    sku, product_name, category, category_id, description, bin_location, 
                    stocks, image_url, doc_cocq, doc_datasheet, doc_catalog, doc_manual, 
                    import_price, retail_price, price_2, price_3, price_4, price_5, price_6, 
                    stock_qty, virtual_stock, unit, accounting_code, accounting_name, vat_rate
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
                )
                ON CONFLICT (sku) DO UPDATE SET
                    product_name = EXCLUDED.product_name,
                    category = CASE WHEN EXCLUDED.category <> 'Khác' THEN EXCLUDED.category ELSE products.category END,
                    category_id = COALESCE(EXCLUDED.category_id, products.category_id),
                    description = CASE WHEN EXCLUDED.description <> '' THEN EXCLUDED.description ELSE products.description END,
                    bin_location = CASE WHEN EXCLUDED.bin_location <> '' THEN EXCLUDED.bin_location ELSE products.bin_location END,
                    stocks = CASE WHEN EXCLUDED.stocks <> '{}'::jsonb THEN EXCLUDED.stocks ELSE products.stocks END,
                    image_url = CASE WHEN EXCLUDED.image_url <> '' THEN EXCLUDED.image_url ELSE products.image_url END,
                    doc_cocq = CASE WHEN EXCLUDED.doc_cocq <> '' THEN EXCLUDED.doc_cocq ELSE products.doc_cocq END,
                    doc_datasheet = CASE WHEN EXCLUDED.doc_datasheet <> '' THEN EXCLUDED.doc_datasheet ELSE products.doc_datasheet END,
                    doc_catalog = CASE WHEN EXCLUDED.doc_catalog <> '' THEN EXCLUDED.doc_catalog ELSE products.doc_catalog END,
                    doc_manual = CASE WHEN EXCLUDED.doc_manual <> '' THEN EXCLUDED.doc_manual ELSE products.doc_manual END,
                    import_price = CASE WHEN EXCLUDED.import_price > 0 THEN EXCLUDED.import_price ELSE products.import_price END,
                    retail_price = CASE WHEN EXCLUDED.retail_price > 0 THEN EXCLUDED.retail_price ELSE products.retail_price END,
                    price_2 = CASE WHEN EXCLUDED.price_2 > 0 THEN EXCLUDED.price_2 ELSE products.price_2 END,
                    price_3 = CASE WHEN EXCLUDED.price_3 > 0 THEN EXCLUDED.price_3 ELSE products.price_3 END,
                    price_4 = CASE WHEN EXCLUDED.price_4 > 0 THEN EXCLUDED.price_4 ELSE products.price_4 END,
                    price_5 = CASE WHEN EXCLUDED.price_5 > 0 THEN EXCLUDED.price_5 ELSE products.price_5 END,
                    price_6 = CASE WHEN EXCLUDED.price_6 > 0 THEN EXCLUDED.price_6 ELSE products.price_6 END,
                    stock_qty = EXCLUDED.stock_qty,
                    virtual_stock = EXCLUDED.virtual_stock,
                    unit = COALESCE(EXCLUDED.unit, products.unit),
                    accounting_code = COALESCE(EXCLUDED.accounting_code, products.accounting_code),
                    accounting_name = COALESCE(EXCLUDED.accounting_name, products.accounting_name),
                    vat_rate = COALESCE(EXCLUDED.vat_rate, products.vat_rate)
                RETURNING (xmax = 0) AS is_inserted;
            `;

            const queryRes = await client.query(upsertQuery, [
                sku, productName, category, categoryId, description, binLocation,
                stocks, imageUrl, docCocq, docDatasheet, docCatalog, docManual,
                importPrice, retailPrice, price2, price3, price4, price5, price6,
                stockQty, virtualStock, unit, accountingCode, accountingName, vatRate
            ]);

            if (queryRes.rows[0]?.is_inserted) {
                insertedCount++;
            } else {
                updatedCount++;
            }
        }

        await client.query('COMMIT');
        res.json({
            success: true,
            total: insertedCount + updatedCount,
            inserted: insertedCount,
            updated: updatedCount,
            message: `Đã xử lý thành công ${insertedCount + updatedCount} thiết bị (Thêm mới: ${insertedCount}, Cập nhật: ${updatedCount})!`
        });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

router.post('/', async (req, res) => {
    try {
        const { sku, product_name, category, category_id, description, bin_location, stocks, image_url, doc_cocq, doc_datasheet, doc_catalog, doc_manual, import_price, retail_price, price_2, price_3, price_4, price_5, price_6, stock_qty, virtual_stock, unit, accounting_code, accounting_name, vat_rate } = req.body;
        
        const cleanSku = String(sku || '').trim().toUpperCase();
        const cleanName = String(product_name || '').trim();
        if (!cleanSku || !cleanName) {
            return res.status(400).json({ success: false, error: 'Mã SKU và Tên thiết bị không được để trống!' });
        }

        const result = await pool.query(
            `INSERT INTO products (
                sku, product_name, category, category_id, description, bin_location, 
                stocks, image_url, doc_cocq, doc_datasheet, doc_catalog, doc_manual, 
                import_price, retail_price, price_2, price_3, price_4, price_5, price_6, 
                stock_qty, virtual_stock, unit, accounting_code, accounting_name, vat_rate
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
            )
            ON CONFLICT (sku) DO UPDATE SET
                product_name = EXCLUDED.product_name,
                category = EXCLUDED.category,
                category_id = EXCLUDED.category_id,
                description = EXCLUDED.description,
                bin_location = EXCLUDED.bin_location,
                stocks = EXCLUDED.stocks,
                image_url = CASE WHEN EXCLUDED.image_url <> '' THEN EXCLUDED.image_url ELSE products.image_url END,
                doc_cocq = CASE WHEN EXCLUDED.doc_cocq <> '' THEN EXCLUDED.doc_cocq ELSE products.doc_cocq END,
                doc_datasheet = CASE WHEN EXCLUDED.doc_datasheet <> '' THEN EXCLUDED.doc_datasheet ELSE products.doc_datasheet END,
                doc_catalog = CASE WHEN EXCLUDED.doc_catalog <> '' THEN EXCLUDED.doc_catalog ELSE products.doc_catalog END,
                doc_manual = CASE WHEN EXCLUDED.doc_manual <> '' THEN EXCLUDED.doc_manual ELSE products.doc_manual END,
                import_price = EXCLUDED.import_price,
                retail_price = EXCLUDED.retail_price,
                price_2 = EXCLUDED.price_2,
                price_3 = EXCLUDED.price_3,
                price_4 = EXCLUDED.price_4,
                price_5 = EXCLUDED.price_5,
                price_6 = EXCLUDED.price_6,
                stock_qty = EXCLUDED.stock_qty,
                virtual_stock = EXCLUDED.virtual_stock,
                unit = EXCLUDED.unit,
                accounting_code = EXCLUDED.accounting_code,
                accounting_name = EXCLUDED.accounting_name,
                vat_rate = EXCLUDED.vat_rate
            RETURNING *;`, 
            [
                cleanSku, 
                cleanName, 
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
                parseFloat(import_price) || 0, 
                parseFloat(retail_price) || 0, 
                parseFloat(price_2) || 0, 
                parseFloat(price_3) || 0, 
                parseFloat(price_4) || 0, 
                parseFloat(price_5) || 0, 
                parseFloat(price_6) || 0, 
                parseInt(stock_qty) || 0, 
                parseInt(virtual_stock) || 0,
                unit || 'Bộ',
                accounting_code || cleanSku,
                accounting_name || cleanName,
                vat_rate !== undefined && vat_rate !== null ? parseFloat(vat_rate) : 8
            ]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.put('/:id', async (req, res) => {
    try {
        const { sku, product_name, category, category_id, description, bin_location, stocks, image_url, doc_cocq, doc_datasheet, doc_catalog, doc_manual, import_price, retail_price, price_2, price_3, price_4, price_5, price_6, stock_qty, virtual_stock, unit, accounting_code, accounting_name, vat_rate } = req.body;
        await pool.query(
            `UPDATE products SET 
                sku=$1, product_name=$2, category=$3, category_id=$4, description=$5, bin_location=$6, stocks=$7, 
                image_url=$8, doc_cocq=$9, doc_datasheet=$10, doc_catalog=$11, doc_manual=$12, 
                import_price=$13, retail_price=$14, price_2=$15, price_3=$16, price_4=$17, price_5=$18, price_6=$19, 
                stock_qty=$20, virtual_stock=$21, unit=$22, accounting_code=$23, accounting_name=$24, vat_rate=$25 
             WHERE id=$26`, 
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
                unit || 'Bộ',
                accounting_code || sku,
                accounting_name || product_name,
                vat_rate !== undefined ? parseFloat(vat_rate) : 8,
                req.params.id
            ]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Endpoint cập nhật nhanh thông tin kế toán (Dành cho Kế toán map mã hàng)
router.put('/:id/accounting', async (req, res) => {
    try {
        const { accounting_code, accounting_name, unit, vat_rate } = req.body;
        await pool.query(
            `UPDATE products SET 
                accounting_code = COALESCE($1, accounting_code),
                accounting_name = COALESCE($2, accounting_name),
                unit = COALESCE($3, unit),
                vat_rate = COALESCE($4, vat_rate)
             WHERE id = $5`,
            [accounting_code, accounting_name, unit, vat_rate, req.params.id]
        );
        res.json({ success: true, message: 'Đã cập nhật thông tin kế toán của sản phẩm' });
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

