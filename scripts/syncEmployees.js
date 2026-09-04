const pool = require('../config/database');

async function syncUsersToEmployees() {
    try {
        const usersRes = await pool.query('SELECT * FROM users');
        console.log('Users to sync:', usersRes.rows.length);

        for (const u of usersRes.rows) {
            const uid = u.id || u.user_id;
            const empCode = (u.emp_id || ('EMP-' + u.username)).trim().toUpperCase();
            const fullName = u.full_name || u.username;
            let deptId = 1; // BGD
            let pos = 'Quản trị';
            let role = 'STAFF';
            let commWs = 5;
            let commBoq = 10;
            let minGp = 0;

            if (u.role === 'SALE' || u.role === 'SALES') {
                deptId = 2; // KD
                pos = 'Nhân Viên Kinh Doanh';
                commWs = 5;
                commBoq = 10;
                minGp = 10000000;
            } else if (u.role === 'KY_THUAT' || u.role === 'NHA_THAU_THI_CONG' || u.role === 'NHA_THAU_GIAM_SAT') {
                deptId = 3; // EPC
                pos = 'Kỹ Sư / Kỹ Thuật';
                commWs = 3;
                commBoq = 10;
            } else if (u.role === 'KE_TOAN') {
                deptId = 5; // TCKT
                pos = 'Kế Toán';
            } else if (u.role === 'NHAN_VIEN_KHO') {
                deptId = 4; // KHO
                pos = 'Thủ Kho';
            } else if (['ADMIN', 'SUPER_ADMIN', 'GIAM_DOC'].includes(u.role)) {
                deptId = 1; // BGD
                pos = 'Ban Giám Đốc';
                role = 'MANAGER';
            }

            const existing = await pool.query('SELECT id FROM employees WHERE UPPER(emp_code) = $1 OR user_id = $2', [empCode, uid]);
            if (existing.rows.length === 0) {
                const ins = await pool.query(`
                    INSERT INTO employees (
                        emp_code, user_id, department_id, full_name, position,
                        contract_type, start_date, status, base_salary, insurance_salary,
                        commission_rate_wholesale, commission_rate_boq, min_gross_profit_threshold,
                        department_role
                    ) VALUES ($1, $2, $3, $4, $5, 'CHINH_THUC', CURRENT_DATE, 'ACTIVE', 8000000, 5000000, $6, $7, $8, $9)
                    RETURNING id, emp_code, full_name
                `, [empCode, uid, deptId, fullName, pos, commWs, commBoq, minGp, role]);
                console.log('Inserted employee:', ins.rows[0]);
            } else {
                await pool.query(`
                    UPDATE employees SET 
                        user_id = $1, department_id = COALESCE(department_id, $2),
                        full_name = COALESCE(full_name, $3), position = COALESCE(position, $4)
                    WHERE id = $5
                `, [uid, deptId, fullName, pos, existing.rows[0].id]);
                console.log('Updated employee for user:', u.username, 'emp_code:', empCode);
            }
        }

        const allEmps = await pool.query('SELECT id, emp_code, full_name, position, user_id FROM employees');
        console.log('All employees after sync:', allEmps.rows);
    } catch(e) {
        console.error('Error syncing:', e);
    } finally {
        await pool.end();
    }
}

syncUsersToEmployees();
