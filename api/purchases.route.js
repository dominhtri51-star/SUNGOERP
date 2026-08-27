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

function readDB() {
    try { return JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch(e) { return []; }
}
function writeDB(data) {
    fs.writeFileSync(dbFile, JSON.stringify(data, null, 2), 'utf8');
}

// [GET] Danh sách Đơn Mua Hàng
router.get('/', (req, res) => {
    res.json({ success: true, data: readDB() });
});

// [POST] Tạo Đơn Mua Hàng mới
router.post('/', (req, res) => {
    try {
        const data = readDB();
        const payload = req.body;
        const newId = data.length > 0 ? Math.max(...data.map(d => d.id || 0)) + 1 : 1;
        
        const newPO = {
            id: newId,
            po_code: payload.po_code || 'PO-DOM-' + Math.floor(100000 + Math.random() * 900000),
            supplier_name: payload.supplier_name,
            note: payload.note || '',
            items: payload.items || [],
            total_amount: payload.total_amount || 0,
            status: 'Chờ Duyệt',
            docs: {}, // Khởi tạo két sắt chứng từ rỗng
            created_at: new Date().toISOString()
        };
        
        data.unshift(newPO);
        writeDB(data);
        res.status(201).json({ success: true, data: newPO });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// [PUT] Cập nhật Đơn Mua Hàng (Nhận hàng từ WMS)
router.put('/:id/receive', uploadWms.array('receipt_documents', 5), async (req, res) => {
    try {
        let data = readDB();
        const id = parseInt(req.params.id);
        const index = data.findIndex(x => x.id === id);
        
        if (index === -1) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy Lệnh mua hàng' });
        }

        const po = data[index];
        const { receive_date, received_items, status, delivery_note, vehicle_info } = req.body;

        // 1. Cập nhật thông tin nhận hàng chung
        po.receive_date = receive_date;
        if (status) po.status = status; // Đổi sang 'Hoàn Tất Nhập Kho'
        
        if (delivery_note !== undefined) po.delivery_note = delivery_note;
        if (vehicle_info !== undefined) po.vehicle_info = vehicle_info;
        
        po.updated_at = new Date().toISOString();

        // 2. Ghi nhận số lượng thực tế & vị trí kệ vào từng vật tư
        if (received_items) {
            const parsedItems = JSON.parse(received_items);
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
                            if (pId && !isNaN(pId)) {
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

        // Lưu dữ liệu
        data[index] = po;
        writeDB(data);

        res.json({ success: true, data: po });
    } catch (error) { 
        res.status(500).json({ success: false, error: error.message }); 
    }
});

// [PUT] Cập nhật trạng thái (Duyệt / Hủy / Nhập Kho)
router.put('/:id/status', (req, res) => {
    try {
        let data = readDB();
        const id = parseInt(req.params.id);
        const index = data.findIndex(x => x.id === id);
        if (index !== -1) {
            data[index].status = req.body.status;
            writeDB(data);
            res.json({ success: true });
        } else res.status(404).json({ success: false });
    } catch (e) { res.status(500).json({ success: false }); }
});

module.exports = router;