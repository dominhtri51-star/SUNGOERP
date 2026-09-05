const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Hàm tạo chữ viết tắt Avatar (VD: "Anh Quốc Lưu" -> "AL", "Đức Camera" -> "ĐC")
function getAvatarInitials(name) {
    if (!name || typeof name !== 'string') return 'KH';
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    const first = words[0][0];
    const last = words[words.length - 1][0];
    return (first + last).toUpperCase();
}

// Hàm tính toán số dư thực tế của khách hàng (Orders + Debt Transactions)
async function calculatePartnerBalance(client, customerId) {
    // 1. Tổng tiền đơn hàng bán (phát sinh nợ phải thu)
    const ordRes = await client.query(`
        SELECT 
            COALESCE(SUM(total_amount), 0) as total_sales,
            COALESCE(SUM(paid_amount), 0) as total_order_paid
        FROM orders 
        WHERE customer_id = $1 AND status NOT IN ('CANCELLED', 'RETURNED')
    `, [customerId]);
    const totalSales = parseFloat(ordRes.rows[0]?.total_sales || 0);

    // 2. Tổng giao dịch trực tiếp từ sổ nợ
    const txRes = await client.query(`
        SELECT 
            COALESCE(SUM(CASE WHEN transaction_type = 'RECEIVE' THEN amount ELSE 0 END), 0) as total_received,
            COALESCE(SUM(CASE WHEN transaction_type = 'PAY' THEN amount ELSE 0 END), 0) as total_paid_out
        FROM debt_transactions
        WHERE customer_id = $1
    `, [customerId]);
    const totalReceived = parseFloat(txRes.rows[0]?.total_received || 0);
    const totalPaidOut = parseFloat(txRes.rows[0]?.total_paid_out || 0);

    // Đếm các đơn thanh toán tiền mặt/chuyển khoản lúc tạo đơn mà chưa qua debt_transactions:
    const directOrderPaidRes = await client.query(`
        SELECT COALESCE(SUM(o.paid_amount), 0) as initial_paid
        FROM orders o
        WHERE o.customer_id = $1 
          AND o.status NOT IN ('CANCELLED', 'RETURNED')
          AND o.id NOT IN (SELECT order_id FROM debt_transactions WHERE order_id IS NOT NULL AND customer_id = $1)
    `, [customerId]);
    const initialPaid = parseFloat(directOrderPaidRes.rows[0]?.initial_paid || 0);

    // Dư nợ = Tổng tiền hàng + Tiền chi ra cho khách - Tiền khách đã trả (gồm giao dịch nhận + cọc ban đầu)
    const netBalance = (totalSales + totalPaidOut) - (totalReceived + initialPaid);
    return netBalance;
}

