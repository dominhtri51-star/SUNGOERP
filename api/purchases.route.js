const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const pool = require('../config/database');
const router = express.Router();
const googleDriveService = require('../services/googleDrive.service');

const dbFile = path.join(__dirname, '../data/purchases.json');

// ===============================================
// CẤU HÌNH UPLOAD FILE (LƯU CHỨNG TỪ KHO)
// ===============================================
const uploadWms = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }
});

function readFallbackDB() {
    try { 
        if (!fs.existsSync(dbFile)) return [];
        return JSON.parse(fs.readFileSync(dbFile, 'utf8')); 
    } catch(e) { return []; }
}
function writeFallbackDB(data) {
    try { fs.writeFileSync(dbFile, JSON.stringify(data, null, 2), 'utf8'); } catch(e) {}
}

function formatPurchaseRow(row) {
    if (!row) return null;
    let docs = row.docs;
    if (typeof docs === 'string') {
        try { docs = JSON.parse(docs); } catch(e) { docs = {}; }
    }
    if (!docs || typeof docs !== 'object') docs = {};

    let items = row.items;
    if (typeof items === 'string') {
        try { items = JSON.parse(items); } catch(e) { items = []; }
    }
    if (!Array.isArray(items)) items = [];

    return {
        id: row.id,
        po_code: row.po_code,
        supplier_id: row.supplier_id ? parseInt(row.supplier_id) : null,
        supplier_name: row.supplier_name || '',
        note: row.note || '',
        status: row.status || 'Chờ Duyệt',
        items: items,
        docs: docs,
        total_amount: parseFloat(row.total_amount) || 0,
        receive_date: row.receive_date,
        delivery_note: row.delivery_note || '',
        vehicle_info: row.vehicle_info || '',
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

// [GET] Danh sách Đơn Mua Hàng
router.get('/', async (req, res) => {
    try {
        if (pool && typeof pool.query === 'function') {
            const result = await pool.query("SELECT * FROM purchases ORDER BY id DESC");
            const data = result.rows.map(formatPurchaseRow);
            writeFallbackDB(data);
            return res.json({ success: true, data: data });
        }
    } catch (e) {
        console.warn("PostgreSQL purchases read fallback:", e.message);
    }
    res.json({ success: true, data: readFallbackDB() });
});

// [POST] Tạo Đơn Mua Hàng mới
router.post('/', async (req, res) => {
    try {
        const payload = req.body;
        const poCode = (payload.po_code || '').trim() || ('PO-DOM-' + Math.floor(100000 + Math.random() * 900000));
        const supplierId = payload.supplier_id ? parseInt(payload.supplier_id) : null;
        const supplierName = (payload.supplier_name || '').trim();
        const note = (payload.note || '').trim();
        const items = Array.isArray(payload.items) ? payload.items : [];
        const totalAmount = parseFloat(payload.total_amount) || 0;
        const status = payload.status || 'Chờ Duyệt';
        const docs = (payload.docs && typeof payload.docs === 'object') ? payload.docs : {};

        let newPO = null;

        if (pool && typeof pool.query === 'function') {
            try {
                const query = `
                    INSERT INTO purchases (
                        po_code, supplier_id, supplier_name, note, items, docs, total_amount, status, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
                    RETURNING *
                `;
                const result = await pool.query(query, [
                    poCode, supplierId, supplierName, note, JSON.stringify(items), JSON.stringify(docs), totalAmount, status
                ]);
                newPO = formatPurchaseRow(result.rows[0]);
            } catch (dbErr) {
                console.error("Lỗi insert DB purchases:", dbErr.message);
            }
        }

        if (!newPO) {
            const data = readFallbackDB();
            const newId = data.length > 0 ? Math.max(...data.map(d => d.id || 0)) + 1 : 1;
            newPO = {
                id: newId,
                po_code: poCode,
                supplier_id: supplierId,
                supplier_name: supplierName,
                note: note,
                items: items,
                total_amount: totalAmount,
                status: status,
                docs: docs,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            data.unshift(newPO);
            writeFallbackDB(data);
        }

        res.status(201).json({ success: true, data: newPO });
    } catch (e) {
        console.error("Lỗi API POST /api/purchases:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// [PUT] Cập nhật chi tiết Đơn Mua Hàng
router.put('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const payload = req.body;
        const poCode = (payload.po_code || '').trim();
        const supplierId = payload.supplier_id ? parseInt(payload.supplier_id) : null;
        const supplierName = (payload.supplier_name || '').trim();
        const note = (payload.note || '').trim();
        const items = Array.isArray(payload.items) ? payload.items : [];
        const totalAmount = parseFloat(payload.total_amount) || 0;
        const status = payload.status || 'Chờ Duyệt';

        let updatedPO = null;

        if (pool && typeof pool.query === 'function') {
            try {
                const query = `
                    UPDATE purchases
                    SET 
                        po_code = COALESCE(NULLIF($1, ''), po_code),
                        supplier_id = $2,
                        supplier_name = COALESCE(NULLIF($3, ''), supplier_name),
                        note = $4,
                        items = $5,
                        total_amount = $6,
                        status = $7,
                        updated_at = NOW()
                    WHERE id = $8
                    RETURNING *
                `;
                const result = await pool.query(query, [
                    poCode, supplierId, supplierName, note, JSON.stringify(items), totalAmount, status, id
                ]);
                if (result.rows.length > 0) {
                    updatedPO = formatPurchaseRow(result.rows[0]);
                }
            } catch (dbErr) {
                console.error("Lỗi update DB purchases:", dbErr.message);
            }
        }

        let data = readFallbackDB();
        const index = data.findIndex(x => x.id === id);
        if (index !== -1) {
            data[index] = { ...data[index], ...payload, updated_at: new Date().toISOString() };
            writeFallbackDB(data);
            if (!updatedPO) updatedPO = data[index];
        }

        if (updatedPO) {
            res.json({ success: true, data: updatedPO });
        } else {
            res.status(404).json({ success: false, error: 'Không tìm thấy Lệnh mua hàng' });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// [PUT] Cập nhật Đơn Mua Hàng (Nhận hàng từ WMS)
router.put('/:id/receive', uploadWms.array('receipt_documents', 5), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { receive_date, received_items, status, delivery_note, vehicle_info } = req.body;

        let po = null;
        if (pool && typeof pool.query === 'function') {
            const result = await pool.query("SELECT * FROM purchases WHERE id = $1", [id]);
            if (result.rows.length > 0) {
                po = formatPurchaseRow(result.rows[0]);
            }
        }

        let data = readFallbackDB();
        const index = data.findIndex(x => x.id === id);
        if (!po && index !== -1) po = data[index];

        if (!po) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy Lệnh mua hàng' });
        }

        // 1. Cập nhật thông tin nhận hàng chung
        po.receive_date = receive_date || new Date().toISOString();
        if (status) po.status = status; // Đổi sang 'Hoàn Tất Nhập Kho'
        if (delivery_note !== undefined) po.delivery_note = delivery_note;
        if (vehicle_info !== undefined) po.vehicle_info = vehicle_info;
        po.updated_at = new Date().toISOString();

        // 2. Ghi nhận số lượng thực tế & vị trí kệ vào từng vật tư
        if (received_items) {
            const parsedItems = typeof received_items === 'string' ? JSON.parse(received_items) : received_items;
            if (po.items && Array.isArray(po.items)) {
                po.items = po.items.map(item => {
                    const rec = parsedItems.find(r => r.id === item.id);
                    if (rec) {
                        return { 
                            ...item, 
                            actual_qty: rec.actual_qty, 
                            bin_location: rec.bin_location, 
                            shelf_status: rec.shelf_status 
                        };
                    }
                    return item;
                });

                // Đồng bộ tăng tồn kho vào bảng products trong PostgreSQL
                for (let rec of parsedItems) {
                    const actQty = parseFloat(rec.actual_qty) || 0;
                    const pId = parseInt(rec.product_id || rec.id);
                    const binLoc = rec.bin_location ? rec.bin_location.trim() : null;

                    if (actQty > 0) {
                        try {
                            if (pId && !isNaN(pId) && pool && typeof pool.query === 'function') {
                                if (binLoc) {
                                    await pool.query(
                                        `UPDATE products 
                                         SET stock_qty = stock_qty + $1, bin_location = COALESCE($2, bin_location) 
                                         WHERE id = $3`,
                                        [actQty, binLoc, pId]
                                    );
                                } else {
                                    await pool.query(
                                        `UPDATE products 
                                         SET stock_qty = stock_qty + $1 
                                         WHERE id = $2`,
                                        [actQty, pId]
                                    );
                                }
                            }
                        } catch (dbErr) {
                            console.error('Error incrementing stock on PO receive:', dbErr);
                        }
                    }
                }
            }
        }

        // 3. Đưa biên nhận (Nhiều ảnh) vào két sắt chứng từ
        if (req.files && req.files.length > 0) {
            if (!po.docs || typeof po.docs !== 'object' || Array.isArray(po.docs)) po.docs = {};
            if (!po.docs.wms_receipt) po.docs.wms_receipt = [];
            
            for (const file of req.files) {
                const uploadResult = await googleDriveService.uploadFile({
                    buffer: file.buffer,
                    originalname: file.originalname,
                    mimetype: file.mimetype,
                    subfolder: 'proofs'
                });
                po.docs.wms_receipt.push({
                    name: 'Bằng chứng giao hàng',
                    url: uploadResult.url,
                    original_name: file.originalname,
                    storage: uploadResult.storage,
                    fileId: uploadResult.fileId || null,
                    uploaded_at: new Date().toISOString()
                });
            }
        }

        // Lưu vào PostgreSQL DB
        if (pool && typeof pool.query === 'function') {
            try {
                await pool.query(`
                    UPDATE purchases 
                    SET 
                        receive_date = $1,
                        status = $2,
                        delivery_note = $3,
                        vehicle_info = $4,
                        items = $5,
                        docs = $6,
                        updated_at = NOW()
                    WHERE id = $7
                `, [po.receive_date, po.status, po.delivery_note, po.vehicle_info, JSON.stringify(po.items), JSON.stringify(po.docs), id]);
            } catch (dbErr) {
                console.error("Lỗi update DB receive purchases:", dbErr.message);
            }
        }

        if (index !== -1) {
            data[index] = po;
            writeFallbackDB(data);
        }

        res.json({ success: true, data: po });
    } catch (error) { 
        res.status(500).json({ success: false, error: error.message }); 
    }
});

// [PUT] Cập nhật trạng thái (Duyệt / Hủy / Nhập Kho)
router.put('/:id/status', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { status } = req.body;

        if (pool && typeof pool.query === 'function') {
            try {
                await pool.query("UPDATE purchases SET status = $1, updated_at = NOW() WHERE id = $2", [status, id]);
            } catch(e) {}
        }

        let data = readFallbackDB();
        const index = data.findIndex(x => x.id === id);
        if (index !== -1) {
            data[index].status = status;
            writeFallbackDB(data);
        }
        res.json({ success: true });
    } catch (e) { 
        res.status(500).json({ success: false }); 
    }
});

// [DELETE] Xóa Đơn Mua Hàng
router.delete('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (pool && typeof pool.query === 'function') {
            await pool.query("DELETE FROM purchases WHERE id = $1", [id]);
        }
        let data = readFallbackDB();
        data = data.filter(x => Number(x.id) !== Number(id));
        writeFallbackDB(data);

        res.json({ success: true, message: 'Đã xóa Lệnh mua hàng thành công!' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;