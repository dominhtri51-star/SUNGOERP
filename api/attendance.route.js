const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Helper: parse time string HH:mm to minutes from midnight
function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

// Helper: format Date to HH:mm
function formatHHmm(dateObj) {
    if (!dateObj) return null;
    const d = new Date(dateObj);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

// 1. Lấy cấu hình chính sách chấm công & thưởng phạt
router.get('/policies', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM attendance_policies ORDER BY id ASC LIMIT 1");
        res.json({
            success: true,
            data: result.rows[0] || null
        });
    } catch (err) {
        console.error('Lỗi lấy chính sách chấm công:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. Cập nhật cấu hình chính sách chấm công & thưởng phạt & Thứ Bảy / Chủ Nhật
router.put('/policies', async (req, res) => {
    try {
        const {
            policy_name, work_start_time, work_end_time, lunch_start_time, lunch_end_time,
            standard_daily_hours, grace_period_minutes, free_late_count,
            bonus_attendance_amount, bonus_perfect_punctuality, ot_rate_multiplier,
            ot_min_minutes, ot_fixed_rate_per_hour,
            saturday_work_mode, saturday_start_time, saturday_end_time,
            saturday_standard_hours, saturday_day_value, saturday_ot_rate,
            sunday_ot_rate, holiday_ot_rate,
            penalty_late_tier1, penalty_late_tier2, penalty_late_tier3, penalty_late_tier4,
            penalty_early_tier1, penalty_early_tier2, penalty_early_tier3, penalty_early_tier4,
            penalty_accumulated_late_5, penalty_unauthorized_absent, notes
        } = req.body;

        const check = await pool.query("SELECT * FROM attendance_policies LIMIT 1");
        const curr = check.rows[0] || {};

        const safeInt = (val, fallback) => {
            const parsed = parseInt(val, 10);
            return isNaN(parsed) ? fallback : parsed;
        };
        const safeFloat = (val, fallback) => {
            const parsed = parseFloat(val);
            return isNaN(parsed) ? fallback : parsed;
        };

        const finalPolicyName = policy_name !== undefined ? policy_name : (curr.policy_name || 'Quy chuẩn Công Ty');
        const finalStart = work_start_time !== undefined ? work_start_time : (curr.work_start_time || '08:30');
        const finalEnd = work_end_time !== undefined ? work_end_time : (curr.work_end_time || '17:00');
        const finalLunchStart = lunch_start_time !== undefined ? lunch_start_time : (curr.lunch_start_time || '12:00');
        const finalLunchEnd = lunch_end_time !== undefined ? lunch_end_time : (curr.lunch_end_time || '13:00');
        const finalHours = safeFloat(standard_daily_hours, curr.standard_daily_hours || 7.5);
        const finalGrace = safeInt(grace_period_minutes, curr.grace_period_minutes || 5);
        const finalFreeLate = safeInt(free_late_count, curr.free_late_count || 3);
        const finalBonusAtt = safeFloat(bonus_attendance_amount, curr.bonus_attendance_amount || 500000);
        const finalBonusPunct = safeFloat(bonus_perfect_punctuality, curr.bonus_perfect_punctuality || 300000);
        const finalOtRate = safeFloat(ot_rate_multiplier, curr.ot_rate_multiplier || 1.5);
        const finalOtMinMins = safeInt(ot_min_minutes, curr.ot_min_minutes !== undefined ? curr.ot_min_minutes : 0);
        const finalOtFixedRate = safeFloat(ot_fixed_rate_per_hour, curr.ot_fixed_rate_per_hour || 0);

        // Thứ Bảy & Nghỉ Lễ
        const finalSatMode = saturday_work_mode !== undefined ? saturday_work_mode : (curr.saturday_work_mode || 'OFF_AFTERNOON');
        const finalSatStart = saturday_start_time !== undefined ? saturday_start_time : (curr.saturday_start_time || '08:30');
        const finalSatEnd = saturday_end_time !== undefined ? saturday_end_time : (curr.saturday_end_time || '12:00');
        const finalSatHours = safeFloat(saturday_standard_hours, curr.saturday_standard_hours || 3.5);
        const finalSatDayVal = safeFloat(saturday_day_value, curr.saturday_day_value || 1.0);
        const finalSatOtRate = safeFloat(saturday_ot_rate, curr.saturday_ot_rate || 1.5);
        const finalSunOtRate = safeFloat(sunday_ot_rate, curr.sunday_ot_rate || 2.0);
        const finalHolOtRate = safeFloat(holiday_ot_rate, curr.holiday_ot_rate || 3.0);

        const finalPen1 = safeFloat(penalty_late_tier1, curr.penalty_late_tier1 || 20000);
        const finalPen2 = safeFloat(penalty_late_tier2, curr.penalty_late_tier2 || 50000);
        const finalPen3 = safeFloat(penalty_late_tier3, curr.penalty_late_tier3 || 100000);
        const finalPen4 = safeFloat(penalty_late_tier4, curr.penalty_late_tier4 || 200000);
        const finalEarly1 = safeFloat(penalty_early_tier1, curr.penalty_early_tier1 || 20000);
        const finalEarly2 = safeFloat(penalty_early_tier2, curr.penalty_early_tier2 || 50000);
        const finalEarly3 = safeFloat(penalty_early_tier3, curr.penalty_early_tier3 || 100000);
        const finalEarly4 = safeFloat(penalty_early_tier4, curr.penalty_early_tier4 || 200000);
        const finalPenAcc = safeFloat(penalty_accumulated_late_5, curr.penalty_accumulated_late_5 || 200000);
        const finalPenUnauth = safeFloat(penalty_unauthorized_absent, curr.penalty_unauthorized_absent || 200000);
        const finalNotes = notes !== undefined ? notes : (curr.notes || '');

        let result;
        if (check.rows.length === 0) {
            result = await pool.query(`
                INSERT INTO attendance_policies (
                    policy_name, work_start_time, work_end_time, lunch_start_time, lunch_end_time,
                    standard_daily_hours, grace_period_minutes, free_late_count,
                    bonus_attendance_amount, bonus_perfect_punctuality, ot_rate_multiplier,
                    ot_min_minutes, ot_fixed_rate_per_hour,
                    saturday_work_mode, saturday_start_time, saturday_end_time,
                    saturday_standard_hours, saturday_day_value, saturday_ot_rate,
                    sunday_ot_rate, holiday_ot_rate,
                    penalty_late_tier1, penalty_late_tier2, penalty_late_tier3, penalty_late_tier4,
                    penalty_early_tier1, penalty_early_tier2, penalty_early_tier3, penalty_early_tier4,
                    penalty_accumulated_late_5, penalty_unauthorized_absent, notes
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32)
                RETURNING *
            `, [
                finalPolicyName, finalStart, finalEnd, finalLunchStart, finalLunchEnd,
                finalHours, finalGrace, finalFreeLate,
                finalBonusAtt, finalBonusPunct, finalOtRate,
                finalOtMinMins, finalOtFixedRate,
                finalSatMode, finalSatStart, finalSatEnd,
                finalSatHours, finalSatDayVal, finalSatOtRate,
                finalSunOtRate, finalHolOtRate,
                finalPen1, finalPen2, finalPen3, finalPen4,
                finalEarly1, finalEarly2, finalEarly3, finalEarly4,
                finalPenAcc, finalPenUnauth, finalNotes
            ]);
        } else {
            result = await pool.query(`
                UPDATE attendance_policies SET
                    policy_name = $1, work_start_time = $2, work_end_time = $3, lunch_start_time = $4, lunch_end_time = $5,
                    standard_daily_hours = $6, grace_period_minutes = $7, free_late_count = $8,
                    bonus_attendance_amount = $9, bonus_perfect_punctuality = $10, ot_rate_multiplier = $11,
                    ot_min_minutes = $12, ot_fixed_rate_per_hour = $13,
                    saturday_work_mode = $14, saturday_start_time = $15, saturday_end_time = $16,
                    saturday_standard_hours = $17, saturday_day_value = $18, saturday_ot_rate = $19,
                    sunday_ot_rate = $20, holiday_ot_rate = $21,
                    penalty_late_tier1 = $22, penalty_late_tier2 = $23, penalty_late_tier3 = $24, penalty_late_tier4 = $25,
                    penalty_early_tier1 = $26, penalty_early_tier2 = $27, penalty_early_tier3 = $28, penalty_early_tier4 = $29,
                    penalty_accumulated_late_5 = $30, penalty_unauthorized_absent = $31, notes = $32, updated_at = NOW()
                WHERE id = $33
                RETURNING *
            `, [
                finalPolicyName, finalStart, finalEnd, finalLunchStart, finalLunchEnd,
                finalHours, finalGrace, finalFreeLate,
                finalBonusAtt, finalBonusPunct, finalOtRate,
                finalOtMinMins, finalOtFixedRate,
                finalSatMode, finalSatStart, finalSatEnd,
                finalSatHours, finalSatDayVal, finalSatOtRate,
                finalSunOtRate, finalHolOtRate,
                finalPen1, finalPen2, finalPen3, finalPen4,
                finalEarly1, finalEarly2, finalEarly3, finalEarly4,
                finalPenAcc, finalPenUnauth, finalNotes, curr.id
            ]);
        }

        const updatedPolicy = result.rows[0];

        // Tự động tính toán lại attendance_daily cho tất cả các ngày đã có log
        try {
            const affectedDays = await pool.query(`
                SELECT DISTINCT employee_id, DATE(scan_time)::TEXT AS work_date
                FROM attendance_logs
                WHERE employee_id IS NOT NULL
            `);
            for (const r of affectedDays.rows) {
                const dayStat = await calculateSingleDayAttendance(pool, r.employee_id, r.work_date, updatedPolicy);
                await pool.query(`
                    UPDATE attendance_daily SET
                        first_check_in = $1,
                        last_check_out = $2,
                        working_hours = $3,
                        late_minutes = $4,
                        early_minutes = $5,
                        ot_hours = $6,
                        working_day_value = $7,
                        status = $8,
                        penalty_amount = $9,
                        notes = $10
                    WHERE employee_id = $11 AND work_date = $12
                `, [
                    dayStat.first_check_in, dayStat.last_check_out,
                    dayStat.working_hours, dayStat.late_minutes, dayStat.early_minutes, dayStat.ot_hours,
                    dayStat.working_day_value, dayStat.status, dayStat.penalty_amount, dayStat.notes,
                    r.employee_id, r.work_date
                ]);
            }

            // Tính lại monthly summary cho các tháng có dữ liệu
            const periodsRes = await pool.query(`SELECT DISTINCT TO_CHAR(work_date, 'YYYY-MM') AS period_key FROM attendance_daily`);
            for (const pr of periodsRes.rows) {
                await calculateAndSaveMonthlySummary(pool, pr.period_key, updatedPolicy);
            }
        } catch(recalcErr) {
            console.warn('Cảnh báo tính lại sau update policy:', recalcErr.message);
        }

        res.json({
            success: true,
            message: 'Đã cập nhật chính sách ca chuẩn, lịch Thứ Bảy nghỉ chiều, thưởng đúng giờ, tiền OT & tự động tính lại thành công!',
            data: updatedPolicy
        });
    } catch (err) {
        console.error('Lỗi cập nhật chính sách chấm công:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 2.1. QUẢN LÝ NGÀY NGHỈ LỄ (HOLIDAYS)
// ==========================================
router.get('/holidays', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM holidays ORDER BY holiday_date ASC");
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('Lỗi lấy danh sách ngày nghỉ lễ:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/holidays', async (req, res) => {
    try {
        const { holiday_name, holiday_date, is_paid = true, ot_rate = 3.0, notes = '' } = req.body;
        if (!holiday_name || !holiday_date) {
            return res.status(400).json({ success: false, error: 'Thiếu tên ngày lễ hoặc ngày nghỉ lễ!' });
        }
        const result = await pool.query(`
            INSERT INTO holidays (holiday_name, holiday_date, is_paid, ot_rate, notes)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (holiday_date) DO UPDATE SET
                holiday_name = EXCLUDED.holiday_name,
                is_paid = EXCLUDED.is_paid,
                ot_rate = EXCLUDED.ot_rate,
                notes = EXCLUDED.notes
            RETURNING *
        `, [holiday_name, holiday_date, is_paid, ot_rate, notes]);

        // Cập nhật lại ngày công trong tháng đó
        const periodKey = holiday_date.slice(0, 7);
        await calculateAndSaveMonthlySummary(pool, periodKey);

        res.json({
            success: true,
            message: `Đã lưu ngày nghỉ lễ: ${holiday_name} (${holiday_date})`,
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Lỗi lưu ngày nghỉ lễ:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/holidays/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("DELETE FROM holidays WHERE id = $1", [id]);
        res.json({ success: true, message: 'Đã xóa ngày nghỉ lễ thành công!' });
    } catch (err) {
        console.error('Lỗi xóa ngày nghỉ lễ:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Helper: tính toán và đồng bộ công tháng cho 1 kỳ hoặc 1 nhân viên
async function calculateAndSaveMonthlySummary(client, periodKey, policy = null, specificEmpId = null) {
    const startDate = `${periodKey}-01`;
    const parts = periodKey.split('-');
    const lastDay = new Date(parseInt(parts[0]), parseInt(parts[1]), 0).getDate();
    const endDate = `${periodKey}-${String(lastDay).padStart(2, '0')}`;

    if (!policy) {
        const polRes = await client.query("SELECT * FROM attendance_policies LIMIT 1");
        policy = polRes.rows[0] || {};
    }

    const bonusAttendance = parseFloat(policy.bonus_attendance_amount) || 500000;
    const bonusPerfectPunctuality = parseFloat(policy.bonus_perfect_punctuality) || 300000;
    const otRateMultiplier = parseFloat(policy.ot_rate_multiplier) || 1.5;
    const otFixedRate = parseFloat(policy.ot_fixed_rate_per_hour) || 0;
    const penaltyAccLate5 = parseFloat(policy.penalty_accumulated_late_5) || 200000;
    const standardDays = 26;
    const stdDailyHours = parseFloat(policy.standard_daily_hours) || 7.5;

    let empsQuery = `
        SELECT e.id, e.emp_code, e.full_name, e.position, e.base_salary, d.dept_name
        FROM employees e
        LEFT JOIN departments d ON e.department_id = d.id
        WHERE e.status = 'ACTIVE'
    `;
    const empsParams = [];
    if (specificEmpId) {
        empsQuery += " AND e.id = $1";
        empsParams.push(specificEmpId);
    }
    empsQuery += " ORDER BY e.id ASC";
    const empsRes = await client.query(empsQuery, empsParams);

    const results = [];

    for (const emp of empsRes.rows) {
        const daysRes = await client.query(`
            SELECT 
                COUNT(id) AS logged_days,
                COALESCE(SUM(working_day_value), 0) AS total_actual_days,
                COALESCE(SUM(CASE WHEN leave_type = 'PAID_LEAVE' OR status = 'HOLIDAY' THEN working_day_value ELSE 0 END), 0) AS total_paid_leave,
                COALESCE(SUM(CASE WHEN leave_type = 'UNPAID_LEAVE' OR status = 'ABSENT' THEN 1 ELSE 0 END), 0) AS total_unpaid_leave,
                COALESCE(SUM(CASE WHEN late_minutes > 0 THEN 1 ELSE 0 END), 0) AS total_late_count,
                COALESCE(SUM(late_minutes), 0) AS total_late_minutes,
                COALESCE(SUM(CASE WHEN early_minutes > 0 THEN 1 ELSE 0 END), 0) AS total_early_count,
                COALESCE(SUM(ot_hours), 0) AS total_ot_hours,
                COALESCE(SUM(penalty_amount), 0) AS total_daily_penalties
            FROM attendance_daily
            WHERE employee_id = $1 AND work_date >= $2 AND work_date <= $3
        `, [emp.id, startDate, endDate]);

        const row = daysRes.rows[0];
        const actualDays = parseFloat(row.total_actual_days) || 0;
        const paidLeave = parseFloat(row.total_paid_leave) || 0;
        const unpaidLeave = parseFloat(row.total_unpaid_leave) || 0;
        const lateCount = parseInt(row.total_late_count, 10) || 0;
        const lateMinutes = parseInt(row.total_late_minutes, 10) || 0;
        const earlyCount = parseInt(row.total_early_count, 10) || 0;
        const otHours = parseFloat(row.total_ot_hours) || 0;
        let totalPenalties = parseFloat(row.total_daily_penalties) || 0;

        // 1. KỊCH BẢN THƯỞNG ĐÚNG GIỜ TUYỆT ĐỐI:
        // Có đi làm trong tháng (> 0), KHÔNG bị muộn trễ lần nào và KHÔNG về sớm
        const isPunctualBonusAwarded = (actualDays > 0) && lateCount === 0 && earlyCount === 0;
        const punctualBonusAmount = isPunctualBonusAwarded ? bonusPerfectPunctuality : 0;

        // 2. KỊCH BẢN THƯỞNG CHUYÊN CẦN:
        // Đủ công chuẩn, KHÔNG trễ, KHÔNG nghỉ không phép
        const isAttendanceBonusAwarded = (actualDays + paidLeave >= standardDays) && lateCount === 0 && unpaidLeave === 0;
        const attendanceBonusAmount = isAttendanceBonusAwarded ? bonusAttendance : 0;

        // 3. KỊCH BẢN THƯỞNG LÀM THÊM GIỜ (OT):
        const baseSalary = parseFloat(emp.base_salary) || 8000000;
        const hourlyWage = baseSalary / (standardDays * stdDailyHours);
        const hourlyOtRate = otFixedRate > 0 ? otFixedRate : Math.round(hourlyWage * otRateMultiplier);
        const otBonusAmount = Math.round(otHours * hourlyOtRate);

        // Tổng tiền thưởng
        const totalBonusAmount = attendanceBonusAmount + punctualBonusAmount + otBonusAmount;

        // 4. KỊCH BẢN PHẠT TÍCH LŨY:
        if (lateCount >= 5) {
            totalPenalties += penaltyAccLate5;
        }

        let evalNote = '';
        if (isAttendanceBonusAwarded) {
            evalNote = 'Đạt Chuẩn Chuyên Cần 100%';
        } else if (isPunctualBonusAwarded) {
            evalNote = 'Đúng Giờ Tuyệt Đối';
        } else if (lateCount >= 3) {
            evalNote = `Vi phạm (${lateCount} lần trễ)`;
        } else if (actualDays > 0) {
            evalNote = 'Bình thường';
        } else {
            evalNote = 'Chưa có công';
        }

        await client.query(`
            INSERT INTO attendance_monthly_summary (
                period_key, employee_id, standard_working_days, total_actual_days,
                total_paid_leave_days, total_unpaid_leave_days, total_late_count, total_late_minutes,
                total_early_count, total_ot_hours, 
                is_attendance_bonus_awarded, attendance_bonus_amount,
                is_punctual_bonus_awarded, punctual_bonus_amount,
                ot_bonus_amount, total_bonus_amount,
                total_attendance_penalty, status, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'CALCULATED', $18)
            ON CONFLICT (period_key, employee_id) DO UPDATE SET
                total_actual_days = EXCLUDED.total_actual_days,
                total_paid_leave_days = EXCLUDED.total_paid_leave_days,
                total_unpaid_leave_days = EXCLUDED.total_unpaid_leave_days,
                total_late_count = EXCLUDED.total_late_count,
                total_late_minutes = EXCLUDED.total_late_minutes,
                total_early_count = EXCLUDED.total_early_count,
                total_ot_hours = EXCLUDED.total_ot_hours,
                is_attendance_bonus_awarded = EXCLUDED.is_attendance_bonus_awarded,
                attendance_bonus_amount = EXCLUDED.attendance_bonus_amount,
                is_punctual_bonus_awarded = EXCLUDED.is_punctual_bonus_awarded,
                punctual_bonus_amount = EXCLUDED.punctual_bonus_amount,
                ot_bonus_amount = EXCLUDED.ot_bonus_amount,
                total_bonus_amount = EXCLUDED.total_bonus_amount,
                total_attendance_penalty = EXCLUDED.total_attendance_penalty,
                status = 'CALCULATED',
                notes = EXCLUDED.notes
        `, [
            periodKey, emp.id, standardDays, actualDays,
            paidLeave, unpaidLeave, lateCount, lateMinutes,
            earlyCount, otHours,
            isAttendanceBonusAwarded, attendanceBonusAmount,
            isPunctualBonusAwarded, punctualBonusAmount,
            otBonusAmount, totalBonusAmount,
            totalPenalties, evalNote
        ]);

        results.push({
            period_key: periodKey,
            employee_id: emp.id,
            emp_code: emp.emp_code,
            full_name: emp.full_name,
            position: emp.position,
            dept_name: emp.dept_name,
            standard_working_days: standardDays,
            total_actual_days: actualDays,
            total_paid_leave_days: paidLeave,
            total_unpaid_leave_days: unpaidLeave,
            total_late_count: lateCount,
            total_late_minutes: lateMinutes,
            total_early_count: earlyCount,
            total_ot_hours: otHours,
            is_attendance_bonus_awarded: isAttendanceBonusAwarded,
            attendance_bonus_amount: attendanceBonusAmount,
            is_punctual_bonus_awarded: isPunctualBonusAwarded,
            punctual_bonus_amount: punctualBonusAmount,
            ot_bonus_amount: otBonusAmount,
            total_bonus_amount: totalBonusAmount,
            total_attendance_penalty: totalPenalties,
            notes: evalNote
        });
    }

    return results;
}

// Helper: tính toán ngày công cho 1 nhân viên vào 1 ngày cụ thể từ attendance_logs
async function calculateSingleDayAttendance(client, employeeId, workDateStr, policy) {
    const cleanDateStr = workDateStr.slice(0, 10);

    if (!policy) {
        const polRes = await client.query("SELECT * FROM attendance_policies LIMIT 1");
        policy = polRes.rows[0] || {};
    }

    // 0. Kiểm tra Ngày Nghỉ Lễ trong CSDL
    const holRes = await client.query("SELECT * FROM holidays WHERE holiday_date = $1", [cleanDateStr]);
    const holiday = holRes.rows[0];

    // Xác định thứ trong tuần (0 = Chủ Nhật, 6 = Thứ Bảy)
    const dayOfWeek = new Date(cleanDateStr + 'T00:00:00Z').getUTCDay();

    // 1. Lấy tất cả logs của nhân viên trong ngày đó
    const logsRes = await client.query(`
        SELECT scan_time, scan_type FROM attendance_logs
        WHERE employee_id = $1 AND DATE(scan_time) = $2
        ORDER BY scan_time ASC
    `, [employeeId, cleanDateStr]);

    const logs = logsRes.rows;

    // Xử lý Ngày Nghỉ Lễ
    if (holiday) {
        if (logs.length === 0) {
            return {
                working_hours: 0,
                late_minutes: 0,
                early_minutes: 0,
                ot_hours: 0,
                working_day_value: holiday.is_paid ? 1.0 : 0,
                status: 'HOLIDAY',
                penalty_amount: 0,
                first_check_in: null,
                last_check_out: null,
                notes: `Nghỉ Lễ: ${holiday.holiday_name} (Hưởng 100% lương)`
            };
        } else {
            const firstCheckIn = logs[0].scan_time;
            const lastCheckOut = logs[logs.length - 1].scan_time;
            const inDate = new Date(firstCheckIn);
            const outDate = new Date(lastCheckOut);
            const workedMins = Math.max(0, (outDate.getTime() - inDate.getTime()) / 60000);
            const workingHours = parseFloat((workedMins / 60).toFixed(2));
            const holOtRate = parseFloat(policy?.holiday_ot_rate) || 3.0;
            return {
                first_check_in: firstCheckIn,
                last_check_out: lastCheckOut,
                working_hours: workingHours,
                late_minutes: 0,
                early_minutes: 0,
                ot_hours: workingHours,
                working_day_value: 1.0,
                status: 'HOLIDAY_WORK',
                penalty_amount: 0,
                notes: `Đi làm ngày Lễ: ${holiday.holiday_name} (OT Lễ x${holOtRate})`
            };
        }
    }

    // Xử lý Ngày Chủ Nhật
    if (dayOfWeek === 0) {
        if (logs.length === 0) {
            return {
                working_hours: 0,
                late_minutes: 0,
                early_minutes: 0,
                ot_hours: 0,
                working_day_value: 0,
                status: 'WEEKEND',
                penalty_amount: 0,
                first_check_in: null,
                last_check_out: null,
                notes: 'Nghỉ Chủ Nhật hàng tuần'
            };
        } else {
            const firstCheckIn = logs[0].scan_time;
            const lastCheckOut = logs[logs.length - 1].scan_time;
            const inDate = new Date(firstCheckIn);
            const outDate = new Date(lastCheckOut);
            const workedMins = Math.max(0, (outDate.getTime() - inDate.getTime()) / 60000);
            const workingHours = parseFloat((workedMins / 60).toFixed(2));
            const sunOtRate = parseFloat(policy?.sunday_ot_rate) || 2.0;
            return {
                first_check_in: firstCheckIn,
                last_check_out: lastCheckOut,
                working_hours: workingHours,
                late_minutes: 0,
                early_minutes: 0,
                ot_hours: workingHours,
                working_day_value: 0,
                status: 'SUNDAY_WORK',
                penalty_amount: 0,
                notes: `Làm thêm Chủ Nhật (OT x${sunOtRate})`
            };
        }
    }

    const isSaturday = (dayOfWeek === 6);
    const satMode = policy?.saturday_work_mode || 'OFF_AFTERNOON';

    // Nếu Thứ Bảy nghỉ cả ngày
    if (isSaturday && satMode === 'OFF_ALL_DAY') {
        if (logs.length === 0) {
            return {
                working_hours: 0,
                late_minutes: 0,
                early_minutes: 0,
                ot_hours: 0,
                working_day_value: 0,
                status: 'WEEKEND',
                penalty_amount: 0,
                first_check_in: null,
                last_check_out: null,
                notes: 'Nghỉ Thứ Bảy'
            };
        }
    }

    // Không có log vào ngày thường hoặc thứ Bảy có lịch làm việc
    if (logs.length === 0) {
        return {
            working_hours: 0,
            late_minutes: 0,
            early_minutes: 0,
            ot_hours: 0,
            working_day_value: 0,
            status: 'ABSENT',
            penalty_amount: policy ? parseFloat(policy.penalty_unauthorized_absent) || 200000 : 200000,
            first_check_in: null,
            last_check_out: null,
            notes: isSaturday ? 'Vắng mặt không quét Thứ Bảy' : 'Vắng mặt không có dữ liệu chấm công'
        };
    }

    const firstCheckIn = logs[0].scan_time;
    const lastCheckOut = logs[logs.length - 1].scan_time;

    // Giờ bắt đầu & kết thúc chuẩn theo policy
    let startTimeMins = timeToMinutes(policy?.work_start_time || '08:30');
    let endTimeMins = timeToMinutes(policy?.work_end_time || '17:00');
    let lunchStartMins = timeToMinutes(policy?.lunch_start_time || '12:00');
    let lunchEndMins = timeToMinutes(policy?.lunch_end_time || '13:00');
    let lunchBreakMins = Math.max(0, lunchEndMins - lunchStartMins);
    let stdHours = parseFloat(policy?.standard_daily_hours) || 7.5;
    let dayValueTarget = 1.0;

    // Nếu là Thứ Bảy và chính sách là Nghỉ Chiều Thứ Bảy (Làm sáng 08:30 - 12:00)
    if (isSaturday && satMode === 'OFF_AFTERNOON') {
        startTimeMins = timeToMinutes(policy?.saturday_start_time || '08:30');
        endTimeMins = timeToMinutes(policy?.saturday_end_time || '12:00');
        lunchBreakMins = 0; // Không trừ nghỉ trưa vì tan ca lúc 12:00
        stdHours = parseFloat(policy?.saturday_standard_hours) || 3.5;
        dayValueTarget = parseFloat(policy?.saturday_day_value) || 1.0;
    }

    const graceMins = parseInt(policy?.grace_period_minutes, 10) || 5;

    const inDate = new Date(firstCheckIn);
    const inMins = inDate.getHours() * 60 + inDate.getMinutes();

    const outDate = new Date(lastCheckOut);
    const outMins = outDate.getHours() * 60 + outDate.getMinutes();

    // Tính số phút đi trễ
    let lateMinutes = 0;
    if (inMins > (startTimeMins + graceMins)) {
        lateMinutes = inMins - startTimeMins;
    }

    // Tính số phút về sớm (nếu có check-out riêng biệt)
    let earlyMinutes = 0;
    if (logs.length > 1 && outMins < endTimeMins) {
        earlyMinutes = endTimeMins - outMins;
    }

    // Tính tổng giờ làm việc thực tế (trừ nghỉ trưa nếu áp dụng)
    let totalWorkedMinutes = Math.max(0, outMins - inMins);
    if (lunchBreakMins > 0 && inMins < lunchStartMins && outMins > lunchEndMins) {
        totalWorkedMinutes = Math.max(0, totalWorkedMinutes - lunchBreakMins);
    }
    const workingHours = parseFloat((totalWorkedMinutes / 60).toFixed(2));

    // Tính giá trị ngày công (working_day_value)
    let workingDayValue = dayValueTarget;
    if (workingHours >= (stdHours - 0.5)) {
        workingDayValue = dayValueTarget;
    } else if (workingHours >= (stdHours / 2.0)) {
        workingDayValue = parseFloat((dayValueTarget / 2.0).toFixed(2));
    } else if (workingHours > 0) {
        workingDayValue = parseFloat((workingHours / stdHours * dayValueTarget).toFixed(2));
    } else {
        workingDayValue = 0;
    }

    // Tính số phút làm thêm ngoài giờ (OT):
    // 1. Dựa trên số giờ làm việc thực tế vượt chuẩn ca (workingHours - stdHours)
    const excessShiftHours = workingHours > stdHours ? parseFloat((workingHours - stdHours).toFixed(2)) : 0;
    // 2. Dựa trên số phút về sau ca chuẩn (outMins - endTimeMins)
    const otMinMins = parseInt(policy?.ot_min_minutes, 10) || 0;
    let afterShiftHours = 0;
    if (logs.length > 1 && outMins > endTimeMins) {
        const extraMins = outMins - endTimeMins;
        if (extraMins >= otMinMins) {
            afterShiftHours = parseFloat((extraMins / 60).toFixed(2));
        }
    }
    // Lấy giá trị lớn nhất giữa số giờ vượt chuẩn ca và giờ về muộn
    let otHours = Math.max(excessShiftHours, afterShiftHours);
    if (otHours < 0.05) otHours = 0;

    // Xác định trạng thái & tiền phạt đi trễ + về sớm theo bậc
    let status = 'ON_TIME';
    let latePenalty = 0;
    let earlyPenalty = 0;

    if (lateMinutes > 0) {
        if (lateMinutes <= 15) {
            latePenalty = parseFloat(policy?.penalty_late_tier1) || 20000;
        } else if (lateMinutes <= 30) {
            latePenalty = parseFloat(policy?.penalty_late_tier2) || 50000;
        } else if (lateMinutes <= 60) {
            latePenalty = parseFloat(policy?.penalty_late_tier3) || 100000;
        } else {
            latePenalty = parseFloat(policy?.penalty_late_tier4) || 200000;
        }
    }

    if (earlyMinutes > 0) {
        if (earlyMinutes <= 15) {
            earlyPenalty = parseFloat(policy?.penalty_early_tier1) || 20000;
        } else if (earlyMinutes <= 30) {
            earlyPenalty = parseFloat(policy?.penalty_early_tier2) || 50000;
        } else if (earlyMinutes <= 60) {
            earlyPenalty = parseFloat(policy?.penalty_early_tier3) || 100000;
        } else {
            earlyPenalty = parseFloat(policy?.penalty_early_tier4) || 200000;
        }
    }

    if (lateMinutes > 0 && earlyMinutes > 0) {
        status = 'LATE';
    } else if (lateMinutes > 0) {
        status = 'LATE';
    } else if (earlyMinutes > 0) {
        status = 'EARLY_OUT';
    }

    const totalPenalty = latePenalty + earlyPenalty;
    const noteArr = [];
    if (isSaturday && satMode === 'OFF_AFTERNOON') {
        noteArr.push('Ca sáng Thứ 7 (Nghỉ chiều)');
    }
    if (lateMinutes > 0) noteArr.push(`Trễ ${lateMinutes}p (-${latePenalty.toLocaleString('vi-VN')}đ)`);
    if (earlyMinutes > 0) noteArr.push(`Về sớm ${earlyMinutes}p (-${earlyPenalty.toLocaleString('vi-VN')}đ)`);
    if (otHours > 0) noteArr.push(`Làm thêm OT +${otHours}h`);
    if (noteArr.length === 0) noteArr.push('Đúng giờ');

    return {
        first_check_in: firstCheckIn,
        last_check_out: logs.length > 1 ? lastCheckOut : firstCheckIn,
        working_hours: workingHours,
        late_minutes: lateMinutes,
        early_minutes: earlyMinutes,
        ot_hours: otHours,
        working_day_value: workingDayValue,
        status,
        penalty_amount: totalPenalty,
        notes: noteArr.join(' • ')
    };
}

// 3. Ghi nhận nhật ký chấm công (Log Check-in / Check-out) từ thiết bị hoặc Web UI
router.post('/checkin-log', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { emp_code, employee_id, scan_time, scan_type, source, device_id, device_name } = req.body;

        // Tìm employee_id nếu chỉ truyền emp_code
        let targetEmpId = employee_id;
        let finalEmpCode = emp_code;
        if (!targetEmpId && emp_code) {
            const empRes = await client.query("SELECT id, emp_code FROM employees WHERE UPPER(emp_code) = $1", [emp_code.trim().toUpperCase()]);
            if (empRes.rows.length > 0) {
                targetEmpId = empRes.rows[0].id;
                finalEmpCode = empRes.rows[0].emp_code;
            }
        }

        if (!targetEmpId) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Không tìm thấy thông tin nhân viên tương ứng trong hệ thống!' });
        }

        const nowScan = scan_time ? new Date(scan_time) : new Date();
        const workDateStr = nowScan.toISOString().slice(0, 10);

        // Lưu vào attendance_logs
        await client.query(`
            INSERT INTO attendance_logs (employee_id, emp_code, scan_time, scan_type, source, device_id, device_name)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [targetEmpId, finalEmpCode, nowScan, scan_type || 'AUTO', source || 'WEB_ONLINE', device_id || null, device_name || 'Hệ thống Web']);

        // Lấy policy
        const polRes = await client.query("SELECT * FROM attendance_policies LIMIT 1");
        const policy = polRes.rows[0];

        // Tính toán & cập nhật attendance_daily
        const dayStat = await calculateSingleDayAttendance(client, targetEmpId, workDateStr, policy);

        await client.query(`
            INSERT INTO attendance_daily (
                employee_id, work_date, first_check_in, last_check_out, working_hours,
                late_minutes, early_minutes, ot_hours, working_day_value, status, penalty_amount, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (employee_id, work_date) DO UPDATE SET
                first_check_in = EXCLUDED.first_check_in,
                last_check_out = EXCLUDED.last_check_out,
                working_hours = EXCLUDED.working_hours,
                late_minutes = EXCLUDED.late_minutes,
                early_minutes = EXCLUDED.early_minutes,
                ot_hours = EXCLUDED.ot_hours,
                working_day_value = EXCLUDED.working_day_value,
                status = EXCLUDED.status,
                penalty_amount = EXCLUDED.penalty_amount,
                notes = EXCLUDED.notes
        `, [
            targetEmpId, workDateStr, dayStat.first_check_in, dayStat.last_check_out,
            dayStat.working_hours, dayStat.late_minutes, dayStat.early_minutes, dayStat.ot_hours,
            dayStat.working_day_value, dayStat.status, dayStat.penalty_amount, dayStat.notes
        ]);

        await client.query('COMMIT');
        res.json({
            success: true,
            message: 'Đã ghi nhận chấm công thành công!',
            data: dayStat
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Lỗi checkin-log:', err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// 4. Nhập file dữ liệu hàng loạt từ Máy chấm công (Excel / CSV / JSON logs)
router.post('/import-logs', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { logs, source } = req.body;
        if (!logs || !Array.isArray(logs) || logs.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Dữ liệu nhật ký chấm công không hợp lệ!' });
        }

        // Cache danh sách nhân viên theo emp_code
        const allEmps = await client.query("SELECT id, emp_code FROM employees WHERE status = 'ACTIVE'");
        const empMap = {};
        allEmps.rows.forEach(e => {
            empMap[e.emp_code.trim().toUpperCase()] = e.id;
        });

        const affectedDates = new Set();
        const affectedEmployees = new Set();
        let importedCount = 0;

        for (const item of logs) {
            const rawCode = (item.emp_code || item.user_id || '').toString().trim().toUpperCase();
            const empId = empMap[rawCode] || (item.employee_id ? parseInt(item.employee_id, 10) : null);
            if (!empId) continue;

            const scanTime = new Date(item.scan_time || item.timestamp);
            if (isNaN(scanTime.getTime())) continue;

            const workDateStr = scanTime.toISOString().slice(0, 10);
            affectedDates.add(workDateStr);
            affectedEmployees.add(empId);

            await client.query(`
                INSERT INTO attendance_logs (employee_id, emp_code, scan_time, scan_type, source, device_id, device_name)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                empId, rawCode, scanTime, item.scan_type || 'AUTO',
                source || 'EXCEL_IMPORT', item.device_id || 'ZKTECO_MACHINE', item.device_name || 'Máy Chấm Công'
            ]);
            importedCount++;
        }

        // Lấy policy
        const polRes = await client.query("SELECT * FROM attendance_policies LIMIT 1");
        const policy = polRes.rows[0];

        // Tự động tính toán lại attendance_daily cho tất cả các ngày và nhân viên bị ảnh hưởng
        for (const empId of affectedEmployees) {
            for (const dateStr of affectedDates) {
                const dayStat = await calculateSingleDayAttendance(client, empId, dateStr, policy);
                await client.query(`
                    INSERT INTO attendance_daily (
                        employee_id, work_date, first_check_in, last_check_out, working_hours,
                        late_minutes, early_minutes, ot_hours, working_day_value, status, penalty_amount, notes
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    ON CONFLICT (employee_id, work_date) DO UPDATE SET
                        first_check_in = EXCLUDED.first_check_in,
                        last_check_out = EXCLUDED.last_check_out,
                        working_hours = EXCLUDED.working_hours,
                        late_minutes = EXCLUDED.late_minutes,
                        early_minutes = EXCLUDED.early_minutes,
                        ot_hours = EXCLUDED.ot_hours,
                        working_day_value = EXCLUDED.working_day_value,
                        status = EXCLUDED.status,
                        penalty_amount = EXCLUDED.penalty_amount,
                        notes = EXCLUDED.notes
                `, [
                    empId, dateStr, dayStat.first_check_in, dayStat.last_check_out,
                    dayStat.working_hours, dayStat.late_minutes, dayStat.early_minutes, dayStat.ot_hours,
                    dayStat.working_day_value, dayStat.status, dayStat.penalty_amount, dayStat.notes
                ]);
            }
        }

        await client.query('COMMIT');
        res.json({
            success: true,
            message: `Đã import thành công ${importedCount} bản ghi quét vân tay và tự động đồng bộ công cho ${affectedEmployees.size} nhân sự!`,
            importedCount
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Lỗi import-logs:', err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// 5. Lấy danh sách chấm công chi tiết theo ngày (Daily Timesheet)
router.get('/daily', async (req, res) => {
    try {
        const { from_date, to_date, employee_id, department_id } = req.query;
        let where = "1=1";
        const params = [];

        if (from_date && typeof from_date === 'string' && from_date.trim()) {
            params.push(from_date.trim());
            where += ` AND ad.work_date >= $${params.length}`;
        }
        if (to_date && typeof to_date === 'string' && to_date.trim()) {
            params.push(to_date.trim());
            where += ` AND ad.work_date <= $${params.length}`;
        }
        if (employee_id && employee_id.toString().trim()) {
            const parsedEmpId = parseInt(employee_id, 10);
            if (!isNaN(parsedEmpId)) {
                params.push(parsedEmpId);
                where += ` AND ad.employee_id = $${params.length}`;
            }
        }
        if (department_id && department_id.toString().trim()) {
            const parsedDeptId = parseInt(department_id, 10);
            if (!isNaN(parsedDeptId)) {
                params.push(parsedDeptId);
                where += ` AND e.department_id = $${params.length}`;
            }
        }

        const result = await pool.query(`
            SELECT 
                ad.*,
                e.emp_code,
                e.full_name,
                e.position,
                d.dept_name
            FROM attendance_daily ad
            JOIN employees e ON ad.employee_id = e.id
            LEFT JOIN departments d ON e.department_id = d.id
            WHERE ${where}
            ORDER BY ad.work_date DESC, e.emp_code ASC
        `, params);

        res.json({
            success: true,
            data: result.rows
        });
    } catch (err) {
        console.error('Lỗi lấy daily timesheet:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5.5. Lấy ma trận chấm công cả tháng (Toàn bộ 01 - 31 ngày chi tiết dạng bảng đối soát như máy chấm công)
router.get('/matrix', async (req, res) => {
    try {
        const periodKey = req.query.period_key || new Date().toISOString().slice(0, 7);
        const [yearStr, monthStr] = periodKey.split('-');
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);
        const daysInMonth = new Date(year, month, 0).getDate();
        const startDate = `${periodKey}-01`;
        const endDate = `${periodKey}-${String(daysInMonth).padStart(2, '0')}`;

        const daysList = [];
        const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
        for (let d = 1; d <= daysInMonth; d++) {
            const dStr = `${periodKey}-${String(d).padStart(2, '0')}`;
            const dow = new Date(`${dStr}T00:00:00Z`).getUTCDay();
            daysList.push({
                day: d,
                date: dStr,
                dayOfWeek: dow,
                dayOfWeekName: dayNames[dow],
                isWeekend: dow === 0 || dow === 6
            });
        }

        const empsRes = await pool.query(`
            SELECT e.id, e.emp_code, e.full_name, e.position, d.dept_name
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.id
            WHERE e.status = 'ACTIVE'
            ORDER BY e.emp_code ASC
        `);

        const dailyRes = await pool.query(`
            SELECT employee_id, work_date, first_check_in, last_check_out, working_hours, late_minutes, early_minutes, ot_hours, working_day_value, status, penalty_amount, notes
            FROM attendance_daily
            WHERE work_date >= $1 AND work_date <= $2
        `, [startDate, endDate]);

        const dailyMap = {};
        dailyRes.rows.forEach(r => {
            const dayNum = parseInt(String(r.work_date).slice(8, 10), 10);
            const key = `${r.employee_id}_${dayNum}`;
            const inT = r.first_check_in ? String(r.first_check_in).slice(11, 16) : '';
            const outT = r.last_check_out ? String(r.last_check_out).slice(11, 16) : '';
            dailyMap[key] = {
                first_check_in: inT,
                last_check_out: outT,
                working_hours: parseFloat(r.working_hours) || 0,
                late_minutes: parseInt(r.late_minutes, 10) || 0,
                early_minutes: parseInt(r.early_minutes, 10) || 0,
                ot_hours: parseFloat(r.ot_hours) || 0,
                working_day_value: parseFloat(r.working_day_value) || 0,
                status: r.status,
                penalty_amount: parseFloat(r.penalty_amount) || 0,
                notes: r.notes || ''
            };
        });

        const employees = empsRes.rows.map(e => {
            const days = {};
            let totalDays = 0;
            let totalOt = 0;
            let lateCount = 0;
            let penaltyTotal = 0;

            for (let d = 1; d <= daysInMonth; d++) {
                const rec = dailyMap[`${e.id}_${d}`] || null;
                days[d] = rec;
                if (rec) {
                    totalDays += rec.working_day_value;
                    totalOt += rec.ot_hours;
                    if (rec.late_minutes > 0) lateCount++;
                    penaltyTotal += rec.penalty_amount;
                }
            }

            return {
                id: e.id,
                emp_code: e.emp_code,
                full_name: e.full_name,
                position: e.position,
                dept_name: e.dept_name,
                total_days: parseFloat(totalDays.toFixed(2)),
                total_ot_hours: parseFloat(totalOt.toFixed(2)),
                total_late_count: lateCount,
                total_penalties: penaltyTotal,
                days
            };
        });

        res.json({
            success: true,
            period_key: periodKey,
            daysInMonth,
            daysList,
            employees
        });
    } catch (err) {
        console.error('Lỗi lấy ma trận chấm công:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. Tổng hợp công tháng & Kịch bản Thưởng Chuyên Cần / Đúng Giờ / Phạt Kỷ Luật / Tiền OT (Monthly Summary)
router.get('/monthly-summary', async (req, res) => {
    try {
        const periodKey = req.query.period_key || new Date().toISOString().slice(0, 7); // '2026-08'

        // 1. Lấy chính sách
        const polRes = await pool.query("SELECT * FROM attendance_policies LIMIT 1");
        const policy = polRes.rows[0] || {};

        // 2. Tự động tính toán & cập nhật bảng attendance_monthly_summary
        const summaryList = await calculateAndSaveMonthlySummary(pool, periodKey, policy);

        res.json({
            success: true,
            period_key: periodKey,
            policy,
            data: summaryList
        });
    } catch (err) {
        console.error('Lỗi monthly summary chấm công:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 7. Đồng bộ Bảng Tổng Hợp Công Tháng vào CSDL (attendance_monthly_summary)
router.post('/sync-monthly', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const periodKey = req.body.period_key || new Date().toISOString().slice(0, 7);
        const polRes = await client.query("SELECT * FROM attendance_policies LIMIT 1");
        const policy = polRes.rows[0] || {};

        const results = await calculateAndSaveMonthlySummary(client, periodKey, policy);
        await client.query('COMMIT');

        res.json({
            success: true,
            message: `Đã tổng hợp và đồng bộ công tháng ${periodKey} cho ${results.length} nhân sự (Thưởng Chuyên cần, Đúng giờ & Tiền OT)!`,
            syncedCount: results.length,
            data: results
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Lỗi sync-monthly:', err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// ==========================================
// KẾT NỐI & ĐỒNG BỘ YUNATT CLOUD MÁY CHẤM CÔNG
// ==========================================
const yunattService = require('./yunatt.service');

// 8. Kiểm tra trạng thái kết nối máy chấm công Cloud
router.get('/yunatt/status', async (req, res) => {
    try {
        const [devices, months] = await Promise.all([
            yunattService.fetchDevices().catch(() => []),
            yunattService.fetchMonthList().catch(() => [])
        ]);

        res.json({
            success: true,
            account: {
                email: 'vinhfuc92@gmail.com',
                provider: 'YunAtt Global Cloud Platform (ZKTeco/6300 Pro)',
                portal_url: 'https://global.yunatt.com'
            },
            devices,
            months,
            status: 'CONNECTED'
        });
    } catch (err) {
        console.error('Lỗi lấy trạng thái YunAtt:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 9. Kích hoạt đồng bộ dữ liệu chấm công từ YunAtt Cloud vào ERP
router.post('/yunatt/sync', async (req, res) => {
    try {
        const periodKey = req.body.period_key || new Date().toISOString().slice(0, 7);
        const result = await yunattService.syncMonthToDatabase(periodKey);

        // Sau khi nạp log xong, tự động tổng hợp công tháng
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const polRes = await client.query("SELECT * FROM attendance_policies LIMIT 1");
            const policy = polRes.rows[0] || {};
            await calculateAndSaveMonthlySummary(client, periodKey, policy);
            await client.query('COMMIT');
        } catch(e) {
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }

        res.json({
            success: true,
            message: `⚡ Đã đồng bộ thành công dữ liệu từ YunAtt Cloud tháng ${periodKey} (${result.syncedEmployees} nhân sự, ${result.totalDaysProcessed} lượt ngày công)!`,
            data: result
        });
    } catch (err) {
        console.error('Lỗi sync YunAtt:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 10. ĐIỀU CHỈNH CHẤM CÔNG THỦ CÔNG (KẾ TOÁN / ADMIN)
// ==========================================
router.post('/adjust', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const {
            employee_id,
            work_date,
            first_check_in,
            last_check_out,
            leave_type,
            adjustment_reason,
            adjusted_by
        } = req.body;

        if (!employee_id || !work_date) {
            throw new Error('Vui lòng chọn nhân viên và ngày cần điều chỉnh!');
        }

        const dateStr = work_date.slice(0, 10);
        const polRes = await client.query("SELECT * FROM attendance_policies LIMIT 1");
        const policy = polRes.rows[0] || {};

        // 1. Thêm bản ghi log ghi nhận điều chỉnh thủ công
        if (first_check_in) {
            await client.query(`
                INSERT INTO attendance_logs (employee_id, scan_time, scan_type, source, device_name)
                VALUES ($1, $2, 'CHECK_IN', 'MANUAL_ADJUST', $3)
            `, [employee_id, first_check_in, `Điều chỉnh bởi ${adjusted_by || 'Kế toán'}`]);
        }
        if (last_check_out && last_check_out !== first_check_in) {
            await client.query(`
                INSERT INTO attendance_logs (employee_id, scan_time, scan_type, source, device_name)
                VALUES ($1, $2, 'CHECK_OUT', 'MANUAL_ADJUST', $3)
            `, [employee_id, last_check_out, `Điều chỉnh bởi ${adjusted_by || 'Kế toán'}`]);
        }

        // 2. Tính toán ngày công
        const dayStat = await calculateSingleDayAttendance(client, employee_id, dateStr, policy);

        // 3. Ghi đè hoặc tạo mới trong attendance_daily
        const updated = await client.query(`
            INSERT INTO attendance_daily (
                employee_id, work_date, first_check_in, last_check_out,
                working_hours, late_minutes, early_minutes, ot_hours,
                working_day_value, leave_type, status, penalty_amount,
                notes, adjustment_reason, adjusted_by, adjusted_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
            ON CONFLICT (employee_id, work_date) DO UPDATE SET
                first_check_in = EXCLUDED.first_check_in,
                last_check_out = EXCLUDED.last_check_out,
                working_hours = EXCLUDED.working_hours,
                late_minutes = EXCLUDED.late_minutes,
                early_minutes = EXCLUDED.early_minutes,
                ot_hours = EXCLUDED.ot_hours,
                working_day_value = EXCLUDED.working_day_value,
                leave_type = EXCLUDED.leave_type,
                status = EXCLUDED.status,
                penalty_amount = EXCLUDED.penalty_amount,
                notes = EXCLUDED.notes,
                adjustment_reason = EXCLUDED.adjustment_reason,
                adjusted_by = EXCLUDED.adjusted_by,
                adjusted_at = NOW()
            RETURNING *
        `, [
            employee_id, dateStr,
            first_check_in || dayStat.first_check_in,
            last_check_out || dayStat.last_check_out,
            dayStat.working_hours, dayStat.late_minutes, dayStat.early_minutes, dayStat.ot_hours,
            dayStat.working_day_value, leave_type || 'NONE',
            adjustment_reason ? 'ADJUSTED' : dayStat.status,
            dayStat.penalty_amount,
            dayStat.notes + (adjustment_reason ? ` (Đã duyệt: ${adjustment_reason})` : ''),
            adjustment_reason || 'Kế toán điều chỉnh',
            adjusted_by || 'Kế toán / Admin'
        ]);

        // 4. Tự động tính lại tổng hợp tháng cho nhân viên này
        const periodKey = dateStr.slice(0, 7);
        await calculateAndSaveMonthlySummary(client, periodKey, policy, employee_id);

        await client.query('COMMIT');
        res.json({
            success: true,
            message: `✅ Đã điều chỉnh giờ chấm công ngày ${dateStr} thành công!`,
            data: updated.rows[0]
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Lỗi adjust attendance:', err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

module.exports = router;

