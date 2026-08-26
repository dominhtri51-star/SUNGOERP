const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Helper: Lấy danh sách ID nhân viên mà user hiện tại được phép xem theo RBAC
async function getAllowedEmployeeIds(userRole, userEmpId) {
    if (!userRole || ['ADMIN', 'SUPER_ADMIN', 'KE_TOAN', 'GIAM_DOC'].includes(userRole.toUpperCase())) {
        return null; // Được xem tất cả
    }

    const cleanEmpId = (userEmpId || '').trim().toUpperCase();
    if (!cleanEmpId) return [];

    // Tìm hồ sơ nhân viên của người dùng hiện tại
    const meRes = await pool.query(
        "SELECT id, emp_code, department_id, department_role FROM employees WHERE UPPER(emp_code) = $1 OR user_id::text = $1",
        [cleanEmpId]
    );

    if (meRes.rows.length === 0) return [];
    const me = meRes.rows[0];

    // Nếu là Trưởng phòng kinh doanh (hoặc vai trò MANAGER / SALE_LEAD / TRUONG_PHONG_KD)
    if (me.department_role === 'MANAGER' || ['TRUONG_PHONG_KD', 'SALE_LEAD', 'SALE_ADMIN'].includes(userRole.toUpperCase())) {
        const teamRes = await pool.query(
            "SELECT id FROM employees WHERE id = $1 OR manager_id = $1 OR department_id = $2",
            [me.id, me.department_id]
        );
        return teamRes.rows.map(r => r.id);
    }

    // Nhân viên kinh doanh thường (SALE): CHỈ xem của chính mình
    return [me.id];
}

