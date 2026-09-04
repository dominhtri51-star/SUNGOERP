const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Helper: Đảm bảo luôn lấy được ID nhân viên hợp lệ (tránh lỗi Foreign Key Constraint)
async function getOrCreateValidEmployeeId(clientOrPool, empRef) {
    try {
        if (empRef !== undefined && empRef !== null && String(empRef).trim() !== '') {
            // 1. Nếu là ID số nguyên, kiểm tra trực tiếp trong bảng employees
            if (typeof empRef === 'number' || (!isNaN(parseInt(empRef)) && String(parseInt(empRef)) === String(empRef).trim())) {
                const check = await clientOrPool.query("SELECT id FROM employees WHERE id = $1", [parseInt(empRef)]);
                if (check.rows.length > 0) return check.rows[0].id;
            }

            // 2. Tìm theo emp_code, user_id hoặc username từ users
            const cleanRef = String(empRef).trim().toUpperCase();
            const checkCode = await clientOrPool.query(`
                SELECT e.id 
                FROM employees e 
                LEFT JOIN users u ON e.user_id = u.id
                WHERE UPPER(e.emp_code) = $1 
                   OR e.user_id::text = $1 
                   OR UPPER(u.emp_id) = $1 
                   OR UPPER(u.username) = $1 
                   OR u.id::text = $1
                LIMIT 1
            `, [cleanRef]);
            if (checkCode.rows.length > 0) return checkCode.rows[0].id;
        }

        // 3. Fallback: Tìm nhân viên Sale/Kinh doanh còn hoạt động
        const saleEmp = await clientOrPool.query(`
            SELECT id FROM employees 
            WHERE status = 'ACTIVE' 
              AND (position ILIKE '%Kinh Doanh%' OR position ILIKE '%Sale%' OR department_id = 2) 
            ORDER BY id ASC LIMIT 1
        `);
        if (saleEmp.rows.length > 0) return saleEmp.rows[0].id;

        // 4. Fallback: Lấy bất kỳ nhân viên ACTIVE nào
        const anyEmp = await clientOrPool.query("SELECT id FROM employees WHERE status = 'ACTIVE' ORDER BY id ASC LIMIT 1");
        if (anyEmp.rows.length > 0) return anyEmp.rows[0].id;

        // 5. Fallback: Lấy bất kỳ nhân viên nào trong bảng
        const firstEmp = await clientOrPool.query("SELECT id FROM employees ORDER BY id ASC LIMIT 1");
        if (firstEmp.rows.length > 0) return firstEmp.rows[0].id;

        // 6. Nếu bảng employees hoàn toàn rỗng, tạo 1 nhân viên quản trị an toàn
        const newEmp = await clientOrPool.query(`
            INSERT INTO employees (
                emp_code, full_name, position, status, commission_rate_wholesale, commission_rate_boq
            ) VALUES ('EMP-ADMIN', 'Quản Trị Viên / Ban Giám Đốc', 'Kinh Doanh & Quản Trị', 'ACTIVE', 5, 10)
            ON CONFLICT (emp_code) DO UPDATE SET status = 'ACTIVE'
            RETURNING id
        `);
        return newEmp.rows[0].id;
    } catch(e) {
        console.error("⚠️ Lỗi getOrCreateValidEmployeeId:", e.message);
        try {
            const fallback = await pool.query("SELECT id FROM employees LIMIT 1");
            if (fallback.rows.length > 0) return fallback.rows[0].id;
        } catch(err){}
        return null;
    }
}

