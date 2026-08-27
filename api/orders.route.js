const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const fs = require('fs');
const path = require('path');
const googleDriveService = require('../services/googleDrive.service');

const parseSafeNum = (val) => {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    let str = String(val).trim().replace(/[đĐ\s]/g, '');
    if (/^-?\d+$/.test(str)) return parseInt(str, 10) || 0;
    if (/^-?\d+\.\d{2}$/.test(str)) return parseFloat(str) || 0;
    str = str.replace(/\./g, '').replace(/,/g, '.');
    return parseFloat(str) || 0;
};

// GET: LẤY DANH SÁCH ĐƠN HÀNG (Sạch biến rác, Kèm Customer Tier & Nhân viên bán hàng)
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT o.*, 
                   COALESCE(NULLIF(o.customer_name, ''), c.full_name, 'Khách Lẻ') as customer_name,
                   COALESCE(NULLIF(o.customer_phone, ''), c.phone, '') as customer_phone,
                   c.tier as customer_tier,
                   e.full_name as salesperson_name,
                   e.emp_code as salesperson_code
            FROM orders o 
            LEFT JOIN customers c ON o.customer_id = c.id 
            LEFT JOIN employees e ON o.employee_id = e.id
            ORDER BY o.id DESC LIMIT 500
        `);
        const orders = result.rows;
        if (orders.length > 0) {
            const orderIds = orders.map(o => o.id);
            const itemsRes = await pool.query(`
                SELECT oi.id, oi.order_id, COALESCE(oi.product_name, p.product_name, 'Thiết bị') as product_name, COALESCE(oi.sku, p.sku, 'N/A') as sku, oi.price, COALESCE(oi.quantity, oi.qty, 1) as quantity, oi.product_id, COALESCE(p.import_price, 0) as import_price, oi.serial_number 
                FROM order_items oi 
                LEFT JOIN products p ON oi.product_id = p.id 
                WHERE oi.order_id = ANY($1)
            `, [orderIds]);
            orders.forEach(o => { o.items = itemsRes.rows.filter(i => i.order_id === o.id); });
        }
        res.json({ success: true, data: orders });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET: LẤY CHI TIẾT 1 ĐƠN HÀNG
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const orderRes = await pool.query(`
            SELECT o.*, 
                   c.full_name as customer_name_joined, 
                   c.phone as customer_phone, 
                   c.address as customer_address, 
                   c.tier as customer_tier,
                   e.full_name as salesperson_name,
                   e.emp_code as salesperson_code
            FROM orders o 
            LEFT JOIN customers c ON o.customer_id = c.id 
            LEFT JOIN employees e ON o.employee_id = e.id
            WHERE o.id = $1
        `, [id]);
        if(orderRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy đơn hàng' });
        
        const itemsRes = await pool.query(`
            SELECT oi.*, p.product_name, p.sku, COALESCE(p.import_price, 0) as import_price 
            FROM order_items oi 
            LEFT JOIN products p ON oi.product_id = p.id 
            WHERE oi.order_id = $1
        `, [id]);
        const docsRes = await pool.query('SELECT * FROM order_docs WHERE order_id = $1 ORDER BY id DESC', [id]);
        const expensesRes = await pool.query('SELECT * FROM cash_transactions WHERE order_id = $1 ORDER BY id ASC', [id]);

        res.json({ 
            success: true, 
            data: { 
                ...orderRes.rows[0], 
                items: itemsRes.rows, 
                docs: docsRes.rows,
                accounting_expenses: expensesRes.rows 
            } 
        });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST: TẠO ĐƠN HÀNG MỚI (Từ POS / Kinh Doanh)
router.post('/', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { 
            customer_id, customer_name, total_amount, paid_amount, payment_method, notes, items, 
            employee_id, emp_id, employee_code,
            shipping_fee, station_fee, packaging_fee, handling_fee, other_fee, other_fee_note,
            discount_amount, points_discount, cost_fund_source, sync_accounting
        } = req.body;

        const order_code = 'DH-' + Date.now().toString().slice(-6) + Math.floor(1000 + Math.random() * 9000);
        const finalPaymentMethod = payment_method || 'TIEN_MAT';
        const finalNotes = notes || '';

        const shipFee = parseSafeNum(shipping_fee);
        const stnFee = parseSafeNum(station_fee);
        const packFee = parseSafeNum(packaging_fee);
        const handFee = parseSafeNum(handling_fee);
        const othFee = parseSafeNum(other_fee);
        const othNote = (other_fee_note || '').trim();
        const discAmount = parseSafeNum(discount_amount);
        const ptsDiscount = parseSafeNum(points_discount);
        const fundSource = cost_fund_source || 'TIEN_MAT_QUY';
        const shouldSync = sync_accounting !== false;

        // Tự động phân giải Mã Nhân Viên (emp_code / emp_id / user_id) sang employees.id
        let resolvedEmpId = null;
        const rawEmp = employee_id || emp_id || employee_code;
        if (rawEmp) {
            if (!isNaN(parseInt(rawEmp)) && String(parseInt(rawEmp)) === String(rawEmp).trim()) {
                const empCheck = await client.query("SELECT id FROM employees WHERE id = $1", [parseInt(rawEmp)]);
                if (empCheck.rows.length > 0) resolvedEmpId = empCheck.rows[0].id;
            }
            if (!resolvedEmpId) {
                const empCodeCheck = await client.query("SELECT id FROM employees WHERE UPPER(emp_code) = $1", [String(rawEmp).trim().toUpperCase()]);
                if (empCodeCheck.rows.length > 0) {
                    resolvedEmpId = empCodeCheck.rows[0].id;
                } else {
                    const userMatch = await client.query("SELECT id, user_id FROM users WHERE UPPER(emp_id) = $1 OR UPPER(username) = $1", [String(rawEmp).trim().toUpperCase()]);
                    if (userMatch.rows.length > 0) {
                        const uId = userMatch.rows[0].id || userMatch.rows[0].user_id;
                        const empUserCheck = await client.query("SELECT id FROM employees WHERE user_id = $1", [uId]);
                        if (empUserCheck.rows.length > 0) resolvedEmpId = empUserCheck.rows[0].id;
                    }
                }
            }
        }

        // Tính toán doanh số, giá vốn và lợi nhuận
        let subtotal = 0;
        let cogs = 0;
        if (items && Array.isArray(items)) {
            for (let item of items) {
                const qty = parseSafeNum(item.quantity) || 1;
                const price = parseSafeNum(item.price);
                let impPrice = parseSafeNum(item.import_price);
                if (!impPrice && item.product_id) {
                    const pRes = await client.query("SELECT import_price FROM products WHERE id = $1", [item.product_id]);
                    if (pRes.rows.length > 0) impPrice = parseSafeNum(pRes.rows[0].import_price);
                }
                subtotal += qty * price;
                cogs += qty * impPrice;
            }
        }
        if (subtotal === 0 && total_amount) subtotal = parseSafeNum(total_amount);

        const calculatedTotal = Math.max(0, subtotal - discAmount - ptsDiscount);
        const finalTotal = total_amount !== undefined ? parseSafeNum(total_amount) : calculatedTotal;
        const finalPaid = paid_amount !== undefined ? parseSafeNum(paid_amount) : finalTotal;
        const grossProfit = finalTotal - cogs;
        const totalOrderCosts = shipFee + stnFee + packFee + handFee + othFee;
        const netProfit = grossProfit - totalOrderCosts;

        // KIỂM TRA HẠN MỨC CÔNG NỢ (DEBT LIMIT CHECK)
        if (customer_id) {
            const custCheck = await client.query(`
                SELECT id, name, full_name, 
                       COALESCE(debt_limit, 0) as debt_limit,
                       COALESCE((SELECT SUM(total_amount - paid_amount) FROM orders WHERE customer_id = $1 AND status NOT IN ('CANCELLED', 'RETURNED')), 0) as current_debt
                FROM customers WHERE id = $1
            `, [customer_id]);
            
            if (custCheck.rows.length > 0) {
                const c = custCheck.rows[0];
                const debtLimit = parseFloat(c.debt_limit) || 0;
                const currentDebt = parseFloat(c.current_debt) || 0;
                const newUnpaid = Math.max(0, finalTotal - finalPaid);
                
                if (debtLimit > 0 && (currentDebt + newUnpaid) > debtLimit) {
                    await client.query('ROLLBACK');
                    const custDisplayName = c.full_name || c.name || 'Khách Hàng';
                    const fmt = (num) => new Intl.NumberFormat('vi-VN').format(num || 0);
                    return res.status(400).json({
                        success: false,
                        code: 'DEBT_LIMIT_EXCEEDED',
                        error: `⛔ CHẶN LÊN ĐƠN: Khách hàng "${custDisplayName}" đã vượt hạn mức công nợ cho phép!\n• Nợ hiện tại: ${fmt(currentDebt)} đ\n• Nợ đơn này: ${fmt(newUnpaid)} đ (Tổng: ${fmt(currentDebt + newUnpaid)} đ)\n• Hạn mức tối đa: ${fmt(debtLimit)} đ\n👉 Yêu cầu thanh toán công nợ cũ trước khi lên đơn mới!`
                    });
                }
            }
        }

        const orderRes = await client.query(`
            INSERT INTO orders (
                order_code, customer_id, customer_name, subtotal_amount, total_amount, paid_amount, 
                payment_method, notes, status, employee_id,
                shipping_fee, station_fee, packaging_fee, handling_fee, other_fee, other_fee_note,
                discount_amount, points_discount, cost_of_goods, gross_profit, net_profit,
                cost_fund_source, sync_accounting, created_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, 
                $7, $8, 'PENDING', $9,
                $10, $11, $12, $13, $14, $15,
                $16, $17, $18, $19, $20,
                $21, $22, NOW()
            ) RETURNING id
        `, [
            order_code, customer_id || null, customer_name || 'Khách Lẻ', subtotal, finalTotal, finalPaid,
            finalPaymentMethod, finalNotes, resolvedEmpId,
            shipFee, stnFee, packFee, handFee, othFee, othNote,
            discAmount, ptsDiscount, cogs, grossProfit, netProfit,
            fundSource, shouldSync
        ]);
        const orderId = orderRes.rows[0].id;
        
        // Ghi danh sách sản phẩm & Trừ kho
        if (items && Array.isArray(items)) {
            for (let item of items) {
                const qty = parseFloat(item.quantity) || 1;
                const price = parseFloat(item.price) || 0;
                const itemTotal = qty * price;
                await client.query(
                    "INSERT INTO order_items (order_id, product_id, quantity, price, total) VALUES ($1, $2, $3, $4, $5)", 
                    [orderId, item.product_id, qty, price, itemTotal]
                );
                await client.query("UPDATE products SET stock_qty = GREATEST(0, stock_qty - $1) WHERE id = $2", [qty, item.product_id]);
            }
        }

        // TỰ ĐỘNG ĐỒNG BỘ CÔNG NỢ & DOANH SỐ VỀ CRM NGAY KHI TẠO ĐƠN
        if (customer_id) {
            await client.query(`
                UPDATE customers 
                SET 
                    current_debt = (SELECT COALESCE(SUM(total_amount - paid_amount), 0) FROM orders WHERE customer_id = $1 AND status NOT IN ('CANCELLED', 'RETURNED')),
                    total_sales = (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE customer_id = $1 AND status NOT IN ('CANCELLED', 'RETURNED'))
                WHERE id = $1
            `, [customer_id]);
        }

        // TỰ ĐỘNG ĐỒNG BỘ CHI PHÍ SANG SỔ QUỸ KẾ TOÁN (cash_transactions)
        if (shouldSync && totalOrderCosts > 0) {
            const pMethod = (fundSource === 'TIEN_MAT_QUY' || fundSource === 'Tiền Mặt') ? 'Tiền Mặt' : 'Chuyển Khoản';
            const custDisplay = customer_name || 'Khách Lẻ';

            if (shipFee > 0) {
                await client.query(`
                    INSERT INTO cash_transactions (code, type, target_name, amount, payment_method, category, tax_status, source_fund, notes, order_id, order_code, cost_type, created_at)
                    VALUES ($1, 'CHI', 'Đơn vị vận chuyển', $2, $3, 'Phí vận chuyển giao hàng', 'KHONG_HOA_DON', $4, $5, $6, $7, 'SHIPPING', NOW())
                `, ['PC-VC-' + order_code, shipFee, pMethod, fundSource, `Cước vận chuyển đơn hàng ${order_code} (${custDisplay})`, orderId, order_code]);
            }
            if (stnFee > 0) {
                await client.query(`
                    INSERT INTO cash_transactions (code, type, target_name, amount, payment_method, category, tax_status, source_fund, notes, order_id, order_code, cost_type, created_at)
                    VALUES ($1, 'CHI', 'Xe trung chuyển chành', $2, $3, 'Phí gửi hàng ra chành', 'KHONG_HOA_DON', $4, $5, $6, $7, 'STATION', NOW())
                `, ['PC-CH-' + order_code, stnFee, pMethod, fundSource, `Phí gửi hàng ra chành xe cho đơn ${order_code} (${custDisplay})`, orderId, order_code]);
            }
            if (packFee > 0) {
                await client.query(`
                    INSERT INTO cash_transactions (code, type, target_name, amount, payment_method, category, tax_status, source_fund, notes, order_id, order_code, cost_type, created_at)
                    VALUES ($1, 'CHI', 'Đóng gói / Pallet', $2, $3, 'Phí đóng gói hàng hóa', 'KHONG_HOA_DON', $4, $5, $6, $7, 'PACKAGING', NOW())
                `, ['PC-DG-' + order_code, packFee, pMethod, fundSource, `Phí đóng gói pallet, kiện gỗ cho đơn ${order_code} (${custDisplay})`, orderId, order_code]);
            }
            if (handFee > 0) {
                await client.query(`
                    INSERT INTO cash_transactions (code, type, target_name, amount, payment_method, category, tax_status, source_fund, notes, order_id, order_code, cost_type, created_at)
                    VALUES ($1, 'CHI', 'Đội bốc xếp / Xe cẩu', $2, $3, 'Phí bốc xếp & nâng hạ', 'KHONG_HOA_DON', $4, $5, $6, $7, 'HANDLING', NOW())
                `, ['PC-BX-' + order_code, handFee, pMethod, fundSource, `Phí bốc vác, nâng hạ thiết bị cho đơn ${order_code} (${custDisplay})`, orderId, order_code]);
            }
            if (othFee > 0) {
                await client.query(`
                    INSERT INTO cash_transactions (code, type, target_name, amount, payment_method, category, tax_status, source_fund, notes, order_id, order_code, cost_type, created_at)
                    VALUES ($1, 'CHI', 'Chi phí khác', $2, $3, 'Chi phí phụ trợ đơn hàng', 'KHONG_HOA_DON', $4, $5, $6, $7, 'OTHER', NOW())
                `, ['PC-KP-' + order_code, othFee, pMethod, fundSource, `${othNote || 'Chi phí ngoài'} cho đơn hàng ${order_code} (${custDisplay})`, orderId, order_code]);
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, orderId, order_code });
    } catch (err) { 
        await client.query('ROLLBACK'); 
        res.status(500).json({ success: false, error: err.message }); 
    } finally { client.release(); }
});

// PUT: CẬP NHẬT CHI TIẾT ĐƠN HÀNG
router.put('/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { 
            delivery_company, driver_name, license_plate, notes, paid_amount, status, payment_method, 
            items, cancel_reason, refund_amount,
            customer_name, customer_phone, customer_address,
            shipping_fee, station_fee, packaging_fee, handling_fee, other_fee, other_fee_note,
            discount_amount, points_discount, cost_fund_source, sync_accounting
        } = req.body;
        
        const oldOrderRes = await client.query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
        if (oldOrderRes.rows.length === 0) throw new Error('Không tìm thấy đơn hàng');
        const oldOrder = oldOrderRes.rows[0];
        const oldStatus = oldOrder.status;
        const custId = oldOrder.customer_id;
        const orderCode = oldOrder.order_code;

        const shipFee = parseSafeNum(shipping_fee);
        const stnFee = parseSafeNum(station_fee);
        const packFee = parseSafeNum(packaging_fee);
        const handFee = parseSafeNum(handling_fee);
        const othFee = parseSafeNum(other_fee);
        const othNote = (other_fee_note || '').trim();
        const discAmount = parseSafeNum(discount_amount);
        const ptsDiscount = parseSafeNum(points_discount);
        const fundSource = cost_fund_source || oldOrder.cost_fund_source || 'TIEN_MAT_QUY';
        const shouldSync = sync_accounting !== undefined ? Boolean(sync_accounting) : true;

        const finalCustomerName = customer_name ? customer_name.trim() : (oldOrder.customer_name || 'Khách Lẻ');
        const finalCustomerPhone = customer_phone !== undefined ? customer_phone.trim() : (oldOrder.customer_phone || '');
        const finalDeliveryCompany = delivery_company !== undefined ? delivery_company : (oldOrder.delivery_company || '');
        const finalDriverName = driver_name !== undefined ? driver_name : (oldOrder.driver_name || '');
        const finalLicensePlate = license_plate !== undefined ? license_plate : (oldOrder.license_plate || '');
        const finalPaidAmount = paid_amount !== undefined ? parseSafeNum(paid_amount) : parseSafeNum(oldOrder.paid_amount);
        const finalStatus = status || oldStatus || 'PENDING';
        const finalPaymentMethod = payment_method || oldOrder.payment_method || 'TIỀN MẶT';
        let newSubtotal = 0;
        let newCogs = 0;

        if (items && Array.isArray(items)) {
            const orderIdInt = parseInt(req.params.id, 10);
            // 1. Hoàn lại kho cho các mặt hàng cũ của đơn này nếu đơn cũ chưa bị hủy/trả
            if (oldStatus !== 'CANCELLED' && oldStatus !== 'RETURNED') {
                const oldItemsRes = await client.query("SELECT product_id, quantity FROM order_items WHERE order_id = $1", [orderIdInt]);
                for (let oldItem of oldItemsRes.rows) {
                    if (oldItem.product_id) {
                        await client.query("UPDATE products SET stock_qty = stock_qty + $1 WHERE id = $2", [parseFloat(oldItem.quantity) || 0, oldItem.product_id]);
                    }
                }
            }

            // 2. Xóa các dòng order_items cũ để ghi nhận danh sách thiết bị mới cập nhật
            await client.query("DELETE FROM order_items WHERE order_id = $1", [orderIdInt]);

            // 3. Chèn các mặt hàng mới & Trừ kho
            for(let i of items) {
                const qty = parseSafeNum(i.quantity) || 1;
                const price = parseSafeNum(i.price);
                const itemTotal = qty * price;
                newSubtotal += itemTotal;

                let impPrice = parseSafeNum(i.import_price);
                if (!impPrice && i.product_id) {
                    const pRes = await client.query("SELECT import_price FROM products WHERE id = $1", [i.product_id]);
                    if (pRes.rows.length > 0) impPrice = parseSafeNum(pRes.rows[0].import_price);
                }
                newCogs += qty * impPrice;

                await client.query(
                    "INSERT INTO order_items (order_id, product_id, quantity, price, total, serial_number) VALUES ($1, $2, $3, $4, $5, $6)", 
                    [orderIdInt, i.product_id, qty, price, itemTotal, i.serial_number || '']
                );

                // Trừ kho thực tế nếu trạng thái đơn không phải CANCELLED hoặc RETURNED
                if (finalStatus !== 'CANCELLED' && finalStatus !== 'RETURNED' && i.product_id) {
                    await client.query("UPDATE products SET stock_qty = GREATEST(0, stock_qty - $1) WHERE id = $2", [qty, i.product_id]);
                }

                // Tự động kích hoạt bảo hành
                if (i.serial_number && i.serial_number.trim() !== '') {
                    await client.query(`
                        INSERT INTO warranties (serial_number, sku, customer_name, warranty_months, activated_at) 
                        VALUES (
                            $1, 
                            (SELECT sku FROM products WHERE id = $2), 
                            $3, 
                            120, 
                            CURRENT_TIMESTAMP
                        )
                        ON CONFLICT (serial_number) DO NOTHING
                    `, [i.serial_number.trim(), i.product_id, finalCustomerName]);
                }
            }
        } else {
            newSubtotal = parseSafeNum(oldOrder.subtotal_amount) || parseSafeNum(oldOrder.total_amount) || 0;
            newCogs = parseSafeNum(oldOrder.cost_of_goods) || 0;
        }

        const newTotalAmount = Math.max(0, newSubtotal - discAmount - ptsDiscount);
        const grossProfit = newTotalAmount - newCogs;
        const totalOrderCosts = shipFee + stnFee + packFee + handFee + othFee;
        const netProfit = grossProfit - totalOrderCosts;

        // KỊCH BẢN HỦY ĐƠN: CỘNG LẠI TỒN KHO THỰC TẾ
        let finalNotes = notes || '';
        if (oldStatus !== 'CANCELLED' && finalStatus === 'CANCELLED') {
            if (items && items.length > 0) {
                for(let i of items) {
                    await client.query("UPDATE products SET stock_qty = stock_qty + $1 WHERE id = $2", [i.quantity, i.product_id]);
                }
            }
            finalNotes = `[HỆ THỐNG]: Đã hoàn lại tồn kho. Lý do hủy: ${cancel_reason || 'Không có'}. Hoàn tiền khách: ${refund_amount || 0}đ.\n` + finalNotes;
        }

        await client.query(`
            UPDATE orders 
            SET customer_name=$1, customer_phone=$2,
                delivery_company=$3, driver_name=$4, license_plate=$5, notes=$6, 
                paid_amount=$7, status=$8, payment_method=$9, 
                subtotal_amount=$10, total_amount=$11,
                shipping_fee=$12, station_fee=$13, packaging_fee=$14, handling_fee=$15, other_fee=$16, other_fee_note=$17,
                discount_amount=$18, points_discount=$19, cost_of_goods=$20, gross_profit=$21, net_profit=$22,
                cost_fund_source=$23, sync_accounting=$24
            WHERE id=$25
        `, [
            finalCustomerName, finalCustomerPhone,
            finalDeliveryCompany, finalDriverName, finalLicensePlate, finalNotes, 
            finalPaidAmount, finalStatus, finalPaymentMethod, 
            newSubtotal, newTotalAmount,
            shipFee, stnFee, packFee, handFee, othFee, othNote,
            discAmount, ptsDiscount, newCogs, grossProfit, netProfit,
            fundSource, shouldSync,
            parseInt(req.params.id, 10)
        ]);
        
        // ĐỒNG BỘ SANG SỔ QUỸ KẾ TOÁN (cash_transactions)
        if (shouldSync) {
            await client.query("DELETE FROM cash_transactions WHERE order_id = $1 AND cost_type IS NOT NULL", [parseInt(req.params.id, 10)]);

            const pMethod = (fundSource === 'TIEN_MAT_QUY' || fundSource === 'Tiền Mặt') ? 'Tiền Mặt' : 'Chuyển Khoản';
            const orderIdInt = parseInt(req.params.id, 10);

            if (shipFee > 0) {
                await client.query(`
                    INSERT INTO cash_transactions (code, type, target_name, amount, payment_method, category, tax_status, source_fund, notes, order_id, order_code, cost_type, created_at)
                    VALUES ($1, 'CHI', $2, $3, $4, 'Phí vận chuyển giao hàng', 'KHONG_HOA_DON', $5, $6, $7, $8, 'SHIPPING', NOW())
                `, [
                    'PC-VC-' + orderCode,
                    finalDeliveryCompany || 'Đơn vị vận chuyển',
                    shipFee,
                    pMethod,
                    fundSource,
                    `Cước vận chuyển đơn hàng ${orderCode} (${finalCustomerName})`,
                    orderIdInt,
                    orderCode
                ]);
            }

            if (stnFee > 0) {
                await client.query(`
                    INSERT INTO cash_transactions (code, type, target_name, amount, payment_method, category, tax_status, source_fund, notes, order_id, order_code, cost_type, created_at)
                    VALUES ($1, 'CHI', 'Xe trung chuyển chành', $2, $3, 'Phí gửi hàng ra chành', 'KHONG_HOA_DON', $4, $5, $6, $7, 'STATION', NOW())
                `, [
                    'PC-CH-' + orderCode,
                    stnFee,
                    pMethod,
                    fundSource,
                    `Phí gửi hàng ra chành xe cho đơn ${orderCode} (${finalCustomerName})`,
                    orderIdInt,
                    orderCode
                ]);
            }

            if (packFee > 0) {
                await client.query(`
                    INSERT INTO cash_transactions (code, type, target_name, amount, payment_method, category, tax_status, source_fund, notes, order_id, order_code, cost_type, created_at)
                    VALUES ($1, 'CHI', 'Đóng gói / Pallet', $2, $3, 'Phí đóng gói hàng hóa', 'KHONG_HOA_DON', $4, $5, $6, $7, 'PACKAGING', NOW())
                `, [
                    'PC-DG-' + orderCode,
                    packFee,
                    pMethod,
                    fundSource,
                    `Phí đóng gói pallet, kiện gỗ cho đơn ${orderCode} (${finalCustomerName})`,
                    orderIdInt,
                    orderCode
                ]);
            }

            if (handFee > 0) {
                await client.query(`
                    INSERT INTO cash_transactions (code, type, target_name, amount, payment_method, category, tax_status, source_fund, notes, order_id, order_code, cost_type, created_at)
                    VALUES ($1, 'CHI', 'Đội bốc xếp / Xe cẩu', $2, $3, 'Phí bốc xếp & nâng hạ', 'KHONG_HOA_DON', $4, $5, $6, $7, 'HANDLING', NOW())
                `, [
                    'PC-BX-' + orderCode,
                    handFee,
                    pMethod,
                    fundSource,
                    `Phí bốc vác, nâng hạ thiết bị cho đơn ${orderCode} (${finalCustomerName})`,
                    orderIdInt,
                    orderCode
                ]);
            }

            if (othFee > 0) {
                await client.query(`
                    INSERT INTO cash_transactions (code, type, target_name, amount, payment_method, category, tax_status, source_fund, notes, order_id, order_code, cost_type, created_at)
                    VALUES ($1, 'CHI', 'Chi phí khác', $2, $3, 'Chi phí phụ trợ đơn hàng', 'KHONG_HOA_DON', $4, $5, $6, $7, 'OTHER', NOW())
                `, [
                    'PC-KP-' + orderCode,
                    othFee,
                    pMethod,
                    fundSource,
                    `${othNote || 'Chi phí ngoài'} cho đơn hàng ${orderCode} (${finalCustomerName})`,
                    req.params.id,
                    orderCode
                ]);
            }
        }

        // ĐỒNG BỘ CÔNG NỢ & DOANH SỐ VỀ CRM
        if (custId) {
            await client.query(`
                UPDATE customers 
                SET 
                    current_debt = (SELECT COALESCE(SUM(total_amount - paid_amount), 0) FROM orders WHERE customer_id = $1 AND status NOT IN ('CANCELLED', 'RETURNED')),
                    total_sales = (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE customer_id = $1 AND status NOT IN ('CANCELLED', 'RETURNED'))
                WHERE id = $1
            `, [custId]);
        }

        await client.query('COMMIT');
        res.json({ 
            success: true, 
            data: { 
                subtotal_amount: newSubtotal, 
                total_amount: newTotalAmount, 
                cost_of_goods: newCogs, 
                gross_profit: grossProfit, 
                net_profit: netProfit,
                total_order_costs: totalOrderCosts 
            } 
        });
    } catch(e) { 
        await client.query('ROLLBACK'); 
        res.status(500).json({ success: false, error: e.message }); 
    } finally { client.release(); }
});

// API ĐỔI TRẠNG THÁI NHANH (MỚI THÊM)
router.put('/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        
        // 1. Cập nhật trạng thái đơn hàng
        await pool.query("UPDATE orders SET status = $1 WHERE id = $2", [status, req.params.id]);
        
        // 2. Lấy customer_id để đồng bộ
        const orderInfo = await pool.query("SELECT customer_id FROM orders WHERE id = $1", [req.params.id]);
        const custId = orderInfo.rows[0] ? orderInfo.rows[0].customer_id : null;
        
        // 3. Đồng bộ Công Nợ & Doanh Số về bảng customers
        if (custId) {
            await pool.query(`
                UPDATE customers 
                SET 
                    current_debt = (SELECT COALESCE(SUM(total_amount - paid_amount), 0) FROM orders WHERE customer_id = $1 AND status NOT IN ('CANCELLED', 'RETURNED')),
                    total_sales = (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE customer_id = $1 AND status NOT IN ('CANCELLED', 'RETURNED'))
                WHERE id = $1
            `, [custId]);
        }
        
        res.json({ success: true });
    } catch(e) { 
        res.status(500).json({ success: false, error: e.message }); 
    }
});

// API TẢI TÀI LIỆU
router.post('/:id/docs', async (req, res) => { 
    try {
        const { file_name, file_data } = req.body;
        await pool.query("INSERT INTO order_docs (order_id, doc_type, file_url) VALUES ($1, $2, $3)", [req.params.id, file_name, file_data]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/:id/docs/:docId', async (req, res) => {
    try {
        await pool.query("DELETE FROM order_docs WHERE id = $1 AND order_id = $2", [req.params.docId, req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ===================================
// API TRẢ HÀNG VÀ KIỂM ĐỊNH KHO QC (RMA & RETURNS)
// ===================================

// Tự động nâng cấp bảng return_orders & return_items nếu thiếu cột
(async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS return_orders (
                id SERIAL PRIMARY KEY,
                order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
                order_code VARCHAR(100),
                customer_name VARCHAR(255),
                customer_phone VARCHAR(50),
                reason TEXT,
                deduction_fee NUMERIC DEFAULT 0,
                refund_amount NUMERIC DEFAULT 0,
                status VARCHAR(50) DEFAULT 'PENDING_QC',
                processed_by VARCHAR(100),
                processed_at TIMESTAMP,
                qc_notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS return_items (
                id SERIAL PRIMARY KEY,
                return_id INTEGER REFERENCES return_orders(id) ON DELETE CASCADE,
                product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
                product_name VARCHAR(255),
                sku VARCHAR(100),
                return_qty INTEGER DEFAULT 1,
                price NUMERIC DEFAULT 0,
                good_qty INTEGER DEFAULT 0,
                defect_qty INTEGER DEFAULT 0,
                qc_status VARCHAR(50) DEFAULT 'PENDING',
                qc_note TEXT
            );
            ALTER TABLE return_orders ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(50);
            ALTER TABLE return_orders ADD COLUMN IF NOT EXISTS processed_by VARCHAR(100);
            ALTER TABLE return_orders ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP;
            ALTER TABLE return_orders ADD COLUMN IF NOT EXISTS qc_notes TEXT;
            ALTER TABLE return_items ADD COLUMN IF NOT EXISTS sku VARCHAR(100);
            ALTER TABLE return_items ADD COLUMN IF NOT EXISTS good_qty INTEGER DEFAULT 0;
            ALTER TABLE return_items ADD COLUMN IF NOT EXISTS defect_qty INTEGER DEFAULT 0;
            ALTER TABLE return_items ADD COLUMN IF NOT EXISTS qc_status VARCHAR(50) DEFAULT 'PENDING';
            ALTER TABLE return_items ADD COLUMN IF NOT EXISTS qc_note TEXT;
        `);
    } catch (e) {
        console.error("Return orders schema check:", e.message);
    }
})();

