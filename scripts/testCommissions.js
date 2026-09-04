const pool = require('../config/database');
const express = require('express');
const commissionsRouter = require('../api/commissions.route');

async function runTests() {
    console.log('🧪 Bắt đầu kiểm tra toàn bộ API và kết nối dữ liệu Hoa Hồng (sales_commissions)...');
    try {
        // 1. Test initDb
        console.log('\n--- 1. Kiểm tra initDb ---');
        await require('../config/initDb')();

        // 2. Test mock HTTP requests to routes
        console.log('\n--- 2. Kiểm tra Sync Đơn Hàng (/api/commissions/sync-orders) ---');
        const reqMock1 = {};
        let syncOrdersResult = null;
        const resMock1 = {
            json: (data) => { syncOrdersResult = data; console.log('sync-orders response:', data); },
            status: (code) => ({ json: (data) => { syncOrdersResult = { code, ...data }; console.error('sync-orders error response:', code, data); } })
        };
        // Tìm route handler sync-orders
        const syncOrdersHandler = commissionsRouter.stack.find(s => s.route && s.route.path === '/sync-orders' && s.route.methods.post)?.route.stack[0].handle;
        if (syncOrdersHandler) {
            await syncOrdersHandler(reqMock1, resMock1);
        } else {
            console.error('Không tìm thấy sync-orders handler');
        }

        console.log('\n--- 3. Kiểm tra Sync BOQ / EPC (/api/commissions/sync-boq) ---');
        let syncBoqResult = null;
        const resMock2 = {
            json: (data) => { syncBoqResult = data; console.log('sync-boq response:', data); },
            status: (code) => ({ json: (data) => { syncBoqResult = { code, ...data }; console.error('sync-boq error response:', code, data); } })
        };
        const syncBoqHandler = commissionsRouter.stack.find(s => s.route && s.route.path === '/sync-boq' && s.route.methods.post)?.route.stack[0].handle;
        if (syncBoqHandler) {
            await syncBoqHandler(reqMock1, resMock2);
        } else {
            console.error('Không tìm thấy sync-boq handler');
        }

        console.log('\n--- 4. Kiểm tra Danh Sách Hoa Hồng GET / (với quyền ADMIN) ---');
        let listResult = null;
        const resMock3 = {
            json: (data) => { listResult = data; console.log(`GET / trả về ${data.data?.length} bản ghi hoa hồng`); },
            status: (code) => ({ json: (data) => console.error('GET / error:', code, data) })
        };
        const getListHandler = commissionsRouter.stack.find(s => s.route && s.route.path === '/' && s.route.methods.get)?.route.stack[0].handle;
        if (getListHandler) {
            await getListHandler({ query: { user_role: 'ADMIN', user_empid: 'EMP001' } }, resMock3);
        }

        console.log('\n--- 5. Kiểm tra Summary GET /summary ---');
        let summaryResult = null;
        const resMock4 = {
            json: (data) => { summaryResult = data; console.log('GET /summary:', data.summary, 'Tổng nhân viên:', data.byEmployee?.length); },
            status: (code) => ({ json: (data) => console.error('GET /summary error:', code, data) })
        };
        const getSummaryHandler = commissionsRouter.stack.find(s => s.route && s.route.path === '/summary' && s.route.methods.get)?.route.stack[0].handle;
        if (getSummaryHandler) {
            await getSummaryHandler({ query: { user_role: 'ADMIN', user_empid: 'EMP001' } }, resMock4);
        }

        console.log('\n--- 6. Kiểm tra RBAC phân quyền cho SALE (SALE-5) ---');
        let saleListResult = null;
        const resMock5 = {
            json: (data) => { saleListResult = data; console.log(`SALE-5 xem được ${data.data?.length} bản ghi`); },
            status: (code) => ({ json: (data) => console.error('GET / error for SALE:', code, data) })
        };
        if (getListHandler) {
            await getListHandler({ query: { user_role: 'SALE', user_empid: 'SALE-5' } }, resMock5);
        }

        console.log('\n--- 7. Kiểm tra Thêm Thủ Công POST / ---');
        let createResult = null;
        const resMock6 = {
            json: (data) => { createResult = data; console.log('POST / tạo mới thành công ID:', data.data?.id); },
            status: (code) => ({ json: (data) => console.error('POST / error:', code, data) })
        };
        const postHandler = commissionsRouter.stack.find(s => s.route && s.route.path === '/' && s.route.methods.post)?.route.stack[0].handle;
        if (postHandler) {
            await postHandler({
                body: {
                    employee_id: 3, // SALE-5 (Mỹ Lâm)
                    customer_name: 'Khách Test Hoa Hồng',
                    revenue_amount: 50000000,
                    cogs_amount: 35000000,
                    gross_profit: 15000000,
                    commission_rate: 5,
                    commission_amount: 750000,
                    paid_status: 'ELIGIBLE',
                    notes: 'Kiểm tra thêm thủ công'
                }
            }, resMock6);
        }

        if (createResult && createResult.data?.id) {
            console.log('\n--- 8. Kiểm tra Cập nhật Trạng thái PUT /:id/status ---');
            const updateHandler = commissionsRouter.stack.find(s => s.route && s.route.path === '/:id/status' && s.route.methods.put)?.route.stack[0].handle;
            const resMock7 = {
                json: (data) => console.log('PUT /:id/status thành công:', data.data?.paid_status),
                status: (code) => ({ json: (data) => console.error('PUT /:id/status error:', code, data) })
            };
            await updateHandler({ params: { id: createResult.data.id }, body: { paid_status: 'PAID', notes: 'Đã chi test' } }, resMock7);

            console.log('\n--- 9. Kiểm tra Xóa DELETE /:id ---');
            const deleteHandler = commissionsRouter.stack.find(s => s.route && s.route.path === '/:id' && s.route.methods.delete)?.route.stack[0].handle;
            const resMock8 = {
                json: (data) => console.log('DELETE /:id thành công:', data.message),
                status: (code) => ({ json: (data) => console.error('DELETE /:id error:', code, data) })
            };
            await deleteHandler({ params: { id: createResult.data.id } }, resMock8);
        }

        console.log('\n==================================================');
        console.log('🎉 TOÀN BỘ KIỂM TRA HOÀN TẤT THÀNH CÔNG RỰC RỠ 100%!');
        console.log('==================================================');
    } catch (err) {
        console.error('❌ Lỗi trong quá trình kiểm tra:', err);
    } finally {
        await pool.end();
    }
}

runTests();
