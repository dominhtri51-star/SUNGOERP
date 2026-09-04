const pool = require('../config/database');
const attendanceRouter = require('../api/attendance.route');
const payrollRouter = require('../api/payroll.route');

async function runAttendanceVerification() {
    console.log('🧪 Bắt đầu kiểm thử toàn diện: TÍCH HỢP MÁY CHẤM CÔNG & KỊCH BẢN THƯỞNG PHẠT...');
    try {
        await require('../config/initDb')();

        console.log('\n--- 1. Cấu hình Chính Sách Chấm Công & Thưởng Phạt ---');
        await pool.query(`
            UPDATE attendance_policies SET
                work_start_time = '08:00',
                work_end_time = '17:30',
                lunch_start_time = '12:00',
                lunch_end_time = '13:30',
                grace_period_minutes = 5,
                free_late_count = 3,
                bonus_attendance_amount = 500000,
                penalty_late_tier1 = 20000,
                penalty_late_tier2 = 50000,
                penalty_late_tier3 = 100000,
                penalty_late_tier4 = 200000,
                penalty_accumulated_late_5 = 200000,
                penalty_unauthorized_absent = 200000
            WHERE id = 1
        `);
        console.log('✅ Đã cập nhật chính sách ca 08:00-17:30, Thưởng chuyên cần 500k, Phạt trễ 20k-50k-100k-200k.');

        console.log('\n--- 2. Tạo 3 Nhân viên thử nghiệm ---');
        // NV1: Gương mẫu
        const emp1 = await pool.query(`
            INSERT INTO employees (emp_code, full_name, position, department_role, status, base_salary)
            VALUES ('EMP_ATT_1', 'Nguyễn Gương Mẫu', 'Chuyên Viên Kinh Doanh', 'STAFF', 'ACTIVE', 10000000)
            ON CONFLICT (emp_code) DO UPDATE SET base_salary = 10000000 RETURNING id
        `);
        const id1 = emp1.rows[0].id;

        // NV2: Đi trễ nhiều lần
        const emp2 = await pool.query(`
            INSERT INTO employees (emp_code, full_name, position, department_role, status, base_salary)
            VALUES ('EMP_ATT_2', 'Trần Hay Đi Trễ', 'Chuyên Viên Kỹ Thuật', 'STAFF', 'ACTIVE', 10000000)
            ON CONFLICT (emp_code) DO UPDATE SET base_salary = 10000000 RETURNING id
        `);
        const id2 = emp2.rows[0].id;

        // NV3: Làm thiếu giờ & nghỉ không phép
        const emp3 = await pool.query(`
            INSERT INTO employees (emp_code, full_name, position, department_role, status, base_salary)
            VALUES ('EMP_ATT_3', 'Lê Nghỉ Không Phép', 'Nhân Viên Kho', 'STAFF', 'ACTIVE', 10000000)
            ON CONFLICT (emp_code) DO UPDATE SET base_salary = 10000000 RETURNING id
        `);
        const id3 = emp3.rows[0].id;

        console.log(`✅ Đã tạo 3 nhân viên: EMP_ATT_1 (ID=${id1}), EMP_ATT_2 (ID=${id2}), EMP_ATT_3 (ID=${id3})`);

        console.log('\n--- 3. Import Nhật Ký Chấm Công Tháng 2026-08 (Mô phỏng máy chấm công) ---');
        const periodKey = '2026-08';

        // Xóa logs cũ của 3 nhân viên này
        await pool.query("DELETE FROM attendance_daily WHERE employee_id IN ($1, $2, $3)", [id1, id2, id3]);
        await pool.query("DELETE FROM attendance_logs WHERE employee_id IN ($1, $2, $3)", [id1, id2, id3]);
        await pool.query("DELETE FROM attendance_monthly_summary WHERE employee_id IN ($1, $2, $3)", [id1, id2, id3]);

        const simulatedLogs = [];

        // 1. Tạo 26 ngày công cho NV1 (07:50 - 17:35 -> đúng giờ tuyệt đối)
        for (let day = 1; day <= 26; day++) {
            const dayStr = String(day).padStart(2, '0');
            simulatedLogs.push({ emp_code: 'EMP_ATT_1', scan_time: `2026-08-${dayStr} 07:50:00`, scan_type: 'CHECK_IN' });
            simulatedLogs.push({ emp_code: 'EMP_ATT_1', scan_time: `2026-08-${dayStr} 17:35:00`, scan_type: 'CHECK_OUT' });
        }

        // 2. Tạo 26 ngày cho NV2 (20 ngày đúng giờ, 6 ngày trễ các mức khác nhau)
        for (let day = 1; day <= 20; day++) {
            const dayStr = String(day).padStart(2, '0');
            simulatedLogs.push({ emp_code: 'EMP_ATT_2', scan_time: `2026-08-${dayStr} 07:55:00`, scan_type: 'CHECK_IN' });
            simulatedLogs.push({ emp_code: 'EMP_ATT_2', scan_time: `2026-08-${dayStr} 17:30:00`, scan_type: 'CHECK_OUT' });
        }
        // 2 lần trễ 10p (08:10) -> Tier 1 (20k/lần)
        simulatedLogs.push({ emp_code: 'EMP_ATT_2', scan_time: '2026-08-21 08:10:00', scan_type: 'CHECK_IN' });
        simulatedLogs.push({ emp_code: 'EMP_ATT_2', scan_time: '2026-08-21 17:30:00', scan_type: 'CHECK_OUT' });
        simulatedLogs.push({ emp_code: 'EMP_ATT_2', scan_time: '2026-08-22 08:10:00', scan_type: 'CHECK_IN' });
        simulatedLogs.push({ emp_code: 'EMP_ATT_2', scan_time: '2026-08-22 17:30:00', scan_type: 'CHECK_OUT' });
        // 2 lần trễ 25p (08:25) -> Tier 2 (50k/lần)
        simulatedLogs.push({ emp_code: 'EMP_ATT_2', scan_time: '2026-08-23 08:25:00', scan_type: 'CHECK_IN' });
        simulatedLogs.push({ emp_code: 'EMP_ATT_2', scan_time: '2026-08-23 17:30:00', scan_type: 'CHECK_OUT' });
        simulatedLogs.push({ emp_code: 'EMP_ATT_2', scan_time: '2026-08-24 08:25:00', scan_type: 'CHECK_IN' });
        simulatedLogs.push({ emp_code: 'EMP_ATT_2', scan_time: '2026-08-24 17:30:00', scan_type: 'CHECK_OUT' });
        // 2 lần trễ 40p (08:40) -> Tier 3 (100k/lần)
        simulatedLogs.push({ emp_code: 'EMP_ATT_2', scan_time: '2026-08-25 08:40:00', scan_type: 'CHECK_IN' });
        simulatedLogs.push({ emp_code: 'EMP_ATT_2', scan_time: '2026-08-25 17:30:00', scan_type: 'CHECK_OUT' });
        simulatedLogs.push({ emp_code: 'EMP_ATT_2', scan_time: '2026-08-26 08:40:00', scan_type: 'CHECK_IN' });
        simulatedLogs.push({ emp_code: 'EMP_ATT_2', scan_time: '2026-08-26 17:30:00', scan_type: 'CHECK_OUT' });

        // 3. Tạo cho NV3: 22 ngày đủ công + 2 ngày làm nửa buổi (08:00 - 12:00 = 4h -> 0.5 công) + 2 ngày vắng
        for (let day = 1; day <= 22; day++) {
            const dayStr = String(day).padStart(2, '0');
            simulatedLogs.push({ emp_code: 'EMP_ATT_3', scan_time: `2026-08-${dayStr} 07:55:00`, scan_type: 'CHECK_IN' });
            simulatedLogs.push({ emp_code: 'EMP_ATT_3', scan_time: `2026-08-${dayStr} 17:30:00`, scan_type: 'CHECK_OUT' });
        }
        // 2 ngày làm nửa buổi
        simulatedLogs.push({ emp_code: 'EMP_ATT_3', scan_time: '2026-08-23 08:00:00', scan_type: 'CHECK_IN' });
        simulatedLogs.push({ emp_code: 'EMP_ATT_3', scan_time: '2026-08-23 12:00:00', scan_type: 'CHECK_OUT' });
        simulatedLogs.push({ emp_code: 'EMP_ATT_3', scan_time: '2026-08-24 08:00:00', scan_type: 'CHECK_IN' });
        simulatedLogs.push({ emp_code: 'EMP_ATT_3', scan_time: '2026-08-24 12:00:00', scan_type: 'CHECK_OUT' });

        // Gọi API Import logs
        const importHandler = attendanceRouter.stack.find(s => s.route && s.route.path === '/import-logs' && s.route.methods.post)?.route.stack[0].handle;
        let importResult;
        await importHandler({ body: { logs: simulatedLogs, source: 'EXCEL_IMPORT' } }, {
            json: (data) => { importResult = data; console.log(data.message); },
            status: () => ({ json: (d) => console.error(d) })
        });

        // 4. Đồng bộ tổng hợp công tháng (Sync Monthly)
        console.log('\n--- 4. Đồng Bộ Tổng Hợp Công Tháng (/api/attendance/sync-monthly) ---');
        const syncMonthlyHandler = attendanceRouter.stack.find(s => s.route && s.route.path === '/sync-monthly' && s.route.methods.post)?.route.stack[0].handle;
        await syncMonthlyHandler({ body: { period_key: periodKey } }, {
            json: (data) => console.log(data.message),
            status: () => ({ json: () => {} })
        });

        // 5. Kiểm tra kết quả tổng hợp công tháng
        console.log('\n--- 5. Kiểm Tra Bảng Tổng Hợp Công Tháng (attendance_monthly_summary) ---');
        const summaryRows = await pool.query(`
            SELECT ams.*, e.emp_code, e.full_name
            FROM attendance_monthly_summary ams
            JOIN employees e ON ams.employee_id = e.id
            WHERE ams.period_key = $1 AND ams.employee_id IN ($2, $3, $4)
            ORDER BY e.emp_code ASC
        `, [periodKey, id1, id2, id3]);

        console.table(summaryRows.rows.map(r => ({
            emp_code: r.emp_code,
            full_name: r.full_name,
            actual_days: r.total_actual_days + '/' + r.standard_working_days,
            late_count: r.total_late_count,
            late_mins: r.total_late_minutes + 'p',
            bonus_awarded: r.is_attendance_bonus_awarded ? `+${Number(r.attendance_bonus_amount).toLocaleString('vi-VN')} đ` : '0 đ (Cắt thưởng)',
            penalties: `-${Number(r.total_attendance_penalty).toLocaleString('vi-VN')} đ`
        })));

        const row1 = summaryRows.rows.find(r => r.employee_id === id1);
        const row2 = summaryRows.rows.find(r => r.employee_id === id2);
        const row3 = summaryRows.rows.find(r => r.employee_id === id3);

        // Kiểm tra NV1: Đủ 26 công, 0 trễ, được thưởng 500k, 0 phạt
        if (parseFloat(row1.total_actual_days) !== 26 || !row1.is_attendance_bonus_awarded || parseFloat(row1.attendance_bonus_amount) !== 500000 || parseFloat(row1.total_attendance_penalty) !== 0) {
            throw new Error('❌ Lỗi kết quả NV1 (Gương mẫu): Không đúng chuẩn thưởng chuyên cần!');
        }

        // Kiểm tra NV2: 26 công, 6 lần trễ, 0 thưởng, phạt = (2*20k + 2*50k + 2*100k) + 200k phạt tích lũy = 540k
        if (row2.is_attendance_bonus_awarded || parseFloat(row2.total_attendance_penalty) !== 540000) {
            throw new Error(`❌ Lỗi kết quả NV2 (Đi trễ): Kì vọng phạt 540.000 đ và cắt thưởng, thực tế phạt ${row2.total_attendance_penalty} đ`);
        }

        // Kiểm tra NV3: 22 ngày 1.0 + 2 ngày 0.5 = 23.0 công
        if (parseFloat(row3.total_actual_days) !== 23.0 || row3.is_attendance_bonus_awarded) {
            throw new Error(`❌ Lỗi kết quả NV3 (Thiếu giờ): Kì vọng 23.0 ngày công, thực tế ${row3.total_actual_days}`);
        }

        console.log('✅ KIỂM TRA THƯỞNG PHẠT CHẤM CÔNG HOÀN HẢO 100%!');

        // 6. Kiểm tra tích hợp vào Bảng Lương Tháng (/api/payroll/generate)
        console.log('\n--- 6. Kiểm Tra Tự Động Đưa Vào Bảng Lương Tháng (/api/payroll/generate) ---');
        const payrollGenHandler = payrollRouter.stack.find(s => s.route && s.route.path === '/generate' && s.route.methods.post)?.route.stack[0].handle;
        await payrollGenHandler({ body: { period_key: periodKey, standard_working_days: 26 } }, {
            json: (data) => console.log('Payroll generate:', data.message),
            status: () => ({ json: () => {} })
        });

        const payrollItemRows = await pool.query(`
            SELECT pi.*, e.emp_code, e.full_name
            FROM payroll_items pi
            JOIN payrolls p ON pi.payroll_id = p.id
            JOIN employees e ON pi.employee_id = e.id
            WHERE p.period_key = $1 AND pi.employee_id IN ($2, $3, $4)
            ORDER BY e.emp_code ASC
        `, [periodKey, id1, id2, id3]);

        console.table(payrollItemRows.rows.map(pi => ({
            emp_code: pi.emp_code,
            full_name: pi.full_name,
            actual_days: pi.actual_working_days + '/26',
            salary_by_days: Number(pi.salary_by_days).toLocaleString('vi-VN') + ' đ',
            bonus_amount: `+${Number(pi.bonus_amount).toLocaleString('vi-VN')} đ`,
            penalty_deduction: `-${Number(pi.deduction_penalty).toLocaleString('vi-VN')} đ`,
            net_salary: Number(pi.net_salary).toLocaleString('vi-VN') + ' đ'
        })));

        const pi1 = payrollItemRows.rows.find(r => r.employee_id === id1);
        const pi2 = payrollItemRows.rows.find(r => r.employee_id === id2);
        const pi3 = payrollItemRows.rows.find(r => r.employee_id === id3);

        // NV1: nhận 500k thưởng chuyên cần
        if (parseFloat(pi1.bonus_amount) !== 500000) {
            throw new Error(`❌ Phiếu lương NV1 không chứa đúng 500k thưởng chuyên cần! Thực tế: ${pi1.bonus_amount}`);
        }
        // NV2: bị trừ 540k tiền phạt
        if (parseFloat(pi2.deduction_penalty) !== 540000) {
            throw new Error(`❌ Phiếu lương NV2 không chứa đúng 540k tiền phạt! Thực tế: ${pi2.deduction_penalty}`);
        }
        // NV3: lương tính theo 23 công
        const expectedSalary3 = Math.round((10000000 / 26) * 23);
        if (parseFloat(pi3.salary_by_days) !== expectedSalary3) {
            throw new Error(`❌ Phiếu lương NV3 không khớp 23 ngày công! Kì vọng: ${expectedSalary3}, Thực tế: ${pi3.salary_by_days}`);
        }

        console.log('\n--- 7. Dọn dẹp dữ liệu test ---');
        await pool.query("DELETE FROM payroll_items WHERE employee_id IN ($1, $2, $3)", [id1, id2, id3]);
        await pool.query("DELETE FROM attendance_daily WHERE employee_id IN ($1, $2, $3)", [id1, id2, id3]);
        await pool.query("DELETE FROM attendance_logs WHERE employee_id IN ($1, $2, $3)", [id1, id2, id3]);
        await pool.query("DELETE FROM attendance_monthly_summary WHERE employee_id IN ($1, $2, $3)", [id1, id2, id3]);
        await pool.query("DELETE FROM employees WHERE id IN ($1, $2, $3)", [id1, id2, id3]);

        console.log('\n========================================================================');
        console.log('🎉 TẤT CẢ KIỂM THỬ CHẤM CÔNG, THƯỞNG CHUYÊN CẦN & PHẠT ĐI TRỄ THÀNH CÔNG 100%!');
        console.log('========================================================================');
    } catch (err) {
        console.error('❌ Lỗi kiểm thử:', err.message, err.stack);
    } finally {
        await pool.end();
    }
}

runAttendanceVerification();