// Lấy danh sách phiếu trả hàng (Kèm chi tiết món và thông tin đơn gốc)
router.get('/returns/list', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT ro.*, 
                   COALESCE(ro.customer_phone, o.customer_phone, c.phone, '') as customer_phone_resolved,
                   COALESCE(c.address, '') as customer_address
            FROM return_orders ro
            LEFT JOIN orders o ON ro.order_id = o.id
            LEFT JOIN customers c ON o.customer_id = c.id
            ORDER BY ro.id DESC
        `);
        const returns = result.rows;
        if (returns.length > 0) {
            const retIds = returns.map(r => r.id);
            const itemsRes = await pool.query(`
                SELECT ri.*, p.sku as product_sku, p.image_url 
                FROM return_items ri 
                LEFT JOIN products p ON ri.product_id = p.id 
                WHERE ri.return_id = ANY($1)
            `, [retIds]);
            returns.forEach(r => { 
                r.customer_phone = r.customer_phone || r.customer_phone_resolved;
                r.items = itemsRes.rows.filter(i => i.return_id === r.id); 
            });
        }
        res.json({ success: true, data: returns });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// Lấy chi tiết 1 phiếu trả hàng
router.get('/returns/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT ro.*, 
                   COALESCE(ro.customer_phone, o.customer_phone, c.phone, '') as customer_phone,
                   COALESCE(c.address, '') as customer_address,
                   o.total_amount as original_order_total
            FROM return_orders ro
            LEFT JOIN orders o ON ro.order_id = o.id
            LEFT JOIN customers c ON o.customer_id = c.id
            WHERE ro.id = $1
        `, [id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy phiếu trả hàng' });
        
        const retOrder = result.rows[0];
        const itemsRes = await pool.query(`
            SELECT ri.*, p.sku as product_sku, p.image_url, p.stock_qty as current_stock, p.defective_qty as current_defective
            FROM return_items ri 
            LEFT JOIN products p ON ri.product_id = p.id 
            WHERE ri.return_id = $1
        `, [id]);
        retOrder.items = itemsRes.rows;
        res.json({ success: true, data: retOrder });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// Tạo phiếu trả hàng mới (Gắn liền với đơn hàng)
router.post('/:id/return', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { reason, deduction_fee, refund_amount, return_items, customer_phone } = req.body;
        
        const orderRes = await client.query('SELECT order_code, customer_name, customer_phone FROM orders WHERE id = $1', [req.params.id]);
        if (orderRes.rows.length === 0) throw new Error('Không tìm thấy đơn hàng gốc');
        const o = orderRes.rows[0];
        const phone = customer_phone || o.customer_phone || '';

        const retRes = await client.query(
            `INSERT INTO return_orders (order_id, order_code, customer_name, customer_phone, reason, deduction_fee, refund_amount, status, created_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING_QC', NOW()) RETURNING id`,
            [req.params.id, o.order_code, o.customer_name, phone, reason || '', deduction_fee || 0, refund_amount || 0]
        );
        const returnId = retRes.rows[0].id;

        if (return_items && Array.isArray(return_items)) {
            for (let item of return_items) {
                const qty = parseInt(item.return_qty) || 0;
                if (qty > 0) {
                    await client.query(
                        `INSERT INTO return_items (return_id, product_id, product_name, sku, return_qty, price, qc_status) 
                         VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')`,
                        [returnId, item.product_id || null, item.product_name || 'Thiết bị', item.sku || '', qty, item.price || 0]
                    );
                }
            }
        }
        await client.query('COMMIT');
        res.json({ success: true, return_id: returnId });
    } catch(e) { 
        await client.query('ROLLBACK'); 
        res.status(500).json({ success: false, error: e.message }); 
    } finally { client.release(); }
});

