const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// 1. GET: Lấy danh sách đánh giá KPI Thu Nợ theo kỳ
router.get('/', async (req, res) => {
    try {
        const { period_key, employee_id } = req.query;
        let query = `
            SELECT dke.*,
                   e.emp_code,
                   e.full_name AS employee_name,
                   e.position,
                   d.dept_name
            FROM debt_kpi_evaluations dke
            LEFT JOIN employees e ON dke.employee_id = e.id
            LEFT JOIN departments d ON e.department_id = d.id
            WHERE 1=1
        `;
        const params = [];

        if (period_key) {
            params.push(period_key);
            query += ` AND dke.period_key = $${params.length}`;
        }
        if (employee_id) {
            params.push(employee_id);
            query += ` AND dke.employee_id = $${params.length}`;
        }

        query += " ORDER BY dke.period_key DESC, dke.id ASC";
        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('Lỗi lấy danh sách KPI thu nợ:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. POST: Đánh giá & Tự động tính Thưởng / Phạt KPI Thu Nợ theo 4 bậc
router.post('/evaluate', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { period_key, employee_id, custom_due_debt, custom_collected_debt } = req.body;

        const period = period_key || new Date().toISOString().slice(0, 7); // 'YYYY-MM'

        // Xác định nhân viên phụ trách thu nợ (Kế toán công nợ / Back-office)
        let targetEmpId = employee_id;
        if (!targetEmpId) {
            const boEmpRes = await client.query(
                "SELECT id FROM employees WHERE position ILIKE '%Kế Toán%' OR position ILIKE '%Công Nợ%' OR position ILIKE '%Back%' ORDER BY id ASC LIMIT 1"
            );
            targetEmpId = boEmpRes.rows.length > 0 ? boEmpRes.rows[0].id : 5; // fallback NV005 (Kế toán)
        }

        let totalDue = parseFloat(custom_due_debt);
        let totalCollected = parseFloat(custom_collected_debt);

        // Nếu không nhập tay, tự động quét từ Sổ Quỹ và Đơn Hàng trong kỳ
        if (isNaN(totalDue) || isNaN(totalCollected)) {
            // Tổng nợ phải thu phát sinh trong kỳ
            const dueRes = await client.query(`
                SELECT COALESCE(SUM(total_amount), 0) AS total_due
                FROM orders
                WHERE TO_CHAR(created_at, 'YYYY-MM') = $1 AND status NOT IN ('CANCELLED', 'RETURNED')
            `, [period]);
            totalDue = parseFloat(dueRes.rows[0].total_due) || 100000000; // Mặc định 100tr nếu chưa có dữ liệu

            // Tổng tiền thu nợ thực tế trong kỳ từ cash_transactions
            const collectedRes = await client.query(`
                SELECT COALESCE(SUM(amount), 0) AS total_collected
                FROM cash_transactions
                WHERE TO_CHAR(created_at, 'YYYY-MM') = $1 AND type = 'THU'
            `, [period]);
            totalCollected = parseFloat(collectedRes.rows[0].total_collected) || 0;
        }

        // Tính tỷ lệ thu nợ đúng hạn (%)
        const collectionRate = totalDue > 0 ? Math.min(100, Math.round((totalCollected / totalDue) * 100)) : 100;

        // Cơ chế Thưởng / Phạt 4 bậc theo đề xuất:
        // - Dưới 70%: Không hoàn thành -> Cảnh cáo / Phạt KPI (-1.000.000 VNĐ)
        // - 70% - 84%: Đạt mức cơ bản -> 100% lương, Thưởng 0 VNĐ
        // - 85% - 94%: Thưởng Mức 1 -> +1.500.000 VNĐ
        // - 95% - 100%: Thưởng Mức 2 (Xuất sắc) -> +3.000.000 VNĐ
        let kpiTier = 'TIER_70_84';
        let rewardPenalty = 0;
        let notes = '';

        if (collectionRate < 70) {
            kpiTier = 'TIER_UNDER_70';
            rewardPenalty = -1000000;
            notes = `Tỷ lệ thu nợ ${collectionRate}% (< 70%): Không hoàn thành KPI. Phạt trừ phụ cấp trách nhiệm -1.000.000đ.`;
        } else if (collectionRate >= 70 && collectionRate <= 84) {
            kpiTier = 'TIER_70_84';
            rewardPenalty = 0;
            notes = `Tỷ lệ thu nợ ${collectionRate}% (70% - 84%): Đạt mức cơ bản. Hưởng 100% lương, không có thưởng thêm.`;
        } else if (collectionRate >= 85 && collectionRate <= 94) {
            kpiTier = 'TIER_85_94';
            rewardPenalty = 1500000;
            notes = `Tỷ lệ thu nợ ${collectionRate}% (85% - 94%): Thưởng Mức 1 (+1.500.000đ) động lực thu hồi công nợ tốt.`;
        } else {
            kpiTier = 'TIER_95_100';
            rewardPenalty = 3000000;
            notes = `Tỷ lệ thu nợ ${collectionRate}% (95% - 100%): Thưởng Mức 2 Xuất Sắc (+3.000.000đ) thu hồi công nợ vượt trội!`;
        }

        const insertRes = await client.query(`
            INSERT INTO debt_kpi_evaluations (
                period_key, employee_id, total_due_debt, total_collected_debt,
                collection_rate, kpi_tier, reward_penalty_amount, notes, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'CALCULATED')
            ON CONFLICT (period_key, employee_id) DO UPDATE SET
                total_due_debt = EXCLUDED.total_due_debt,
                total_collected_debt = EXCLUDED.total_collected_debt,
                collection_rate = EXCLUDED.collection_rate,
                kpi_tier = EXCLUDED.kpi_tier,
                reward_penalty_amount = EXCLUDED.reward_penalty_amount,
                notes = EXCLUDED.notes,
                status = 'CALCULATED'
            RETURNING *
        `, [
            period, targetEmpId, totalDue, totalCollected,
            collectionRate, kpiTier, rewardPenalty, notes
        ]);

        await client.query('COMMIT');
        res.json({
            success: true,
            message: `Đã đánh giá KPI Thu nợ kỳ ${period} thành công! (${notes})`,
            data: insertRes.rows[0]
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Lỗi đánh giá KPI thu nợ:', err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// 3. PUT: Điều chỉnh thủ công mức thưởng / phạt KPI thu nợ
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { reward_penalty_amount, notes } = req.body;

        const updateRes = await pool.query(`
            UPDATE debt_kpi_evaluations
            SET reward_penalty_amount = $1,
                notes = COALESCE($2, notes)
            WHERE id = $3
            RETURNING *
        `, [parseFloat(reward_penalty_amount) || 0, notes, id]);

        if (updateRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy bản ghi đánh giá KPI' });
        }

        res.json({ success: true, message: 'Đã cập nhật mức thưởng/phạt KPI thành công!', data: updateRes.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
