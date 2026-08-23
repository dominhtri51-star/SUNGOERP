const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const dbFile = path.join(__dirname, '../data/quotations.json');

function readDB() {
    try {
        const content = fs.readFileSync(dbFile, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        return [];
    }
}

function writeDB(data) {
    fs.writeFileSync(dbFile, JSON.stringify(data, null, 2), 'utf8');
}

// [GET] Lấy danh sách Báo giá
router.get('/', (req, res) => {
    try {
        const data = readDB();
        res.json({ success: true, data: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// [POST] Tạo Báo giá mới
router.post('/', (req, res) => {
    try {
        const data = readDB();
        const payload = req.body;
        
        // Tự động nhảy số ID
        const newId = data.length > 0 ? Math.max(...data.map(d => d.quotation_id || 0)) + 1 : 1;
        
        // Xác định tiền tố mã báo giá
        let prefix = 'BOQ';
        const brand = (payload.brand_name || '').toUpperCase();
        if (brand.includes('ONGRID') || brand.includes('ON-GRID') || brand.includes('BÁM TẢI')) prefix = 'ONG';
        else if (brand.includes('PUMP') || brand.includes('BƠM')) prefix = 'PUMP';
        else if (brand.includes('OFF-GRID') || brand.includes('OFFGRID') || brand.includes('ĐỘC LẬP')) prefix = 'OFF';
        else prefix = 'HYB';
                       
        const newQuotation = {
            quotation_id: newId,
            quotation_code: prefix + '-' + Math.floor(100000 + Math.random() * 900000),
            ...payload,
            created_at: new Date().toISOString()
        };
        
        // Lưu vào đầu danh sách
        data.unshift(newQuotation);
        writeDB(data);
        
        console.log(`✅ Đã lưu thành công báo giá: ${newQuotation.quotation_code}`);
        res.status(201).json({ success: true, quotation: newQuotation });
        
    } catch (e) {
        console.error("❌ Lỗi khi lưu Báo Giá:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// [GET] Lấy chi tiết Báo giá theo ID
router.get('/:id', (req, res) => {
    try {
        const data = readDB();
        const id = parseInt(req.params.id);
        const q = data.find(x => x.quotation_id === id);
        
        if (q) {
            res.json({ success: true, quotation: q, items: q.items || [] });
        } else {
            res.status(404).json({ success: false, error: 'Không tìm thấy báo giá' });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