// Tạo phiếu trả hàng tự do / trực tiếp
router.post('/returns/create-direct', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { order_id, order_code, customer_name, customer_phone, reason, deduction_fee, refund_amount, return_items } = req.body;
        
        const finalOrderCode = order_code || ('TH-' + Math.floor(Date.now() / 1000));
        const finalCustName = customer_name || 'Khách Hàng';
        const finalPhone = customer_phone || '';

        const retRes = await client.query(
            `INSERT INTO return_orders (order_id, order_code, customer_name, customer_phone, reason, deduction_fee, refund_amount, status, created_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING_QC', NOW()) RETURNING id`,
            [order_id || null, finalOrderCode, finalCustName, finalPhone, reason || '', deduction_fee || 0, refund_amount || 0]
        );
        const returnId = retRes.rows[0].id;

        if (return_items && Array.isArray(return_items)) {
            for (let item of return_items) {
                const qty = parseInt(item.return_qty) || 0;
                if (qty > 0) {
                    await client.query(
                        `INSERT INTO return_items (return_id, product_id, product_name, sku, return_qty, price, qc_status) 
                         VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')`,
                        [returnId, item.product_id || null, item.product_name || 'Thiết bị', item.sku || '', qty, item.price || 0]
                    );
                }
            }
        }
        await client.query('COMMIT');
        res.json({ success: true, return_id: returnId });
    } catch(e) { 
        await client.query('ROLLBACK'); 
        res.status(500).json({ success: false, error: e.message }); 
    } finally { client.release(); }
});