// =========================================================================
// 1. GET /api/debt-book/summary : TỔNG QUAN PHẢI THU & PHẢI TRẢ
// =========================================================================
router.get('/summary', async (req, res) => {
    try {
        const query = `
            WITH partner_orders AS (
                SELECT 
                    customer_id,
                    COALESCE(SUM(total_amount), 0) as total_orders,
                    COALESCE(SUM(paid_amount), 0) as order_paid
                FROM orders 
                WHERE status NOT IN ('CANCELLED', 'RETURNED') AND customer_id IS NOT NULL
                GROUP BY customer_id
            ),
            partner_tx AS (
                SELECT 
                    customer_id,
                    COALESCE(SUM(CASE WHEN transaction_type = 'RECEIVE' THEN amount ELSE 0 END), 0) as total_received,
                    COALESCE(SUM(CASE WHEN transaction_type = 'PAY' THEN amount ELSE 0 END), 0) as total_paid_out
                FROM debt_transactions
                WHERE customer_id IS NOT NULL
                GROUP BY customer_id
            ),
            partner_unlinked_paid AS (
                SELECT 
                    o.customer_id,
                    COALESCE(SUM(o.paid_amount), 0) as unlinked_paid
                FROM orders o
                WHERE o.status NOT IN ('CANCELLED', 'RETURNED') 
                  AND o.customer_id IS NOT NULL
                  AND o.id NOT IN (SELECT order_id FROM debt_transactions WHERE order_id IS NOT NULL)
                GROUP BY o.customer_id
            )
            SELECT 
                c.id,
                c.name,
                c.full_name,
                COALESCE(po.total_orders, 0) as total_orders,
                COALESCE(ptx.total_received, 0) as total_received,
                COALESCE(ptx.total_paid_out, 0) as total_paid_out,
                COALESCE(pup.unlinked_paid, 0) as unlinked_paid
            FROM customers c
            LEFT JOIN partner_orders po ON c.id = po.customer_id
            LEFT JOIN partner_tx ptx ON c.id = ptx.customer_id
            LEFT JOIN partner_unlinked_paid pup ON c.id = pup.customer_id
            WHERE (COALESCE(po.total_orders, 0) > 0 OR COALESCE(ptx.total_received, 0) > 0 OR COALESCE(ptx.total_paid_out, 0) > 0)
        `;

        const { rows } = await pool.query(query);

        let totalReceivable = 0; // Phải thu (Net > 0)
        let totalPayable = 0;    // Phải trả (Net < 0)
        let debtorCount = 0;     // Số khách phải thu
        let creditorCount = 0;   // Số khách phải trả

        rows.forEach(r => {
            const orders = parseFloat(r.total_orders || 0);
            const received = parseFloat(r.total_received || 0);
            const paidOut = parseFloat(r.total_paid_out || 0);
            const unlinked = parseFloat(r.unlinked_paid || 0);
            
            const net = (orders + paidOut) - (received + unlinked);
            if (net > 0) {
                totalReceivable += net;
                debtorCount++;
            } else if (net < 0) {
                totalPayable += Math.abs(net);
                creditorCount++;
            }
        });

        // Đếm lịch nhắc nợ sắp tới
        const reminderRes = await pool.query(`
            SELECT COUNT(DISTINCT customer_id) as count 
            FROM debt_transactions 
            WHERE reminder_date IS NOT NULL AND reminder_date >= CURRENT_DATE
        `);
        const reminderCount = parseInt(reminderRes.rows[0]?.count || 0);

        res.json({
            success: true,
            summary: {
                total_receivable: Math.round(totalReceivable),
                total_payable: Math.round(totalPayable),
                debtor_count: debtorCount,
                creditor_count: creditorCount,
                reminder_count: reminderCount
            }
        });
    } catch(err) {
        console.error('Lỗi GET /api/debt-book/summary:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// =========================================================================
// 2. GET /api/debt-book/partners : DANH SÁCH KHÁCH HÀNG & NHÀ CUNG CẤP SỔ NỢ
// =========================================================================
router.get('/partners', async (req, res) => {
    try {
        const { search, partner_type, debt_status } = req.query;

        const query = `
            WITH partner_orders AS (
                SELECT 
                    customer_id,
                    COALESCE(SUM(total_amount), 0) as total_orders,
                    COUNT(id) as orders_count,
                    MAX(created_at) as latest_order_date
                FROM orders 
                WHERE status NOT IN ('CANCELLED', 'RETURNED') AND customer_id IS NOT NULL
                GROUP BY customer_id
            ),
            partner_tx AS (
                SELECT 
                    customer_id,
                    COALESCE(SUM(CASE WHEN transaction_type = 'RECEIVE' THEN amount ELSE 0 END), 0) as total_received,
                    COALESCE(SUM(CASE WHEN transaction_type = 'PAY' THEN amount ELSE 0 END), 0) as total_paid_out,
                    MAX(created_at) as latest_tx_date,
                    (ARRAY_AGG(reminder_date ORDER BY reminder_date DESC NULLS LAST))[1] as active_reminder
                FROM debt_transactions
                WHERE customer_id IS NOT NULL
                GROUP BY customer_id
            ),
            partner_unlinked_paid AS (
                SELECT 
                    o.customer_id,
                    COALESCE(SUM(o.paid_amount), 0) as unlinked_paid
                FROM orders o
                WHERE o.status NOT IN ('CANCELLED', 'RETURNED') 
                  AND o.customer_id IS NOT NULL
                  AND o.id NOT IN (SELECT order_id FROM debt_transactions WHERE order_id IS NOT NULL)
                GROUP BY o.customer_id
            )
            SELECT 
                c.id,
                COALESCE(NULLIF(c.full_name, ''), NULLIF(c.name, ''), 'Khách Hàng') as name,
                c.phone,
                c.address,
                c.customer_code,
                COALESCE(po.total_orders, 0) as total_orders,
                COALESCE(po.orders_count, 0) as orders_count,
                COALESCE(ptx.total_received, 0) as total_received,
                COALESCE(ptx.total_paid_out, 0) as total_paid_out,
                COALESCE(pup.unlinked_paid, 0) as unlinked_paid,
                GREATEST(po.latest_order_date, ptx.latest_tx_date) as last_activity_date,
                ptx.active_reminder as reminder_date
            FROM customers c
            LEFT JOIN partner_orders po ON c.id = po.customer_id
            LEFT JOIN partner_tx ptx ON c.id = ptx.customer_id
            LEFT JOIN partner_unlinked_paid pup ON c.id = pup.customer_id
            ORDER BY c.id DESC
        `;

        const { rows } = await pool.query(query);

        let partners = rows.map(r => {
            const orders = parseFloat(r.total_orders || 0);
            const received = parseFloat(r.total_received || 0);
            const paidOut = parseFloat(r.total_paid_out || 0);
            const unlinked = parseFloat(r.unlinked_paid || 0);

            const net = (orders + paidOut) - (received + unlinked);
            const roundedNet = Math.round(net);

            let debtType = 'ZERO';
            let debtLabel = 'Hết nợ';
            if (roundedNet > 0) {
                debtType = 'RECEIVABLE';
                debtLabel = 'Phải thu';
            } else if (roundedNet < 0) {
                debtType = 'PAYABLE';
                debtLabel = 'Phải trả';
            }

            return {
                id: r.id,
                name: r.name,
                phone: r.phone || '',
                address: r.address || '',
                customer_code: r.customer_code || '',
                initials: getAvatarInitials(r.name),
                partner_type: 'CUSTOMER',
                net_balance: roundedNet,
                amount: Math.abs(roundedNet),
                debt_type: debtType,
                debt_label: debtLabel,
                last_activity_date: r.last_activity_date,
                reminder_date: r.reminder_date
            };
        });

        // 1. Lọc theo tìm kiếm từ khóa
        if (search && search.trim()) {
            const q = search.trim().toLowerCase();
            partners = partners.filter(p => 
                (p.name && p.name.toLowerCase().includes(q)) ||
                (p.phone && p.phone.includes(q)) ||
                (p.customer_code && p.customer_code.toLowerCase().includes(q))
            );
        }

        // 2. Lọc theo trạng thái nợ
        if (debt_status && debt_status !== 'ALL') {
            partners = partners.filter(p => p.debt_type === debt_status);
        } else {
            // Mặc định ưu tiên hiển thị những người CÓ NỢ lên đầu
            partners.sort((a, b) => {
                const aHasDebt = a.debt_type !== 'ZERO';
                const bHasDebt = b.debt_type !== 'ZERO';
                if (aHasDebt && !bHasDebt) return -1;
                if (!aHasDebt && bHasDebt) return 1;
                return b.amount - a.amount;
            });
        }

        res.json({
            success: true,
            total: partners.length,
            partners
        });
    } catch(err) {
        console.error('Lỗi GET /api/debt-book/partners:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// =========================================================================
// 3. GET /api/debt-book/partner/:id : CHI TIẾT SỔ NỢ ĐỐI TÁC & LỊCH SỬ GIAO DỊCH
// =========================================================================
router.get('/partner/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Thông tin đối tác
        const custRes = await pool.query(`
            SELECT id, COALESCE(NULLIF(full_name, ''), NULLIF(name, ''), 'Khách Hàng') as name, 
                   phone, address, customer_code, debt_limit
            FROM customers 
            WHERE id = $1
        `, [id]);

        if (custRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy khách hàng trong hệ thống!' });
        }
        const cust = custRes.rows[0];
        cust.initials = getAvatarInitials(cust.name);

        // 2. Lấy tất cả Đơn Hàng hợp lệ của khách
        const ordersRes = await pool.query(`
            SELECT 
                id, order_code, total_amount, paid_amount, 
                (total_amount - COALESCE(paid_amount, 0)) as remaining,
                created_at, status, notes
            FROM orders 
            WHERE customer_id = $1 AND status NOT IN ('CANCELLED', 'RETURNED')
            ORDER BY created_at ASC
        `, [id]);

        // 3. Lấy tất cả Giao Dịch trực tiếp từ debt_transactions
        const txRes = await pool.query(`
            SELECT 
                id, code, transaction_type, amount, balance_after,
                payment_method, source_fund, order_id, order_code,
                notes, reminder_date, created_by, created_at
            FROM debt_transactions
            WHERE customer_id = $1
            ORDER BY created_at ASC
        `, [id]);

        // 4. Kết hợp và tính toán Running Balance (Dòng thời gian giao dịch)
        const timelineEvents = [];
        const txOrderIds = new Set(txRes.rows.map(t => t.order_id).filter(Boolean));

        ordersRes.rows.forEach(o => {
            const ordTotal = parseFloat(o.total_amount || 0);
            timelineEvents.push({
                type: 'SALE_ORDER',
                type_label: 'Nợ đơn bán',
                code: o.order_code,
                order_id: o.id,
                order_code: o.order_code,
                amount: ordTotal,
                change: ordTotal, // Tăng nợ khách
                notes: `Ghi nợ cho đơn ${o.order_code}`,
                created_at: o.created_at,
                is_order: true
            });

            // Nếu đơn này có thanh toán ban đầu mà không qua debt_transactions
            const paid = parseFloat(o.paid_amount || 0);
            if (paid > 0 && !txOrderIds.has(o.id)) {
                timelineEvents.push({
                    type: 'RECEIVE',
                    type_label: 'Tôi đã nhận',
                    code: 'TT-' + o.order_code,
                    order_id: o.id,
                    order_code: o.order_code,
                    amount: paid,
                    change: -paid, // Giảm nợ khách
                    notes: `Thanh toán cho đơn ${o.order_code}`,
                    created_at: new Date(new Date(o.created_at).getTime() + 1000).toISOString(),
                    is_initial_paid: true
                });
            }
        });

        txRes.rows.forEach(t => {
            const amt = parseFloat(t.amount || 0);
            const isReceive = (t.transaction_type === 'RECEIVE');
            timelineEvents.push({
                id: t.id,
                type: t.transaction_type,
                type_label: isReceive ? 'Tôi đã nhận' : 'Tôi đã đưa',
                code: t.code,
                order_id: t.order_id,
                order_code: t.order_code,
                amount: amt,
                change: isReceive ? -amt : amt,
                payment_method: t.payment_method,
                source_fund: t.source_fund,
                notes: t.notes || (isReceive ? 'Khách thanh toán / chuyển khoản cọc' : 'Chi hoàn trả khách'),
                created_by: t.created_by,
                reminder_date: t.reminder_date,
                created_at: t.created_at,
                is_direct_tx: true
            });
        });

        // Sắp xếp tăng dần theo thời gian để tính số dư lũy kế
        timelineEvents.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

        let currentRunning = 0;
        timelineEvents.forEach(e => {
            currentRunning += e.change;
            e.running_balance = Math.round(currentRunning);
            e.balance_type = e.running_balance > 0 ? 'RECEIVABLE' : (e.running_balance < 0 ? 'PAYABLE' : 'ZERO');
            e.balance_abs = Math.abs(e.running_balance);
        });

        // Đảo ngược lại (mới nhất lên trên) để hiển thị trong UI
        timelineEvents.reverse();

        const netBalance = Math.round(currentRunning);
        let debtType = 'ZERO';
        let debtLabel = 'HẾT NỢ';
        if (netBalance > 0) {
            debtType = 'RECEIVABLE';
            debtLabel = 'TÔI PHẢI THU';
        } else if (netBalance < 0) {
            debtType = 'PAYABLE';
            debtLabel = 'TÔI PHẢI TRẢ';
        }

        // Lấy lịch nhắc nợ gần nhất
        const lastReminderRes = await pool.query(`
            SELECT reminder_date, notes FROM debt_transactions 
            WHERE customer_id = $1 AND reminder_date IS NOT NULL 
            ORDER BY reminder_date DESC LIMIT 1
        `, [id]);

        res.json({
            success: true,
            partner: {
                ...cust,
                net_balance: netBalance,
                amount: Math.abs(netBalance),
                debt_type: debtType,
                debt_label: debtLabel,
                active_reminder: lastReminderRes.rows[0] || null
            },
            transactions: timelineEvents
        });
    } catch(err) {
        console.error('Lỗi GET /api/debt-book/partner/:id:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// =========================================================================
// 4. POST /api/debt-book/transaction : TẠO GIAO DỊCH NHANH ("TÔI ĐÃ NHẬN" / "TÔI ĐÃ ĐƯA")
// =========================================================================
router.post('/transaction', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const {
            customer_id,
            customer_name,
            transaction_type, // 'RECEIVE' (Tôi đã nhận) hoặc 'PAY' (Tôi đã đưa)
            amount,
            payment_method, // 'Chuyển Khoản' hoặc 'Tiền Mặt'
            source_fund,    // 'TK_CONG_TY' hoặc 'TIEN_MAT_QUY'
            notes,
            reminder_date,
            auto_settle_orders // Tự động cấn trừ đơn hàng cũ
        } = req.body;

        const amt = parseFloat(amount);
        if (!amt || amt <= 0) {
            throw new Error("Vui lòng nhập số tiền giao dịch hợp lệ (> 0 VNĐ)!");
        }

        if (!['RECEIVE', 'PAY'].includes(transaction_type)) {
            throw new Error("Loại giao dịch không hợp lệ ('RECEIVE' hoặc 'PAY')!");
        }

        // 1. Xác thực hoặc tạo mới Khách Hàng nếu chưa có ID
        let custId = customer_id ? parseInt(customer_id, 10) : null;
        let custName = customer_name ? customer_name.trim() : '';

        if (!custId && custName) {
            const findCust = await client.query("SELECT id, name FROM customers WHERE name ILIKE $1 OR full_name ILIKE $1 LIMIT 1", [custName]);
            if (findCust.rows.length > 0) {
                custId = findCust.rows[0].id;
                custName = findCust.rows[0].name;
            } else {
                const newCust = await client.query(`
                    INSERT INTO customers (name, full_name, current_debt, payable_debt, created_at)
                    VALUES ($1, $1, 0, 0, NOW()) RETURNING id
                `, [custName]);
                custId = newCust.rows[0].id;
            }
        }

        if (!custId) {
            throw new Error("Vui lòng chọn hoặc nhập tên khách hàng!");
        }

        const method = payment_method || 'Chuyển Khoản';
        const fund = source_fund || (method === 'Tiền Mặt' ? 'TIEN_MAT_QUY' : 'TK_CONG_TY');
        const txCode = (transaction_type === 'RECEIVE' ? 'GDN-' : 'GDC-') + Date.now().toString().slice(-8);
        const userName = req.user?.full_name || req.user?.username || 'Kế Toán';

        // 2. Ghi nhận giao dịch vào debt_transactions
        const insertTx = await client.query(`
            INSERT INTO debt_transactions 
            (code, customer_id, customer_name, transaction_type, amount, payment_method, source_fund, notes, reminder_date, created_by, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
            RETURNING id, code, created_at
        `, [
            txCode, custId, custName, transaction_type, amt, 
            method, fund, notes || (transaction_type === 'RECEIVE' ? 'Tôi đã nhận tiền' : 'Tôi đã đưa tiền'),
            reminder_date ? new Date(reminder_date) : null,
            userName
        ]);

        // 3. ĐỒNG BỘ VÀO SỔ QUỸ KẾ TOÁN (cash_transactions)
        const cashCategory = transaction_type === 'RECEIVE' 
            ? 'Thu tiền cọc / công nợ khách hàng' 
            : 'Chi hoàn cọc / trả khách hàng';
        const cashType = transaction_type === 'RECEIVE' ? 'THU' : 'CHI';

        await client.query(`
            INSERT INTO cash_transactions 
            (code, type, target_name, amount, payment_method, category, tax_status, source_fund, notes, customer_id, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, 'KHONG_HOA_DON', $7, $8, $9, NOW())
        `, [
            txCode, cashType, custName, amt, method, cashCategory, fund, 
            notes || `Giao dịch nhanh Sổ Nợ: ${transaction_type === 'RECEIVE' ? 'Thu' : 'Chi'} ${custName}`,
            custId
        ]);

        // 4. Nếu là "Tôi đã nhận" (RECEIVE) và được bật auto_settle_orders: cấn trừ đơn hàng cũ
        let settledOrders = [];
        if (transaction_type === 'RECEIVE' && auto_settle_orders !== false) {
            let remainToApply = amt;
            const unpaidOrders = await client.query(`
                SELECT id, order_code, total_amount, paid_amount 
                FROM orders 
                WHERE customer_id = $1 AND status NOT IN ('CANCELLED', 'RETURNED')
                  AND (total_amount - COALESCE(paid_amount, 0)) > 0
                ORDER BY created_at ASC FOR UPDATE
            `, [custId]);

            for (const ord of unpaidOrders.rows) {
                if (remainToApply <= 0) break;
                const unpaid = Math.max(0, parseFloat(ord.total_amount) - parseFloat(ord.paid_amount || 0));
                if (unpaid > 0) {
                    const apply = Math.min(remainToApply, unpaid);
                    const newPaid = parseFloat(ord.paid_amount || 0) + apply;
                    await client.query("UPDATE orders SET paid_amount = $1 WHERE id = $2", [newPaid, ord.id]);
                    settledOrders.push({ order_code: ord.order_code, applied: apply });
                    remainToApply -= apply;
                }
            }
        }

        // 5. Cập nhật current_debt và payable_debt trong bảng customers
        const netBal = await calculatePartnerBalance(client, custId);
        const curDebt = netBal > 0 ? netBal : 0;
        const payDebt = netBal < 0 ? Math.abs(netBal) : 0;

        await client.query(`
            UPDATE customers 
            SET current_debt = $1, payable_debt = $2
            WHERE id = $3
        `, [curDebt, payDebt, custId]);

        // Cập nhật lại balance_after trong debt_transactions
        await client.query("UPDATE debt_transactions SET balance_after = $1 WHERE id = $2", [netBal, insertTx.rows[0].id]);

        await client.query('COMMIT');

        res.json({
            success: true,
            code: txCode,
            message: `✅ Đã lưu giao dịch ${transaction_type === 'RECEIVE' ? 'nhận' : 'đưa'} ${new Intl.NumberFormat('vi-VN').format(amt)} đ thành công!`,
            net_balance: netBal,
            settled_orders: settledOrders
        });
    } catch(err) {
        await client.query('ROLLBACK');
        console.error('Lỗi POST /api/debt-book/transaction:', err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// =========================================================================
// 5. POST /api/debt-book/reminder : ĐẶT LỊCH NHẮC NỢ CHO KHÁCH HÀNG
// =========================================================================
router.post('/reminder', async (req, res) => {
    try {
        const { customer_id, reminder_date, notes } = req.body;
        if (!customer_id || !reminder_date) {
            return res.status(400).json({ success: false, error: 'Vui lòng chọn khách hàng và ngày hẹn nhắc nợ!' });
        }

        const code = 'REM-' + Date.now().toString().slice(-6);
        await pool.query(`
            INSERT INTO debt_transactions 
            (code, customer_id, transaction_type, amount, reminder_date, notes, created_by, created_at)
            VALUES ($1, $2, 'REMINDER', 0, $3, $4, $5, NOW())
        `, [
            code, parseInt(customer_id, 10), new Date(reminder_date), 
            notes || 'Hẹn ngày thanh toán nợ', 
            req.user?.full_name || 'Kế Toán'
        ]);

        res.json({
            success: true,
            message: `✅ Đã đặt lịch nhắc nợ vào ngày ${new Date(reminder_date).toLocaleDateString('vi-VN')}!`
        });
    } catch(err) {
        console.error('Lỗi POST /api/debt-book/reminder:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// =========================================================================
// 6. DELETE /api/debt-book/transaction/:id : XÓA GIAO DỊCH SAI & HOÀN LẠI DƯ NỢ
// =========================================================================
router.delete('/transaction/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;

        const txRes = await client.query("SELECT * FROM debt_transactions WHERE id = $1 FOR UPDATE", [id]);
        if (txRes.rows.length === 0) {
            throw new Error("Không tìm thấy giao dịch cần xóa!");
        }
        const tx = txRes.rows[0];

        // 1. Xóa trong cash_transactions (nếu có đồng bộ mã)
        if (tx.code) {
            await client.query("DELETE FROM cash_transactions WHERE code = $1", [tx.code]);
        }

        // 2. Xóa giao dịch trong debt_transactions
        await client.query("DELETE FROM debt_transactions WHERE id = $1", [id]);

        // 3. Tính toán lại số dư của khách
        if (tx.customer_id) {
            const netBal = await calculatePartnerBalance(client, tx.customer_id);
            const curDebt = netBal > 0 ? netBal : 0;
            const payDebt = netBal < 0 ? Math.abs(netBal) : 0;
            await client.query("UPDATE customers SET current_debt = $1, payable_debt = $2 WHERE id = $3", [curDebt, payDebt, tx.customer_id]);
        }

        await client.query('COMMIT');
        res.json({ success: true, message: "✅ Đã xóa giao dịch và hoàn lại số dư nợ thành công!" });
    } catch(err) {
        await client.query('ROLLBACK');
        console.error('Lỗi DELETE /api/debt-book/transaction/:id:', err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

module.exports = router;