// Helper: Lấy danh sách ID nhân viên mà user hiện tại được phép xem theo RBAC
async function getAllowedEmployeeIds(userRole, userEmpId) {
    if (!userRole || ['ADMIN', 'SUPER_ADMIN', 'KE_TOAN', 'GIAM_DOC'].includes(userRole.toUpperCase())) {
        return null; // Được xem tất cả
    }

    const cleanEmpId = (userEmpId || '').trim().toUpperCase();
    if (!cleanEmpId) return [];

    // Tìm hồ sơ nhân viên của người dùng hiện tại (qua emp_code, user_id, username, emp_id)
    const meRes = await pool.query(`
        SELECT e.id, e.emp_code, e.department_id, e.department_role 
        FROM employees e 
        LEFT JOIN users u ON e.user_id = u.id
        WHERE UPPER(e.emp_code) = $1 
           OR e.user_id::text = $1 
           OR UPPER(u.emp_id) = $1 
           OR UPPER(u.username) = $1 
           OR u.id::text = $1
        LIMIT 1
    `, [cleanEmpId]);

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

// 1. Lấy danh sách hoa hồng (kèm phân quyền dữ liệu theo vai trò)
router.get('/', async (req, res) => {
    try {
        const { employee_id, paid_status, ref_type, period, commission_type, user_role, user_empid } = req.query;
        let query = `
            SELECT sc.*,
                   e.emp_code,
                   e.full_name AS employee_name,
                   e.commission_rate_wholesale AS emp_rate_ws,
                   e.commission_rate_boq AS emp_rate_boq,
                   e.commission_rate_manager_wholesale,
                   e.commission_rate_manager_boq,
                   e.min_gross_profit_threshold,
                   e.department_role,
                   d.dept_name,
                   sub.full_name AS subordinate_name,
                   sub.emp_code AS subordinate_code
            FROM sales_commissions sc
            LEFT JOIN employees e ON sc.employee_id = e.id
            LEFT JOIN departments d ON e.department_id = d.id
            LEFT JOIN employees sub ON sc.subordinate_id = sub.id
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
        if (commission_type) {
            params.push(commission_type);
            query += ` AND sc.commission_type = $${params.length}`;
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

// 2. Thống kê tổng quan hoa hồng & Đo lường KPI theo Ngưỡng Lợi Nhuận Gộp Tối Thiểu
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
                    summary: { total_commission: 0, pending_commission: 0, eligible_commission: 0, paid_commission: 0, total_records: 0, eligible_count: 0 },
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
                COALESCE(SUM(CASE WHEN commission_type = 'MANAGER_OVERRIDE' THEN commission_amount ELSE 0 END), 0) AS total_manager_override_commission,
                COUNT(id) AS total_records,
                COUNT(CASE WHEN paid_status = 'ELIGIBLE' THEN 1 END) AS eligible_count
            FROM sales_commissions
            WHERE ${whereClause}
        `, params);

        // Thống kê chi tiết theo từng nhân viên kèm kiểm tra Ngưỡng Điểm Hòa Vốn (Break-Even Marginal Threshold)
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
                COALESCE(e.commission_rate_manager_wholesale, 2) AS rate_manager_wholesale,
                COALESCE(e.commission_rate_manager_boq, 3) AS rate_manager_boq,
                COALESCE(e.min_gross_profit_threshold, 0) AS min_gross_profit_threshold,
                (SELECT COUNT(*) FROM employees sub WHERE sub.manager_id = e.id AND sub.status = 'ACTIVE') AS subordinate_count,
                COUNT(sc.id) AS total_orders,
                COALESCE(SUM(sc.revenue_amount), 0) AS total_revenue,
                COALESCE(SUM(sc.gross_profit), 0) AS total_gross_profit,
                COALESCE(SUM(CASE WHEN sc.commission_type = 'DIRECT' THEN sc.gross_profit ELSE 0 END), 0) AS direct_gross_profit,
                COALESCE(SUM(sc.commission_amount), 0) AS raw_commission,
                COALESCE(SUM(CASE WHEN sc.commission_type = 'DIRECT' THEN sc.commission_amount ELSE 0 END), 0) AS raw_direct_commission,
                COALESCE(SUM(CASE WHEN sc.commission_type = 'MANAGER_OVERRIDE' THEN sc.commission_amount ELSE 0 END), 0) AS raw_manager_commission,
                COALESCE(SUM(CASE WHEN sc.paid_status = 'ELIGIBLE' AND sc.commission_type = 'DIRECT' THEN sc.commission_amount ELSE 0 END), 0) AS raw_eligible_direct_comm,
                COALESCE(SUM(CASE WHEN sc.paid_status = 'ELIGIBLE' AND sc.commission_type = 'MANAGER_OVERRIDE' THEN sc.commission_amount ELSE 0 END), 0) AS raw_eligible_mgr_comm,
                COALESCE(SUM(CASE WHEN sc.paid_status = 'ELIGIBLE' THEN sc.commission_amount ELSE 0 END), 0) AS raw_eligible_commission
            FROM employees e
            LEFT JOIN sales_commissions sc ON e.id = sc.employee_id
            WHERE ${empWhere}
            GROUP BY e.id, e.emp_code, e.full_name, e.position, e.department_role, e.commission_rate_wholesale, e.commission_rate_boq, e.commission_rate_manager_wholesale, e.commission_rate_manager_boq, e.min_gross_profit_threshold
            ORDER BY e.id ASC
        `, empParams);

        // Lấy dữ liệu chi tiết hoa hồng quản lý theo từng cặp (Trưởng phòng, Cấp dưới)
        const mgrSubRes = await pool.query(`
            SELECT 
                sc.employee_id AS manager_id,
                sc.subordinate_id,
                sub.emp_code AS sub_code,
                sub.full_name AS sub_name,
                COALESCE(sub.min_gross_profit_threshold, 0) AS sub_threshold,
                COALESCE(SUM(sc.gross_profit), 0) AS sub_order_gp,
                COALESCE(SUM(sc.commission_amount), 0) AS raw_mgr_comm,
                COALESCE(SUM(CASE WHEN sc.paid_status = 'ELIGIBLE' THEN sc.commission_amount ELSE 0 END), 0) AS raw_eligible_mgr_comm
            FROM sales_commissions sc
            JOIN employees sub ON sc.subordinate_id = sub.id
            WHERE sc.commission_type = 'MANAGER_OVERRIDE' AND sc.subordinate_id IS NOT NULL
            GROUP BY sc.employee_id, sc.subordinate_id, sub.emp_code, sub.full_name, sub.min_gross_profit_threshold
        `);

        // Bản đồ tỷ lệ vượt ngưỡng hòa vốn của từng nhân viên cấp dưới (subordinate excess ratio map)
        const subExcessMap = {};
        empSummaryRes.rows.forEach(emp => {
            const minThreshold = parseFloat(emp.min_gross_profit_threshold) || 0;
            const directGp = parseFloat(emp.direct_gross_profit) || 0;
            const excessGp = Math.max(0, directGp - minThreshold);
            const excessRatio = directGp > 0 ? (excessGp / directGp) : (minThreshold === 0 ? 1 : 0);
            subExcessMap[emp.employee_id] = {
                threshold: minThreshold,
                direct_gp: directGp,
                excess_gp: excessGp,
                excess_ratio: excessRatio,
                is_reached: minThreshold === 0 || directGp >= minThreshold
            };
        });

        // Bản đồ gom hoa hồng quản lý cho từng trưởng phòng
        const mgrCommsByManager = {};
        mgrSubRes.rows.forEach(row => {
            if (!mgrCommsByManager[row.manager_id]) {
                mgrCommsByManager[row.manager_id] = [];
            }
            const subStat = subExcessMap[row.subordinate_id] || { excess_ratio: 0, excess_gp: 0, threshold: 0, direct_gp: 0, is_reached: false };
            const effectiveSubMgrComm = Math.round(parseFloat(row.raw_mgr_comm) * subStat.excess_ratio);
            const effectiveEligibleSubMgrComm = Math.round(parseFloat(row.raw_eligible_mgr_comm) * subStat.excess_ratio);

            mgrCommsByManager[row.manager_id].push({
                subordinate_id: row.subordinate_id,
                subordinate_code: row.sub_code,
                subordinate_name: row.sub_name,
                sub_threshold: subStat.threshold,
                sub_direct_gp: subStat.direct_gp,
                sub_excess_gp: subStat.excess_gp,
                sub_excess_ratio: subStat.excess_ratio,
                sub_is_reached: subStat.is_reached,
                raw_mgr_comm: parseFloat(row.raw_mgr_comm) || 0,
                effective_mgr_comm: effectiveSubMgrComm,
                raw_eligible_mgr_comm: parseFloat(row.raw_eligible_mgr_comm) || 0,
                effective_eligible_mgr_comm: effectiveEligibleSubMgrComm
            });
        });

        // Tính toán lại hoa hồng theo cơ chế PHẦN VƯỢT ĐIỂM HÒA VỐN (Marginal Break-Even Threshold)
        let grandTotalEffectiveCommission = 0;
        let grandEligibleEffectiveCommission = 0;

        const processedByEmployee = empSummaryRes.rows.map(emp => {
            const minThreshold = parseFloat(emp.min_gross_profit_threshold) || 0;
            const directGp = parseFloat(emp.direct_gross_profit) || 0;
            const rawDirectComm = parseFloat(emp.raw_direct_commission) || 0;
            const rawEligibleDirectComm = parseFloat(emp.raw_eligible_direct_comm) || 0;

            const isThresholdReached = minThreshold === 0 || directGp >= minThreshold;
            const excessGp = Math.max(0, directGp - minThreshold);
            const excessRatio = directGp > 0 ? (excessGp / directGp) : (minThreshold === 0 ? 1 : 0);
            const progressPercent = minThreshold > 0 ? Math.min(100, Math.round((directGp / minThreshold) * 100)) : 100;

            // 1. Hoa hồng bán hàng trực tiếp của nhân viên (chỉ tính trên phần vượt điểm hòa vốn)
            const effectiveDirectComm = Math.round(rawDirectComm * excessRatio);
            const effectiveEligibleDirectComm = Math.round(rawEligibleDirectComm * excessRatio);

            // 2. Hoa hồng quản lý đội nhóm của Trưởng phòng (hưởng theo phần vượt hòa vốn của từng cấp dưới)
            const subMgrList = mgrCommsByManager[emp.employee_id] || [];
            const effectiveMgrComm = subMgrList.reduce((sum, item) => sum + item.effective_mgr_comm, 0);
            const effectiveEligibleMgrComm = subMgrList.reduce((sum, item) => sum + item.effective_eligible_mgr_comm, 0);
            const rawMgrComm = parseFloat(emp.raw_manager_commission) || 0;

            const totalEffectiveComm = effectiveDirectComm + effectiveMgrComm;
            const totalEffectiveEligibleComm = effectiveEligibleDirectComm + effectiveEligibleMgrComm;

            grandTotalEffectiveCommission += totalEffectiveComm;
            grandEligibleEffectiveCommission += totalEffectiveEligibleComm;

            let thresholdNote = '';
            if (minThreshold === 0) {
                thresholdNote = 'Không áp dụng điểm hòa vốn (Hưởng 100% hoa hồng)';
            } else if (isThresholdReached) {
                thresholdNote = `Đã vượt điểm hòa vốn (+${excessGp.toLocaleString('vi-VN')} đ). Tính thưởng trên phần ${excessGp.toLocaleString('vi-VN')} đ vượt ngưỡng.`;
            } else {
                const missing = minThreshold - directGp;
                thresholdNote = `Chưa đạt điểm hòa vốn: ${directGp.toLocaleString('vi-VN')} / ${minThreshold.toLocaleString('vi-VN')} đ (còn thiếu ${missing.toLocaleString('vi-VN')} đ) -> Thưởng = 0 đ`;
            }

            return {
                ...emp,
                min_gross_profit_threshold: minThreshold,
                total_gross_profit: parseFloat(emp.total_gross_profit) || 0,
                direct_gross_profit: directGp,
                excess_gross_profit: excessGp,
                excess_ratio: excessRatio,
                is_threshold_reached: isThresholdReached,
                threshold_progress_percent: progressPercent,
                total_commission: totalEffectiveComm,
                direct_commission: effectiveDirectComm,
                manager_commission: effectiveMgrComm,
                eligible_commission: totalEffectiveEligibleComm,
                raw_direct_commission: rawDirectComm,
                raw_manager_commission: rawMgrComm,
                subordinate_override_breakdown: subMgrList,
                threshold_note: thresholdNote
            };
        });

        const rawSummary = summaryRes.rows[0] || {};

        res.json({
            success: true,
            summary: {
                ...rawSummary,
                total_commission: grandTotalEffectiveCommission,
                eligible_commission: grandEligibleEffectiveCommission
            },
            byEmployee: processedByEmployee
        });
    } catch (err) {
        console.error('Lỗi summary hoa hồng:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. Đồng bộ & Tự động tính hoa hồng từ ĐƠN HÀNG KHÁCH SỈ (Theo % riêng của từng nhân viên & Hoa hồng Quản lý Trưởng phòng)
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

        let syncedCount = 0;

        for (const ord of ordersRes.rows) {
            const rev = parseFloat(ord.calc_revenue) || parseFloat(ord.total_amount) || 0;
            let cogs = parseFloat(ord.total_cogs) || 0;
            if (cogs === 0 && rev > 0) {
                cogs = rev * 0.75;
            }
            const grossProfit = Math.max(0, rev - cogs);
            const assignedEmpId = await getOrCreateValidEmployeeId(client, ord.employee_id);

            // 3.1. Lấy thông tin nhân viên sale & cấu hình hoa hồng cá nhân
            let commissionRate = 5;
            let empDetails = null;
            if (assignedEmpId) {
                const empRateRes = await client.query(`
                    SELECT e.id, e.full_name, e.emp_code, e.manager_id,
                           COALESCE(e.commission_rate_wholesale, 5) AS rate_wholesale,
                           m.id AS mgr_id, m.full_name AS mgr_name, m.emp_code AS mgr_code, m.status AS mgr_status,
                           COALESCE(m.commission_rate_manager_wholesale, 2) AS mgr_rate_ws
                    FROM employees e
                    LEFT JOIN employees m ON e.manager_id = m.id
                    WHERE e.id = $1
                `, [assignedEmpId]);

                if (empRateRes.rows.length > 0) {
                    empDetails = empRateRes.rows[0];
                    commissionRate = parseFloat(empDetails.rate_wholesale) || 5;
                }
            }
            const commissionAmount = Math.round(grossProfit * (commissionRate / 100));

            // Kiểm tra trạng thái thanh toán
            const isFullyPaid = (parseFloat(ord.paid_amount) || 0) >= (parseFloat(ord.total_amount) || 0) && (parseFloat(ord.total_amount) || 0) > 0;
            const paidStatus = isFullyPaid ? 'ELIGIBLE' : 'PENDING';

            // 3.2. Đồng bộ Hoa hồng Trực tiếp của Sale (DIRECT)
            const checkExist = await client.query(
                "SELECT id, paid_status FROM sales_commissions WHERE ref_type = 'ORDER' AND ref_id = $1",
                [String(ord.id)]
            );

            if (checkExist.rows.length === 0) {
                await client.query(`
                    INSERT INTO sales_commissions (
                        employee_id, subordinate_id, commission_type, ref_type, ref_id, ref_code, customer_name,
                        revenue_amount, cogs_amount, gross_profit, commission_rate,
                        commission_amount, paid_status, notes
                    ) VALUES ($1, NULL, 'DIRECT', 'ORDER', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                `, [
                    assignedEmpId, String(ord.id), ord.order_code || ('DH-' + ord.id),
                    ord.customer_name || 'Khách hàng', rev, cogs, grossProfit, commissionRate,
                    commissionAmount, paidStatus, `Tự động tính ${commissionRate}% Lợi nhuận gộp Đơn sỉ`
                ]);
                syncedCount++;
            } else {
                if (checkExist.rows[0].paid_status === 'PENDING' && isFullyPaid) {
                    await client.query(
                        "UPDATE sales_commissions SET paid_status = 'ELIGIBLE', revenue_amount = $1, cogs_amount = $2, gross_profit = $3, commission_amount = $4, employee_id = COALESCE($5, employee_id) WHERE id = $6",
                        [rev, cogs, grossProfit, commissionAmount, assignedEmpId, checkExist.rows[0].id]
                    );
                }
            }

            // 3.3. KỊCH BẢN HOA HỒNG QUẢN LÝ CHO TRƯỞNG PHÒNG (MANAGER OVERRIDE COMMISSION)
            if (empDetails && empDetails.mgr_id && empDetails.mgr_status === 'ACTIVE') {
                const mgrRate = parseFloat(empDetails.mgr_rate_ws) || 0;
                if (mgrRate > 0) {
                    const mgrCommAmount = Math.round(grossProfit * (mgrRate / 100));
                    const checkMgrExist = await client.query(
                        "SELECT id, paid_status FROM sales_commissions WHERE ref_type = 'ORDER_MANAGER' AND ref_id = $1 AND employee_id = $2",
                        [String(ord.id), empDetails.mgr_id]
                    );

                    if (checkMgrExist.rows.length === 0) {
                        await client.query(`
                            INSERT INTO sales_commissions (
                                employee_id, subordinate_id, commission_type, ref_type, ref_id, ref_code, customer_name,
                                revenue_amount, cogs_amount, gross_profit, commission_rate,
                                commission_amount, paid_status, notes
                            ) VALUES ($1, $2, 'MANAGER_OVERRIDE', 'ORDER_MANAGER', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                        `, [
                            empDetails.mgr_id, assignedEmpId, String(ord.id), 'QL-' + (ord.order_code || ('DH-' + ord.id)),
                            ord.customer_name || 'Khách hàng', rev, cogs, grossProfit, mgrRate,
                            mgrCommAmount, paidStatus, `Hoa hồng Quản lý Trưởng phòng (${mgrRate}% LN gộp) - Đơn do NV ${empDetails.full_name} (${empDetails.emp_code}) chốt`
                        ]);
                        syncedCount++;
                    } else {
                        if (checkMgrExist.rows[0].paid_status === 'PENDING' && isFullyPaid) {
                            await client.query(
                                "UPDATE sales_commissions SET paid_status = 'ELIGIBLE', revenue_amount = $1, cogs_amount = $2, gross_profit = $3, commission_amount = $4, subordinate_id = $5 WHERE id = $6",
                                [rev, cogs, grossProfit, mgrCommAmount, assignedEmpId, checkMgrExist.rows[0].id]
                            );
                        }
                    }
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

// 4. Đồng bộ & Tự động tính hoa hồng từ BÁO GIÁ BOQ / HỢP ĐỒNG EPC (10% Lợi nhuận gộp & Hoa hồng Quản lý Trưởng phòng)
router.post('/sync-boq', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Lấy danh sách hợp đồng
        const contractsRes = await client.query(`
            SELECT c.*, o.employee_id AS order_employee_id
            FROM contracts c
            LEFT JOIN orders o ON c.order_id = o.id
            WHERE c.contract_status != 'CANCELLED'
        `);
        let syncedCount = 0;

        for (const c of contractsRes.rows) {
            const rev = parseFloat(c.total_value) || 0;
            // Dự án EPC: Giả định Giá vốn thiết bị & nhân công ~ 70% doanh thu
            const cogs = rev * 0.70;
            const grossProfit = Math.max(0, rev - cogs);
            
            const rawEmp = c.employee_id || c.order_employee_id || null;
            const assignedEmpId = await getOrCreateValidEmployeeId(client, rawEmp);

            // 4.1. Lấy thông tin sale & cấu hình hoa hồng BOQ
            let commissionRate = 10;
            let empDetails = null;
            if (assignedEmpId) {
                const empRateRes = await client.query(`
                    SELECT e.id, e.full_name, e.emp_code, e.manager_id,
                           COALESCE(e.commission_rate_boq, 10) AS rate_boq,
                           m.id AS mgr_id, m.full_name AS mgr_name, m.emp_code AS mgr_code, m.status AS mgr_status,
                           COALESCE(m.commission_rate_manager_boq, 3) AS mgr_rate_boq
                    FROM employees e
                    LEFT JOIN employees m ON e.manager_id = m.id
                    WHERE e.id = $1
                `, [assignedEmpId]);

                if (empRateRes.rows.length > 0) {
                    empDetails = empRateRes.rows[0];
                    commissionRate = parseFloat(empDetails.rate_boq) || 10;
                }
            }
            const commissionAmount = Math.round(grossProfit * (commissionRate / 100));

            const isPaid = (parseFloat(c.paid_amount) || 0) >= rev && rev > 0;
            const paidStatus = isPaid ? 'ELIGIBLE' : (parseFloat(c.paid_amount) > 0 ? 'ELIGIBLE' : 'PENDING');

            // 4.2. Đồng bộ Hoa hồng Trực tiếp BOQ
            const checkExist = await client.query(
                "SELECT id, paid_status FROM sales_commissions WHERE ref_type = 'CONTRACT' AND ref_id = $1",
                [String(c.id)]
            );

            if (checkExist.rows.length === 0) {
                await client.query(`
                    INSERT INTO sales_commissions (
                        employee_id, subordinate_id, commission_type, ref_type, ref_id, ref_code, customer_name,
                        revenue_amount, cogs_amount, gross_profit, commission_rate,
                        commission_amount, paid_status, notes
                    ) VALUES ($1, NULL, 'DIRECT', 'CONTRACT', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                `, [
                    assignedEmpId, String(c.id), c.contract_code || ('HD-' + c.id),
                    c.customer_name || 'Khách hàng dự án', rev, cogs, grossProfit, commissionRate,
                    commissionAmount, paidStatus, `Tự động tính ${commissionRate}% Lợi nhuận gộp Báo giá BOQ / EPC`
                ]);
                syncedCount++;
            } else {
                if (checkExist.rows[0].paid_status === 'PENDING' && isPaid) {
                    await client.query(
                        "UPDATE sales_commissions SET paid_status = 'ELIGIBLE', revenue_amount = $1, cogs_amount = $2, gross_profit = $3, commission_amount = $4, employee_id = COALESCE($5, employee_id) WHERE id = $6",
                        [rev, cogs, grossProfit, commissionAmount, assignedEmpId, checkExist.rows[0].id]
                    );
                }
            }

            // 4.3. KỊCH BẢN HOA HỒNG QUẢN LÝ BOQ CHO TRƯỞNG PHÒNG
            if (empDetails && empDetails.mgr_id && empDetails.mgr_status === 'ACTIVE') {
                const mgrBoqRate = parseFloat(empDetails.mgr_rate_boq) || 0;
                if (mgrBoqRate > 0) {
                    const mgrBoqCommAmount = Math.round(grossProfit * (mgrBoqRate / 100));
                    const checkMgrExist = await client.query(
                        "SELECT id, paid_status FROM sales_commissions WHERE ref_type = 'CONTRACT_MANAGER' AND ref_id = $1 AND employee_id = $2",
                        [String(c.id), empDetails.mgr_id]
                    );

                    if (checkMgrExist.rows.length === 0) {
                        await client.query(`
                            INSERT INTO sales_commissions (
                                employee_id, subordinate_id, commission_type, ref_type, ref_id, ref_code, customer_name,
                                revenue_amount, cogs_amount, gross_profit, commission_rate,
                                commission_amount, paid_status, notes
                            ) VALUES ($1, $2, 'MANAGER_OVERRIDE', 'CONTRACT_MANAGER', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                        `, [
                            empDetails.mgr_id, assignedEmpId, String(c.id), 'QL-' + (c.contract_code || ('HD-' + c.id)),
                            c.customer_name || 'Khách hàng dự án', rev, cogs, grossProfit, mgrBoqRate,
                            mgrBoqCommAmount, paidStatus, `Hoa hồng Quản lý Trưởng phòng (${mgrBoqRate}% LN gộp) - Báo giá BOQ do NV ${empDetails.full_name} (${empDetails.emp_code}) chốt`
                        ]);
                        syncedCount++;
                    } else {
                        if (checkMgrExist.rows[0].paid_status === 'PENDING' && isPaid) {
                            await client.query(
                                "UPDATE sales_commissions SET paid_status = 'ELIGIBLE', revenue_amount = $1, cogs_amount = $2, gross_profit = $3, commission_amount = $4, subordinate_id = $5 WHERE id = $6",
                                [rev, cogs, grossProfit, mgrBoqCommAmount, assignedEmpId, checkMgrExist.rows[0].id]
                            );
                        }
                    }
                }
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

// 5. Thêm hoa hồng thủ công
router.post('/', async (req, res) => {
    try {
        const {
            employee_id, subordinate_id, commission_type, ref_type, ref_id, ref_code, customer_name,
            revenue_amount, cogs_amount, gross_profit, commission_rate,
            commission_amount, paid_status, notes
        } = req.body;

        const finalEmpId = await getOrCreateValidEmployeeId(pool, employee_id);

        const rev = parseFloat(revenue_amount) || 0;
        const cogs = parseFloat(cogs_amount) || 0;
        const gp = parseFloat(gross_profit) !== undefined && !isNaN(parseFloat(gross_profit)) ? parseFloat(gross_profit) : Math.max(0, rev - cogs);
        const rate = parseFloat(commission_rate) || 5;
        const commAmt = parseFloat(commission_amount) !== undefined && !isNaN(parseFloat(commission_amount)) ? parseFloat(commission_amount) : Math.round(gp * (rate / 100));

        const result = await pool.query(`
            INSERT INTO sales_commissions (
                employee_id, subordinate_id, commission_type, ref_type, ref_id, ref_code, customer_name,
                revenue_amount, cogs_amount, gross_profit, commission_rate,
                commission_amount, paid_status, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING *
        `, [
            finalEmpId, subordinate_id || null, commission_type || 'DIRECT', ref_type || 'MANUAL', ref_id || ('REF-' + Date.now()),
            ref_code || ('HH-' + Math.floor(Date.now() / 1000)), customer_name || '',
            rev, cogs, gp, rate, commAmt, paid_status || 'ELIGIBLE', notes || ''
        ]);

        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. Cập nhật trạng thái hoa hồng (Duyệt chi / Chuyển sang Đủ điều kiện / Đã chi)
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
        if (employee_id !== undefined && employee_id !== null && String(employee_id).trim() !== '') {
            const validEmpId = await getOrCreateValidEmployeeId(pool, employee_id);
            if (validEmpId) {
                params.push(validEmpId);
                query += `, employee_id = $${params.length}`;
            }
        }

        params.push(id);
        query += ` WHERE id = $${params.length} RETURNING *`;

        const result = await pool.query(query, params);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy bản ghi hoa hồng' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 7. Xóa bản ghi hoa hồng
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("DELETE FROM sales_commissions WHERE id = $1", [id]);
        res.json({ success: true, message: 'Đã xóa bản ghi hoa hồng thành công' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