// Xử lý kiểm định QC & Nhập kho sản phẩm trả lại
router.post('/returns/:id/process', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const { qc_items, qc_notes, processed_by } = req.body;
        
        if (qc_items && Array.isArray(qc_items)) {
            for (let item of qc_items) {
                const goodQty = parseInt(item.good_qty) || 0;
                const defectQty = parseInt(item.defect_qty) || 0;
                const itemNote = item.qc_note || '';

                if (item.id) {
                    await client.query(
                        `UPDATE return_items 
                         SET good_qty = $1, defect_qty = $2, qc_note = $3, qc_status = 'QC_CHECKED' 
                         WHERE id = $4`,
                        [goodQty, defectQty, itemNote, item.id]
                    );
                }

                if (item.product_id) {
                    // Hàng tốt đạt chuẩn -> Cộng vào tồn kho bán hàng (stock_qty)
                    if (goodQty > 0) {
                        await client.query("UPDATE products SET stock_qty = stock_qty + $1 WHERE id = $2", [goodQty, item.product_id]);
                    }
                    // Hàng lỗi / hỏng / chờ bảo hành -> Cộng vào kho hàng lỗi (defective_qty)
                    if (defectQty > 0) {
                        await client.query("UPDATE products SET defective_qty = defective_qty + $1 WHERE id = $2", [defectQty, item.product_id]);
                    }
                }
            }
        }
        
        await client.query(
            `UPDATE return_orders 
             SET status = 'COMPLETED', processed_at = NOW(), processed_by = $1, qc_notes = $2 
             WHERE id = $3`, 
            [processed_by || 'Nhân Viên QC', qc_notes || '', id]
        );
        await client.query('COMMIT');
        res.json({ success: true });
    } catch(e) { 
        await client.query('ROLLBACK'); 
        res.status(500).json({ success: false, error: e.message }); 
    } finally { client.release(); }
});

