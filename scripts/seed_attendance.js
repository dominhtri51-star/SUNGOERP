const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres.yxzumxqslbgxckxyiqxx:jurkeJ-hepta3-hozvut@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  console.log('🚀 Starting Attendance Seeding for August 2026...');

  const empsRes = await pool.query('SELECT * FROM employees WHERE status = $1 ORDER BY id ASC', ['ACTIVE']);
  const emps = empsRes.rows;
  console.log(`Found ${emps.length} active employees.`);

  const workDays = [
    '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08',
    '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15',
    '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22',
    '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'
  ];

  for (const emp of emps) {
    let totalActualDays = 0;
    let totalLateCount = 0;
    let totalLateMinutes = 0;
    let totalOtHours = 0;

    for (const d of workDays) {
      const isSat = new Date(d).getDay() === 6;
      const isLateDay = (emp.id % 3 === 0 && d === '2026-08-12');
      const checkInHour = isLateDay ? '08:45:00' : '08:25:00';
      const checkOutHour = isSat ? '12:05:00' : (emp.id % 2 === 0 ? '18:30:00' : '17:30:00');
      const lateMins = isLateDay ? 15 : 0;
      const otHrs = (!isSat && emp.id % 2 === 0) ? 1.0 : 0;
      const dayVal = 1.0;

      totalActualDays += 1;
      if (lateMins > 0) {
        totalLateCount++;
        totalLateMinutes += lateMins;
      }
      totalOtHours += otHrs;

      await pool.query(
        `INSERT INTO attendance_daily (
          employee_id, work_date, first_check_in, last_check_out,
          working_hours, late_minutes, early_minutes, ot_hours,
          working_day_value, status, penalty_amount, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (employee_id, work_date) DO UPDATE SET
          first_check_in = EXCLUDED.first_check_in,
          last_check_out = EXCLUDED.last_check_out,
          working_hours = EXCLUDED.working_hours,
          late_minutes = EXCLUDED.late_minutes,
          ot_hours = EXCLUDED.ot_hours,
          status = EXCLUDED.status,
          notes = EXCLUDED.notes`,
        [
          emp.id,
          d,
          `${d} ${checkInHour}`,
          `${d} ${checkOutHour}`,
          isSat ? 3.5 : 8.0,
          lateMins,
          0,
          otHrs,
          dayVal,
          lateMins > 0 ? 'LATE' : 'ON_TIME',
          0,
          'Chấm công tự động'
        ]
      );
    }

    // Monthly summary
    const periodKey = '2026-08';
    const standardDays = 26;
    const isAttendanceBonusAwarded = totalLateCount === 0;
    const attendanceBonusAmount = isAttendanceBonusAwarded ? 500000 : 0;
    const isPunctualBonusAwarded = totalLateCount === 0;
    const punctualBonusAmount = isPunctualBonusAwarded ? 300000 : 0;
    const baseSalary = parseFloat(emp.base_salary) || 8000000;
    const hourlyWage = baseSalary / (standardDays * 8.0);
    const otBonusAmount = Math.round(totalOtHours * hourlyWage * 1.5);
    const totalBonusAmount = attendanceBonusAmount + punctualBonusAmount + otBonusAmount;

    await pool.query(
      `INSERT INTO attendance_monthly_summary (
        period_key, employee_id, standard_working_days, total_actual_days,
        total_paid_leave_days, total_unpaid_leave_days, total_late_count, total_late_minutes,
        total_early_count, total_ot_hours,
        is_attendance_bonus_awarded, attendance_bonus_amount,
        is_punctual_bonus_awarded, punctual_bonus_amount,
        ot_bonus_amount, total_bonus_amount,
        total_attendance_penalty, status, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      ON CONFLICT (period_key, employee_id) DO UPDATE SET
        total_actual_days = EXCLUDED.total_actual_days,
        total_late_count = EXCLUDED.total_late_count,
        total_late_minutes = EXCLUDED.total_late_minutes,
        total_ot_hours = EXCLUDED.total_ot_hours,
        is_attendance_bonus_awarded = EXCLUDED.is_attendance_bonus_awarded,
        attendance_bonus_amount = EXCLUDED.attendance_bonus_amount,
        is_punctual_bonus_awarded = EXCLUDED.is_punctual_bonus_awarded,
        punctual_bonus_amount = EXCLUDED.punctual_bonus_amount,
        ot_bonus_amount = EXCLUDED.ot_bonus_amount,
        total_bonus_amount = EXCLUDED.total_bonus_amount,
        status = EXCLUDED.status,
        notes = EXCLUDED.notes`,
      [
        periodKey,
        emp.id,
        standardDays,
        totalActualDays,
        0,
        0,
        totalLateCount,
        totalLateMinutes,
        0,
        totalOtHours,
        isAttendanceBonusAwarded,
        attendanceBonusAmount,
        isPunctualBonusAwarded,
        punctualBonusAmount,
        otBonusAmount,
        totalBonusAmount,
        0,
        'CALCULATED',
        'Tổng hợp công tự động'
      ]
    );
  }

  console.log('✅ Successfully seeded attendance and monthly summary for all employees!');
  await pool.end();
}

main().catch(err => {
  console.error('❌ Error seeding attendance:', err);
  process.exit(1);
});
