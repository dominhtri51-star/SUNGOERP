const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// 1. Lấy cấu hình Chính Sách KPI Xuất Kho hiện tại
router.get('/policy', async (req, res) => {
    try {
        const polRes = await pool.query("SELECT * FROM warehouse_kpi_policies WHERE id = 1 LIMIT 1");
        if (polRes.rows.length === 0) {
            await pool.query(`
                INSERT INTO warehouse_kpi_policies (id, policy_name, rate_per_order, profit_percent, min_orders_threshold, bonus_target_orders, bonus_tier_amount, is_active)
                VALUES (1, 'Chính sách KPI Xuất Kho Mặc Định', 20000, 0, 0, 50, 500000, TRUE)
                ON CONFLICT (id) DO NOTHING
            `);
            const fallback = await pool.query("SELECT * FROM warehouse_kpi_policies WHERE id = 1 LIMIT 1");
            return res.json({ success: true, data: fallback.rows[0] });
        }
        res.json({ success: true, data: polRes.rows[0] });
    } catch (err) {
        console.error('Lỗi get warehouse KPI policy:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. Cập nhật Chính Sách KPI Xuất Kho (Dành cho Admin / Quản lý)
router.put('/policy', async (req, res) => {
    try {
        const { rate_per_order, profit_percent, min_orders_threshold, bonus_target_orders, bonus_tier_amount, is_active, notes } = req.body;
        const result = await pool.query(`
            UPDATE warehouse_kpi_policies SET
                rate_per_order = COALESCE($1, rate_per_order),
                profit_percent = COALESCE($2, profit_percent),
                min_orders_threshold = COALESCE($3, min_orders_threshold),
                bonus_target_orders = COALESCE($4, bonus_target_orders),
                bonus_tier_amount = COALESCE($5, bonus_tier_amount),
                is_active = COALESCE($6, is_active),
                notes = COALESCE($7, notes),
                updated_at = NOW()
            WHERE id = 1
            RETURNING *
        `, [
            rate_per_order !== undefined ? parseFloat(rate_per_order) : null,
            profit_percent !== undefined ? parseFloat(profit_percent) : null,
            min_orders_threshold !== undefined ? parseInt(min_orders_threshold, 10) : null,
            bonus_target_orders !== undefined ? parseInt(bonus_target_orders, 10) : null,
            bonus_tier_amount !== undefined ? parseFloat(bonus_tier_amount) : null,
            is_active !== undefined ? is_active : null,
            notes !== undefined ? notes : null
        ]);

        // Tự động đồng bộ lại tiền hoa hồng kho vào bảng lương DRAFT hiện hành (nếu có)
        try {
            const currentPeriod = new Date().toISOString().slice(0, 7);
            const draftPayroll = await pool.query("SELECT id FROM payrolls WHERE period_key = $1 AND status = 'DRAFT' LIMIT 1", [currentPeriod]);
            if (draftPayroll.rows.length > 0) {
                const payrollId = draftPayroll.rows[0].id;
                const pol = result.rows[0];
                const rate = parseFloat(pol.rate_per_order) || 0;
                const pct = parseFloat(pol.profit_percent) || 0;
                const minThresh = parseInt(pol.min_orders_threshold, 10) || 0;

                const startDate = `${currentPeriod}-01 00:00:00`;
                const parts = currentPeriod.split('-');
                const lastDay = new Date(parseInt(parts[0]), parseInt(parts[1]), 0).getDate();
                const endDate = `${currentPeriod}-${String(lastDay).padStart(2, '0')} 23:59:59`;

                const items = await pool.query("SELECT id, employee_id, total_commission, warehouse_commission, gross_income, net_salary FROM payroll_items WHERE payroll_id = $1", [payrollId]);
                for (const item of items.rows) {
                    const ordRes = await pool.query(`
                        SELECT COUNT(id) AS dispatched_count,
                               COALESCE(SUM(COALESCE(NULLIF(regexp_replace(gross_profit::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)), 0) AS total_gross_profit
                        FROM orders
                        WHERE dispatched_by = $1
                          AND status IN ('SHIPPED', 'COMPLETED')
                          AND COALESCE(dispatched_at, created_at) >= $2
                          AND COALESCE(dispatched_at, created_at) <= $3
                    `, [item.employee_id, startDate, endDate]);

                    const count = parseInt(ordRes.rows[0]?.dispatched_count, 10) || 0;
                    const gp = Math.max(0, parseFloat(ordRes.rows[0]?.total_gross_profit) || 0);

                    if (count > 0 || parseFloat(item.warehouse_commission) > 0) {
                        const eligibleCount = Math.max(0, count - minThresh);
                        const fixedComm = eligibleCount * rate;
                        const profitComm = Math.round(gp * (pct / 100));
                        const newWhComm = fixedComm + profitComm;

                        const oldWhComm = parseFloat(item.warehouse_commission) || 0;
                        const diff = newWhComm - oldWhComm;

                        await pool.query(`
                            UPDATE payroll_items SET
                                warehouse_commission = $1,
                                total_commission = total_commission + $2,
                                gross_income = gross_income + $2,
                                net_salary = net_salary + $2
                            WHERE id = $3
                        `, [newWhComm, diff, item.id]);
                    }
                }

                await pool.query(`
                    UPDATE payrolls SET
                        total_commission = (SELECT COALESCE(SUM(total_commission), 0) FROM payroll_items WHERE payroll_id = $1),
                        total_gross_salary = (SELECT COALESCE(SUM(gross_income), 0) FROM payroll_items WHERE payroll_id = $1),
                        total_net_salary = (SELECT COALESCE(SUM(net_salary), 0) FROM payroll_items WHERE payroll_id = $1)
                    WHERE id = $1
                `, [payrollId]);
            }
        } catch (syncErr) {
            console.warn("⚠️ Tự động đồng bộ bảng lương DRAFT khi đổi chính sách KPI thất bại:", syncErr.message);
        }

        res.json({
            success: true,
            message: '✅ Đã cập nhật chính sách KPI hoa hồng xuất kho thành công!',
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Lỗi update warehouse KPI policy:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. Lấy báo cáo tổng hợp KPI Xuất Kho theo tháng (period_key = 'YYYY-MM')
router.get('/summary', async (req, res) => {
    try {
        const periodKey = req.query.period_key || new Date().toISOString().slice(0, 7);
        const startDate = `${periodKey}-01 00:00:00`;
        const parts = periodKey.split('-');
        const lastDay = new Date(parseInt(parts[0]), parseInt(parts[1]), 0).getDate();
        const endDate = `${periodKey}-${String(lastDay).padStart(2, '0')} 23:59:59`;

        // Lấy chính sách hiện tại
        const polRes = await pool.query("SELECT * FROM warehouse_kpi_policies WHERE id = 1 LIMIT 1");
        const policy = polRes.rows[0] || {
            rate_per_order: 20000,
            profit_percent: 0,
            min_orders_threshold: 0,
            bonus_target_orders: 50,
            bonus_tier_amount: 500000
        };

        const ratePerOrder = parseFloat(policy.rate_per_order) || 0;
        const profitPercent = parseFloat(policy.profit_percent) || 0;
        const minThreshold = parseInt(policy.min_orders_threshold, 10) || 0;
        const bonusTarget = parseInt(policy.bonus_target_orders, 10) || 50;
        const bonusTierAmount = parseFloat(policy.bonus_tier_amount) || 500000;

        // Lấy danh sách nhân sự kho hoặc có đơn xử lý
        const empsRes = await pool.query(`
            SELECT DISTINCT e.id, e.emp_code, e.full_name, e.position, d.dept_name
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.id
            WHERE e.status = 'ACTIVE' 
              AND (d.dept_name ILIKE '%kho%' OR e.position ILIKE '%kho%' OR e.emp_code = 'NVKHO')
            ORDER BY e.id ASC
        `);

        const summary = [];
        let grandOrders = 0;
        let grandCommission = 0;

        for (const emp of empsRes.rows) {
            const ordRes = await pool.query(`
                SELECT 
                    COUNT(id) AS dispatched_count,
                    COALESCE(SUM(warehouse_commission), 0) AS raw_commission,
                    COALESCE(SUM(COALESCE(NULLIF(regexp_replace(gross_profit::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)), 0) AS total_gross_profit
                FROM orders
                WHERE dispatched_by = $1
                  AND status IN ('SHIPPED', 'COMPLETED')
                  AND COALESCE(dispatched_at, created_at) >= $2
                  AND COALESCE(dispatched_at, created_at) <= $3
            `, [emp.id, startDate, endDate]);

            const row = ordRes.rows[0];
            const count = parseInt(row.dispatched_count, 10) || 0;
            const totalGrossProfit = Math.max(0, parseFloat(row.total_gross_profit) || 0);

            const eligibleCount = Math.max(0, count - minThreshold);
            const fixedCommission = eligibleCount * ratePerOrder;
            const profitCommission = Math.round(totalGrossProfit * (profitPercent / 100));
            const baseCommission = fixedCommission + profitCommission;

            const hasBonus = count >= bonusTarget && bonusTarget > 0;
            const tierBonus = hasBonus ? bonusTierAmount : 0;
            const totalPayout = baseCommission + tierBonus;

            grandOrders += count;
            grandCommission += totalPayout;

            summary.push({
                employee_id: emp.id,
                emp_code: emp.emp_code,
                full_name: emp.full_name,
                position: emp.position,
                dept_name: emp.dept_name,
                dispatched_count: count,
                rate_per_order: ratePerOrder,
                profit_percent: profitPercent,
                total_gross_profit: totalGrossProfit,
                fixed_commission: fixedCommission,
                profit_commission: profitCommission,
                base_commission: baseCommission,
                has_target_bonus: hasBonus,
                target_bonus_amount: tierBonus,
                total_payout: totalPayout
            });
        }

        res.json({
            success: true,
            period_key: periodKey,
            policy: {
                rate_per_order: ratePerOrder,
                profit_percent: profitPercent,
                min_orders_threshold: minThreshold,
                bonus_target_orders: bonusTarget,
                bonus_tier_amount: bonusTierAmount
            },
            total_dispatched_orders: grandOrders,
            total_warehouse_commission: grandCommission,
            staff_summary: summary
        });
    } catch (err) {
        console.error('Lỗi get warehouse KPI summary:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. Lấy chi tiết đơn hàng xuất kho của 1 nhân viên trong tháng
router.get('/orders', async (req, res) => {
    try {
        const { period_key, employee_id } = req.query;
        if (!employee_id) return res.status(400).json({ success: false, error: 'Thiếu employee_id' });

        const pKey = period_key || new Date().toISOString().slice(0, 7);
        const startDate = `${pKey}-01 00:00:00`;
        const parts = pKey.split('-');
        const lastDay = new Date(parseInt(parts[0]), parseInt(parts[1]), 0).getDate();
        const endDate = `${pKey}-${String(lastDay).padStart(2, '0')} 23:59:59`;

        const ords = await pool.query(`
            SELECT id, order_code, customer_name, customer_phone, status, 
                   total_amount, cost_of_goods, gross_profit, delivery_company, driver_name, license_plate,
                   dispatched_at, warehouse_commission, created_at
            FROM orders
            WHERE dispatched_by = $1
              AND status IN ('SHIPPED', 'COMPLETED')
              AND COALESCE(dispatched_at, created_at) >= $2
              AND COALESCE(dispatched_at, created_at) <= $3
            ORDER BY COALESCE(dispatched_at, created_at) DESC
        `, [employee_id, startDate, endDate]);

        res.json({
            success: true,
            period_key: pKey,
            employee_id: parseInt(employee_id, 10),
            total_orders: ords.rows.length,
            orders: ords.rows
        });
    } catch (err) {
        console.error('Lỗi get warehouse KPI orders:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