// Hủy phiếu trả hàng (Chỉ khi đang PENDING_QC)
router.delete('/returns/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const check = await pool.query('SELECT status FROM return_orders WHERE id = $1', [id]);
        if (check.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy phiếu trả hàng' });
        
        if (check.rows[0].status === 'COMPLETED') {
            return res.status(400).json({ success: false, error: 'Không thể xóa phiếu trả hàng đã được kiểm định & nhập kho!' });
        }

        await pool.query('DELETE FROM return_orders WHERE id = $1', [id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// API DÀNH RIÊNG CHO KHO: Cập nhật vận chuyển & Serial (Bảo toàn tuyệt đối Giá tiền)
router.put('/:id/wms-out', async (req, res) => {
    const client = await pool.connect();
    const fs = require('fs');
    const path = require('path');
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const { delivery_company, driver_name, license_plate, notes, status, items, delivery_proofs } = req.body;

        // Xử lý Upload Ảnh Giao Hàng
        let proofUrls = [];
        if (delivery_proofs && Array.isArray(delivery_proofs)) {
            for (let i = 0; i < delivery_proofs.length; i++) {
                const proof = delivery_proofs[i];
                if (proof && proof.startsWith('data:image')) {
                    const matches = proof.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
                    const mime = matches ? matches[1] : 'image/jpeg';
                    const base64Str = matches ? matches[2] : proof.replace(/^data:image\/\w+;base64,/, '');
                    const buffer = Buffer.from(base64Str, 'base64');
                    const fileName = `proof_${id}_${Date.now()}_${i}.jpg`;
                    
                    const uploadResult = await googleDriveService.uploadFile({
                        buffer: buffer,
                        originalname: fileName,
                        mimetype: mime,
                        subfolder: 'proofs'
                    });
                    proofUrls.push(uploadResult.url);
                } else if (proof) {
                    proofUrls.push(proof); // Ảnh cũ đã có URL
                }
            }
        }
        const proofsJson = JSON.stringify(proofUrls);

        // Update thông tin (TUYỆT ĐỐI KHÔNG CHẠM VÀO GIÁ TIỀN)
        await client.query(`
            UPDATE orders 
            SET delivery_company = COALESCE($1, delivery_company),
                driver_name = COALESCE($2, driver_name),
                license_plate = COALESCE($3, license_plate),
                notes = COALESCE($4, notes),
                status = COALESCE($5, status),
                delivery_proofs = $6
            WHERE id = $7
        `, [delivery_company, driver_name, license_plate, notes, status, proofsJson, id]);

        // Lấy tên khách hàng trước khi chạy vòng lặp
        const custNameRes = await client.query('SELECT customer_name FROM orders WHERE id=$1', [id]);
        const warrantyCustomer = custNameRes.rows[0]?.customer_name || 'Khách Lẻ';

        // Update Serial
        if (items && items.length > 0) {
            for (let i of items) {
                await client.query("UPDATE order_items SET serial_number = $1 WHERE product_id = $2 AND order_id = $3", 
                [i.serial_number || '', i.product_id, id]);

                // [THÊM MỚI] Tự động kích hoạt bảo hành
                if (i.serial_number && i.serial_number.trim() !== '') {
                    await client.query(`
                        INSERT INTO warranties (serial_number, sku, customer_name, warranty_months, activated_at) 
                        VALUES (
                            $1, 
                            (SELECT sku FROM products WHERE id = $2), 
                            $3, 
                            120, 
                            CURRENT_TIMESTAMP
                        )
                        ON CONFLICT (serial_number) DO NOTHING
                    `, [i.serial_number.trim(), i.product_id, warrantyCustomer]);
                }
            }
        }
        await client.query('COMMIT');
        res.json({ success: true, proofUrls });
    } catch(e) { 
        await client.query('ROLLBACK'); 
        res.status(500).json({ success: false, error: e.message }); 
    } finally { client.release(); }
});

// TỰ ĐỘNG DỌN DẸP ĐƠN CHỜ XÁC NHẬN QUÁ 30 NGÀY (AUTO-CLEANUP)
(async () => {
    try {
        await pool.query("DELETE FROM orders WHERE status = 'PENDING' AND created_at < NOW() - INTERVAL '30 days'");
        console.log("[Auto-Cleanup] Đã dọn dẹp các đơn PENDING quá hạn 30 ngày lúc Server khởi động.");
    } catch(e) {}
})();
setInterval(async () => {
    try {
        await pool.query("DELETE FROM orders WHERE status = 'PENDING' AND created_at < NOW() - INTERVAL '30 days'");
    } catch(e) {}
}, 60 * 60 * 1000); // Rà soát đều đặn mỗi tiếng một lần

// [BẢO MẬT KÉP] XÓA ĐƠN HÀNG VĨNH VIỄN
router.delete('/:id/force', async (req, res) => {
    try {
        const orderId = req.params.id;
        const orderRes = await pool.query('SELECT status FROM orders WHERE id = $1', [orderId]);
        if (orderRes.rows.length === 0) return res.json({ success: false, error: 'Không tìm thấy đơn hàng!' });
        
        const status = orderRes.rows[0].status;
        const { password } = req.body;
        const ADMIN_PASSWORD = 'sungo123'; 

        // NẾU ĐƠN KHÔNG PHẢI "CHỜ XÁC NHẬN" -> ADMIN MỚI CÓ QUYỀN TRẢM
        if (status !== 'PENDING' && status !== 'NEW') {
            if (password !== ADMIN_PASSWORD) {
                return res.status(403).json({ success: false, error: 'Đơn đã xử lý hoặc đã hủy/trả! Cần Mật khẩu Admin để tiêu hủy.' });
            }
            
            // Phục hồi Tồn kho (Nếu đơn hàng đang ở trạng thái đã trừ kho)
            if (['PACKED', 'SHIPPING_CMD', 'SHIPPED', 'COMPLETED'].includes(status)) {
                const itemsRes = await pool.query('SELECT product_id, quantity FROM order_items WHERE order_id = $1', [orderId]);
                for (let item of itemsRes.rows) {
                    if (item.product_id) {
                        await pool.query('UPDATE products SET stock_qty = stock_qty + $1 WHERE id = $2', [item.quantity, item.product_id]);
                    }
                }
            }
        }

        // Tiêu hủy sạch sẽ toàn bộ chứng cứ
        await pool.query('DELETE FROM order_docs WHERE order_id = $1', [orderId]);
        await pool.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);
        await pool.query('DELETE FROM order_timeline WHERE order_id = $1', [orderId]);
        await pool.query('DELETE FROM orders WHERE id = $1', [orderId]);

        res.json({ success: true, message: 'Đã xóa sạch sẽ!' });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});
// API UPLOAD CHỨNG TỪ (Tự động đồng bộ Google Drive / Local)
router.post('/:id/docs', async (req, res) => {
    try {
        const id = req.params.id; // Lấy ID đơn hàng
        const payload = req.body;

        if (!payload.file_data) {
            return res.status(400).json({success: false, error: 'Thiếu file data'});
        }

        // 1. Giải mã file Base64
        const matches = payload.file_data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches) return res.status(400).json({success: false, error: 'File sai định dạng'});

        const mimeType = matches[1];
        const buffer = Buffer.from(matches[2], 'base64');
        const ext = payload.file_name?.toLowerCase().includes('pdf') ? '.pdf' : '.jpg';
        const rawFileName = payload.file_name || `proof_${id}_${Date.now()}${ext}`;

        // 2. Upload file qua Google Drive Service
        const uploadResult = await googleDriveService.uploadFile({
            buffer: buffer,
            originalname: rawFileName,
            mimetype: mimeType,
            subfolder: 'proofs'
        });

        const fileUrl = uploadResult.url;

        // 3. Lưu đường dẫn vào Database
        const dbFile = path.join(__dirname, '../data/orders.json');
        if (fs.existsSync(dbFile)) {
            let data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
            const idx = data.findIndex(x => x.id == id);
            if (idx !== -1) {
                if(!data[idx].docs) data[idx].docs = [];
                data[idx].docs.push({
                    id: Date.now(),
                    doc_type: payload.file_name,
                    file_url: fileUrl,
                    storage: uploadResult.storage,
                    fileId: uploadResult.fileId || null
                });
                fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
                return res.json({
                    success: true,
                    file_url: fileUrl,
                    storage: uploadResult.storage
                });
            }
        }
        res.status(404).json({success: false, error: 'Không tìm thấy đơn hàng trong Database'});
    } catch(e) { 
        console.error("LỖI UPLOAD:", e);
        res.status(500).json({success: false, error: e.message}); 
    }
});

// API XÓA FILE CHỨNG TỪ
router.delete('/:id/docs/:docId', (req, res) => {
    try {
        const id = req.params.id;
        const docId = parseInt(req.params.docId);
        const fs = require('fs');
        const path = require('path');
        const dbFile = path.join(__dirname, '../data/orders.json');
        
        if (fs.existsSync(dbFile)) {
            let data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
            const idx = data.findIndex(x => x.id == id);
            if (idx !== -1 && data[idx].docs) {
                data[idx].docs = data[idx].docs.filter(d => d.id !== docId);
                fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
                return res.json({success: true});
            }
        }
        res.status(404).json({success: false});
    } catch(e) { res.status(500).json({success: false}); }
});

// [POST] ĐÍNH KÈM FILE VÀO ĐƠN HÀNG (Bổ sung file, không ghi đè toàn bộ đơn)
router.post('/:id/attach-file', async (req, res) => {
    try {
        const orderId = req.params.id;
        const { fileUrl } = req.body;
        
        const getOrder = await pool.query('SELECT attached_files FROM orders WHERE id = $1', [orderId]);
        if (getOrder.rows.length === 0) return res.json({ success: false, error: 'Không tìm thấy đơn hàng' });
        
        let files = [];
        const dbFiles = getOrder.rows[0].attached_files;
        if (typeof dbFiles === 'string') {
            try { files = JSON.parse(dbFiles); } catch(e) {}
        } else if (Array.isArray(dbFiles)) {
            files = dbFiles;
        }
        
        files.push(fileUrl);
        await pool.query('UPDATE orders SET attached_files = $1 WHERE id = $2', [JSON.stringify(files), orderId]);
        
        res.json({ success: true, files: files });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

module.exports = router;