const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Lấy danh sách các kỳ bảng lương
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.*,
                   COUNT(pi.id) AS total_staff_count
            FROM payrolls p
            LEFT JOIN payroll_items pi ON p.id = pi.payroll_id
            GROUP BY p.id
            ORDER BY p.period_key DESC
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('Lỗi lấy danh sách bảng lương:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Lấy chi tiết bảng lương của 1 kỳ cụ thể (VD: '2026-08')
router.get('/:period', async (req, res) => {
    try {
        const { period } = req.params;
        const payrollRes = await pool.query("SELECT * FROM payrolls WHERE period_key = $1", [period]);
        if (payrollRes.rows.length === 0) {
            return res.json({ success: true, exists: false, data: null, items: [] });
        }

        const payroll = payrollRes.rows[0];
        const itemsRes = await pool.query(`
            SELECT pi.*,
                   e.emp_code,
                   e.full_name,
                   e.position,
                   e.phone,
                   e.bank_account_no,
                   e.bank_name,
                   e.bank_branch,
                   e.insurance_salary,
                   d.dept_name,
                   d.dept_code
            FROM payroll_items pi
            JOIN employees e ON pi.employee_id = e.id
            LEFT JOIN departments d ON e.department_id = d.id
            WHERE pi.payroll_id = $1
            ORDER BY e.id ASC
        `, [payroll.id]);

        res.json({
            success: true,
            exists: true,
            data: payroll,
            items: itemsRes.rows
        });
    } catch (err) {
        console.error('Lỗi lấy chi tiết bảng lương:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Tự động Khởi tạo / Tính toán Bảng Lương tháng
router.post('/generate', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { period_key, standard_working_days = 26 } = req.body;

        if (!period_key) {
            return res.status(400).json({ success: false, error: 'Thiếu kỳ lương (period_key YYYY-MM)' });
        }

        // 1. Kiểm tra hoặc tạo header bảng lương
        let payrollId;
        const existPayroll = await client.query("SELECT id, status FROM payrolls WHERE period_key = $1", [period_key]);
        if (existPayroll.rows.length > 0) {
            if (existPayroll.rows[0].status === 'PAID') {
                return res.status(400).json({ success: false, error: 'Bảng lương kỳ này đã được CHI TRẢ, không thể tính lại!' });
            }
            payrollId = existPayroll.rows[0].id;
        } else {
            const newPayroll = await client.query(
                "INSERT INTO payrolls (period_key, standard_working_days, status) VALUES ($1, $2, 'DRAFT') RETURNING id",
                [period_key, standard_working_days]
            );
            payrollId = newPayroll.rows[0].id;
        }

        // 2. Lấy cấu hình tỷ lệ bảo hiểm xã hội hiện hành
        let insPol = {
            rate_bhxh_emp: 8.0, rate_bhyt_emp: 1.5, rate_bhtn_emp: 1.0,
            rate_bhxh_comp: 17.5, rate_bhyt_comp: 3.0, rate_bhtn_comp: 1.0, rate_kpcd_comp: 2.0
        };
        try {
            const insPolRes = await client.query("SELECT * FROM insurance_policies WHERE id = 1");
            if (insPolRes.rows.length > 0) {
                insPol = insPolRes.rows[0];
            }
        } catch(insErr) {
            console.warn("⚠️ Không thể đọc insurance_policies, sử dụng tỷ lệ mặc định:", insErr.message);
        }

        // 3. Lấy toàn bộ nhân sự đang làm việc (ACTIVE)
        const employeesRes = await client.query(`
            SELECT e.*, 
                   ins.has_bhxh, ins.has_bhyt, ins.has_bhtn, ins.has_kpcd, ins.status AS ins_status
            FROM employees e
            LEFT JOIN employee_insurances ins ON e.id = ins.employee_id
            WHERE e.status = 'ACTIVE'
            ORDER BY e.id ASC
        `);

        let grandGross = 0;
        let grandCommission = 0;
        let grandCommissionRetained = 0;
        let grandAllowance = 0;
        let grandBonus = 0;
        let grandInsEmp = 0;
        let grandInsComp = 0;
        let grandAdvance = 0;
        let grandNet = 0;

        for (const emp of employeesRes.rows) {
            // 0. Tích hợp Dữ Liệu Chấm Công & Thưởng Chuyên Cần / Phạt Đi Trễ
            const attRes = await client.query(
                "SELECT * FROM attendance_monthly_summary WHERE period_key = $1 AND employee_id = $2",
                [period_key, emp.id]
            );
            let actualDays = standard_working_days;
            let paidLeaveDays = 0;
            let unpaidLeaveDays = 0;
            let attendanceBonus = 0;
            let attendancePenalty = 0;

            if (attRes.rows.length > 0) {
                const att = attRes.rows[0];
                actualDays = parseFloat(att.total_actual_days) || 0;
                paidLeaveDays = parseFloat(att.total_paid_leave_days) || 0;
                unpaidLeaveDays = parseFloat(att.total_unpaid_leave_days) || 0;
                attendanceBonus = parseFloat(att.total_bonus_amount) || ((parseFloat(att.attendance_bonus_amount) || 0) + (parseFloat(att.punctual_bonus_amount) || 0) + (parseFloat(att.ot_bonus_amount) || 0));
                attendancePenalty = parseFloat(att.total_attendance_penalty) || 0;
            }

            const baseSalary = parseFloat(emp.base_salary) || 0;
            // Ngày tính lương = Ngày làm thực tế + Ngày nghỉ phép hưởng lương (paid_leave_days)
            const payableDays = Math.min(standard_working_days, actualDays + paidLeaveDays);
            const salaryByDays = Math.round((baseSalary / standard_working_days) * payableDays);

            // Phụ cấp mặc định
            const mealAllowance = 730000;
            const phoneGasAllowance = emp.position.includes('Kinh Doanh') || emp.position.includes('Sale') ? 500000 : 300000;
            const respAllowance = emp.position.includes('Trưởng') || emp.position.includes('Giám Đốc') ? 1500000 : 0;
            const totalAllowance = mealAllowance + phoneGasAllowance + respAllowance;

            // 1. Kéo hoa hồng ĐỦ ĐIỀU KIỆN (ELIGIBLE) chỉ tính trên PHẦN VƯỢT ĐIỂM HÒA VỐN (Marginal Break-Even Threshold)
            // 1.1. Hoa hồng bán hàng trực tiếp của cá nhân:
            const directGpRes = await client.query(
                "SELECT COALESCE(SUM(gross_profit), 0) AS direct_gp, COALESCE(SUM(commission_amount), 0) AS raw_direct_comm FROM sales_commissions WHERE employee_id = $1 AND commission_type = 'DIRECT' AND paid_status = 'ELIGIBLE'",
                [emp.id]
            );
            const directGp = parseFloat(directGpRes.rows[0].direct_gp) || 0;
            const rawDirectComm = parseFloat(directGpRes.rows[0].raw_direct_comm) || 0;
            const minThreshold = parseFloat(emp.min_gross_profit_threshold) || 0;

            let effectiveDirectComm = 0;
            if (directGp > 0) {
                if (minThreshold === 0) {
                    effectiveDirectComm = rawDirectComm;
                } else if (directGp > minThreshold) {
                    const excessRatio = (directGp - minThreshold) / directGp;
                    effectiveDirectComm = Math.round(rawDirectComm * excessRatio);
                }
            }

            // 1.2. Hoa hồng quản lý đội nhóm (hưởng trên phần vượt điểm hòa vốn của từng cấp dưới):
            let effectiveMgrComm = 0;
            const mgrCommsRes = await client.query(
                `SELECT sc.id, sc.subordinate_id, sc.commission_amount, sc.gross_profit,
                        sub.min_gross_profit_threshold AS sub_threshold,
                        COALESCE((
                            SELECT SUM(sub_sc.gross_profit)
                            FROM sales_commissions sub_sc
                            WHERE sub_sc.employee_id = sc.subordinate_id
                              AND sub_sc.commission_type = 'DIRECT'
                              AND sub_sc.paid_status = 'ELIGIBLE'
                        ), 0) AS sub_total_direct_gp
                 FROM sales_commissions sc
                 JOIN employees sub ON sc.subordinate_id = sub.id
                 WHERE sc.employee_id = $1
                   AND sc.commission_type = 'MANAGER_OVERRIDE'
                   AND sc.paid_status = 'ELIGIBLE'`,
                [emp.id]
            );

            for (const mc of mgrCommsRes.rows) {
                const subTotalGp = parseFloat(mc.sub_total_direct_gp) || 0;
                const subThreshold = parseFloat(mc.sub_threshold) || 0;
                const rawSubMgrComm = parseFloat(mc.commission_amount) || 0;

                if (subTotalGp > 0) {
                    if (subThreshold === 0) {
                        effectiveMgrComm += rawSubMgrComm;
                    } else if (subTotalGp > subThreshold) {
                        const subExcessRatio = (subTotalGp - subThreshold) / subTotalGp;
                        effectiveMgrComm += Math.round(rawSubMgrComm * subExcessRatio);
                    }
                }
            }

            const totalCommission = effectiveDirectComm + effectiveMgrComm;

            if (totalCommission > 0 || (rawDirectComm > 0 || mgrCommsRes.rows.length > 0)) {
                await client.query(
                    "UPDATE sales_commissions SET paid_status = 'INCLUDED_PAYROLL', payroll_period = $1 WHERE employee_id = $2 AND paid_status = 'ELIGIBLE'",
                    [period_key, emp.id]
                );
            }

            // 1.3. Hoa hồng KPI xử lý xuất kho (Warehouse Outbound Commission)
            let warehouseCommission = 0;
            const whStartDate = `${period_key}-01 00:00:00`;
            const whParts = period_key.split('-');
            const whLastDay = new Date(parseInt(whParts[0]), parseInt(whParts[1]), 0).getDate();
            const whEndDate = `${period_key}-${String(whLastDay).padStart(2, '0')} 23:59:59`;

            const whOrdRes = await client.query(`
                SELECT COUNT(id) AS dispatched_count,
                       COALESCE(SUM(COALESCE(NULLIF(regexp_replace(gross_profit::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)), 0) AS total_gross_profit
                FROM orders
                WHERE dispatched_by = $1
                  AND status IN ('SHIPPED', 'COMPLETED')
                  AND COALESCE(dispatched_at, created_at) >= $2
                  AND COALESCE(dispatched_at, created_at) <= $3
            `, [emp.id, whStartDate, whEndDate]);

            const whDispatchedCount = parseInt(whOrdRes.rows[0]?.dispatched_count, 10) || 0;
            const whTotalGp = Math.max(0, parseFloat(whOrdRes.rows[0]?.total_gross_profit) || 0);

            if (whDispatchedCount > 0) {
                const whPolRes = await client.query("SELECT * FROM warehouse_kpi_policies WHERE id = 1 LIMIT 1");
                const whPol = whPolRes.rows[0] || { rate_per_order: 20000, profit_percent: 0, min_orders_threshold: 0, bonus_target_orders: 50, bonus_tier_amount: 500000 };
                const whRate = parseFloat(whPol.rate_per_order) || 0;
                const whProfitPercent = parseFloat(whPol.profit_percent) || 0;
                const whMinThresh = parseInt(whPol.min_orders_threshold, 10) || 0;
                const whEligibleCount = Math.max(0, whDispatchedCount - whMinThresh);

                const fixedComm = whEligibleCount * whRate;
                const profitComm = Math.round(whTotalGp * (whProfitPercent / 100));
                warehouseCommission = fixedComm + profitComm;

                if (whPol.bonus_target_orders > 0 && whDispatchedCount >= whPol.bonus_target_orders) {
                    warehouseCommission += (parseFloat(whPol.bonus_tier_amount) || 0);
                }
            }

            const combinedCommission = totalCommission + warehouseCommission;

            // 1.4. CƠ CHẾ HOA HỒNG BIẾN ĐỔI: 70% THỰC LĨNH THÁNG & 30% TÍCH LŨY QUỸ TẾT CUỐI NĂM
            const retentionRate = emp.commission_retention_rate !== null && emp.commission_retention_rate !== undefined 
                ? parseFloat(emp.commission_retention_rate) 
                : 30;
            
            const commissionRetained = Math.round(combinedCommission * (retentionRate / 100));
            const commissionPaid = combinedCommission - commissionRetained;

            // Tính lũy kế quỹ thưởng Tết của nhân viên từ đầu năm đến kỳ hiện tại
            const curYear = period_key.split('-')[0];
            const prevRetainedRes = await client.query(`
                SELECT COALESCE(SUM(pi.commission_retained), 0) AS prev_retained
                FROM payroll_items pi
                JOIN payrolls p ON pi.payroll_id = p.id
                WHERE pi.employee_id = $1
                  AND p.period_key LIKE $2
                  AND p.period_key < $3
            `, [emp.id, `${curYear}-%`, period_key]);
            
            const prevRetained = parseFloat(prevRetainedRes.rows[0]?.prev_retained) || 0;
            const cumulativeRetainedBonus = prevRetained + commissionRetained;

            // 2. Kéo Thưởng / Phạt KPI Thu Hồi Công Nợ (Debt KPI Incentive Tiered Bonus)
            const debtKpiRes = await client.query(
                "SELECT reward_penalty_amount, notes FROM debt_kpi_evaluations WHERE period_key = $1 AND employee_id = $2",
                [period_key, emp.id]
            );
            let kpiBonus = 0;
            let kpiPenalty = 0;
            if (debtKpiRes.rows.length > 0) {
                const kpiAmt = parseFloat(debtKpiRes.rows[0].reward_penalty_amount) || 0;
                if (kpiAmt > 0) {
                    kpiBonus = kpiAmt;
                } else if (kpiAmt < 0) {
                    kpiPenalty = Math.abs(kpiAmt);
                }
                await client.query(
                    "UPDATE debt_kpi_evaluations SET status = 'APPLIED_PAYROLL' WHERE period_key = $1 AND employee_id = $2",
                    [period_key, emp.id]
                );
            }

            // Tổng Thưởng (KPI nợ + Thưởng chuyên cần) & Tổng Phạt (Kỷ luật nợ + Phạt đi trễ / vắng mặt)
            const totalBonus = kpiBonus + attendanceBonus;
            const totalPenalty = kpiPenalty + attendancePenalty;

            // 3. Tổng Thu Nhập Trước Khấu Trừ (Gross Income): Chỉ cộng hoa hồng thực chi trong tháng (70%)
            const grossIncome = salaryByDays + totalAllowance + commissionPaid + totalBonus;

            // Tính Bảo hiểm
            let insBhxhEmp = 0, insBhytEmp = 0, insBhtnEmp = 0;
            let insBhxhComp = 0, insBhytComp = 0, insBhtnComp = 0, insKpcdComp = 0;

            const isInsActive = emp.ins_status === 'DANG_DONG' && emp.contract_type !== 'THU_VIEC' && emp.contract_type !== 'CTV';
            const insSalary = parseFloat(emp.insurance_salary) || (baseSalary > 0 ? baseSalary : 5000000);

            if (isInsActive && insSalary > 0) {
                if (emp.has_bhxh !== false) {
                    insBhxhEmp = Math.round(insSalary * (parseFloat(insPol.rate_bhxh_emp) || 8.0) / 100);
                    insBhxhComp = Math.round(insSalary * (parseFloat(insPol.rate_bhxh_comp) || 17.5) / 100);
                }
                if (emp.has_bhyt !== false) {
                    insBhytEmp = Math.round(insSalary * (parseFloat(insPol.rate_bhyt_emp) || 1.5) / 100);
                    insBhytComp = Math.round(insSalary * (parseFloat(insPol.rate_bhyt_comp) || 3.0) / 100);
                }
                if (emp.has_bhtn !== false) {
                    insBhtnEmp = Math.round(insSalary * (parseFloat(insPol.rate_bhtn_emp) || 1.0) / 100);
                    insBhtnComp = Math.round(insSalary * (parseFloat(insPol.rate_bhtn_comp) || 1.0) / 100);
                }
                if (emp.has_kpcd !== false) {
                    insKpcdComp = Math.round(insSalary * (parseFloat(insPol.rate_kpcd_comp) || 2.0) / 100);
                }
            }

            const totalInsEmp = insBhxhEmp + insBhytEmp + insBhtnEmp;
            const totalInsComp = insBhxhComp + insBhytComp + insBhtnComp + insKpcdComp;

            const advanceAmount = 0;
            const taxAmount = 0;
            const netSalary = Math.max(0, grossIncome - totalInsEmp - advanceAmount - totalPenalty - taxAmount);

            grandGross += grossIncome;
            grandCommission += combinedCommission;
            grandCommissionRetained += commissionRetained;
            grandAllowance += totalAllowance;
            grandBonus += totalBonus;
            grandInsEmp += totalInsEmp;
            grandInsComp += totalInsComp;
            grandNet += netSalary;

            // Kiểm tra xem đã có item cho nhân viên này chưa
            const checkItem = await client.query(
                "SELECT id FROM payroll_items WHERE payroll_id = $1 AND employee_id = $2",
                [payrollId, emp.id]
            );

            if (checkItem.rows.length === 0) {
                await client.query(`
                    INSERT INTO payroll_items (
                        payroll_id, employee_id, actual_working_days, paid_leave_days, unpaid_leave_days,
                        base_salary, salary_by_days, allowance_meal, allowance_phone_gas, allowance_responsibility,
                        total_commission, warehouse_commission, commission_rate_retained, commission_retained, commission_paid, cumulative_retained_bonus,
                        bonus_amount, gross_income,
                        ins_bhxh_emp, ins_bhyt_emp, ins_bhtn_emp, total_ins_emp,
                        ins_bhxh_comp, ins_bhyt_comp, ins_bhtn_comp, ins_kpcd_comp, total_ins_comp,
                        advance_amount, deduction_penalty, personal_tax, net_salary, payment_status
                    ) VALUES (
                        $1, $2, $3, $4, $5,
                        $6, $7, $8, $9, $10,
                        $11, $12, $13, $14, $15, $16,
                        $17, $18,
                        $19, $20, $21, $22,
                        $23, $24, $25, $26, $27,
                        $28, $29, $30, $31, 'UNPAID'
                    )
                `, [
                    payrollId, emp.id, actualDays, paidLeaveDays, unpaidLeaveDays,
                    baseSalary, salaryByDays, mealAllowance, phoneGasAllowance, respAllowance,
                    combinedCommission, warehouseCommission, retentionRate, commissionRetained, commissionPaid, cumulativeRetainedBonus,
                    totalBonus, grossIncome,
                    insBhxhEmp, insBhytEmp, insBhtnEmp, totalInsEmp,
                    insBhxhComp, insBhytComp, insBhtnComp, insKpcdComp, totalInsComp,
                    advanceAmount, totalPenalty, taxAmount, netSalary
                ]);
            } else {
                await client.query(`
                    UPDATE payroll_items SET
                        actual_working_days = $1, paid_leave_days = $2, unpaid_leave_days = $3,
                        base_salary = $4, salary_by_days = $5,
                        allowance_meal = $6, allowance_phone_gas = $7, allowance_responsibility = $8,
                        total_commission = $9, warehouse_commission = $10,
                        commission_rate_retained = $11, commission_retained = $12, commission_paid = $13, cumulative_retained_bonus = $14,
                        bonus_amount = $15, deduction_penalty = $16, gross_income = $17,
                        ins_bhxh_emp = $18, ins_bhyt_emp = $19, ins_bhtn_emp = $20, total_ins_emp = $21,
                        ins_bhxh_comp = $22, ins_bhyt_comp = $23, ins_bhtn_comp = $24, ins_kpcd_comp = $25, total_ins_comp = $26,
                        net_salary = $27
                    WHERE id = $28
                `, [
                    actualDays, paidLeaveDays, unpaidLeaveDays,
                    baseSalary, salaryByDays,
                    mealAllowance, phoneGasAllowance, respAllowance,
                    combinedCommission, warehouseCommission,
                    retentionRate, commissionRetained, commissionPaid, cumulativeRetainedBonus,
                    totalBonus, totalPenalty, grossIncome,
                    insBhxhEmp, insBhytEmp, insBhtnEmp, totalInsEmp,
                    insBhxhComp, insBhytComp, insBhtnComp, insKpcdComp, totalInsComp,
                    netSalary, checkItem.rows[0].id
                ]);
            }
        }

        // Cập nhật tổng header bảng lương
        await client.query(`
            UPDATE payrolls SET
                total_gross_salary = $1,
                total_commission = $2,
                total_commission_retained = $3,
                total_allowance = $4,
                total_bonus = $5,
                total_insurance_emp = $6,
                total_insurance_comp = $7,
                total_advance = $8,
                total_net_salary = $9
            WHERE id = $10
        `, [
            grandGross, grandCommission, grandCommissionRetained, grandAllowance, grandBonus,
            grandInsEmp, grandInsComp, grandAdvance, grandNet, payrollId
        ]);

        await client.query('COMMIT');
        res.json({ success: true, message: `Khởi tạo bảng lương kỳ ${period_key} thành công!`, payrollId });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Lỗi khởi tạo bảng lương:', err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// Cập nhật chi tiết 1 dòng phiếu lương nhân viên
router.put('/item/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const {
            actual_working_days, paid_leave_days, unpaid_leave_days,
            allowance_meal, allowance_phone_gas, allowance_responsibility,
            bonus_amount, advance_amount, deduction_penalty, personal_tax
        } = req.body;

        const currentItemRes = await client.query("SELECT * FROM payroll_items WHERE id = $1", [id]);
        if (currentItemRes.rows.length === 0) throw new Error('Không tìm thấy dòng phiếu lương');
        const item = currentItemRes.rows[0];

        const days = parseFloat(actual_working_days) || 0;
        const baseSal = parseFloat(item.base_salary) || 0;
        const salaryByDays = Math.round((baseSal / 26) * days);

        const meal = parseFloat(allowance_meal) !== undefined ? parseFloat(allowance_meal) : parseFloat(item.allowance_meal);
        const phoneGas = parseFloat(allowance_phone_gas) !== undefined ? parseFloat(allowance_phone_gas) : parseFloat(item.allowance_phone_gas);
        const resp = parseFloat(allowance_responsibility) !== undefined ? parseFloat(allowance_responsibility) : parseFloat(item.allowance_responsibility);
        const commPaid = item.commission_paid !== null && item.commission_paid !== undefined
            ? parseFloat(item.commission_paid)
            : (parseFloat(item.total_commission) * 0.7);
        const bonus = parseFloat(bonus_amount) !== undefined ? parseFloat(bonus_amount) : parseFloat(item.bonus_amount);
        const grossIncome = salaryByDays + totalAllowance + commPaid + bonus;

        const totalInsEmp = parseFloat(item.total_ins_emp) || 0;
        const advance = parseFloat(advance_amount) !== undefined ? parseFloat(advance_amount) : parseFloat(item.advance_amount);
        const penalty = parseFloat(deduction_penalty) !== undefined ? parseFloat(deduction_penalty) : parseFloat(item.deduction_penalty);
        const tax = parseFloat(personal_tax) !== undefined ? parseFloat(personal_tax) : parseFloat(item.personal_tax);

        const netSalary = Math.max(0, grossIncome - totalInsEmp - advance - penalty - tax);

        await client.query(`
            UPDATE payroll_items SET
                actual_working_days = $1, paid_leave_days = $2, unpaid_leave_days = $3,
                salary_by_days = $4, allowance_meal = $5, allowance_phone_gas = $6, allowance_responsibility = $7,
                bonus_amount = $8, gross_income = $9, advance_amount = $10, deduction_penalty = $11,
                personal_tax = $12, net_salary = $13
            WHERE id = $14
        `, [
            days, parseFloat(paid_leave_days) || 0, parseFloat(unpaid_leave_days) || 0,
            salaryByDays, meal, phoneGas, resp,
            bonus, grossIncome, advance, penalty,
            tax, netSalary, id
        ]);

        // Cập nhật lại tổng header bảng lương
        await client.query(`
            UPDATE payrolls SET
                total_gross_salary = (SELECT COALESCE(SUM(gross_income),0) FROM payroll_items WHERE payroll_id = $1),
                total_commission = (SELECT COALESCE(SUM(total_commission),0) FROM payroll_items WHERE payroll_id = $1),
                total_allowance = (SELECT COALESCE(SUM(allowance_meal + allowance_phone_gas + allowance_responsibility),0) FROM payroll_items WHERE payroll_id = $1),
                total_bonus = (SELECT COALESCE(SUM(bonus_amount),0) FROM payroll_items WHERE payroll_id = $1),
                total_advance = (SELECT COALESCE(SUM(advance_amount),0) FROM payroll_items WHERE payroll_id = $1),
                total_net_salary = (SELECT COALESCE(SUM(net_salary),0) FROM payroll_items WHERE payroll_id = $1)
            WHERE id = $1
        `, [item.payroll_id]);

        await client.query('COMMIT');
        res.json({ success: true, message: 'Đã cập nhật phiếu lương thành công!' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// Duyệt Chi Bảng Lương -> Hạch toán tự động vào Sổ Quỹ và Chi Phí
router.post('/:period/approve', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { period } = req.params;
        const { approved_by = 'ADMIN', notes = '' } = req.body;

        const payrollRes = await client.query("SELECT * FROM payrolls WHERE period_key = $1", [period]);
        if (payrollRes.rows.length === 0) throw new Error('Không tìm thấy bảng lương');
        const payroll = payrollRes.rows[0];

        if (payroll.status === 'PAID') {
            return res.json({ success: true, message: 'Bảng lương này đã được duyệt chi từ trước!' });
        }

        const netAmount = parseFloat(payroll.total_net_salary) || 0;
        const grossAmount = parseFloat(payroll.total_gross_salary) || 0;
        const compInsAmount = parseFloat(payroll.total_insurance_comp) || 0;

        // 1. Cập nhật trạng thái bảng lương
        await client.query(`
            UPDATE payrolls SET
                status = 'PAID',
                approved_by = $1,
                approved_at = NOW(),
                notes = $2
            WHERE id = $3
        `, [approved_by, notes, payroll.id]);

        // Cập nhật trạng thái từng item
        await client.query("UPDATE payroll_items SET payment_status = 'PAID' WHERE payroll_id = $1", [payroll.id]);

        // 2. Hạch toán Phiếu Chi vào Sổ Quỹ Tiền Mặt (cash_transactions)
        const cashCode = 'PC-LUONG-' + period.replace('-', '');
        await client.query(`
            INSERT INTO cash_transactions (code, type, target_name, amount, notes)
            VALUES ($1, 'CHI', $2, $3, $4)
        `, [
            cashCode, 'Toàn thể Cán bộ Nhân viên', netAmount,
            `Chi trả lương thực lĩnh tháng ${period} theo Bảng Lương duyệt bởi ${approved_by}`
        ]);

        // 3. Ghi nhận Chi phí vào bảng expenses (Chi phí lương & Chi phí bảo hiểm)
        await client.query(`
            INSERT INTO expenses (
                expense_date, category, description, vendor_name, amount_before_tax, total_amount
            ) VALUES 
            (CURRENT_DATE, 'LƯƠNG & NHÂN SỰ', $1, 'SUNGO ERP Payroll', $2, $2),
            (CURRENT_DATE, 'BẢO HIỂM DOANH NGHIỆP', $3, 'Cơ quan BHXH', $4, $4)
        `, [
            `Chi phí quỹ lương tổng hợp tháng ${period}`, grossAmount,
            `Chi phí BHXH + BHYT + BHTN + KPCĐ Doanh nghiệp chịu tháng ${period}`, compInsAmount
        ]);

        // 4. Chốt toàn bộ hoa hồng liên quan sang trạng thái PAID
        await client.query(
            "UPDATE sales_commissions SET paid_status = 'PAID' WHERE payroll_period = $1",
            [period]
        );

        await client.query('COMMIT');
        res.json({
            success: true,
            message: `Đã duyệt chi bảng lương tháng ${period} thành công! Đã hạch toán ${netAmount.toLocaleString('vi-VN')} đ vào Sổ Quỹ.`,
            cashCode
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Lỗi duyệt chi bảng lương:', err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// ====================================================================
// QUỸ THƯỞNG CUỐI NĂM & THƯỞNG TẾT (YEAR-END RETENTION & PROFIT SHARING)
// ====================================================================

// 1. Lấy báo cáo Quỹ Thưởng Tết Cuối Năm
router.get('/year-end/:year', async (req, res) => {
    try {
        const year = parseInt(req.params.year, 10) || new Date().getFullYear();
        const startDate = `${year}-01-01 00:00:00`;
        const endDate = `${year}-12-31 23:59:59`;

        // Lấy hoặc khởi tạo chính sách năm
        let polRes = await pool.query("SELECT * FROM year_end_bonus_policies WHERE year = $1", [year]);
        if (polRes.rows.length === 0) {
            await pool.query(`
                INSERT INTO year_end_bonus_policies (year, target_gross_profit, profit_sharing_percent, status, notes)
                VALUES ($1, 10000000000, 10.0, 'ACTIVE', 'Chính sách thưởng năm ' || $1)
                ON CONFLICT (year) DO NOTHING
            `, [year]);
            polRes = await pool.query("SELECT * FROM year_end_bonus_policies WHERE year = $1", [year]);
        }
        const policy = polRes.rows[0];
        const targetGp = parseFloat(policy.target_gross_profit) || 0;
        const sharingPct = parseFloat(policy.profit_sharing_percent) || 0;

        // Lấy tổng doanh thu & lợi nhuận gộp thực tế của công ty trong năm
        const compActualRes = await pool.query(`
            SELECT 
                COALESCE(SUM(COALESCE(NULLIF(regexp_replace(total_amount::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)), 0) AS actual_revenue,
                COALESCE(SUM(COALESCE(NULLIF(regexp_replace(gross_profit::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)), 0) AS actual_gross_profit
            FROM orders
            WHERE status IN ('SHIPPED', 'COMPLETED')
              AND COALESCE(dispatched_at, created_at) >= $1
              AND COALESCE(dispatched_at, created_at) <= $2
        `, [startDate, endDate]);

        const actualRevenue = parseFloat(compActualRes.rows[0]?.actual_revenue) || 0;
        const actualGrossProfit = parseFloat(compActualRes.rows[0]?.actual_gross_profit) || 0;

        const excessGp = Math.max(0, actualGrossProfit - targetGp);
        const profitSharingPool = Math.round(excessGp * (sharingPct / 100));

        // Lấy dữ liệu từng nhân viên
        const empRes = await pool.query(`
            SELECT 
                e.id AS employee_id,
                e.emp_code,
                e.full_name,
                e.position,
                d.dept_name,
                COALESCE(e.commission_retention_rate, 30) AS retention_rate,
                COALESCE(SUM(pi.total_commission), 0) AS total_commission_earned,
                COALESCE(SUM(pi.commission_paid), 0) AS total_commission_paid,
                COALESCE(SUM(pi.commission_retained), 0) AS total_retained_pool,
                COALESCE((
                    SELECT SUM(sc.gross_profit)
                    FROM sales_commissions sc
                    WHERE sc.employee_id = e.id
                      AND sc.created_at >= $1
                      AND sc.created_at <= $2
                ), 0) AS employee_gross_profit
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.id
            LEFT JOIN payroll_items pi ON e.id = pi.employee_id
            LEFT JOIN payrolls p ON pi.payroll_id = p.id AND p.period_key LIKE $3
            WHERE e.status = 'ACTIVE'
            GROUP BY e.id, e.emp_code, e.full_name, e.position, d.dept_name, e.commission_retention_rate
            ORDER BY total_retained_pool DESC, e.id ASC
        `, [startDate, endDate, `${year}-%`]);

        const totalEmpGp = empRes.rows.reduce((sum, r) => sum + (parseFloat(r.employee_gross_profit) || 0), 0);
        let totalRetainedAll = 0;
        let totalGrandBonusAll = 0;

        const employees = empRes.rows.map(r => {
            const empGp = parseFloat(r.employee_gross_profit) || 0;
            const earned = parseFloat(r.total_commission_earned) || 0;
            const paid = parseFloat(r.total_commission_paid) || 0;
            const retainedTier1 = parseFloat(r.total_retained_pool) || 0;

            let targetBonusTier2 = 0;
            if (profitSharingPool > 0 && totalEmpGp > 0 && empGp > 0) {
                targetBonusTier2 = Math.round(profitSharingPool * (empGp / totalEmpGp));
            }

            const grandBonus = retainedTier1 + targetBonusTier2;
            totalRetainedAll += retainedTier1;
            totalGrandBonusAll += grandBonus;

            return {
                employee_id: r.employee_id,
                emp_code: r.emp_code,
                full_name: r.full_name,
                position: r.position,
                dept_name: r.dept_name,
                retention_rate: parseFloat(r.retention_rate),
                employee_gross_profit: empGp,
                total_commission_earned: earned,
                total_commission_paid: paid,
                retained_pool_tier1: retainedTier1,
                target_bonus_tier2: targetBonusTier2,
                grand_year_end_bonus: grandBonus
            };
        });

        res.json({
            success: true,
            year,
            policy,
            company_metrics: {
                actual_revenue: actualRevenue,
                actual_gross_profit: actualGrossProfit,
                target_gross_profit: targetGp,
                is_target_achieved: actualGrossProfit >= targetGp && targetGp > 0,
                excess_gross_profit: excessGp,
                profit_sharing_percent: sharingPct,
                profit_sharing_pool: profitSharingPool,
                total_retained_pool: totalRetainedAll,
                grand_total_bonus_pool: totalGrandBonusAll
            },
            employees
        });
    } catch (err) {
        console.error('Lỗi lấy báo cáo thưởng cuối năm:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. Cập nhật Chỉ Tiêu Lợi Nhuận Gộp Năm & % Thưởng Vượt Target (Dành cho Giám Đốc)
router.put('/year-end/:year/target', async (req, res) => {
    try {
        const year = parseInt(req.params.year, 10);
        const { target_gross_profit, profit_sharing_percent, notes } = req.body;

        const result = await pool.query(`
            INSERT INTO year_end_bonus_policies (year, target_gross_profit, profit_sharing_percent, notes, updated_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (year) DO UPDATE SET
                target_gross_profit = EXCLUDED.target_gross_profit,
                profit_sharing_percent = EXCLUDED.profit_sharing_percent,
                notes = COALESCE(EXCLUDED.notes, year_end_bonus_policies.notes),
                updated_at = NOW()
            RETURNING *
        `, [
            year,
            parseFloat(target_gross_profit) || 0,
            parseFloat(profit_sharing_percent) || 0,
            notes || ''
        ]);

        res.json({ success: true, message: `✅ Đã lưu cấu hình chỉ tiêu thưởng năm ${year}!`, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. Duyệt Chi Quỹ Thưởng Tết Năm (Hạch toán Sổ Quỹ & Chi phí Doanh nghiệp)
router.post('/year-end/:year/payout', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const year = parseInt(req.params.year, 10);
        const { approved_by = 'BAN_GIAM_DOC' } = req.body;

        const polRes = await client.query("SELECT * FROM year_end_bonus_policies WHERE year = $1", [year]);
        if (polRes.rows.length === 0) throw new Error("Chưa có chính sách thưởng năm " + year);
        const pol = polRes.rows[0];

        if (pol.status === 'PAID') {
            return res.json({ success: true, message: `Quỹ thưởng Tết năm ${year} đã được duyệt chi từ trước!` });
        }

        // Lấy tổng số tiền thưởng năm từ các kỳ lương
        const retainedRes = await client.query(`
            SELECT COALESCE(SUM(pi.commission_retained), 0) AS total_retained
            FROM payroll_items pi
            JOIN payrolls p ON pi.payroll_id = p.id
            WHERE p.period_key LIKE $1
        `, [`${year}-%`]);
        const totalRetained = parseFloat(retainedRes.rows[0]?.total_retained) || 0;

        // Tính thưởng vượt target
        const compActualRes = await client.query(`
            SELECT COALESCE(SUM(COALESCE(NULLIF(regexp_replace(gross_profit::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)), 0) AS actual_gp
            FROM orders
            WHERE status IN ('SHIPPED', 'COMPLETED')
              AND EXTRACT(YEAR FROM COALESCE(dispatched_at, created_at)) = $1
        `, [year]);
        const actualGp = parseFloat(compActualRes.rows[0]?.actual_gp) || 0;
        const targetGp = parseFloat(pol.target_gross_profit) || 0;
        const excessGp = Math.max(0, actualGp - targetGp);
        const profitSharingPool = Math.round(excessGp * (parseFloat(pol.profit_sharing_percent || 10) / 100));

        const grandPayout = totalRetained + profitSharingPool;

        await client.query(`
            UPDATE year_end_bonus_policies SET
                status = 'PAID',
                updated_at = NOW()
            WHERE year = $1
        `, [year]);

        const cashCode = 'PC-THUONG-TET-' + year;
        await client.query(`
            INSERT INTO cash_transactions (code, type, target_name, amount, notes)
            VALUES ($1, 'CHI', $2, $3, $4)
        `, [
            cashCode, 'Toàn thể Cán bộ Nhân viên', grandPayout,
            `Chi trả Quỹ Thưởng Tết & Thưởng Vượt Target năm ${year} (Cục 1 Tích lũy: ${totalRetained.toLocaleString('vi-VN')}đ + Cục 2 Thưởng Vượt: ${profitSharingPool.toLocaleString('vi-VN')}đ)`
        ]);

        await client.query(`
            INSERT INTO expenses (
                expense_date, category, description, vendor_name, amount_before_tax, total_amount
            ) VALUES 
            (CURRENT_DATE, 'LƯƠNG & NHÂN SỰ', $1, 'SUNGO ERP Bonus Hub', $2, $2)
        `, [
            `Chi phí Quỹ Thưởng Tết & Thưởng Vượt Target năm ${year}`, grandPayout
        ]);

        await client.query('COMMIT');
        res.json({
            success: true,
            message: `✅ Đã duyệt chi Quỹ Thưởng Tết năm ${year} thành công! Đã hạch toán ${grandPayout.toLocaleString('vi-VN')} đ vào Sổ Quỹ.`,
            cashCode
        });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

module.exports = router;
