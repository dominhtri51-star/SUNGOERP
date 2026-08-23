const express = require('express');
const router = express.Router();
const pool = require('../config/database'); // Đảm bảo đường dẫn này đúng với cấu trúc của bạn

// TỰ ĐỘNG TẠO BẢNG NẾU CHƯA CÓ
pool.query(`
    CREATE TABLE IF NOT EXISTS om_schedules (
        id SERIAL PRIMARY KEY,
        scheduled_date DATE NOT NULL,
        project_name VARCHAR(255) NOT NULL,
        system_type VARCHAR(100) DEFAULT 'Khác',
        address TEXT,
        task TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
`).catch(console.error);

// 1. LẤY DANH SÁCH LỊCH BẢO TRÌ (Sắp xếp theo ngày gần nhất)
router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT 
                id, 
                TO_CHAR(scheduled_date, 'DD/MM/YYYY') as date, 
                project_name as name, 
                system_type as type, 
                address, 
                task, 
                status 
            FROM om_schedules 
            ORDER BY status DESC, scheduled_date ASC
        `);
        // status DESC để 'pending' nổi lên trên 'done'
        res.json({ success: true, data: rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 2. LẤY THỐNG KÊ NHANH CHO DASHBOARD (Tuần/Tháng/Sự cố)
router.get('/stats', async (req, res) => {
    try {
        const statsQuery = `
            SELECT 
                COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
                COUNT(*) FILTER (WHERE status = 'done' AND EXTRACT(MONTH FROM scheduled_date) = EXTRACT(MONTH FROM CURRENT_DATE)) as done_this_month,
                COUNT(*) FILTER (WHERE status = 'issue') as issue_count
            FROM om_schedules
        `;
        const { rows } = await pool.query(statsQuery);
        res.json({ success: true, data: rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 3. TẠO LỊCH BẢO TRÌ MỚI
router.post('/', async (req, res) => {
    try {
        const { scheduled_date, name, type, address, task } = req.body;
        const insert = await pool.query(`
            INSERT INTO om_schedules (scheduled_date, project_name, system_type, address, task, status)
            VALUES ($1, $2, $3, $4, $5, 'pending') 
            RETURNING *
        `, [scheduled_date, name, type || 'Hybrid/Grid-tie', address || '', task]);
        
        res.json({ success: true, data: insert.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 4. CẬP NHẬT TRẠNG THÁI (Hoàn thành / Báo lỗi)
router.put('/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // 'done', 'pending', hoặc 'issue'
        
        const update = await pool.query(`
            UPDATE om_schedules 
            SET status = $1 
            WHERE id = $2 
            RETURNING *
        `, [status, id]);

        if (update.rowCount === 0) {
            return res.status(404).json({ success: false, error: "Không tìm thấy lịch bảo trì này" });
        }
        res.json({ success: true, data: update.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 5. CHỈNH SỬA THÔNG TIN LỊCH TRÌNH
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { scheduled_date, name, type, address, task } = req.body;
        
        await pool.query(`
            UPDATE om_schedules 
            SET scheduled_date = $1, project_name = $2, system_type = $3, address = $4, task = $5
            WHERE id = $6
        `, [scheduled_date, name, type, address, task, id]);
        
        res.json({ success: true, message: 'Cập nhật thành công' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 6. XÓA LỊCH BẢO TRÌ
router.delete('/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM om_schedules WHERE id = $1', [req.params.id]);
        res.json({ success: true, message: 'Đã xóa thành công' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;