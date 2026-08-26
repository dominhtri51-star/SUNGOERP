const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// ===============================================
// CẤU HÌNH UPLOAD ẢNH / BIÊN BẢN KIỂM KHO
// ===============================================
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = path.join(__dirname, '../public/uploads/audits');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, 'audit_proof_' + Date.now() + '_' + Math.floor(Math.random() * 1000) + ext);
    }
});
const uploadAudit = multer({ storage: storage });

// ===============================================
// 1. GET /api/inventory - LẤY DANH SÁCH TỒN KHO THỰC TẾ & METRICS
// ===============================================
router.get('/', async (req, res) => {
    try {
        const queryStr = `
            SELECT 
                id, sku, product_name, category, unit, 
                COALESCE(import_price, 0) as import_price, 
                COALESCE(retail_price, 0) as retail_price, 
                COALESCE(stock_qty, 0) as stock_qty, 
                COALESCE(virtual_stock, 0) as virtual_stock, 
                COALESCE(bin_location, '') as bin_location, 
                stocks, image_url, vat_rate, accounting_code, accounting_name,
                (COALESCE(stock_qty, 0) * COALESCE(import_price, 0)) as total_value
            FROM products 
            ORDER BY stock_qty DESC, id DESC
        `;
        const result = await pool.query(queryStr);
        const products = result.rows.map(p => ({
            ...p,
            import_price: parseFloat(p.import_price) || 0,
            retail_price: parseFloat(p.retail_price) || 0,
            stock_qty: parseFloat(p.stock_qty) || 0,
            virtual_stock: parseFloat(p.virtual_stock) || 0,
            total_value: (parseFloat(p.stock_qty) || 0) * (parseFloat(p.import_price) || 0)
        }));

        // Tính các chỉ số KPI tồn kho
        let totalItems = products.length;
        let totalStockQty = 0;
        let totalInventoryValue = 0;
        let lowStockCount = 0;
        let outOfStockCount = 0;

        products.forEach(p => {
            totalStockQty += p.stock_qty;
            totalInventoryValue += p.total_value;
            if (p.stock_qty <= 0) {
                outOfStockCount++;
            } else if (p.stock_qty < 5) {
                lowStockCount++;
            }
        });

        // Đếm tổng số phiếu kiểm kê đã thực hiện
        let totalAuditsCount = 0;
        try {
            const auditCountRes = await pool.query('SELECT COUNT(*) FROM inventory_audits');
            totalAuditsCount = parseInt(auditCountRes.rows[0].count) || 0;
        } catch(e) {}

        res.json({
            success: true,
            data: products,
            metrics: {
                total_items: totalItems,
                total_stock_qty: totalStockQty,
                total_inventory_value: totalInventoryValue,
                low_stock_count: lowStockCount,
                out_of_stock_count: outOfStockCount,
                total_audits_count: totalAuditsCount
            }
        });
    } catch (err) {
        console.error('Error fetching inventory:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===============================================
// 2. GET /api/inventory/audits - LỊCH SỬ PHIẾU KIỂM KÊ KHO
// ===============================================
router.get('/audits', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM inventory_audits 
            ORDER BY audit_date DESC, id DESC
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('Error fetching audits:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===============================================
// 3. GET /api/inventory/audits/:id - CHI TIẾT 1 PHIẾU KIỂM KÊ
// ===============================================
router.get('/audits/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM inventory_audits WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy phiếu kiểm kê' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===============================================
// 4. POST /api/inventory/upload-proof - UPLOAD ẢNH/CHỨNG TỪ BIÊN BẢN KIỂM KHO
// ===============================================
router.post('/upload-proof', uploadAudit.array('proof_files', 10), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, error: 'Không có file nào được tải lên' });
        }
        const fileUrls = req.files.map(f => ({
            name: f.originalname,
            url: '/uploads/audits/' + f.filename,
            size: f.size,
            uploaded_at: new Date().toISOString()
        }));
        res.json({ success: true, files: fileUrls });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===============================================
// 5. POST /api/inventory/audits - LẬP PHIẾU KIỂM KÊ KHO THỰC TẾ & CẬP NHẬT TỒN
// ===============================================
router.post('/audits', async (req, res) => {
    const client = await pool.connect();
    try {
        const {
            audit_code,
            audit_type, // 'INITIAL_IMPORT', 'PERIODIC_AUDIT', 'ADJUSTMENT'
            warehouse_name,
            auditor_name,
            audit_date,
            notes,
            items, // Array of { product_id, sku, product_name, category, unit, system_qty, actual_qty, variance_qty, import_price, bin_location, warehouse_name, note }
            proof_images
        } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, error: 'Danh sách kiểm kê không được để trống' });
        }

        const generatedCode = audit_code || `KK-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(1000 + Math.random() * 9000)}`;
        const validAuditType = audit_type || 'PERIODIC_AUDIT';
        const validWarehouse = warehouse_name || 'Kho Tổng';
        const validAuditor = auditor_name || 'Bộ Phận Kiểm Kho';
        const validAuditDate = audit_date ? new Date(audit_date) : new Date();

        let totalItems = items.length;
        let totalSystemQty = 0;
        let totalActualQty = 0;
        let totalVarianceQty = 0;
        let totalVarianceValue = 0;

        await client.query('BEGIN');

        // 1. Duyệt qua từng sản phẩm và cập nhật vào bảng products
        for (let item of items) {
            const pId = parseInt(item.product_id);
            const actualQty = parseFloat(item.actual_qty) !== undefined ? parseFloat(item.actual_qty) : 0;
            const systemQty = parseFloat(item.system_qty) || 0;
            const varianceQty = actualQty - systemQty;
            const costPrice = parseFloat(item.import_price) || 0;
            const binLoc = item.bin_location !== undefined ? item.bin_location.trim() : null;

            totalSystemQty += systemQty;
            totalActualQty += actualQty;
            totalVarianceQty += varianceQty;
            totalVarianceValue += (varianceQty * costPrice);

            // Cập nhật sản phẩm trong CSDL
            if (pId && !isNaN(pId)) {
                // Cập nhật stock_qty, bin_location, và import_price nếu có
                if (costPrice > 0 && binLoc !== null) {
                    await client.query(
                        `UPDATE products 
                         SET stock_qty = $1, bin_location = $2, import_price = $3 
                         WHERE id = $4`,
                        [actualQty, binLoc, costPrice, pId]
                    );
                } else if (binLoc !== null) {
                    await client.query(
                        `UPDATE products 
                         SET stock_qty = $1, bin_location = $2 
                         WHERE id = $3`,
                        [actualQty, binLoc, pId]
                    );
                } else if (costPrice > 0) {
                    await client.query(
                        `UPDATE products 
                         SET stock_qty = $1, import_price = $2 
                         WHERE id = $3`,
                        [actualQty, costPrice, pId]
                    );
                } else {
                    await client.query(
                        `UPDATE products 
                         SET stock_qty = $1 
                         WHERE id = $2`,
                        [actualQty, pId]
                    );
                }
            } else if (item.sku) {
                // Nếu sản phẩm chưa có ID mà có SKU: tìm theo SKU hoặc tạo mới
                const findRes = await client.query('SELECT id FROM products WHERE sku = $1', [item.sku]);
                if (findRes.rows.length > 0) {
                    const existingId = findRes.rows[0].id;
                    await client.query(
                        `UPDATE products 
                         SET stock_qty = $1, bin_location = COALESCE($2, bin_location), import_price = CASE WHEN $3 > 0 THEN $3 ELSE import_price END 
                         WHERE id = $4`,
                        [actualQty, binLoc, costPrice, existingId]
                    );
                } else {
                    // Tạo sản phẩm mới
                    await client.query(
                        `INSERT INTO products (sku, product_name, category, unit, wholesale_price, retail_price, import_price, stock_qty, bin_location)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                        [
                            item.sku, 
                            item.product_name || item.sku, 
                            item.category || 'Vật tư có sẵn', 
                            item.unit || 'Cái', 
                            costPrice > 0 ? costPrice * 1.1 : 0,
                            costPrice > 0 ? costPrice * 1.2 : 0,
                            costPrice, 
                            actualQty, 
                            binLoc || ''
                        ]
                    );
                }
            }
        }

        // 2. Ghi nhận phiếu kiểm kê vào bảng inventory_audits
        const insertAuditQuery = `
            INSERT INTO inventory_audits (
                audit_code, audit_type, warehouse_name, auditor_name, audit_date, notes,
                total_items, total_system_qty, total_actual_qty, total_variance_qty, total_variance_value,
                items_snapshot, proof_images, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'COMPLETED')
            RETURNING *
        `;

        const auditRes = await client.query(insertAuditQuery, [
            generatedCode,
            validAuditType,
            validWarehouse,
            validAuditor,
            validAuditDate,
            notes || '',
            totalItems,
            totalSystemQty,
            totalActualQty,
            totalVarianceQty,
            totalVarianceValue,
            JSON.stringify(items),
            JSON.stringify(proof_images || [])
        ]);

        await client.query('COMMIT');

        res.status(201).json({
            success: true,
            message: `Đã hoàn tất phiếu kiểm kê ${generatedCode} và cập nhật tồn kho thực tế!`,
            data: auditRes.rows[0]
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating audit voucher:', err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// ===============================================
// 6. POST /api/inventory/quick-adjust - ĐIỀU CHỈNH NHANH 1 MÃ HÀNG
// ===============================================
router.post('/quick-adjust', async (req, res) => {
    const client = await pool.connect();
    try {
        const { product_id, actual_qty, bin_location, import_price, warehouse_name, auditor_name, reason } = req.body;
        
        if (!product_id) {
            return res.status(400).json({ success: false, error: 'Thiếu ID sản phẩm cần điều chỉnh' });
        }

        await client.query('BEGIN');

        // Lấy thông tin sản phẩm hiện tại
        const pRes = await client.query('SELECT * FROM products WHERE id = $1', [product_id]);
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Không tìm thấy sản phẩm' });
        }

        const product = pRes.rows[0];
        const oldStock = parseFloat(product.stock_qty) || 0;
        const newStock = parseFloat(actual_qty) !== undefined ? parseFloat(actual_qty) : oldStock;
        const varianceQty = newStock - oldStock;
        const costPrice = parseFloat(import_price) !== undefined && parseFloat(import_price) > 0 ? parseFloat(import_price) : (parseFloat(product.import_price) || 0);
        const newBin = bin_location !== undefined ? bin_location.trim() : (product.bin_location || '');

        // Cập nhật sản phẩm
        await client.query(
            `UPDATE products 
             SET stock_qty = $1, bin_location = $2, import_price = $3 
             WHERE id = $4`,
            [newStock, newBin, costPrice, product_id]
        );

        // Tạo log phiếu kiểm kê dạng điều chỉnh nhanh (ADJUSTMENT)
        const auditCode = `KK-QUICK-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(1000 + Math.random() * 9000)}`;
        const snapshotItem = [{
            product_id: product.id,
            sku: product.sku,
            product_name: product.product_name,
            category: product.category,
            unit: product.unit,
            system_qty: oldStock,
            actual_qty: newStock,
            variance_qty: varianceQty,
            import_price: costPrice,
            bin_location: newBin,
            warehouse_name: warehouse_name || 'Kho Tổng',
            note: reason || 'Điều chỉnh kiểm đếm nhanh'
        }];

        await client.query(`
            INSERT INTO inventory_audits (
                audit_code, audit_type, warehouse_name, auditor_name, audit_date, notes,
                total_items, total_system_qty, total_actual_qty, total_variance_qty, total_variance_value,
                items_snapshot, proof_images, status
            ) VALUES ($1, 'ADJUSTMENT', $2, $3, CURRENT_TIMESTAMP, $4, 1, $5, $6, $7, $8, $9, '[]'::jsonb, 'COMPLETED')
        `, [
            auditCode,
            warehouse_name || 'Kho Tổng',
            auditor_name || 'Thủ Kho',
            reason || `Điều chỉnh nhanh số lượng tồn cho ${product.product_name}`,
            oldStock,
            newStock,
            varianceQty,
            varianceQty * costPrice,
            JSON.stringify(snapshotItem)
        ]);

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `Đã cập nhật tồn kho cho mã ${product.sku || product.product_name} thành ${newStock} ${product.unit || 'Cái'}`,
            data: {
                id: product.id,
                stock_qty: newStock,
                bin_location: newBin,
                import_price: costPrice
            }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error quick adjusting stock:', err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// ===============================================
// 7. POST /api/inventory/import-excel - NẠP SỐ DƯ TỒN KHO ĐẦU KỲ TỪ EXCEL
// ===============================================
router.post('/import-excel', async (req, res) => {
    const client = await pool.connect();
    try {
        const { items, auditor_name, warehouse_name, notes } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, error: 'Danh sách nạp Excel không hợp lệ hoặc rỗng' });
        }

        await client.query('BEGIN');

        let totalImported = 0;
        let totalActualQty = 0;
        let totalSystemQty = 0;
        let totalValue = 0;
        let snapshotItems = [];

        const auditCode = `KK-DAUKY-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(1000 + Math.random() * 9000)}`;

        for (let row of items) {
            const sku = (row.sku || row['Mã SKU'] || row['Mã hàng'] || '').toString().trim();
            const name = (row.product_name || row['Tên Hàng Hóa'] || row['Tên sản phẩm'] || sku || 'Hàng tồn đầu kỳ').toString().trim();
            const category = (row.category || row['Danh Mục'] || row['Ngành hàng'] || 'Hàng có sẵn').toString().trim();
            const unit = (row.unit || row['Đơn Vị Tính'] || row['ĐVT'] || 'Bộ').toString().trim();
            const qty = parseFloat(row.stock_qty || row.actual_qty || row['Số Lượng Tồn Thực Tế'] || row['Tồn thực tế'] || row['Số lượng'] || 0);
            const cost = parseFloat(row.import_price || row['Đơn Giá Vốn'] || row['Giá vốn'] || row['Giá nhập'] || 0);
            const binLoc = (row.bin_location || row['Vị Trí Kệ'] || row['Vị trí'] || row['Kệ/Ngăn'] || '').toString().trim();
            const wh = (row.warehouse_name || row['Kho Hàng'] || warehouse_name || 'Kho Tổng').toString().trim();

            if (!sku && !name) continue;

            let systemQty = 0;
            let pId = null;

            // Tìm sản phẩm hiện có theo SKU
            let findRes = { rows: [] };
            if (sku) {
                findRes = await client.query('SELECT id, stock_qty, import_price, bin_location FROM products WHERE sku = $1', [sku]);
            }
            if (findRes.rows.length === 0 && name) {
                findRes = await client.query('SELECT id, stock_qty, import_price, bin_location FROM products WHERE LOWER(product_name) = LOWER($1)', [name]);
            }

            if (findRes.rows.length > 0) {
                pId = findRes.rows[0].id;
                systemQty = parseFloat(findRes.rows[0].stock_qty) || 0;

                await client.query(
                    `UPDATE products 
                     SET stock_qty = $1,
                         import_price = CASE WHEN $2 > 0 THEN $2 ELSE import_price END,
                         bin_location = CASE WHEN $3 <> '' THEN $3 ELSE bin_location END,
                         unit = COALESCE($4, unit)
                     WHERE id = $5`,
                    [qty, cost, binLoc, unit, pId]
                );
            } else {
                // Tạo mới sản phẩm
                const genSku = sku || `SKU-${Date.now().toString().slice(-6)}`;
                const insertRes = await client.query(
                    `INSERT INTO products (sku, product_name, category, unit, wholesale_price, retail_price, import_price, stock_qty, bin_location)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                     RETURNING id`,
                    [
                        genSku, 
                        name, 
                        category, 
                        unit, 
                        cost > 0 ? cost * 1.1 : 0,
                        cost > 0 ? cost * 1.2 : 0, 
                        cost, 
                        qty, 
                        binLoc
                    ]
                );
                pId = insertRes.rows[0].id;
            }

            totalImported++;
            totalActualQty += qty;
            totalSystemQty += systemQty;
            totalValue += (qty * cost);

            snapshotItems.push({
                product_id: pId,
                sku: sku,
                product_name: name,
                category: category,
                unit: unit,
                system_qty: systemQty,
                actual_qty: qty,
                variance_qty: qty - systemQty,
                import_price: cost,
                bin_location: binLoc,
                warehouse_name: wh,
                note: 'Nhập số dư đầu kỳ từ Excel'
            });
        }

        // Tạo phiếu kiểm kê đầu kỳ (INITIAL_IMPORT)
        await client.query(`
            INSERT INTO inventory_audits (
                audit_code, audit_type, warehouse_name, auditor_name, audit_date, notes,
                total_items, total_system_qty, total_actual_qty, total_variance_qty, total_variance_value,
                items_snapshot, proof_images, status
            ) VALUES ($1, 'INITIAL_IMPORT', $2, $3, CURRENT_TIMESTAMP, $4, $5, $6, $7, $8, $9, $10, '[]'::jsonb, 'COMPLETED')
        `, [
            auditCode,
            warehouse_name || 'Kho Tổng',
            auditor_name || 'Tổ Kiểm Kê Đầu Kỳ',
            notes || 'Chuyển đổi số dư tồn kho ban đầu sang phần mềm mới qua Excel',
            totalImported,
            totalSystemQty,
            totalActualQty,
            totalActualQty - totalSystemQty,
            totalValue,
            JSON.stringify(snapshotItems)
        ]);

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `Đã nạp thành công ${totalImported} mặt hàng vào kho thực tế! Mã phiếu: ${auditCode}`,
            total_items: totalImported,
            total_qty: totalActualQty,
            total_value: totalValue,
            audit_code: auditCode
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error importing Excel initial stock:', err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

module.exports = router;