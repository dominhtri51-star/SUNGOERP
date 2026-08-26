const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// ==========================================
// 1. PHÒNG BAN (DEPARTMENTS)
// ==========================================

// Lấy danh sách phòng ban
router.get('/departments', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT d.*, 
                   COUNT(e.id) AS total_employees,
                   e_mgr.full_name AS manager_name
            FROM departments d
            LEFT JOIN employees e ON e.department_id = d.id AND e.status = 'ACTIVE'
            LEFT JOIN employees e_mgr ON d.manager_emp_id = e_mgr.id
            GROUP BY d.id, e_mgr.full_name
            ORDER BY d.id ASC
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('Lỗi lấy danh sách phòng ban:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Thêm phòng ban
router.post('/departments', async (req, res) => {
    try {
        const { dept_code, dept_name, manager_emp_id, description } = req.body;
        const result = await pool.query(
            "INSERT INTO departments (dept_code, dept_name, manager_emp_id, description) VALUES ($1, $2, $3, $4) RETURNING *",
            [dept_code, dept_name, manager_emp_id || null, description || '']
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Sửa phòng ban
router.put('/departments/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { dept_code, dept_name, manager_emp_id, description } = req.body;
        const result = await pool.query(
            "UPDATE departments SET dept_code = $1, dept_name = $2, manager_emp_id = $3, description = $4 WHERE id = $5 RETURNING *",
            [dept_code, dept_name, manager_emp_id || null, description || '', id]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Xóa phòng ban
router.delete('/departments/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("UPDATE employees SET department_id = NULL WHERE department_id = $1", [id]);
        await pool.query("DELETE FROM departments WHERE id = $1", [id]);
        res.json({ success: true, message: 'Đã xóa phòng ban' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 2. HỒ SƠ NHÂN SỰ (EMPLOYEES)
// ==========================================

// Lấy danh sách nhân viên (kèm bộ lọc & phân cấp quản lý)
router.get('/employees', async (req, res) => {
    try {
        const { department_id, status, search, manager_id, role } = req.query;
        let query = `
            SELECT e.*, 
                   d.dept_name,
                   d.dept_code,
                   u.username,
                   u.role AS user_role,
                   m.full_name AS manager_name,
                   m.emp_code AS manager_code,
                   ins.bhxh_code,
                   ins.bhyt_code,
                   ins.hospital_name,
                   ins.has_bhxh,
                   ins.has_bhyt,
                   ins.has_bhtn,
                   ins.has_kpcd,
                   ins.status AS insurance_status
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.id
            LEFT JOIN users u ON e.user_id = u.id OR e.user_id = u.user_id
            LEFT JOIN employees m ON e.manager_id = m.id
            LEFT JOIN employee_insurances ins ON e.id = ins.employee_id
            WHERE 1=1
        `;
        const params = [];

        if (department_id) {
            params.push(department_id);
            query += ` AND e.department_id = $${params.length}`;
        }
        if (manager_id) {
            params.push(manager_id);
            query += ` AND e.manager_id = $${params.length}`;
        }
        if (role) {
            params.push(role);
            query += ` AND e.department_role = $${params.length}`;
        }
        if (status) {
            params.push(status);
            query += ` AND e.status = $${params.length}`;
        }
        if (search) {
            params.push(`%${search}%`);
            query += ` AND (e.full_name ILIKE $${params.length} OR e.emp_code ILIKE $${params.length} OR e.phone ILIKE $${params.length} OR e.position ILIKE $${params.length})`;
        }

        query += " ORDER BY e.id ASC";
        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('Lỗi lấy danh sách nhân viên:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Thống kê nhanh tổng quan nhân sự
router.get('/summary', async (req, res) => {
    try {
        const totalRes = await pool.query(`
            SELECT 
                COUNT(*) AS total_employees,
                COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END) AS active_employees,
                COUNT(CASE WHEN contract_type = 'CHINH_THUC' AND status = 'ACTIVE' THEN 1 END) AS official_employees,
                COUNT(CASE WHEN contract_type = 'THU_VIEC' AND status = 'ACTIVE' THEN 1 END) AS probation_employees,
                COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN base_salary ELSE 0 END), 0) AS total_base_salary_fund,
                COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN insurance_salary ELSE 0 END), 0) AS total_insurance_fund
            FROM employees
        `);
        res.json({ success: true, data: totalRes.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Lấy danh sách tài khoản RBAC để liên kết với nhân sự
router.get('/rbac-users', async (req, res) => {
    try {
        const usersRes = await pool.query("SELECT id, user_id, emp_id, username, full_name, role FROM users ORDER BY id ASC");
        res.json({ success: true, data: usersRes.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Lấy chi tiết 1 nhân viên
router.get('/employees/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT e.*, 
                   d.dept_name,
                   d.dept_code,
                   u.username,
                   u.role AS user_role,
                   m.full_name AS manager_name,
                   m.emp_code AS manager_code,
                   ins.bhxh_code,
                   ins.bhyt_code,
                   ins.hospital_name,
                   ins.has_bhxh,
                   ins.has_bhyt,
                   ins.has_bhtn,
                   ins.has_kpcd,
                   ins.status AS insurance_status
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.id
            LEFT JOIN users u ON e.user_id = u.id OR e.user_id = u.user_id
            LEFT JOIN employees m ON e.manager_id = m.id
            LEFT JOIN employee_insurances ins ON e.id = ins.employee_id
            WHERE e.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy nhân viên' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Thêm nhân viên mới (Bắt buộc Mã NV & Tự động liên kết Phân quyền RBAC & Cấu hình Hoa hồng)
router.post('/employees', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const {
            emp_code, user_id, department_id, full_name, gender, dob, id_card_number,
            phone, email, address, position, contract_type, start_date, end_date,
            status, base_salary, insurance_salary, bank_account_no, bank_name, bank_branch,
            commission_rate_wholesale, commission_rate_boq, min_gross_profit_threshold,
            department_role, manager_id,
            bhxh_code, bhyt_code, hospital_name, has_bhxh, has_bhyt, has_bhtn, has_kpcd
        } = req.body;

        const finalEmpCode = (emp_code || '').trim().toUpperCase();
        if (!finalEmpCode) {
            return res.status(400).json({
                success: false,
                error: 'MÃ NHÂN VIÊN LÀ BẮT BUỘC! Mã này dùng để liên kết với tài khoản phân quyền RBAC và đo lường KPI bán hàng.'
            });
        }

        // Kiểm tra trùng mã nhân viên
        const checkDuplicate = await client.query("SELECT id FROM employees WHERE emp_code = $1", [finalEmpCode]);
        if (checkDuplicate.rows.length > 0) {
            return res.status(400).json({ success: false, error: `Mã nhân viên "${finalEmpCode}" đã tồn tại trong hệ thống!` });
        }

        // Tự động tìm và liên kết tài khoản RBAC tương ứng
        let finalUserId = user_id || null;
        if (!finalUserId) {
            const matchUser = await client.query("SELECT id, user_id FROM users WHERE UPPER(emp_id) = $1 OR UPPER(username) = $1", [finalEmpCode]);
            if (matchUser.rows.length > 0) {
                finalUserId = matchUser.rows[0].id || matchUser.rows[0].user_id;
            }
        }

        // Nếu có user_id, đồng bộ lại emp_id và full_name trong bảng users
        if (finalUserId) {
            await client.query(
                "UPDATE users SET emp_id = $1, full_name = COALESCE($2, full_name) WHERE id = $3 OR user_id = $3",
                [finalEmpCode, full_name, finalUserId]
            );
        }

        const empRes = await client.query(`
            INSERT INTO employees (
                emp_code, user_id, department_id, full_name, gender, dob, id_card_number,
                phone, email, address, position, contract_type, start_date, end_date,
                status, base_salary, insurance_salary, bank_account_no, bank_name, bank_branch,
                commission_rate_wholesale, commission_rate_boq, min_gross_profit_threshold,
                department_role, manager_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
            RETURNING *
        `, [
            finalEmpCode, finalUserId, department_id || null, full_name, gender || 'Nam',
            dob || null, id_card_number || '', phone || '', email || '', address || '',
            position || '', contract_type || 'CHINH_THUC', start_date || new Date(),
            end_date || null, status || 'ACTIVE', parseFloat(base_salary) || 0,
            parseFloat(insurance_salary) || 0, bank_account_no || '', bank_name || '', bank_branch || '',
            parseFloat(commission_rate_wholesale) !== undefined && !isNaN(parseFloat(commission_rate_wholesale)) ? parseFloat(commission_rate_wholesale) : 5,
            parseFloat(commission_rate_boq) !== undefined && !isNaN(parseFloat(commission_rate_boq)) ? parseFloat(commission_rate_boq) : 10,
            parseFloat(min_gross_profit_threshold) || 0,
            department_role || 'STAFF', manager_id || null
        ]);
        const employee = empRes.rows[0];

        // Tạo hồ sơ bảo hiểm
        await client.query(`
            INSERT INTO employee_insurances (
                employee_id, bhxh_code, bhyt_code, hospital_name,
                has_bhxh, has_bhyt, has_bhtn, has_kpcd, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DANG_DONG')
            ON CONFLICT (employee_id) DO UPDATE SET
                bhxh_code = EXCLUDED.bhxh_code,
                bhyt_code = EXCLUDED.bhyt_code,
                hospital_name = EXCLUDED.hospital_name,
                has_bhxh = EXCLUDED.has_bhxh,
                has_bhyt = EXCLUDED.has_bhyt,
                has_bhtn = EXCLUDED.has_bhtn,
                has_kpcd = EXCLUDED.has_kpcd
        `, [
            employee.id, bhxh_code || '', bhyt_code || '', hospital_name || '',
            has_bhxh !== false, has_bhyt !== false, has_bhtn !== false, has_kpcd !== false
        ]);

        await client.query('COMMIT');
        res.json({ success: true, data: employee });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Lỗi thêm nhân viên:', err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// Cập nhật thông tin nhân viên (Đồng bộ RBAC User & Hoa hồng & Quản lý)
router.put('/employees/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const {
            emp_code, user_id, department_id, full_name, gender, dob, id_card_number,
            phone, email, address, position, contract_type, start_date, end_date,
            status, base_salary, insurance_salary, bank_account_no, bank_name, bank_branch,
            commission_rate_wholesale, commission_rate_boq, min_gross_profit_threshold,
            department_role, manager_id,
            bhxh_code, bhyt_code, hospital_name, has_bhxh, has_bhyt, has_bhtn, has_kpcd, insurance_status
        } = req.body;

        const finalEmpCode = (emp_code || '').trim().toUpperCase();
        if (!finalEmpCode) {
            return res.status(400).json({ success: false, error: 'Mã nhân viên là bắt buộc!' });
        }

        // Tự động tìm user_id nếu chưa chọn
        let finalUserId = user_id || null;
        if (!finalUserId) {
            const matchUser = await client.query("SELECT id, user_id FROM users WHERE UPPER(emp_id) = $1 OR UPPER(username) = $1", [finalEmpCode]);
            if (matchUser.rows.length > 0) {
                finalUserId = matchUser.rows[0].id || matchUser.rows[0].user_id;
            }
        }

        // Đồng bộ sang bảng users
        if (finalUserId) {
            await client.query(
                "UPDATE users SET emp_id = $1, full_name = COALESCE($2, full_name) WHERE id = $3 OR user_id = $3",
                [finalEmpCode, full_name, finalUserId]
            );
        }

        const empRes = await client.query(`
            UPDATE employees SET
                emp_code = $1, user_id = $2, department_id = $3, full_name = $4,
                gender = $5, dob = $6, id_card_number = $7, phone = $8,
                email = $9, address = $10, position = $11, contract_type = $12,
                start_date = $13, end_date = $14, status = $15, base_salary = $16,
                insurance_salary = $17, bank_account_no = $18, bank_name = $19, bank_branch = $20,
                commission_rate_wholesale = $21, commission_rate_boq = $22, min_gross_profit_threshold = $23,
                department_role = $24, manager_id = $25
            WHERE id = $26 RETURNING *
        `, [
            finalEmpCode, finalUserId, department_id || null, full_name, gender || 'Nam',
            dob || null, id_card_number || '', phone || '', email || '', address || '',
            position || '', contract_type || 'CHINH_THUC', start_date || new Date(),
            end_date || null, status || 'ACTIVE', parseFloat(base_salary) || 0,
            parseFloat(insurance_salary) || 0, bank_account_no || '', bank_name || '', bank_branch || '',
            parseFloat(commission_rate_wholesale) !== undefined && !isNaN(parseFloat(commission_rate_wholesale)) ? parseFloat(commission_rate_wholesale) : 5,
            parseFloat(commission_rate_boq) !== undefined && !isNaN(parseFloat(commission_rate_boq)) ? parseFloat(commission_rate_boq) : 10,
            parseFloat(min_gross_profit_threshold) || 0,
            department_role || 'STAFF', manager_id || null,
            id
        ]);

        // Cập nhật bảo hiểm
        await client.query(`
            INSERT INTO employee_insurances (
                employee_id, bhxh_code, bhyt_code, hospital_name,
                has_bhxh, has_bhyt, has_bhtn, has_kpcd, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (employee_id) DO UPDATE SET
                bhxh_code = EXCLUDED.bhxh_code,
                bhyt_code = EXCLUDED.bhyt_code,
                hospital_name = EXCLUDED.hospital_name,
                has_bhxh = EXCLUDED.has_bhxh,
                has_bhyt = EXCLUDED.has_bhyt,
                has_bhtn = EXCLUDED.has_bhtn,
                has_kpcd = EXCLUDED.has_kpcd,
                status = EXCLUDED.status
        `, [
            id, bhxh_code || '', bhyt_code || '', hospital_name || '',
            has_bhxh !== false, has_bhyt !== false, has_bhtn !== false, has_kpcd !== false,
            insurance_status || 'DANG_DONG'
        ]);

        await client.query('COMMIT');
        res.json({ success: true, data: empRes.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Lỗi cập nhật nhân viên:', err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// Xóa nhân viên
router.delete('/employees/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("DELETE FROM employee_insurances WHERE employee_id = $1", [id]);
        await pool.query("DELETE FROM employees WHERE id = $1", [id]);
        res.json({ success: true, message: 'Đã xóa nhân viên thành công' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
