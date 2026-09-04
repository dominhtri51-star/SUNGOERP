const pool = require('../config/database');
const commissionsRouter = require('../api/commissions.route');
const payrollRouter = require('../api/payroll.route');

async function runVerification() {
    console.log('🧪 Bắt đầu kiểm thử: TÍNH HOA HỒNG TRÊN PHẦN VƯỢT ĐIỂM HÒA VỐN (MARGINAL BREAK-EVEN)...');
    try {
        await require('../config/initDb')();

        console.log('\n--- 1. Thiết lập Trưởng phòng (MGR_TEST) & Nhân viên cấp dưới (STAFF_TEST) ---');
        
        // 1. Trưởng phòng
        let mgrRes = await pool.query("SELECT id FROM employees WHERE emp_code = 'MGR_TEST'");
        let mgrId;
        if (mgrRes.rows.length === 0) {
            const newMgr = await pool.query(`
                INSERT INTO employees (
                    emp_code, full_name, position, department_role, status,
                    commission_rate_wholesale, commission_rate_boq,
                    commission_rate_manager_wholesale, commission_rate_manager_boq,
                    min_gross_profit_threshold, base_salary
                ) VALUES (
                    'MGR_TEST', 'Trần Trưởng Phòng', 'Trưởng Phòng Kinh Doanh', 'MANAGER', 'ACTIVE',
                    5, 10, 2, 3, 0, 15000000
                ) RETURNING id
            `);
            mgrId = newMgr.rows[0].id;
        } else {
            mgrId = mgrRes.rows[0].id;
            await pool.query(`
                UPDATE employees SET
                    department_role = 'MANAGER',
                    commission_rate_manager_wholesale = 2,
                    commission_rate_manager_boq = 3,
                    min_gross_profit_threshold = 0
                WHERE id = $1
            `, [mgrId]);
        }

        // 2. Nhân viên cấp dưới với ĐIỂM HÒA VỐN 50 TRIỆU (min_gross_profit_threshold = 50.000.000)
        const staffThreshold = 50000000;
        let staffRes = await pool.query("SELECT id FROM employees WHERE emp_code = 'STAFF_TEST'");
        let staffId;
        if (staffRes.rows.length === 0) {
            const newStaff = await pool.query(`
                INSERT INTO employees (
                    emp_code, full_name, position, department_role, status,
                    commission_rate_wholesale, commission_rate_boq,
                    manager_id, min_gross_profit_threshold, base_salary
                ) VALUES (
                    'STAFF_TEST', 'Lê Nhân Viên Sale', 'Chuyên Viên Kinh Doanh Sỉ', 'STAFF', 'ACTIVE',
                    5, 10, $1, $2, 8000000
                ) RETURNING id
            `, [mgrId, staffThreshold]);
            staffId = newStaff.rows[0].id;
        } else {
            staffId = staffRes.rows[0].id;
            await pool.query(`
                UPDATE employees SET
                    department_role = 'STAFF',
                    manager_id = $1,
                    commission_rate_wholesale = 5,
                    commission_rate_boq = 10,
                    min_gross_profit_threshold = $2
                WHERE id = $3
            `, [mgrId, staffThreshold, staffId]);
        }
        console.log(`✅ Trưởng phòng: ID=${mgrId}, Mã=MGR_TEST (% QL Sỉ=2%, % QL BOQ=3%)`);
        console.log(`✅ Nhân viên cấp dưới: ID=${staffId}, Mã=STAFF_TEST (% Sỉ=5%, Điểm Hòa Vốn = 50.000.000 đ)`);

        // TEST KỊCH BẢN 1: ĐƠN HÀNG VƯỢT ĐIỂM HÒA VỐN (LN GỘP = 80 TRIỆU -> VƯỢT 30 TRIỆU)
        console.log('\n--- 2. Kịch bản 1: Cấp dưới đạt LN Gộp 80 Tr (Vượt điểm hòa vốn 30 Tr) ---');
        const testOrderCode1 = 'DH-MGR-TEST-EXCESS-' + Date.now();
        const orderInsert1 = await pool.query(`
            INSERT INTO orders (
                order_code, customer_name, total_amount, paid_amount, status, employee_id, created_at
            ) VALUES ($1, 'Khách Hàng Đơn Lớn', 320000000, 320000000, 'COMPLETED', $2, NOW())
            RETURNING id, order_code
        `, [testOrderCode1, staffId]);
        const testOrder1 = orderInsert1.rows[0];

        // Tạo order items có LN gộp 80 triệu (320tr - 240tr = 80tr)
        await pool.query(`
            INSERT INTO order_items (order_id, quantity, price, total)
            VALUES ($1, 32, 10000000, 320000000)
        `, [testOrder1.id]);

        // Kích hoạt sync-orders
        const syncOrdersHandler = commissionsRouter.stack.find(s => s.route && s.route.path === '/sync-orders' && s.route.methods.post)?.route.stack[0].handle;
        await syncOrdersHandler({}, { json: () => {}, status: () => ({ json: () => {} }) });

        // Đánh dấu bản ghi sang ELIGIBLE
        await pool.query("UPDATE sales_commissions SET paid_status = 'ELIGIBLE' WHERE ref_id = $1", [String(testOrder1.id)]);

        // Gọi Summary API
        let summaryResult1;
        const getSummaryHandler = commissionsRouter.stack.find(s => s.route && s.route.path === '/summary' && s.route.methods.get)?.route.stack[0].handle;
        await getSummaryHandler({ query: { user_role: 'ADMIN', user_empid: 'EMP001' } }, { json: (data) => { summaryResult1 = data; }, status: () => ({ json: () => {} }) });

        const staffSummary1 = summaryResult1.byEmployee.find(e => e.employee_id === staffId);
        const mgrSummary1 = summaryResult1.byEmployee.find(e => e.employee_id === mgrId);

        console.log('Kết quả Kịch bản 1 (Vượt điểm hòa vốn):');
        console.log(`   • Sale STAFF_TEST: LN Gộp = ${staffSummary1.direct_gross_profit.toLocaleString('vi-VN')} đ | Ngưỡng = ${staffSummary1.min_gross_profit_threshold.toLocaleString('vi-VN')} đ`);
        console.log(`   • Phần vượt hòa vốn: ${staffSummary1.excess_gross_profit.toLocaleString('vi-VN')} đ (Tỷ lệ vượt: ${(staffSummary1.excess_ratio * 100).toFixed(1)}%)`);
        console.log(`   • Hoa hồng Sale thực nhận (5% trên 30Tr vượt): ${staffSummary1.total_commission.toLocaleString('vi-VN')} đ`);
        console.log(`   • Hoa hồng Quản lý Trưởng phòng thực nhận (2% trên 30Tr vượt): ${mgrSummary1.manager_commission.toLocaleString('vi-VN')} đ`);

        if (staffSummary1.total_commission !== 1500000) {
            throw new Error(`❌ Sai hoa hồng Sale: Kì vọng 1.500.000 đ (5% của 30Tr vượt), nhận được ${staffSummary1.total_commission} đ`);
        }
        if (mgrSummary1.manager_commission !== 600000) {
            throw new Error(`❌ Sai hoa hồng Quản lý: Kì vọng 600.000 đ (2% của 30Tr vượt), nhận được ${mgrSummary1.manager_commission} đ`);
        }
        console.log('✅ KỊCH BẢN 1 ĐẠT 100% CHUẨN XÁC!');

        // TEST KỊCH BẢN 2: CẤP DƯỚI CHƯA ĐẠT ĐIỂM HÒA VỐN (LN GỘP = 40 TRIỆU <= 50 TRIỆU)
        console.log('\n--- 3. Kịch bản 2: Cấp dưới chỉ đạt LN Gộp 40 Tr (Chưa hòa vốn 50 Tr) ---');
        // Xóa đơn 1, tạo đơn 2
        await pool.query("DELETE FROM sales_commissions WHERE ref_id = $1", [String(testOrder1.id)]);
        await pool.query("DELETE FROM order_items WHERE order_id = $1", [testOrder1.id]);
        await pool.query("DELETE FROM orders WHERE id = $1", [testOrder1.id]);

        const testOrderCode2 = 'DH-MGR-TEST-BELOW-' + Date.now();
        const orderInsert2 = await pool.query(`
            INSERT INTO orders (
                order_code, customer_name, total_amount, paid_amount, status, employee_id, created_at
            ) VALUES ($1, 'Khách Hàng Đơn Nhỏ', 160000000, 160000000, 'COMPLETED', $2, NOW())
            RETURNING id, order_code
        `, [testOrderCode2, staffId]);
        const testOrder2 = orderInsert2.rows[0];

        // LN gộp 40 triệu (160tr * 25% = 40tr)
        await pool.query(`
            INSERT INTO order_items (order_id, quantity, price, total)
            VALUES ($1, 16, 10000000, 160000000)
        `, [testOrder2.id]);

        await syncOrdersHandler({}, { json: () => {}, status: () => ({ json: () => {} }) });
        await pool.query("UPDATE sales_commissions SET paid_status = 'ELIGIBLE' WHERE ref_id = $1", [String(testOrder2.id)]);

        let summaryResult2;
        await getSummaryHandler({ query: { user_role: 'ADMIN', user_empid: 'EMP001' } }, { json: (data) => { summaryResult2 = data; }, status: () => ({ json: () => {} }) });

        const staffSummary2 = summaryResult2.byEmployee.find(e => e.employee_id === staffId);
        const mgrSummary2 = summaryResult2.byEmployee.find(e => e.employee_id === mgrId);

        console.log('Kết quả Kịch bản 2 (Chưa đạt điểm hòa vốn):');
        console.log(`   • Sale STAFF_TEST: LN Gộp = ${staffSummary2.direct_gross_profit.toLocaleString('vi-VN')} đ | Ngưỡng = ${staffSummary2.min_gross_profit_threshold.toLocaleString('vi-VN')} đ`);
        console.log(`   • Phần vượt hòa vốn: ${staffSummary2.excess_gross_profit.toLocaleString('vi-VN')} đ`);
        console.log(`   • Hoa hồng Sale thực nhận: ${staffSummary2.total_commission.toLocaleString('vi-VN')} đ`);
        console.log(`   • Hoa hồng Quản lý Trưởng phòng thực nhận: ${mgrSummary2.manager_commission.toLocaleString('vi-VN')} đ`);

        if (staffSummary2.total_commission !== 0) {
            throw new Error(`❌ Sai hoa hồng Sale: Chưa đạt điểm hòa vốn phải = 0 đ, nhận được ${staffSummary2.total_commission} đ`);
        }
        if (mgrSummary2.manager_commission !== 0) {
            throw new Error(`❌ Sai hoa hồng Quản lý: Cấp dưới chưa hòa vốn thì Quản lý phải = 0 đ, nhận được ${mgrSummary2.manager_commission} đ`);
        }
        console.log('✅ KỊCH BẢN 2 ĐẠT 100% CHUẨN XÁC!');

        // Dọn dẹp
        console.log('\n--- 4. Dọn dẹp dữ liệu test ---');
        await pool.query("DELETE FROM sales_commissions WHERE ref_id = $1", [String(testOrder2.id)]);
        await pool.query("DELETE FROM order_items WHERE order_id = $1", [testOrder2.id]);
        await pool.query("DELETE FROM orders WHERE id = $1", [testOrder2.id]);
        await pool.query("DELETE FROM employees WHERE emp_code IN ('MGR_TEST', 'STAFF_TEST')");

        console.log('\n========================================================================');
        console.log('🎉 TẤT CẢ KIỂM TRA ĐIỂM HÒA VỐN VÀ HOA HỒNG PHẦN VƯỢT THÀNH CÔNG RỰC RỠ 100%!');
        console.log('========================================================================');
    } catch (err) {
        console.error('❌ Lỗi kiểm thử:', err.message, err.stack);
    } finally {
        await pool.end();
    }
}

runVerification();
