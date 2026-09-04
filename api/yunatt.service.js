const pool = require('../config/database');

class YunAttService {
    constructor() {
        this.baseUrl = 'https://global.yunatt.com';
        this.email = 'vinhfuc92@gmail.com';
        this.password = 'sungo123';
        this.cookies = '';
        this.lastLoginTime = 0;
    }

    // 1. Đăng nhập vào hệ thống YunAtt Cloud
    async login() {
        try {
            // Bước 1: Khởi tạo session cookie ban đầu
            const initRes = await fetch(`${this.baseUrl}/`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                redirect: 'manual'
            });

            const rawCookies1 = initRes.headers.getSetCookie ? initRes.headers.getSetCookie() : [initRes.headers.get('set-cookie')];
            let cookies = rawCookies1.filter(Boolean).map(c => c.split(';')[0]).join('; ');

            // Bước 2: POST xác thực Email + Mật khẩu
            const params = new URLSearchParams();
            params.append('email', this.email);
            params.append('password', this.password);
            params.append('remember', '1');

            const loginRes = await fetch(`${this.baseUrl}/login/emailLogin`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': cookies,
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': `${this.baseUrl}/`
                },
                body: params.toString(),
                redirect: 'manual'
            });

            if (loginRes.status !== 302 && loginRes.status !== 200) {
                throw new Error(`Đăng nhập YunAtt thất bại (Status: ${loginRes.status})`);
            }

            const loginCookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [loginRes.headers.get('set-cookie')];
            const newCookies = loginCookies.filter(Boolean).map(c => c.split(';')[0]).join('; ');
            if (newCookies) {
                cookies = (cookies ? cookies + '; ' : '') + newCookies;
            }

            this.cookies = cookies;
            this.lastLoginTime = Date.now();
            return true;
        } catch (err) {
            console.error('❌ Lỗi kết nối YunAtt Cloud:', err.message);
            throw err;
        }
    }

    // Đảm bảo phiên đăng nhập còn hiệu lực (refresh sau 30 phút)
    async ensureSession() {
        if (!this.cookies || Date.now() - this.lastLoginTime > 30 * 60 * 1000) {
            await this.login();
        }
    }

    // 2. Lấy danh sách tháng có dữ liệu trên YunAtt
    async fetchMonthList() {
        await this.ensureSession();
        const res = await fetch(`${this.baseUrl}/cardRecord/monthIndex`, {
            headers: {
                'Cookie': this.cookies,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const html = await res.text();
        const months = [];
        const optRegex = /<option value="(\d+)"[^>]*>([^<]+)<\/option>/g;
        let m;
        while ((m = optRegex.exec(html)) !== null) {
            months.push({ id: m[1], period_key: m[2].trim() });
        }
        return months;
    }

    // 3. Lấy thông tin thiết bị máy chấm công (6300 Pro Wifi, VĂN PHÒNG SUNGO...)
    async fetchDevices() {
        await this.ensureSession();
        const res = await fetch(`${this.baseUrl}/attenceMachine/query`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Cookie': this.cookies,
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: 'offset=0&limit=50'
        });

        const data = await res.json();
        return (data.rows || []).map(d => ({
            id: d.id,
            name: d.name,
            model: d.modelname,
            series: d.series,
            ip: d.ip,
            status: d.status === 1 ? 'ONLINE' : 'OFFLINE',
            last_contact: d.contactTime ? new Date(d.contactTime).toLocaleString('vi-VN') : 'N/A'
        }));
    }

    // 4. Lấy dữ liệu ma trận chấm công tháng từ YunAtt
    async fetchMonthRecords(monthDataId) {
        await this.ensureSession();
        const qParams = new URLSearchParams();
        qParams.append('offset', '0');
        qParams.append('limit', '200');
        qParams.append('monthDataId', monthDataId);

        const res = await fetch(`${this.baseUrl}/cardRecord/queryForMonth`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Cookie': this.cookies,
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `${this.baseUrl}/cardRecord/monthIndex`
            },
            body: qParams.toString()
        });

        const data = await res.json();
        return data.rows || [];
    }

    // 5. Đồng bộ toàn bộ dữ liệu từ YunAtt Cloud vào CSDL ERP
    async syncMonthToDatabase(periodKey) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Tìm monthDataId tương ứng với periodKey
            const monthList = await this.fetchMonthList();
            let targetMonth = monthList.find(m => m.period_key === periodKey);
            if (!targetMonth && monthList.length > 0) {
                targetMonth = monthList[0];
                periodKey = targetMonth.period_key;
            }

            if (!targetMonth) {
                throw new Error(`Không tìm thấy kỳ chấm công ${periodKey} trên YunAtt Cloud!`);
            }

            // 2. Lấy danh sách chấm công từ YunAtt
            const yunRows = await this.fetchMonthRecords(targetMonth.id);

            // 3. Lấy policy chấm công hiện tại
            const polRes = await client.query("SELECT * FROM attendance_policies LIMIT 1");
            const policy = polRes.rows[0] || {};
            
            const timeToMinutes = (tStr) => {
                if (!tStr) return 0;
                const parts = tStr.split(':');
                return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
            };

            const startTimeMins = timeToMinutes(policy.work_start_time || '08:30');
            const endTimeMins = timeToMinutes(policy.work_end_time || '17:00');
            const lunchStartMins = timeToMinutes(policy.lunch_start_time || '12:00');
            const lunchEndMins = timeToMinutes(policy.lunch_end_time || '13:00');
            const lunchBreakMins = Math.max(0, lunchEndMins - lunchStartMins);
            const graceMins = parseInt(policy.grace_period_minutes, 10) || 5;
            const stdHours = parseFloat(policy.standard_daily_hours) || 7.5;

            // 4. Lấy danh sách ngày lễ trong CSDL
            const holRes = await client.query("SELECT holiday_date::text, holiday_name, is_paid FROM holidays");
            const holidayMap = {};
            holRes.rows.forEach(h => {
                const k = (h.holiday_date || '').slice(0, 10);
                holidayMap[k] = h;
            });

            // 5. Lấy danh sách nhân viên hiện tại để map emp_code
            const empsRes = await client.query("SELECT id, emp_code, full_name FROM employees");
            const empMap = {};
            empsRes.rows.forEach(e => {
                empMap[e.emp_code.trim().toUpperCase()] = e.id;
                empMap[e.full_name.trim().toUpperCase()] = e.id;
            });

            let syncedEmployees = 0;
            let totalDaysProcessed = 0;

            for (const row of yunRows) {
                const staffCode = (row.staffNumber || '').trim().toUpperCase();
                const staffName = (row.staffName || '').trim();
                if (!staffCode && !staffName) continue;

                // Tìm hoặc tự động tạo nhân sự nếu chưa có trong ERP
                let empId = empMap[staffCode] || empMap[staffName.toUpperCase()];
                if (!empId) {
                    const newEmp = await client.query(`
                        INSERT INTO employees (
                            emp_code, full_name, position, department_id, department_role,
                            contract_type, start_date, status, base_salary, insurance_salary
                        ) VALUES ($1, $2, 'Nhân Viên', 2, 'STAFF', 'CHINH_THUC', CURRENT_DATE, 'ACTIVE', 8000000, 5000000)
                        RETURNING id
                    `, [staffCode || `NV-${staffName}`, staffName]);
                    empId = newEmp.rows[0].id;
                    empMap[staffCode] = empId;
                    empMap[staffName.toUpperCase()] = empId;
                }

                // Duyệt qua tất cả các ngày trong tháng (day-YYYY-MM-DD)
                for (const key of Object.keys(row)) {
                    if (!key.startsWith('day-')) continue;
                    const dateStr = key.replace('day-', ''); // '2026-08-01'
                    const cellVal = (row[key] || '').trim(); // e.g. "08:08<br>17:23" or "17:08" or ""

                    if (!cellVal) continue; // Ngày không đi làm

                    // Tách các mốc giờ quét trong ngày
                    const timeParts = cellVal.split(/<br\s*\/?>|\n|,|\s+/).map(t => t.trim()).filter(Boolean);
                    if (timeParts.length === 0) continue;

                    const firstTimeStr = timeParts[0]; // e.g. "08:08"
                    const lastTimeStr = timeParts[timeParts.length - 1]; // e.g. "17:23"

                    const firstCheckIn = `${dateStr} ${firstTimeStr}:00`;
                    const lastCheckOut = timeParts.length > 1 ? `${dateStr} ${lastTimeStr}:00` : firstCheckIn;

                    // Lưu vào attendance_logs nếu chưa có
                    await client.query(`
                        INSERT INTO attendance_logs (employee_id, emp_code, scan_time, scan_type, source, device_name)
                        VALUES ($1, $2, $3, 'CHECK_IN', 'YUNATT_CLOUD', 'Máy Chấm Công Vân Tay')
                    `, [empId, staffCode, firstCheckIn]);

                    if (timeParts.length > 1) {
                        await client.query(`
                            INSERT INTO attendance_logs (employee_id, emp_code, scan_time, scan_type, source, device_name)
                            VALUES ($1, $2, $3, 'CHECK_OUT', 'YUNATT_CLOUD', 'Máy Chấm Công Vân Tay')
                        `, [empId, staffCode, lastCheckOut]);
                    }

                    // Kiểm tra Ngày Nghỉ Lễ & Thứ trong tuần
                    const cleanDateStr = dateStr.slice(0, 10);
                    const holiday = holidayMap[cleanDateStr];
                    const dayOfWeek = new Date(cleanDateStr + 'T00:00:00Z').getUTCDay();

                    let curStartMins = startTimeMins;
                    let curEndMins = endTimeMins;
                    let curLunchMins = lunchBreakMins;
                    let curStdHours = stdHours;
                    let curDayValueTarget = 1.0;

                    const isSat = (dayOfWeek === 6);
                    const satMode = policy.saturday_work_mode || 'OFF_AFTERNOON';

                    if (isSat && satMode === 'OFF_AFTERNOON') {
                        const satStartParts = (policy.saturday_start_time || '08:30').split(':');
                        const satEndParts = (policy.saturday_end_time || '12:00').split(':');
                        curStartMins = parseInt(satStartParts[0], 10) * 60 + parseInt(satStartParts[1], 10);
                        curEndMins = parseInt(satEndParts[0], 10) * 60 + parseInt(satEndParts[1], 10);
                        curLunchMins = 0;
                        curStdHours = parseFloat(policy.saturday_standard_hours) || 3.5;
                        curDayValueTarget = parseFloat(policy.saturday_day_value) || 1.0;
                    }

                    // Tính toán giờ làm, số phút trễ, số phút về sớm
                    const inParts = firstTimeStr.split(':');
                    const inMins = parseInt(inParts[0], 10) * 60 + parseInt(inParts[1], 10);

                    const outParts = lastTimeStr.split(':');
                    const outMins = parseInt(outParts[0], 10) * 60 + parseInt(outParts[1], 10);

                    // Phút đi trễ
                    let lateMinutes = 0;
                    if (!holiday && dayOfWeek !== 0 && inMins > (curStartMins + graceMins)) {
                        lateMinutes = inMins - curStartMins;
                    }

                    // Phút về sớm
                    let earlyMinutes = 0;
                    if (!holiday && dayOfWeek !== 0 && timeParts.length > 1 && outMins < curEndMins) {
                        earlyMinutes = curEndMins - outMins;
                    }

                    // Giờ làm việc trong ca chuẩn (Regular Shift Hours):
                    // Đến sớm trước ca (vd 07:54, 08:08) chỉ tính từ giờ bắt đầu ca curStartMins (08:30)
                    // Ra muộn sau ca chỉ tính trong ca đến giờ kết thúc ca curEndMins (17:00 / 12:00)
                    const effectiveInMins = Math.max(inMins, curStartMins);
                    const effectiveOutMins = Math.min(outMins, curEndMins);

                    let shiftWorkedMins = Math.max(0, effectiveOutMins - effectiveInMins);
                    if (curLunchMins > 0 && effectiveInMins < lunchStartMins && effectiveOutMins > lunchEndMins) {
                        shiftWorkedMins = Math.max(0, shiftWorkedMins - curLunchMins);
                    }
                    const shiftHours = parseFloat((shiftWorkedMins / 60).toFixed(2));

                    // Giá trị ngày công
                    let workingDayValue = curDayValueTarget;
                    if (holiday) {
                        workingDayValue = 1.0;
                    } else if (dayOfWeek === 0) {
                        workingDayValue = 0;
                    } else if (shiftHours >= (curStdHours - 0.5)) {
                        workingDayValue = curDayValueTarget;
                    } else if (shiftHours >= (curStdHours / 2.0)) {
                        workingDayValue = parseFloat((curDayValueTarget / 2.0).toFixed(2));
                    } else if (shiftHours > 0) {
                        workingDayValue = parseFloat((shiftHours / curStdHours * curDayValueTarget).toFixed(2));
                    } else {
                        workingDayValue = 0;
                    }

                    // Tính số phút làm thêm ngoài giờ (OT):
                    let otHours = 0;
                    const otMinMins = parseInt(policy.ot_min_minutes, 10) || 0;

                    if (holiday) {
                        let workedMins = Math.max(0, outMins - inMins);
                        if (inMins < lunchStartMins && outMins > lunchEndMins) {
                            workedMins = Math.max(0, workedMins - (lunchBreakMins || 60));
                        }
                        otHours = parseFloat((workedMins / 60).toFixed(2));
                    } else if (dayOfWeek === 0) {
                        let workedMins = Math.max(0, outMins - inMins);
                        if (inMins < lunchStartMins && outMins > lunchEndMins) {
                            workedMins = Math.max(0, workedMins - (lunchBreakMins || 60));
                        }
                        otHours = parseFloat((workedMins / 60).toFixed(2));
                    } else if (isSat && satMode === 'OFF_AFTERNOON') {
                        // Thứ Bảy nghỉ chiều (ca sáng 08:30 - 12:00, nghỉ trưa 12:00 - 13:00)
                        if (timeParts.length > 1 && outMins > 780) {
                            const extraMins = outMins - 780;
                            if (extraMins >= otMinMins) {
                                otHours = parseFloat((extraMins / 60).toFixed(2));
                            }
                        }
                    } else {
                        // Ngày thường (Thứ 2 - Thứ 6): chỉ tính OT khi về sau giờ tan ca chuẩn
                        if (timeParts.length > 1 && outMins > curEndMins) {
                            const extraMins = outMins - curEndMins;
                            if (extraMins >= otMinMins) {
                                otHours = parseFloat((extraMins / 60).toFixed(2));
                            }
                        }
                    }

                    if (otHours < 0.05) otHours = 0;

                    // Tổng giờ làm việc thực tế hiển thị
                    let workingHours = 0;
                    if (holiday || dayOfWeek === 0) {
                        workingHours = otHours;
                    } else {
                        workingHours = parseFloat((shiftHours + otHours).toFixed(2));
                    }

                    // Tính tiền phạt đi trễ + về sớm
                    let status = 'ON_TIME';
                    let latePenalty = 0;
                    let earlyPenalty = 0;

                    if (holiday) {
                        status = 'HOLIDAY_WORK';
                    } else if (dayOfWeek === 0) {
                        status = 'SUNDAY_WORK';
                    } else {
                        if (lateMinutes > 0) {
                            if (lateMinutes <= 15) latePenalty = parseFloat(policy.penalty_late_tier1) || 20000;
                            else if (lateMinutes <= 30) latePenalty = parseFloat(policy.penalty_late_tier2) || 50000;
                            else if (lateMinutes <= 60) latePenalty = parseFloat(policy.penalty_late_tier3) || 100000;
                            else latePenalty = parseFloat(policy.penalty_late_tier4) || 200000;
                        }

                        if (earlyMinutes > 0) {
                            if (earlyMinutes <= 15) earlyPenalty = parseFloat(policy.penalty_early_tier1) || 20000;
                            else if (earlyMinutes <= 30) earlyPenalty = parseFloat(policy.penalty_early_tier2) || 50000;
                            else if (earlyMinutes <= 60) earlyPenalty = parseFloat(policy.penalty_early_tier3) || 100000;
                            else earlyPenalty = parseFloat(policy.penalty_early_tier4) || 200000;
                        }

                        if (lateMinutes > 0 && earlyMinutes > 0) status = 'LATE';
                        else if (lateMinutes > 0) status = 'LATE';
                        else if (earlyMinutes > 0) status = 'EARLY_OUT';
                    }

                    const penaltyAmount = latePenalty + earlyPenalty;
                    const noteArr = [];
                    if (holiday) {
                        noteArr.push(`Đi làm ngày Lễ: ${holiday.holiday_name} (OT Lễ x${policy.holiday_ot_rate || 3.0})`);
                    } else if (dayOfWeek === 0) {
                        noteArr.push(`Làm thêm Chủ Nhật (OT x${policy.sunday_ot_rate || 2.0})`);
                    } else {
                        if (isSat && satMode === 'OFF_AFTERNOON') noteArr.push('Ca sáng Thứ 7 (Nghỉ chiều)');
                        if (lateMinutes > 0) noteArr.push(`Đi trễ ${lateMinutes}p (-${latePenalty.toLocaleString('vi-VN')}đ)`);
                        if (earlyMinutes > 0) noteArr.push(`Về sớm ${earlyMinutes}p (-${earlyPenalty.toLocaleString('vi-VN')}đ)`);
                        if (otHours > 0) noteArr.push(`Làm thêm OT +${otHours}h`);
                        if (noteArr.length === 0) noteArr.push('Đúng giờ (Máy CC)');
                    }

                    // Lưu / Cập nhật vào attendance_daily
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
                            status = CASE WHEN attendance_daily.status = 'ADJUSTED' THEN attendance_daily.status ELSE EXCLUDED.status END,
                            penalty_amount = EXCLUDED.penalty_amount,
                            notes = EXCLUDED.notes
                    `, [
                        empId, dateStr, firstCheckIn, lastCheckOut,
                        workingHours, lateMinutes, earlyMinutes, otHours,
                        workingDayValue, status, penaltyAmount,
                        noteArr.join(' • ')
                    ]);

                    totalDaysProcessed++;
                }

                syncedEmployees++;
            }

            await client.query('COMMIT');

            // Đồng bộ sang bảng tổng hợp tháng
            return {
                success: true,
                period_key: periodKey,
                syncedEmployees,
                totalDaysProcessed,
                monthName: targetMonth.period_key
            };
        } catch (err) {
            await client.query('ROLLBACK');
            console.error('❌ Lỗi đồng bộ YunAtt vào CSDL:', err.message);
            throw err;
        } finally {
            client.release();
        }
    }
}

module.exports = new YunAttService();
