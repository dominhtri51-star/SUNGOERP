const express = require('express');
const router = express.Router();
const pool = require('../config/database');

const initTable = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS cash_transactions (
                id SERIAL PRIMARY KEY,
                code VARCHAR(50),
                type VARCHAR(10),
                target_name VARCHAR(255),
                amount NUMERIC(15,2),
                payment_method VARCHAR(50) DEFAULT 'Tiền Mặt',
                category VARCHAR(100) DEFAULT 'Vận hành chung',
                tax_status VARCHAR(50) DEFAULT 'KHONG_HOA_DON',
                source_fund VARCHAR(50) DEFAULT 'TK_CONG_TY',
                attachment_url TEXT,
                notes TEXT,
                customer_id INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // Add columns if not exists
        await pool.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cash_transactions' AND column_name = 'payment_method') THEN
                    ALTER TABLE cash_transactions ADD COLUMN payment_method VARCHAR(50) DEFAULT 'Tiền Mặt';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cash_transactions' AND column_name = 'customer_id') THEN
                    ALTER TABLE cash_transactions ADD COLUMN customer_id INT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cash_transactions' AND column_name = 'category') THEN
                    ALTER TABLE cash_transactions ADD COLUMN category VARCHAR(100) DEFAULT 'Vận hành chung';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cash_transactions' AND column_name = 'tax_status') THEN
                    ALTER TABLE cash_transactions ADD COLUMN tax_status VARCHAR(50) DEFAULT 'KHONG_HOA_DON';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cash_transactions' AND column_name = 'source_fund') THEN
                    ALTER TABLE cash_transactions ADD COLUMN source_fund VARCHAR(50) DEFAULT 'TK_CONG_TY';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cash_transactions' AND column_name = 'attachment_url') THEN
                    ALTER TABLE cash_transactions ADD COLUMN attachment_url TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cash_transactions' AND column_name = 'order_id') THEN
                    ALTER TABLE cash_transactions ADD COLUMN order_id INT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cash_transactions' AND column_name = 'order_code') THEN
                    ALTER TABLE cash_transactions ADD COLUMN order_code VARCHAR(50);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cash_transactions' AND column_name = 'cost_type') THEN
                    ALTER TABLE cash_transactions ADD COLUMN cost_type VARCHAR(50);
                END IF;
            END $$;
        `);
    } catch(e) { console.log("Lỗi init bảng cash_transactions:", e.message); }
};
initTable();

// 1. GET: Lấy thống kê Sổ Quỹ & Danh sách Giao Dịch Thu/Chi (Hỗ trợ lọc ngày & Siêu tốc chống nghẽn mạng)
router.get('/cash', async (req, res) => {
    try {
        const { type, category, tax_status, source_fund, search, date_from, date_to, limit } = req.query;
        let query = "SELECT * FROM cash_transactions";
        const params = [];
        const conditions = [];

        if (type && type !== 'ALL') {
            params.push(type);
            conditions.push(`type = $${params.length}`);
        }
        if (category && category !== 'ALL') {
            params.push(category);
            conditions.push(`category = $${params.length}`);
        }
        if (tax_status && tax_status !== 'ALL') {
            params.push(tax_status);
            conditions.push(`tax_status = $${params.length}`);
        }
        if (source_fund && source_fund !== 'ALL') {
            params.push(source_fund);
            conditions.push(`source_fund = $${params.length}`);
        }
        if (search && search.trim()) {
            params.push(`%${search.trim()}%`);
            conditions.push(`(code ILIKE $${params.length} OR target_name ILIKE $${params.length} OR notes ILIKE $${params.length} OR category ILIKE $${params.length} OR order_code ILIKE $${params.length})`);
        }
        if (date_from && date_to) {
            params.push(date_from + ' 00:00:00');
            params.push(date_to + ' 23:59:59');
            conditions.push(`created_at >= $${params.length - 1}::timestamp AND created_at <= $${params.length}::timestamp`);
        } else if (date_from) {
            params.push(date_from + ' 00:00:00');
            conditions.push(`created_at >= $${params.length}::timestamp`);
        } else if (date_to) {
            params.push(date_to + ' 23:59:59');
            conditions.push(`created_at <= $${params.length}::timestamp`);
        }

        if (conditions.length > 0) {
            query += " WHERE " + conditions.join(" AND ");
        }
        
        const maxLimit = limit ? Math.min(1000, parseInt(limit)) : 1000;
        params.push(maxLimit);
        query += ` ORDER BY created_at DESC, id DESC LIMIT $${params.length}`;

        const transRes = await pool.query(query, params);
        
        // 1. Tính tổng Quỹ Tiền Mặt LŨY KẾ (Toàn bộ thời gian - Chuẩn mực số dư kế toán)
        const sumRes = await pool.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN type = 'THU' THEN amount ELSE 0 END), 0) as total_thu,
                COALESCE(SUM(CASE WHEN type = 'CHI' THEN amount ELSE 0 END), 0) as total_chi,
                COALESCE(SUM(CASE WHEN type = 'THU' AND (payment_method = 'Tiền Mặt' OR source_fund = 'TIEN_MAT_QUY') THEN amount ELSE 0 END), 0) as thu_cash,
                COALESCE(SUM(CASE WHEN type = 'THU' AND payment_method != 'Tiền Mặt' AND source_fund != 'TIEN_MAT_QUY' THEN amount ELSE 0 END), 0) as thu_bank,
                COALESCE(SUM(CASE WHEN type = 'CHI' AND (payment_method = 'Tiền Mặt' OR source_fund = 'TIEN_MAT_QUY') THEN amount ELSE 0 END), 0) as chi_cash,
                COALESCE(SUM(CASE WHEN type = 'CHI' AND payment_method != 'Tiền Mặt' AND source_fund != 'TIEN_MAT_QUY' THEN amount ELSE 0 END), 0) as chi_bank,
                -- Phân loại Thuế vs Quản trị
                COALESCE(SUM(CASE WHEN type = 'CHI' AND tax_status IN ('CO_HOA_DON', 'BANG_KE_01', 'KHOAN_VIEC_08') THEN amount ELSE 0 END), 0) as chi_tax_valid,
                COALESCE(SUM(CASE WHEN type = 'CHI' AND (tax_status = 'KHONG_HOA_DON' OR tax_status IS NULL) THEN amount ELSE 0 END), 0) as chi_tax_invalid,
                -- Phân bổ theo 4 nhóm trọng yếu
                COALESCE(SUM(CASE WHEN type = 'CHI' AND category ILIKE '%Giao hàng%' THEN amount ELSE 0 END), 0) as chi_shipping,
                COALESCE(SUM(CASE WHEN type = 'CHI' AND (category ILIKE '%Thuê%' OR category ILIKE '%Kho%' OR category ILIKE '%Văn phòng%') THEN amount ELSE 0 END), 0) as chi_rent,
                COALESCE(SUM(CASE WHEN type = 'CHI' AND (category ILIKE '%Thời vụ%' OR category ILIKE '%Nhân công%') THEN amount ELSE 0 END), 0) as chi_labor,
                COALESCE(SUM(CASE WHEN type = 'CHI' AND (category ILIKE '%Vay%' OR category ILIKE '%Chủ sở hữu%') THEN amount ELSE 0 END), 0) as chi_owner_loan
            FROM cash_transactions
        `);
        const totalThu = parseFloat(sumRes.rows[0].total_thu || 0);
        const totalChi = parseFloat(sumRes.rows[0].total_chi || 0);
        const currentCash = totalThu - totalChi;

        // 2. Tính Tổng Thu và Chi TRONG KỲ LỌC (nếu có chọn khoảng ngày)
        let periodThu = totalThu;
        let periodChi = totalChi;
        let periodB4 = parseFloat(sumRes.rows[0].chi_tax_invalid || 0);
        let periodValidTax = parseFloat(sumRes.rows[0].chi_tax_valid || 0);

        if (date_from || date_to) {
            let periodParams = [];
            let periodWhere = [];
            if (date_from && date_to) {
                periodParams.push(date_from + ' 00:00:00', date_to + ' 23:59:59');
                periodWhere.push(`created_at >= $1::timestamp AND created_at <= $2::timestamp`);
            } else if (date_from) {
                periodParams.push(date_from + ' 00:00:00');
                periodWhere.push(`created_at >= $1::timestamp`);
            } else if (date_to) {
                periodParams.push(date_to + ' 23:59:59');
                periodWhere.push(`created_at <= $1::timestamp`);
            }
            const pRes = await pool.query(`
                SELECT 
                    COALESCE(SUM(CASE WHEN type = 'THU' THEN amount ELSE 0 END), 0) as p_thu,
                    COALESCE(SUM(CASE WHEN type = 'CHI' THEN amount ELSE 0 END), 0) as p_chi,
                    COALESCE(SUM(CASE WHEN type = 'CHI' AND (tax_status = 'KHONG_HOA_DON' OR tax_status IS NULL) THEN amount ELSE 0 END), 0) as p_b4,
                    COALESCE(SUM(CASE WHEN type = 'CHI' AND tax_status IN ('CO_HOA_DON', 'BANG_KE_01', 'KHOAN_VIEC_08') THEN amount ELSE 0 END), 0) as p_valid
                FROM cash_transactions
                WHERE ${periodWhere.join(' AND ')}
            `, periodParams);
            periodThu = parseFloat(pRes.rows[0].p_thu || 0);
            periodChi = parseFloat(pRes.rows[0].p_chi || 0);
            periodB4 = parseFloat(pRes.rows[0].p_b4 || 0);
            periodValidTax = parseFloat(pRes.rows[0].p_valid || 0);
        }

        // Tự động tính Nợ Phải Thu Khách Hàng (TK 131 từ Orders: Tổng tiền - Đã thanh toán)
        let totalReceivable = 0;
        try {
            const debtRes = await pool.query("SELECT COALESCE(SUM(total_amount - COALESCE(paid_amount,0)), 0) as debt FROM orders WHERE status != 'CANCELLED' AND status != 'RETURNED'");
            totalReceivable = parseFloat(debtRes.rows[0].debt || 0);
        } catch (e) {}

        res.json({
            success: true,
            summary: {
                total_cash: currentCash,
                total_thu: totalThu,
                total_chi: totalChi,
                period_thu: periodThu,
                period_chi: periodChi,
                period_b4: periodB4,
                period_valid_tax: periodValidTax,
                is_filtered_date: !!(date_from || date_to),
                total_receivable: totalReceivable,
                thu_cash: parseFloat(sumRes.rows[0].thu_cash || 0),
                thu_bank: parseFloat(sumRes.rows[0].thu_bank || 0),
                chi_cash: parseFloat(sumRes.rows[0].chi_cash || 0),
                chi_bank: parseFloat(sumRes.rows[0].chi_bank || 0),
                chi_tax_valid: parseFloat(sumRes.rows[0].chi_tax_valid || 0),
                chi_tax_invalid: parseFloat(sumRes.rows[0].chi_tax_invalid || 0),
                chi_shipping: parseFloat(sumRes.rows[0].chi_shipping || 0),
                chi_rent: parseFloat(sumRes.rows[0].chi_rent || 0),
                chi_labor: parseFloat(sumRes.rows[0].chi_labor || 0),
                chi_owner_loan: parseFloat(sumRes.rows[0].chi_owner_loan || 0),
                count_transactions: transRes.rows.length
            },
            transactions: transRes.rows
        });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 2. POST: Ghi nhận Phiếu Thu / Phiếu Chi mới