// Lấy danh sách hoa hồng (kèm phân quyền dữ liệu theo vai trò)
router.get('/', async (req, res) => {
    try {
        const { employee_id, paid_status, ref_type, period, user_role, user_empid } = req.query;
        let query = `
            SELECT sc.*,
                   e.emp_code,
                   e.full_name AS employee_name,
                   e.commission_rate_wholesale AS emp_rate_ws,
                   e.commission_rate_boq AS emp_rate_boq,
                   e.min_gross_profit_threshold,
                   e.department_role,
                   d.dept_name
            FROM sales_commissions sc
            LEFT JOIN employees e ON sc.employee_id = e.id
            LEFT JOIN departments d ON e.department_id = d.id
            WHERE 1=1
        `;
        const params = [];

        // Phân quyền theo vai trò (RBAC)
        const allowedIds = await getAllowedEmployeeIds(user_role, user_empid);
        if (allowedIds !== null) {
            if (allowedIds.length === 0) {
                return res.json({ success: true, data: [] });
            }
            params.push(allowedIds);
            query += ` AND sc.employee_id = ANY($${params.length})`;
        }

        if (employee_id) {
            params.push(employee_id);
            query += ` AND sc.employee_id = $${params.length}`;
        }
        if (paid_status) {
            params.push(paid_status);
            query += ` AND sc.paid_status = $${params.length}`;
        }
        if (ref_type) {
            params.push(ref_type);
            query += ` AND sc.ref_type = $${params.length}`;
        }
        if (period) {
            params.push(period);
            query += ` AND sc.payroll_period = $${params.length}`;
        }

        query += " ORDER BY sc.id DESC";
        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('Lỗi lấy danh sách hoa hồng:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Thống kê tổng quan hoa hồng & Đo lường KPI theo Ngưỡng Lợi Nhuận Gộp Tối Thiểu
router.get('/summary', async (req, res) => {
    try {
        const { user_role, user_empid, period } = req.query;
        const allowedIds = await getAllowedEmployeeIds(user_role, user_empid);

        let whereClause = "1=1";
        const params = [];
        if (allowedIds !== null) {
            if (allowedIds.length === 0) {
                return res.json({
                    success: true,
                    summary: { total_commission: 0, pending_commission: 0, eligible_commission: 0, paid_commission: 0, total_records: 0 },
                    byEmployee: []
                });
            }
            params.push(allowedIds);
            whereClause += ` AND employee_id = ANY($${params.length})`;
        }

        const summaryRes = await pool.query(`
            SELECT 
                COALESCE(SUM(commission_amount), 0) AS total_commission,
                COALESCE(SUM(CASE WHEN paid_status = 'PENDING' THEN commission_amount ELSE 0 END), 0) AS pending_commission,
                COALESCE(SUM(CASE WHEN paid_status = 'ELIGIBLE' THEN commission_amount ELSE 0 END), 0) AS eligible_commission,
                COALESCE(SUM(CASE WHEN paid_status = 'PAID' OR paid_status = 'INCLUDED_PAYROLL' THEN commission_amount ELSE 0 END), 0) AS paid_commission,
                COUNT(id) AS total_records,
                COUNT(CASE WHEN paid_status = 'ELIGIBLE' THEN 1 END) AS eligible_count
            FROM sales_commissions
            WHERE ${whereClause}
        `, params);

        // Thống kê theo từng nhân viên kèm kiểm tra Ngưỡng Lợi Nhuận Tối Thiểu
        let empWhere = "e.status = 'ACTIVE'";
        const empParams = [];
        if (allowedIds !== null) {
            empParams.push(allowedIds);
            empWhere += ` AND e.id = ANY($${empParams.length})`;
        }

        const empSummaryRes = await pool.query(`
            SELECT 
                e.id AS employee_id,
                e.emp_code,
                e.full_name,
                e.position,
                e.department_role,
                COALESCE(e.commission_rate_wholesale, 5) AS rate_wholesale,
                COALESCE(e.commission_rate_boq, 10) AS rate_boq,
                COALESCE(e.min_gross_profit_threshold, 0) AS min_gross_profit_threshold,
                COUNT(sc.id) AS total_orders,
                COALESCE(SUM(sc.revenue_amount), 0) AS total_revenue,
                COALESCE(SUM(sc.gross_profit), 0) AS total_gross_profit,
                COALESCE(SUM(sc.commission_amount), 0) AS raw_commission,
                COALESCE(SUM(CASE WHEN sc.paid_status = 'ELIGIBLE' THEN sc.commission_amount ELSE 0 END), 0) AS raw_eligible_commission
            FROM employees e
            LEFT JOIN sales_commissions sc ON e.id = sc.employee_id
            WHERE ${empWhere}
            GROUP BY e.id, e.emp_code, e.full_name, e.position, e.department_role, e.commission_rate_wholesale, e.commission_rate_boq, e.min_gross_profit_threshold
            ORDER BY e.id ASC
        `, empParams);

        // Tính toán lại hoa hồng theo Ngưỡng Lợi Nhuận Gộp Tối Thiểu (Threshold Logic)
        const processedByEmployee = empSummaryRes.rows.map(emp => {
            const minThreshold = parseFloat(emp.min_gross_profit_threshold) || 0;
            const totalGross = parseFloat(emp.total_gross_profit) || 0;
            const rawComm = parseFloat(emp.raw_commission) || 0;
            const rawEligible = parseFloat(emp.raw_eligible_commission) || 0;

            const isThresholdReached = minThreshold === 0 || totalGross >= minThreshold;
            const progressPercent = minThreshold > 0 ? Math.min(100, Math.round((totalGross / minThreshold) * 100)) : 100;

            // Nếu chưa đạt ngưỡng tối thiểu -> Hoa hồng = 0 đ (công ty giữ an toàn chi phí)
            const effectiveCommission = isThresholdReached ? rawComm : 0;
            const effectiveEligibleCommission = isThresholdReached ? rawEligible : 0;

            return {
                ...emp,
                min_gross_profit_threshold: minThreshold,
                total_gross_profit: totalGross,
                is_threshold_reached: isThresholdReached,
                threshold_progress_percent: progressPercent,
                total_commission: effectiveCommission,
                eligible_commission: effectiveEligibleCommission,
                threshold_note: isThresholdReached 
                    ? (minThreshold > 0 ? `Đã vượt ngưỡng tối thiểu (${totalGross.toLocaleString('vi-VN')} / ${minThreshold.toLocaleString('vi-VN')} đ)` : 'Không áp dụng ngưỡng')
                    : `Chưa đạt ngưỡng tối thiểu: ${totalGross.toLocaleString('vi-VN')} / ${minThreshold.toLocaleString('vi-VN')} đ (${progressPercent}%) - Chưa kích hoạt hoa hồng`
            };
        });

        res.json({
            success: true,
            summary: summaryRes.rows[0],
            byEmployee: processedByEmployee
        });
    } catch (err) {
        console.error('Lỗi summary hoa hồng:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Đồng bộ & Tự động tính hoa hồng từ ĐƠN HÀNG KHÁCH SỈ (Theo % riêng của từng nhân viên)
router.post('/sync-orders', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Lấy các đơn hàng chưa bị hủy
        const ordersRes = await client.query(`
            SELECT o.id, o.order_code, o.customer_id, o.customer_name, o.total_amount, o.paid_amount, o.status, o.employee_id, o.created_at,
                   COALESCE(SUM(oi.quantity * COALESCE(p.import_price, 0)), 0) AS total_cogs,
                   COALESCE(SUM(oi.quantity * oi.price), o.total_amount) AS calc_revenue
            FROM orders o
            LEFT JOIN order_items oi ON oi.order_id = o.id
            LEFT JOIN products p ON oi.product_id = p.id
            WHERE o.status != 'CANCELLED' AND o.status != 'RETURNED'
            GROUP BY o.id, o.order_code, o.customer_id, o.customer_name, o.total_amount, o.paid_amount, o.status, o.employee_id, o.created_at
        `);

        // Lấy nhân viên sale mặc định nếu đơn hàng chưa gán
        const defaultSaleRes = await client.query("SELECT id, commission_rate_wholesale FROM employees WHERE position ILIKE '%Kinh Doanh%' OR position ILIKE '%Sale%' ORDER BY id ASC LIMIT 1");
        const defaultEmpId = defaultSaleRes.rows.length > 0 ? defaultSaleRes.rows[0].id : 1;

        let syncedCount = 0;

        for (const ord of ordersRes.rows) {
            const rev = parseFloat(ord.calc_revenue) || parseFloat(ord.total_amount) || 0;
            let cogs = parseFloat(ord.total_cogs) || 0;
            if (cogs === 0 && rev > 0) {
                cogs = rev * 0.75;
            }
            const grossProfit = Math.max(0, rev - cogs);
            const assignedEmpId = ord.employee_id || defaultEmpId;

            // Lấy % hoa hồng riêng của nhân viên đó
            const empRateRes = await client.query(
                "SELECT COALESCE(commission_rate_wholesale, 5) AS rate_wholesale FROM employees WHERE id = $1",
                [assignedEmpId]
            );
            const commissionRate = empRateRes.rows.length > 0 ? parseFloat(empRateRes.rows[0].rate_wholesale) : 5;
            const commissionAmount = Math.round(grossProfit * (commissionRate / 100));

            // Kiểm tra trạng thái thanh toán
            const isFullyPaid = (parseFloat(ord.paid_amount) || 0) >= (parseFloat(ord.total_amount) || 0) && (parseFloat(ord.total_amount) || 0) > 0;
            const paidStatus = isFullyPaid ? 'ELIGIBLE' : 'PENDING';

            // Kiểm tra xem hoa hồng đơn này đã có chưa
            const checkExist = await client.query(
                "SELECT id, paid_status FROM sales_commissions WHERE ref_type = 'ORDER' AND ref_id = $1",
                [String(ord.id)]
            );

            if (checkExist.rows.length === 0) {
                await client.query(`
                    INSERT INTO sales_commissions (
                        employee_id, ref_type, ref_id, ref_code, customer_name,
                        revenue_amount, cogs_amount, gross_profit, commission_rate,
                        commission_amount, paid_status, notes
                    ) VALUES ($1, 'ORDER', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                `, [
                    assignedEmpId, String(ord.id), ord.order_code || ('DH-' + ord.id),
                    ord.customer_name || 'Khách hàng', rev, cogs, grossProfit, commissionRate,
                    commissionAmount, paidStatus, `Tự động tính ${commissionRate}% Lợi nhuận gộp Đơn sỉ`
                ]);
                syncedCount++;
            } else {
                if (checkExist.rows[0].paid_status === 'PENDING' && isFullyPaid) {
                    await client.query(
                        "UPDATE sales_commissions SET paid_status = 'ELIGIBLE', revenue_amount = $1, cogs_amount = $2, gross_profit = $3, commission_amount = $4 WHERE id = $5",
                        [rev, cogs, grossProfit, commissionAmount, checkExist.rows[0].id]
                    );
                }
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, message: `Đã đồng bộ hoa hồng ${syncedCount} đơn hàng mới thành công!`, syncedCount });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Lỗi đồng bộ hoa hồng đơn hàng:', err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// Đồng bộ & Tự động tính hoa hồng từ BÁO GIÁ BOQ / HỢP ĐỒNG EPC (10% Lợi nhuận gộp)
router.post('/sync-boq', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Lấy danh sách hợp đồng BOQ
        const contractsRes = await client.query("SELECT * FROM contracts");
        const defaultBoqEmpRes = await client.query("SELECT id FROM employees WHERE position ILIKE '%BOQ%' OR position ILIKE '%Thiết Kế%' OR position ILIKE '%Kỹ Sư%' ORDER BY id ASC LIMIT 1");
        const defaultEmpId = defaultBoqEmpRes.rows.length > 0 ? defaultBoqEmpRes.rows[0].id : 3;

        let syncedCount = 0;

        for (const c of contractsRes.rows) {
            const rev = parseFloat(c.total_value) || 0;
            // Dự án EPC: Giả định Giá vốn thiết bị & nhân công ~ 70% doanh thu
            const cogs = rev * 0.70;
            let assignedEmpId = c.employee_id || null;
            if (!assignedEmpId) {
                // Thử tìm trong bảng quotations theo mã hợp đồng hoặc tên khách hàng
                try {
                    const quotationsRes = await client.query(
                        "SELECT emp_id, created_by FROM quotations WHERE quotation_code = $1 OR customer_name = $2 LIMIT 1",
                        [c.contract_code, c.customer_name]
                    ).catch(() => ({ rows: [] }));
                    if (quotationsRes.rows.length > 0 && quotationsRes.rows[0].emp_id) {
                        const qEmp = quotationsRes.rows[0].emp_id;
                        const matchEmp = await client.query(
                            "SELECT id FROM employees WHERE UPPER(emp_code) = $1",
                            [String(qEmp).trim().toUpperCase()]
                        );
                        if (matchEmp.rows.length > 0) assignedEmpId = matchEmp.rows[0].id;
                    }
                } catch(e) {}
            }
            if (!assignedEmpId) assignedEmpId = defaultEmpId;

            // Lấy % hoa hồng BOQ riêng của nhân viên đó
            const empRateRes = await client.query(
                "SELECT COALESCE(commission_rate_boq, 10) AS rate_boq FROM employees WHERE id = $1",
                [assignedEmpId]
            );
            const commissionRate = empRateRes.rows.length > 0 ? parseFloat(empRateRes.rows[0].rate_boq) : 10;
            const commissionAmount = Math.round(grossProfit * (commissionRate / 100));

            const isPaid = (parseFloat(c.paid_amount) || 0) >= rev && rev > 0;
            const paidStatus = isPaid ? 'ELIGIBLE' : (parseFloat(c.paid_amount) > 0 ? 'ELIGIBLE' : 'PENDING');

            const checkExist = await client.query(
                "SELECT id, paid_status FROM sales_commissions WHERE ref_type = 'CONTRACT' AND ref_id = $1",
                [String(c.id)]
            );

            if (checkExist.rows.length === 0) {
                await client.query(`
                    INSERT INTO sales_commissions (
                        employee_id, ref_type, ref_id, ref_code, customer_name,
                        revenue_amount, cogs_amount, gross_profit, commission_rate,
                        commission_amount, paid_status, notes
                    ) VALUES ($1, 'CONTRACT', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                `, [
                    assignedEmpId, String(c.id), c.contract_code || ('HD-' + c.id),
                    c.customer_name || 'Khách hàng dự án', rev, cogs, grossProfit, commissionRate,
                    commissionAmount, paidStatus, `Tự động tính ${commissionRate}% Lợi nhuận gộp Báo giá BOQ / EPC`
                ]);
                syncedCount++;
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, message: `Đã đồng bộ hoa hồng ${syncedCount} hợp đồng BOQ thành công!`, syncedCount });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Lỗi đồng bộ hoa hồng BOQ:', err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// Thêm hoa hồng thủ công
router.post('/', async (req, res) => {
    try {
        const {
            employee_id, ref_type, ref_id, ref_code, customer_name,
            revenue_amount, cogs_amount, gross_profit, commission_rate,
            commission_amount, paid_status, notes
        } = req.body;

        const result = await pool.query(`
            INSERT INTO sales_commissions (
                employee_id, ref_type, ref_id, ref_code, customer_name,
                revenue_amount, cogs_amount, gross_profit, commission_rate,
                commission_amount, paid_status, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
        `, [
            employee_id, ref_type || 'MANUAL', ref_id || ('REF-' + Date.now()),
            ref_code || ('HH-' + Math.floor(Date.now() / 1000)), customer_name || '',
            parseFloat(revenue_amount) || 0, parseFloat(cogs_amount) || 0,
            parseFloat(gross_profit) || 0, parseFloat(commission_rate) || 5,
            parseFloat(commission_amount) || 0, paid_status || 'ELIGIBLE', notes || ''
        ]);

        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Cập nhật trạng thái hoa hồng (Duyệt chi / Chuyển sang Đủ điều kiện / Đã chi)
router.put('/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { paid_status, notes, employee_id } = req.body;

        let query = "UPDATE sales_commissions SET paid_status = $1";
        const params = [paid_status];

        if (notes !== undefined) {
            params.push(notes);
            query += `, notes = $${params.length}`;
        }
        if (employee_id !== undefined) {
            params.push(employee_id);
            query += `, employee_id = $${params.length}`;
        }

        params.push(id);
        query += ` WHERE id = $${params.length} RETURNING *`;

        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Xóa bản ghi hoa hồng
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("DELETE FROM sales_commissions WHERE id = $1", [id]);
        res.json({ success: true, message: 'Đã xóa bản ghi hoa hồng' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
