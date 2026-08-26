const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const pool = require('../config/database');

const paymentsDbFile = path.join(__dirname, '../data/payments.json');
const suppliersDbFile = path.join(__dirname, '../data/suppliers.json');
const purchasesDbFile = path.join(__dirname, '../data/purchases.json');

function readJSON(file) {
    try { 
        if (!fs.existsSync(file)) return [];
        return JSON.parse(fs.readFileSync(file, 'utf8')); 
    } catch(e) { return []; }
}

function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// 1. [GET] /api/payments/supplier-debts: Thống kê tổng hợp & Dư nợ từng Nhà Cung Cấp (TK 331)
router.get('/supplier-debts', (req, res) => {
    try {
        const suppliers = readJSON(suppliersDbFile);
        const purchases = readJSON(purchasesDbFile);
        const payments = readJSON(paymentsDbFile);

        let totalPayableAll = 0;
        let totalPaidMonth = 0;
        let pendingCount = 0;

        const currentMonth = new Date().getMonth();
        const currentYear = new Date().getFullYear();

        // Tính các khoản chi trong tháng
        payments.forEach(p => {
            if (p.status === 'Chờ Duyệt') pendingCount++;
            if (p.status === 'Đã Thanh Toán' && p.created_at) {
                const d = new Date(p.created_at);
                if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
                    totalPaidMonth += parseFloat(p.amount || 0);
                }
            }
        });

        // Tính nợ cho từng Nhà Cung Cấp
        const supplierDebts = suppliers.map(s => {
            // Tổng tiền hàng đã hoàn tất nhập kho hoặc đã duyệt
            const supPurchases = purchases.filter(po => 
                (po.supplier_id === s.id || (po.supplier_name && po.supplier_name.toLowerCase() === (s.name || '').toLowerCase())) &&
                po.status !== 'Đã Hủy'
            );
            const totalPurchased = supPurchases.reduce((sum, po) => sum + parseFloat(po.total_amount || 0), 0);

            // Tổng tiền đã thanh toán (chỉ tính phiếu 'Đã Thanh Toán')
            const supPayments = payments.filter(p => 
                (p.supplier_id === s.id || (p.supplier_name && p.supplier_name.toLowerCase() === (s.name || '').toLowerCase())) &&
                p.status === 'Đã Thanh Toán'
            );
            const totalPaid = supPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

            // Dư nợ hiện tại
            const currentDebt = Math.max(0, totalPurchased - totalPaid);
            totalPayableAll += currentDebt;

            // Đếm số đơn PO và số lần thanh toán
            const pendingPaymentsCount = payments.filter(p => 
                (p.supplier_id === s.id || (p.supplier_name && p.supplier_name.toLowerCase() === (s.name || '').toLowerCase())) &&
                p.status === 'Chờ Duyệt'
            ).length;

            return {
                id: s.id,
                supplier_code: s.supplier_code || `NCC${s.id}`,
                name: s.name,
                phone: s.phone || '',
                email: s.email || '',
                tax_code: s.tax_code || '',
                address: s.address || '',
                credit_limit: parseFloat(s.credit_limit || 0),
                debt_days: parseInt(s.debt_days || 30),
                advance_pct: parseInt(s.advance_pct || 0),
                remain_pct: parseInt(s.remain_pct || 100),
                bank_account: s.bank_account || '',
                bank_name: s.bank_name || '',
                account_holder: s.account_holder || s.name,
                total_purchased: totalPurchased,
                total_paid: totalPaid,
                current_debt: currentDebt,
                pending_payments_count: pendingPaymentsCount,
                orders_count: supPurchases.length,
                payments_count: supPayments.length
            };
        });

        // Sắp xếp nhà cung cấp nợ nhiều nhất lên đầu
        supplierDebts.sort((a, b) => b.current_debt - a.current_debt);

        const suppliersInDebtCount = supplierDebts.filter(s => s.current_debt > 0).length;

        res.json({
            success: true,
            summary: {
                total_payable: totalPayableAll,
                total_paid_month: totalPaidMonth,
                pending_approvals: pendingCount,
                suppliers_in_debt_count: suppliersInDebtCount,
                total_suppliers: suppliers.length
            },
            data: supplierDebts
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 2. [GET] /api/payments/supplier/:id/statement: Sao kê lịch sử Mua hàng (PO) & Thanh toán (UNC) của 1 NCC
router.get('/supplier/:id/statement', (req, res) => {
    try {
        const supId = parseInt(req.params.id);
        const suppliers = readJSON(suppliersDbFile);
        const purchases = readJSON(purchasesDbFile);
        const payments = readJSON(paymentsDbFile);

        const supplier = suppliers.find(s => s.id === supId);
        if (!supplier) return res.status(404).json({ success: false, error: 'Không tìm thấy Nhà Cung Cấp' });

        const supPurchases = purchases.filter(po => 
            (po.supplier_id === supId || (po.supplier_name && po.supplier_name.toLowerCase() === supplier.name.toLowerCase()))
        );

        const supPayments = payments.filter(p => 
            (p.supplier_id === supId || (p.supplier_name && p.supplier_name.toLowerCase() === supplier.name.toLowerCase()))
        );

        const totalPurchased = supPurchases.filter(po => po.status !== 'Đã Hủy').reduce((sum, po) => sum + parseFloat(po.total_amount || 0), 0);
        const totalPaid = supPayments.filter(p => p.status === 'Đã Thanh Toán').reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
        const currentDebt = Math.max(0, totalPurchased - totalPaid);

        res.json({
            success: true,
            supplier: {
                ...supplier,
                total_purchased: totalPurchased,
                total_paid: totalPaid,
                current_debt: currentDebt
            },
            purchases: supPurchases,
            payments: supPayments
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 3. [GET] /api/payments: Danh sách Phiếu chi / UNC
router.get('/', (req, res) => {
    const { status, supplier_id } = req.query;
    let data = readJSON(paymentsDbFile);
    
    if (status && status !== 'ALL') {
        data = data.filter(p => p.status === status);
    }
    if (supplier_id) {
        data = data.filter(p => p.supplier_id === parseInt(supplier_id));
    }
    
    res.json({ success: true, data });
});

// 4. [POST] /api/payments: Tạo Phiếu chi / UNC mới
router.post('/', async (req, res) => {
    try {
        const data = readJSON(paymentsDbFile);
        const payload = req.body;
        const newId = data.length > 0 ? Math.max(...data.map(d => d.id || 0)) + 1 : 1;
        
        const isAutoApprove = payload.auto_approve === true;
        const newPayment = {
            id: newId,
            payment_code: payload.payment_code || 'UNC-' + Math.floor(100000 + Math.random() * 900000),
            supplier_id: payload.supplier_id ? parseInt(payload.supplier_id) : null,
            supplier_name: payload.supplier_name || 'Nhà Cung Cấp',
            amount: parseFloat(payload.amount || 0),
            payment_method: payload.payment_method || 'Chuyển Khoản (UNC)',
            bank_account: payload.bank_account || '',
            bank_name: payload.bank_name || '',
            account_holder: payload.account_holder || payload.supplier_name || '',
            note: payload.note || '',
            status: isAutoApprove ? 'Đã Thanh Toán' : 'Chờ Duyệt',
            created_at: new Date().toISOString()
        };
        
        data.unshift(newPayment);
        writeJSON(paymentsDbFile, data);

        // Nếu auto approve hoặc tạo xong duyệt ngay, ghi đồng bộ vào cash_transactions
        if (isAutoApprove) {
            try {
                await pool.query(`
                    INSERT INTO cash_transactions (code, type, target_name, amount, payment_method, notes)
                    VALUES ($1, 'CHI', $2, $3, $4, $5)
                `, [newPayment.payment_code, newPayment.supplier_name, newPayment.amount, newPayment.payment_method, newPayment.note || 'Thanh toán NCC ' + newPayment.supplier_name]);
            } catch (sqlErr) {
                console.error("Lỗi đồng bộ Sổ Quỹ:", sqlErr.message);
            }
        }

        res.status(201).json({ 
            success: true, 
            message: `✅ Đã lập ${newPayment.payment_code} thành công!`,
            data: newPayment 
        });
    } catch (e) { 
        res.status(500).json({ success: false, error: e.message }); 
    }
});

// 5. [PUT] /api/payments/:id/status: Duyệt Chi / Hủy Phiếu
router.put('/:id/status', async (req, res) => {
    try {
        let data = readJSON(paymentsDbFile);
        const id = parseInt(req.params.id);
        const index = data.findIndex(x => x.id === id);
        
        if (index !== -1) {
            const targetStatus = req.body.status; // 'Đã Thanh Toán' hoặc 'Đã Hủy'
            data[index].status = targetStatus;
            data[index].updated_at = new Date().toISOString();
            writeJSON(paymentsDbFile, data);

            // Khi duyệt chi (Đã Thanh Toán), đồng bộ ghi 1 dòng CHI vào Sổ Quỹ (cash_transactions)
            if (targetStatus === 'Đã Thanh Toán') {
                try {
                    const p = data[index];
                    // Kiểm tra xem đã ghi nhận chưa để tránh trùng lặp
                    const checkExist = await pool.query("SELECT id FROM cash_transactions WHERE code = $1", [p.payment_code]);
                    if (checkExist.rows.length === 0) {
                        await pool.query(`
                            INSERT INTO cash_transactions (code, type, target_name, amount, payment_method, notes)
                            VALUES ($1, 'CHI', $2, $3, $4, $5)
                        `, [p.payment_code, p.supplier_name, p.amount, p.payment_method || 'Chuyển Khoản', p.note || 'Thanh toán tiền hàng NCC ' + p.supplier_name]);
                    }
                } catch (sqlErr) {
                    console.error("Lỗi ghi Sổ Quỹ khi duyệt chi:", sqlErr.message);
                }
            }

            res.json({ 
                success: true, 
                message: `✅ Đã cập nhật trạng thái phiếu thành "${targetStatus}"!`,
                data: data[index] 
            });
        } else {
            res.status(404).json({ success: false, error: 'Không tìm thấy phiếu chi' });
        }
    } catch (e) { 
        res.status(500).json({ success: false, error: e.message }); 
    }
});

module.exports = router;