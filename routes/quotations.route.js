const express = require('express');
const router = express.Router();
const pool = require('./db');

router.get('/', async (req, res) => {
    // Dữ liệu giả lập tạm thời cho Báo Cáo Doanh Thu (chờ ghép thực tế)
    res.json({ 
        success: true, 
        data: [
            { status: 'APPROVED', total_amount: 1250000000, system_kwp: 120 },
            { status: 'APPROVED', total_amount: 480000000, system_kwp: 45 },
            { status: 'PENDING_APPROVAL', total_amount: 95000000, system_kwp: 10 }
        ] 
    });
});

// [POST] Xử lý tạo Báo Giá (BOQ) mới tự động
router.post('/', async (req, res) => {
    try {
        const payload = req.body;
        console.log("📥 Dữ liệu BOQ nhận được từ Frontend:", payload);
        
        // Trả về JSON thành công giả lập để giao diện chạy tiếp (sau này sếp nhét code Insert DB vào đây)
        res.status(201).json({
            success: true,
            message: 'Tạo báo giá thành công',
            quotation: {
                quotation_id: Math.floor(Math.random() * 10000), 
                quotation_code: 'BOQ-' + Math.floor(100000 + Math.random() * 900000),
                ...payload
            }
        });
    } catch (error) {
        console.error("❌ Lỗi Backend:", error);
        res.status(500).json({ success: false, error: 'Lỗi server' });
    }
});

module.exports = router;
