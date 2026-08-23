const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const dbFile = path.join(__dirname, '../data/suppliers.json');

function readDB() {
    try { 
        if (!fs.existsSync(dbFile)) return [];
        return JSON.parse(fs.readFileSync(dbFile, 'utf8')); 
    } catch(e) { return []; }
}
function writeDB(data) {
    fs.writeFileSync(dbFile, JSON.stringify(data, null, 2), 'utf8');
}

// [GET] Lấy danh sách NCC
router.get('/', (req, res) => {
    res.json({ success: true, data: readDB() });
});

// [POST] Thêm mới NCC
router.post('/', (req, res) => {
    try {
        const data = readDB();
        const payload = req.body;
        const newId = data.length > 0 ? Math.max(...data.map(d => d.id || 0)) + 1 : 1;
        
        const newSupplier = {
            id: newId,
            supplier_code: payload.supplier_code || 'NCC' + Math.floor(1000 + Math.random() * 9000),
            name: payload.name,
            phone: payload.phone || '',
            email: payload.email || '',
            tax_code: payload.tax_code || '',
            address: payload.address || '',
            note: payload.note || '',
            created_at: new Date().toISOString()
        };
        
        data.unshift(newSupplier);
        writeDB(data);
        res.status(201).json({ success: true, data: newSupplier });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// [PUT] Cập nhật thông tin NCC
router.put('/:id', (req, res) => {
    try {
        let data = readDB();
        const id = parseInt(req.params.id);
        const index = data.findIndex(x => x.id === id);
        
        if (index !== -1) {
            data[index] = { ...data[index], ...req.body, updated_at: new Date().toISOString() };
            writeDB(data);
            res.json({ success: true, data: data[index] });
        } else {
            res.status(404).json({ success: false, error: 'Không tìm thấy Nhà Cung Cấp' });
        }
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// [DELETE] Xóa NCC
router.delete('/:id', (req, res) => {
    try {
        let data = readDB();
        const id = parseInt(req.params.id);
        const filteredData = data.filter(x => x.id !== id);
        writeDB(filteredData);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

module.exports = router;