const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const dbFile = path.join(__dirname, '../data/payments.json');

function readDB() {
    try { 
        if (!fs.existsSync(dbFile)) return [];
        return JSON.parse(fs.readFileSync(dbFile, 'utf8')); 
    } catch(e) { return []; }
}

function writeDB(data) {
    fs.writeFileSync(dbFile, JSON.stringify(data, null, 2), 'utf8');
}

// [GET] Danh sách Phiếu chi
router.get('/', (req, res) => {
    res.json({ success: true, data: readDB() });
});

// [POST] Tạo Phiếu chi / UNC mới
router.post('/', (req, res) => {
    try {
        const data = readDB();
        const payload = req.body;
        const newId = data.length > 0 ? Math.max(...data.map(d => d.id || 0)) + 1 : 1;
        
        const newPayment = {
            id: newId,
            payment_code: payload.payment_code || 'PC-' + Math.floor(100000 + Math.random() * 900000),
            supplier_id: payload.supplier_id,
            supplier_name: payload.supplier_name,
            amount: payload.amount || 0,
            payment_method: payload.payment_method || 'Chuyển Khoản',
            note: payload.note || '',
            status: 'Chờ Duyệt', // Mặc định là Chờ Duyệt
            created_at: new Date().toISOString()
        };
        
        data.unshift(newPayment);
        writeDB(data);
        res.status(201).json({ success: true, data: newPayment });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// [PUT] Duyệt Chi / Hủy Phiếu
router.put('/:id/status', (req, res) => {
    try {
        let data = readDB();
        const id = parseInt(req.params.id);
        const index = data.findIndex(x => x.id === id);
        
        if (index !== -1) {
            data[index].status = req.body.status; // 'Đã Thanh Toán' hoặc 'Đã Hủy'
            data[index].updated_at = new Date().toISOString();
            writeDB(data);
            res.json({ success: true, data: data[index] });
        } else {
            res.status(404).json({ success: false, error: 'Không tìm thấy phiếu chi' });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

module.exports = router;