router.post('/cash', async (req, res) => {
    try {
        const { 
            type, target_name, amount, payment_method, 
            category, tax_status, source_fund, attachment_url, 
            notes, customer_id 
        } = req.body;
        
        const code = (type === 'THU' ? 'PT-' : 'PC-') + Date.now().toString().slice(-6);
        const method = payment_method || 'Tiền Mặt';
        const cat = category || (type === 'THU' ? 'Thu tiền hàng' : 'Vận hành chung');
        const taxStat = tax_status || (type === 'THU' ? 'KHONG_AP_DUNG' : 'KHONG_HOA_DON');
        const fund = source_fund || (method === 'Tiền Mặt' ? 'TIEN_MAT_QUY' : 'TK_CONG_TY');
        const amt = parseFloat(amount) || 0;

        await pool.query(
            `INSERT INTO cash_transactions 
             (code, type, target_name, amount, payment_method, category, tax_status, source_fund, attachment_url, notes, customer_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [code, type, target_name, amt, method, cat, taxStat, fund, attachment_url || '', notes || '', customer_id || null]
        );

        // Nếu là chi có hóa đơn VAT / Bảng kê hợp lệ, tự động đồng bộ sang bảng expenses
        if (type === 'CHI' && (taxStat === 'CO_HOA_DON' || taxStat === 'BANG_KE_01')) {
            try {
                await pool.query(`
                    INSERT INTO expenses (expense_date, category, description, vendor_name, has_invoice, total_amount, amount_before_tax, tax_status, source_fund)
                    VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7, $8)
                `, [cat, notes || `${code} - ${target_name}`, target_name, taxStat === 'CO_HOA_DON', amt, amt, taxStat, fund]);
            } catch (expErr) {
                console.error("Lỗi đồng bộ chi phí sang expenses:", expErr.message);
            }
        }

        // Nếu là thu nợ của khách hàng và có customer_id, ghi nhận thanh toán vào bảng customers
        if (type === 'THU' && customer_id) {
            try {
                await pool.query(`
                    UPDATE customers 
                    SET current_debt = GREATEST(0, COALESCE(current_debt, 0) - $1),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = $2
                `, [amt, customer_id]);
            } catch (custErr) {
                console.error("Lỗi cập nhật công nợ khách hàng:", custErr.message);
            }
        }

        res.json({ success: true, code, message: `Đã lập ${type === 'THU' ? 'Phiếu Thu' : 'Phiếu Chi'} #${code} thành công!` });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Xóa một phiếu giao dịch khỏi Sổ Quỹ (cash_transactions)
router.delete('/cash/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const txRes = await pool.query("SELECT * FROM cash_transactions WHERE id = $1", [id]);
        if (txRes.rows.length === 0) {
            return res.json({ success: true, message: 'Giao dịch không tồn tại hoặc đã được xóa trước đó' });
        }
        const tx = txRes.rows[0];

        // 1. Xóa giao dịch khỏi cash_transactions
        await pool.query("DELETE FROM cash_transactions WHERE id = $1", [id]);

        // 2. Nếu phiếu thu/chi liên quan tới customer_id, đồng bộ lại công nợ
        if (tx.customer_id) {
            try {
                await pool.query(`
                    UPDATE customers 
                    SET current_debt = (SELECT COALESCE(SUM(total_amount - paid_amount), 0) FROM orders WHERE customer_id = $1 AND status NOT IN ('CANCELLED', 'RETURNED'))
                    WHERE id = $1
                `, [tx.customer_id]);
            } catch(e) {}
        }

        res.json({ 
            success: true, 
            message: `Đã xóa phiếu giao dịch [${tx.code}] (${tx.type === 'THU' ? 'Phiếu Thu' : 'Phiếu Chi'}) khỏi Sổ Quỹ!` 
        });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// 1.5. API CÔNG NỢ PHẢI THU KHÁCH HÀNG (TK 131) - ĐỒNG BỘ CRM & ĐƠN HÀNG
// ==========================================
router.get('/receivables-aging', async (req, res) => {
    try {
        const query = `
            SELECT 
                MAX(COALESCE(c.id, o.customer_id, 0)) as customer_id,
                COALESCE(NULLIF(c.name, ''), NULLIF(c.full_name, ''), o.customer_name, 'Khách Vãng Lai') as customer_name,
                MAX(c.phone) as customer_phone,
                MAX(c.address) as customer_address,
                MAX(c.customer_code) as customer_code,
                MAX(COALESCE(c.debt_limit, 0)) as debt_limit,
                MAX(COALESCE(c.tier, c.vip_level, 1)) as customer_tier,
                COUNT(o.id) as unpaid_orders_count,
                SUM(o.total_amount) as total_order_amount,
                SUM(COALESCE(o.paid_amount, 0)) as total_paid,
                SUM(o.total_amount - COALESCE(o.paid_amount, 0)) as remaining_debt,
                MIN(o.created_at) as oldest_order_date,
                MAX(o.created_at) as latest_order_date,
                (ARRAY_AGG(o.order_code ORDER BY o.created_at DESC))[1] as latest_order_code,
                GREATEST(0, DATE_PART('day', NOW() - MIN(o.created_at))::int) as days_overdue,
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'id', o.id,
                        'order_code', o.order_code,
                        'total_amount', o.total_amount,
                        'paid_amount', COALESCE(o.paid_amount, 0),
                        'remaining', (o.total_amount - COALESCE(o.paid_amount, 0)),
                        'created_at', o.created_at,
                        'status', o.status,
                        'days_overdue', GREATEST(0, DATE_PART('day', NOW() - o.created_at)::int)
                    ) ORDER BY o.created_at ASC
                ) as orders_detail
            FROM orders o
            LEFT JOIN customers c ON (o.customer_id = c.id OR (o.customer_id IS NULL AND (c.name = o.customer_name OR c.full_name = o.customer_name)))
            WHERE o.status NOT IN ('CANCELLED', 'RETURNED')
              AND (o.total_amount - COALESCE(o.paid_amount, 0)) > 0
            GROUP BY COALESCE(NULLIF(c.name, ''), NULLIF(c.full_name, ''), o.customer_name, 'Khách Vãng Lai')
            ORDER BY remaining_debt DESC
        `;

        const { rows } = await pool.query(query);

        let totalDebt = 0;
        let normalDebt = 0;
        let warningDebt = 0;
        let dangerDebt = 0;

        const debtorList = rows.map(d => {
            const rem = parseFloat(d.remaining_debt || 0);
            const days = parseInt(d.days_overdue || 0);
            totalDebt += rem;

            let aging_status = 'NORMAL';
            if (days > 25) {
                aging_status = 'DANGER';
                dangerDebt += rem;
            } else if (days > 10) {
                aging_status = 'WARNING';
                warningDebt += rem;
            } else {
                aging_status = 'NORMAL';
                normalDebt += rem;
            }

            return {
                ...d,
                remaining_debt: rem,
                total_order_amount: parseFloat(d.total_order_amount || 0),
                total_paid: parseFloat(d.total_paid || 0),
                aging_status
            };
        });

        res.json({
            success: true,
            summary: {
                total_debt: totalDebt,
                normal_debt: normalDebt,
                warning_debt: warningDebt,
                danger_debt: dangerDebt,
                debtor_count: debtorList.length
            },
            debts: debtorList
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 1.6. API BẢNG ĐỐI CHIẾU CÔNG NỢ CHI TIẾT THEO KHÁCH HÀNG (IN & XUẤT EXCEL THEO MẪU SUNGO)
router.get('/debt-statement', async (req, res) => {
    try {
        const { customer_id, customer_name, from_date, to_date } = req.query;
        if (!customer_id && !customer_name) {
            return res.status(400).json({ success: false, error: "Vui lòng chỉ định khách hàng cần đối chiếu công nợ!" });
        }

        // 1. Thông tin khách hàng
        let custInfo = { name: customer_name || 'Khách Hàng', phone: '', address: '', customer_code: '' };
        if (customer_id && parseInt(customer_id) > 0) {
            const cRes = await pool.query("SELECT * FROM customers WHERE id = $1", [customer_id]);
            if (cRes.rows.length > 0) {
                const c = cRes.rows[0];
                custInfo = {
                    id: c.id,
                    name: c.full_name || c.name || customer_name,
                    phone: c.phone || '',
                    address: c.address || '',
                    customer_code: c.customer_code || '',
                    debt_limit: c.debt_limit || 0
                };
            }
        }

        // 2. Danh sách các đơn hàng của khách hàng
        const cId = parseInt(customer_id) || 0;
        const cName = customer_name || custInfo.name || '';

        let orderSql = `
            SELECT o.id, o.order_code, o.total_amount, o.paid_amount, 
                   (o.total_amount - COALESCE(o.paid_amount, 0)) as remaining,
                   o.created_at, o.status, o.notes
            FROM orders o
            WHERE o.status NOT IN ('CANCELLED', 'RETURNED')
              AND (
                  ($1::int > 0 AND (o.customer_id = $1 OR o.customer_name IN (SELECT name FROM customers WHERE id = $1) OR o.customer_name IN (SELECT full_name FROM customers WHERE id = $1)))
                  OR ($2::text != '' AND (o.customer_name = $2 OR o.customer_name ILIKE $2))
              )
        `;
        const params = [cId, cName];

        if (from_date) {
            params.push(from_date);
            orderSql += ` AND o.created_at >= $${params.length}`;
        }
        if (to_date) {
            params.push(to_date + ' 23:59:59');
            orderSql += ` AND o.created_at <= $${params.length}`;
        }

        orderSql += " ORDER BY o.created_at ASC";
        const ordersRes = await pool.query(orderSql, params);

        let totalGrossAmount = 0;
        let totalPaidAmount = 0;
        let statementOrders = [];

        // 3. Lấy chi tiết từng mặt hàng trong từng đơn
        for (const ord of ordersRes.rows) {
            const total = parseFloat(ord.total_amount || 0);
            const paid = parseFloat(ord.paid_amount || 0);
            const rem = parseFloat(ord.remaining || 0);
            totalGrossAmount += total;
            totalPaidAmount += paid;

            const itemsRes = await pool.query(`
                SELECT oi.id, oi.product_id, 
                       COALESCE(NULLIF(oi.product_name, ''), p.product_name, 'Sản phẩm / Thiết bị') as product_name,
                       COALESCE(p.unit, 'Bộ') as unit,
                       COALESCE(oi.quantity, 1) as quantity,
                       COALESCE(oi.price, 0) as price,
                       COALESCE(oi.total, (COALESCE(oi.quantity, 1) * COALESCE(oi.price, 0))) as total
                FROM order_items oi
                LEFT JOIN products p ON oi.product_id = p.id
                WHERE oi.order_id = $1
                ORDER BY oi.id ASC
            `, [ord.id]);

            let items = itemsRes.rows.map(item => ({
                id: item.id,
                product_name: item.product_name,
                unit: item.unit,
                quantity: parseFloat(item.quantity) || 1,
                price: parseFloat(item.price) || 0,
                total: parseFloat(item.total) || 0
            }));

            // Nếu đơn hàng chưa có chi tiết items, tạo 1 dòng tổng quát
            if (items.length === 0) {
                items.push({
                    id: 0,
                    product_name: `Đơn hàng thiết bị năng lượng mặt trời #${ord.order_code}`,
                    unit: 'Gói',
                    quantity: 1,
                    price: total,
                    total: total
                });
            }

            statementOrders.push({
                order_id: ord.id,
                order_code: ord.order_code,
                order_date: ord.created_at,
                total_amount: total,
                paid_amount: paid,
                remaining_debt: rem,
                status: ord.status,
                items: items
            });
        }

        const remainingBalance = totalGrossAmount - totalPaidAmount;

        res.json({
            success: true,
            company: {
                name: "CÔNG TY TNHH ĐIỆN MẶT TRỜI SUNGO",
                address: "419/13 Song hành xa lộ Hà Nội, P. Trường Thọ, TP. Thủ Đức, TP.HCM",
                phone: "0937039889",
                email: "info@sungo.vn",
                website: "sungo.vn"
            },
            customer: custInfo,
            date_range: {
                from_date: from_date || (statementOrders[0]?.order_date || new Date()),
                to_date: to_date || (statementOrders[statementOrders.length - 1]?.order_date || new Date())
            },
            summary: {
                total_orders_count: statementOrders.length,
                total_gross_amount: totalGrossAmount,
                total_returned_amount: 0,
                total_paid_amount: totalPaidAmount,
                remaining_balance: remainingBalance
            },
            orders: statementOrders
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// THU HỒI CÔNG NỢ & ĐỒNG BỘ ĐƠN HÀNG + SỔ QUỸ
router.post('/collect-debt', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { 
            customer_id, customer_name, order_id, 
            amount, payment_method, source_fund, notes 
        } = req.body;

        const collectAmt = parseFloat(amount) || 0;
        if (collectAmt <= 0) {
            throw new Error("Số tiền thu nợ phải lớn hơn 0");
        }

        const custName = customer_name || 'Khách Hàng';
        const method = payment_method || 'Chuyển Khoản';
        const fund = source_fund || (method === 'Tiền Mặt' ? 'TIEN_MAT_QUY' : 'TK_CONG_TY');
        const code = 'PT-' + Date.now().toString().slice(-6);

        // 1. Ghi nhận Phiếu Thu vào cash_transactions
        await client.query(`
            INSERT INTO cash_transactions 
            (code, type, target_name, amount, payment_method, category, tax_status, source_fund, notes, customer_id)
            VALUES ($1, 'THU', $2, $3, $4, 'Thu tiền hàng', 'KHONG_AP_DUNG', $5, $6, $7)
        `, [code, custName, collectAmt, method, fund, notes || `Thu nợ khách hàng ${custName}`, (customer_id && parseInt(customer_id) > 0) ? customer_id : null]);

        // 2. Phân bổ tiền thu trừ nợ vào Đơn Hàng (orders)
        let remainingToApply = collectAmt;
        let settledOrders = [];

        if (order_id) {
            // Thu đích danh đơn hàng
            const ordRes = await client.query("SELECT id, order_code, total_amount, paid_amount FROM orders WHERE id = $1 FOR UPDATE", [order_id]);
            if (ordRes.rows.length > 0) {
                const ord = ordRes.rows[0];
                const currentUnpaid = Math.max(0, parseFloat(ord.total_amount) - parseFloat(ord.paid_amount || 0));
                const apply = Math.min(remainingToApply, currentUnpaid);
                const newPaid = parseFloat(ord.paid_amount || 0) + apply;
                await client.query("UPDATE orders SET paid_amount = $1 WHERE id = $2", [newPaid, ord.id]);
                settledOrders.push({ order_code: ord.order_code, applied: apply });
                remainingToApply -= apply;
            }
        } else {
            // Thu nợ tổng thể: Trừ theo thứ tự đơn cũ nhất trước (FIFO)
            let orderQuery = `
                SELECT id, order_code, total_amount, paid_amount 
                FROM orders 
                WHERE status NOT IN ('CANCELLED', 'RETURNED')
                  AND (total_amount - COALESCE(paid_amount, 0)) > 0
            `;
            let params = [];
            if (customer_id && parseInt(customer_id) > 0) {
                params.push(customer_id);
                orderQuery += ` AND customer_id = $${params.length}`;
            } else if (customer_name) {
                params.push(customer_name);
                orderQuery += ` AND customer_name = $${params.length}`;
            }
            orderQuery += " ORDER BY created_at ASC FOR UPDATE";

            const unpaidOrders = await client.query(orderQuery, params);
            for (const ord of unpaidOrders.rows) {
                if (remainingToApply <= 0) break;
                const currentUnpaid = Math.max(0, parseFloat(ord.total_amount) - parseFloat(ord.paid_amount || 0));
                if (currentUnpaid > 0) {
                    const apply = Math.min(remainingToApply, currentUnpaid);
                    const newPaid = parseFloat(ord.paid_amount || 0) + apply;
                    await client.query("UPDATE orders SET paid_amount = $1 WHERE id = $2", [newPaid, ord.id]);
                    settledOrders.push({ order_code: ord.order_code, applied: apply });
                    remainingToApply -= apply;
                }
            }
        }

        // 3. Cập nhật current_debt trong bảng customers
        if (customer_id && parseInt(customer_id) > 0) {
            await client.query(`
                UPDATE customers 
                SET current_debt = (
                    SELECT COALESCE(SUM(total_amount - COALESCE(paid_amount, 0)), 0)
                    FROM orders 
                    WHERE customer_id = customers.id AND status NOT IN ('CANCELLED', 'RETURNED')
                )
                WHERE id = $1
            `, [customer_id]);
        }

        await client.query('COMMIT');
        res.json({
            success: true,
            code,
            message: `Đã thu nợ ${new Intl.NumberFormat('vi-VN').format(collectAmt)} đ của khách hàng ${custName}!`,
            settled_orders: settledOrders
        });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: e.message });
    } finally {
        client.release();
    }
});

// ==========================================
// API BÁO CÁO THUẾ GTGT (HỖ TRỢ KẾ TOÁN TRƯỞNG)
// ==========================================
router.get('/tax-summary', async (req, res) => {
    try {
        const { period } = req.query; // Format: YYYY-MM hoặc YYYY
        const currentPeriod = period || new Date().toISOString().slice(0, 7); // Mặc định tháng hiện tại: 2026-08

        // 1. Lấy danh sách Hóa Đơn Bán Ra (Chỉ lấy các hóa đơn ĐÃ PHÁT HÀNH chính thức hoặc NHẬP TAY)
        const outRes = await pool.query(`
            SELECT * FROM invoices 
            WHERE (status IN ('ISSUED', 'Đã Phát Hành') OR ref_type = 'MANUAL')
              AND (issued_at::text LIKE $1 OR created_at::text LIKE $1)
            ORDER BY issued_at DESC, id DESC
        `, [`${currentPeriod}%`]);

        let vatOut0 = 0, vatOut8 = 0, vatOut10 = 0;
        let revOut0 = 0, revOut8 = 0, revOut10 = 0;
        let totalRevOut = 0, totalVatOut = 0;

        const outList = outRes.rows.map(inv => {
            const total = parseFloat(inv.total_amount || 0);
            const vat = parseFloat(inv.vat_amount || 0);
            const net = parseFloat(inv.amount_before_tax || (total - vat));
            const rate = parseInt(inv.vat_rate || 8);

            totalRevOut += net;
            totalVatOut += vat;

            if (rate === 0) { revOut0 += net; vatOut0 += vat; }
            else if (rate === 10) { revOut10 += net; vatOut10 += vat; }
            else { revOut8 += net; vatOut8 += vat; }

            let items = [];
            if (typeof inv.items_snapshot === 'string') {
                try { items = JSON.parse(inv.items_snapshot); } catch(e) {}
            } else if (Array.isArray(inv.items_snapshot)) {
                items = inv.items_snapshot;
            }

            return {
                id: inv.id,
                ref_id: inv.ref_id,
                ref_type: inv.ref_type,
                invoice_no: inv.invoice_no,
                invoice_symbol: inv.invoice_symbol || '1C26T-AA/26E',
                issued_at: inv.issued_at || inv.created_at,
                company_name: inv.company_name || 'Khách Lẻ',
                tax_code: inv.tax_code || '',
                amount_before_tax: net,
                vat_rate: rate,
                vat_amount: vat,
                total_amount: total,
                provider: inv.provider,
                items: items
            };
        });

        // 2. Lấy danh sách Hóa Đơn Mua Vào (Từ bảng expenses có has_invoice = true)
        const inRes = await pool.query(`
            SELECT * FROM expenses 
            WHERE has_invoice = true 
              AND expense_date::text LIKE $1
            ORDER BY expense_date DESC, id DESC
        `, [`${currentPeriod}%`]);

        let totalRevIn = 0, totalVatIn = 0;
        const inList = inRes.rows.map(exp => {
            const total = parseFloat(exp.total_amount || 0);
            const vat = parseFloat(exp.vat_amount || 0);
            const net = parseFloat(exp.amount_before_tax || (total - vat));
            const needUNC = total >= 20000000;

            totalRevIn += net;
            totalVatIn += vat;

            return {
                id: exp.id,
                expense_date: exp.expense_date,
                category: exp.category,
                description: exp.description,
                vendor_name: exp.vendor_name,
                vendor_tax_code: exp.vendor_tax_code,
                invoice_no: exp.invoice_no,
                amount_before_tax: net,
                vat_rate: exp.vat_rate || (vat > 0 ? 8 : 0),
                vat_amount: vat,
                total_amount: total,
                need_unc: needUNC,
                unc_status: needUNC ? 'Yêu cầu UNC ngân hàng (>20Tr)' : 'Hợp lệ thanh toán tiền mặt'
            };
        });

        // 3. Tính toán nghĩa vụ thuế GTGT kỳ này
        const vatDifference = totalVatOut - totalVatIn;
        const vatPayable = Math.max(0, vatDifference); // Thuế GTGT phải nộp (Chỉ tiêu [40])
        const vatCarriedForward = Math.max(0, -vatDifference); // Thuế GTGT còn được khấu trừ chuyển kỳ sau (Chỉ tiêu [43])

        res.json({
            success: true,
            period: currentPeriod,
            summary: {
                total_rev_out: totalRevOut,
                total_vat_out: totalVatOut,
                rev_out_0: revOut0, vat_out_0: vatOut0,
                rev_out_8: revOut8, vat_out_8: vatOut8,
                rev_out_10: revOut10, vat_out_10: vatOut10,
                total_rev_in: totalRevIn,
                total_vat_in: totalVatIn,
                vat_payable: vatPayable,
                vat_carried_forward: vatCarriedForward
            },
            vat_out_list: outList,
            vat_in_list: inList
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// API BÁO CÁO TÀI CHÍNH QUẢN TRỊ & P&L THỰC TẾ
// ==========================================
router.get('/financial-statement', async (req, res) => {
    try {
        const { period } = req.query; // Format: YYYY-MM hoặc YYYY
        const currentPeriod = period || new Date().toISOString().slice(0, 7);

        // 1. Doanh thu thuần & Giá vốn hàng bán (COGS) từ Đơn hàng trong kỳ
        const orderRes = await pool.query(`
            SELECT o.id, o.order_code, o.total_amount, o.paid_amount, o.status, o.created_at,
                   COALESCE(SUM(oi.quantity * COALESCE(p.import_price, 0)), 0) as total_cogs
            FROM orders o
            LEFT JOIN order_items oi ON o.id = oi.order_id
            LEFT JOIN products p ON oi.product_id = p.id
            WHERE o.status NOT IN ('CANCELLED', 'RETURNED')
              AND o.created_at::text LIKE $1
            GROUP BY o.id
        `, [`${currentPeriod}%`]);

        let totalGrossRevenue = 0;
        let totalCOGS = 0;
        orderRes.rows.forEach(r => {
            totalGrossRevenue += parseFloat(r.total_amount || 0);
            totalCOGS += parseFloat(r.total_cogs || 0);
        });

        // 2. Chi phí từ Sổ Quỹ (cash_transactions) và Bảng Expenses trong kỳ
        const cashExpRes = await pool.query(`
            SELECT 
                category,
                tax_status,
                COALESCE(SUM(amount), 0) as total_amt
            FROM cash_transactions
            WHERE type = 'CHI' AND created_at::text LIKE $1
            GROUP BY category, tax_status
        `, [`${currentPeriod}%`]);

        // Phân loại chi phí theo nhóm và theo hóa đơn
        let expShipping = { invoiced: 0, non_invoiced: 0, total: 0 };
        let expRent = { invoiced: 0, non_invoiced: 0, total: 0 };
        let expLabor = { invoiced: 0, non_invoiced: 0, total: 0 };
        let expOwnerLoan = { invoiced: 0, non_invoiced: 0, total: 0 };
        let expGeneral = { invoiced: 0, non_invoiced: 0, total: 0 };

        cashExpRes.rows.forEach(r => {
            const amt = parseFloat(r.total_amt || 0);
            const isTaxValid = ['CO_HOA_DON', 'BANG_KE_01', 'KHOAN_VIEC_08'].includes(r.tax_status);
            const cat = (r.category || '').toLowerCase();

            let targetGroup = expGeneral;
            if (cat.includes('giao hàng') || cat.includes('vận chuyển') || cat.includes('ship')) {
                targetGroup = expShipping;
            } else if (cat.includes('thuê') || cat.includes('kho') || cat.includes('mặt bằng') || cat.includes('văn phòng')) {
                targetGroup = expRent;
            } else if (cat.includes('thời vụ') || cat.includes('nhân công') || cat.includes('bốc xếp')) {
                targetGroup = expLabor;
            } else if (cat.includes('vay') || cat.includes('chủ sở hữu') || cat.includes('tài chính')) {
                targetGroup = expOwnerLoan;
            }

            if (isTaxValid) {
                targetGroup.invoiced += amt;
            } else {
                targetGroup.non_invoiced += amt;
            }
            targetGroup.total += amt;
        });

        // 3. Chi phí tiền lương chính thức nhân sự từ bảng payrolls
        let totalPayrollCost = 0;
        try {
            const payRes = await pool.query(`
                SELECT COALESCE(SUM(total_gross_salary + total_commission + total_allowance + total_bonus + total_insurance_comp), 0) as payroll_total
                FROM payrolls
                WHERE period_key = $1 OR period_key LIKE $2
            `, [currentPeriod, `${currentPeriod}%`]);
            totalPayrollCost = parseFloat(payRes.rows[0]?.payroll_total || 0);
        } catch (e) {}

        // 4. Chi phí lãi vay ngân hàng từ bảng loan_repayments
        let totalInterestBank = 0;
        try {
            const loanRes = await pool.query(`
                SELECT COALESCE(SUM(interest_paid), 0) as interest_total
                FROM loan_repayments
                WHERE repayment_date::text LIKE $1
            `, [`${currentPeriod}%`]);
            totalInterestBank = parseFloat(loanRes.rows[0]?.interest_total || 0);
        } catch (e) {}

        // 5. Tổng hợp các cột P&L 3 Cột (Có HĐ, Không HĐ, Tổng thực tế)
        const totalExpInvoiced = expShipping.invoiced + expRent.invoiced + expLabor.invoiced + expOwnerLoan.invoiced + expGeneral.invoiced + totalPayrollCost + totalInterestBank;
        const totalExpNonInvoiced = expShipping.non_invoiced + expRent.non_invoiced + expLabor.non_invoiced + expOwnerLoan.non_invoiced + expGeneral.non_invoiced;
        const totalOperatingExpenses = totalExpInvoiced + totalExpNonInvoiced;

        const grossProfit = totalGrossRevenue - totalCOGS;
        const profitBeforeTaxReal = grossProfit - totalOperatingExpenses; // Lợi nhuận trước thuế thực tế

        // Tính thuế TNDN ước tính: Sổ thuế loại trừ toàn bộ chi phí không có hóa đơn (Chỉ tiêu B4)
        const profitTaxBook = grossProfit - totalExpInvoiced; // Lợi nhuận theo sổ thuế (sẽ cao hơn do mất chi phí không HĐ)
        const estimatedCitTax = Math.max(0, profitTaxBook * 0.20); // Thuế TNDN 20%
        const netProfitPocket = profitBeforeTaxReal - estimatedCitTax; // Lợi nhuận ròng thực sự bỏ túi

        // 6. Tổng hợp công nợ 131 & 331
        let ar131 = 0;
        try {
            const arRes = await pool.query("SELECT COALESCE(SUM(total_amount - COALESCE(paid_amount,0)), 0) as ar FROM orders WHERE status NOT IN ('CANCELLED', 'RETURNED')");
            ar131 = parseFloat(arRes.rows[0]?.ar || 0);
        } catch (e) {}

        let ap331 = 0;
        try {
            const apRes = await pool.query("SELECT COALESCE(SUM(total_amount), 0) as ap FROM expenses WHERE has_invoice = true AND expense_date::text LIKE $1", [`${currentPeriod}%`]);
            ap331 = parseFloat(apRes.rows[0]?.ap || 0);
        } catch (e) {}

        res.json({
            success: true,
            period: currentPeriod,
            pnl_3cols: {
                revenue: { invoiced: totalGrossRevenue, non_invoiced: 0, total: totalGrossRevenue },
                cogs: { invoiced: totalCOGS, non_invoiced: 0, total: totalCOGS },
                gross_profit: { invoiced: grossProfit, non_invoiced: 0, total: grossProfit },
                expenses: {
                    shipping: expShipping,
                    rent: expRent,
                    labor: expLabor,
                    owner_loan: expOwnerLoan,
                    payroll: { invoiced: totalPayrollCost, non_invoiced: 0, total: totalPayrollCost },
                    bank_interest: { invoiced: totalInterestBank, non_invoiced: 0, total: totalInterestBank },
                    general: expGeneral,
                    total_invoiced: totalExpInvoiced,
                    total_non_invoiced: totalExpNonInvoiced,
                    total_operating: totalOperatingExpenses
                },
                profit_before_tax_real: profitBeforeTaxReal,
                profit_tax_book: profitTaxBook,
                non_deductible_b4: totalExpNonInvoiced,
                estimated_cit_tax: estimatedCitTax,
                net_profit_pocket: netProfitPocket,
                net_margin_pocket: totalGrossRevenue > 0 ? ((netProfitPocket / totalGrossRevenue) * 100).toFixed(2) : '0.00'
            },
            pnl: {
                gross_revenue: totalGrossRevenue,
                deductions: 0,
                net_revenue: totalGrossRevenue,
                cogs: totalCOGS,
                gross_profit: grossProfit,
                gross_margin: totalGrossRevenue > 0 ? ((grossProfit / totalGrossRevenue) * 100).toFixed(2) : '0.00',
                operating_expenses: totalOperatingExpenses,
                payroll_expenses: totalPayrollCost,
                interest_expenses: totalInterestBank,
                total_expenses: totalOperatingExpenses,
                net_profit: netProfitPocket,
                net_margin: totalGrossRevenue > 0 ? ((netProfitPocket / totalGrossRevenue) * 100).toFixed(2) : '0.00'
            },
            balance_indicators: {
                receivables_131: ar131,
                payables_331: ap331
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;