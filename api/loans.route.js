const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Lấy danh sách toàn bộ các khoản vay
router.get('/', async (req, res) => {
    try {
        const loansRes = await pool.query(`
            SELECT l.*,
                   (SELECT COUNT(*) FROM loan_repayments r WHERE r.loan_id = l.id) AS total_repayments_count,
                   (SELECT COALESCE(SUM(principal_paid), 0) FROM loan_repayments r WHERE r.loan_id = l.id) AS total_principal_paid,
                   (SELECT COALESCE(SUM(interest_paid), 0) FROM loan_repayments r WHERE r.loan_id = l.id) AS total_interest_paid
            FROM bank_loans l
            ORDER BY l.status ASC, l.id DESC
        `);

        // Thống kê tổng quan
        const summaryRes = await pool.query(`
            SELECT 
                COALESCE(SUM(original_principal), 0) AS total_original_debt,
                COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN current_principal ELSE 0 END), 0) AS total_current_debt,
                COALESCE(SUM(CASE WHEN status = 'ACTIVE' AND loan_type = 'SHORT_TERM' THEN current_principal ELSE 0 END), 0) AS short_term_debt,
                COALESCE(SUM(CASE WHEN status = 'ACTIVE' AND loan_type = 'LONG_TERM' THEN current_principal ELSE 0 END), 0) AS long_term_debt,
                COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END) AS active_loans_count
            FROM bank_loans
        `);

        // Tính ước tính tiền lãi phải trả tháng này
        let monthlyInterestEstimate = 0;
        loansRes.rows.forEach(l => {
            if (l.status === 'ACTIVE') {
                const curP = parseFloat(l.current_principal) || 0;
                const rate = parseFloat(l.interest_rate) || 0;
                monthlyInterestEstimate += Math.round(curP * (rate / 100) / 12);
            }
        });

        res.json({
            success: true,
            data: loansRes.rows,
            summary: {
                ...summaryRes.rows[0],
                monthly_interest_estimate: monthlyInterestEstimate
            }
        });
    } catch (err) {
        console.error('Lỗi lấy danh sách khoản vay:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Lấy chi tiết 1 khoản vay kèm lịch sử trả nợ
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const loanRes = await pool.query("SELECT * FROM bank_loans WHERE id = $1", [id]);
        if (loanRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy hợp đồng vay' });
        }

        const repaymentsRes = await pool.query(
            "SELECT * FROM loan_repayments WHERE loan_id = $1 ORDER BY repayment_date DESC, id DESC",
            [id]
        );

        res.json({
            success: true,
            data: loanRes.rows[0],
            repayments: repaymentsRes.rows
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Sinh bảng lịch trả nợ dự kiến (Amortization Schedule)
router.get('/:id/schedule', async (req, res) => {
    try {
        const { id } = req.params;
        const loanRes = await pool.query("SELECT * FROM bank_loans WHERE id = $1", [id]);
        if (loanRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy khoản vay' });

        const loan = loanRes.rows[0];
        const principal = parseFloat(loan.original_principal) || 0;
        const annualRate = parseFloat(loan.interest_rate) / 100;
        const monthlyRate = annualRate / 12;
        const termMonths = parseInt(loan.term_months) || 12;
        const disbDate = new Date(loan.disbursement_date);
        const payDay = parseInt(loan.payment_day_of_month) || 25;

        const schedule = [];
        let remainingPrincipal = principal;
        const equalPrincipalPerMonth = Math.round(principal / termMonths);

        for (let i = 1; i <= termMonths; i++) {
            const dueDate = new Date(disbDate.getFullYear(), disbDate.getMonth() + i, payDay);
            const interest = Math.round(remainingPrincipal * monthlyRate);
            let principalRepayment = 0;

            if (loan.repayment_method === 'BULLET') {
                principalRepayment = (i === termMonths) ? remainingPrincipal : 0;
            } else if (loan.repayment_method === 'ANNUITY') {
                // Niên kim
                const annuity = Math.round(principal * (monthlyRate * Math.pow(1 + monthlyRate, termMonths)) / (Math.pow(1 + monthlyRate, termMonths) - 1));
                principalRepayment = Math.min(remainingPrincipal, annuity - interest);
            } else {
                // EQUAL_PRINCIPAL: Gốc đều hàng tháng
                principalRepayment = (i === termMonths) ? remainingPrincipal : equalPrincipalPerMonth;
            }

            const totalPay = principalRepayment + interest;
            remainingPrincipal = Math.max(0, remainingPrincipal - principalRepayment);

            schedule.push({
                period: i,
                due_date: dueDate.toISOString().slice(0, 10),
                principal_repayment: principalRepayment,
                interest_payment: interest,
                total_payment: totalPay,
                remaining_principal: remainingPrincipal
            });
        }

        res.json({ success: true, schedule, loan });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Thêm hợp đồng vay mới
router.post('/', async (req, res) => {
    try {
        const {
            loan_code, lender_name, loan_type, purpose,
            original_principal, current_principal, interest_rate,
            disbursement_date, maturity_date, term_months,
            repayment_method, payment_day_of_month, collateral, status
        } = req.body;

        let code = loan_code;
        if (!code || code.trim() === '') {
            code = 'VAY-' + Date.now().toString().slice(-5);
        }

        const origP = parseFloat(original_principal) || 0;
        const curP = current_principal !== undefined ? parseFloat(current_principal) : origP;

        const result = await pool.query(`
            INSERT INTO bank_loans (
                loan_code, lender_name, loan_type, purpose,
                original_principal, current_principal, interest_rate,
                disbursement_date, maturity_date, term_months,
                repayment_method, payment_day_of_month, collateral, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING *
        `, [
            code, lender_name, loan_type || 'SHORT_TERM', purpose || '',
            origP, curP, parseFloat(interest_rate) || 0,
            disbursement_date || new Date(), maturity_date || new Date(), parseInt(term_months) || 12,
            repayment_method || 'EQUAL_PRINCIPAL', parseInt(payment_day_of_month) || 25,
            collateral || '', status || 'ACTIVE'
        ]);

        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error('Lỗi thêm khoản vay:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Sửa hợp đồng vay
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            loan_code, lender_name, loan_type, purpose,
            original_principal, current_principal, interest_rate,
            disbursement_date, maturity_date, term_months,
            repayment_method, payment_day_of_month, collateral, status
        } = req.body;

        const result = await pool.query(`
            UPDATE bank_loans SET
                loan_code = $1, lender_name = $2, loan_type = $3, purpose = $4,
                original_principal = $5, current_principal = $6, interest_rate = $7,
                disbursement_date = $8, maturity_date = $9, term_months = $10,
                repayment_method = $11, payment_day_of_month = $12, collateral = $13, status = $14
            WHERE id = $15
            RETURNING *
        `, [
            loan_code, lender_name, loan_type, purpose,
            parseFloat(original_principal), parseFloat(current_principal), parseFloat(interest_rate),
            disbursement_date, maturity_date, parseInt(term_months),
            repayment_method, parseInt(payment_day_of_month), collateral, status, id
        ]);

        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Ghi nhận thanh toán trả nợ gốc & lãi vay -> Tự động hạch toán Sổ Quỹ & Chi phí
router.post('/:id/repay', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const { repayment_date, principal_paid, interest_paid, payment_proof_url, notes } = req.body;

        const loanRes = await client.query("SELECT * FROM bank_loans WHERE id = $1", [id]);
        if (loanRes.rows.length === 0) throw new Error('Không tìm thấy khoản vay');
        const loan = loanRes.rows[0];

        const pPaid = parseFloat(principal_paid) || 0;
        const iPaid = parseFloat(interest_paid) || 0;
        const totalPaid = pPaid + iPaid;
        const newPrincipal = Math.max(0, parseFloat(loan.current_principal) - pPaid);
        const newStatus = newPrincipal === 0 ? 'CLOSED' : 'ACTIVE';

        // 1. Lưu bản ghi lịch sử trả nợ
        const repRes = await client.query(`
            INSERT INTO loan_repayments (
                loan_id, repayment_date, principal_paid, interest_paid,
                total_paid, remaining_principal, payment_proof_url, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [
            id, repayment_date || new Date(), pPaid, iPaid,
            totalPaid, newPrincipal, payment_proof_url || '', notes || ''
        ]);

        // 2. Cập nhật dư nợ hiện tại của khoản vay
        await client.query(
            "UPDATE bank_loans SET current_principal = $1, status = $2 WHERE id = $3",
            [newPrincipal, newStatus, id]
        );

        // 3. Tự động sinh Phiếu Chi Sổ Quỹ (cash_transactions)
        const cashCode = 'PC-VAY-' + Date.now().toString().slice(-6);
        await client.query(`
            INSERT INTO cash_transactions (code, type, target_name, amount, notes)
            VALUES ($1, 'CHI', $2, $3, $4)
        `, [
            cashCode, loan.lender_name, totalPaid,
            `Thanh toán hợp đồng vay ${loan.loan_code} (Gốc: ${pPaid.toLocaleString('vi-VN')} đ, Lãi: ${iPaid.toLocaleString('vi-VN')} đ) - ${notes || ''}`
        ]);

        // 4. Ghi nhận Chi phí Lãi vay vào bảng expenses (để tính đúng P&L)
        if (iPaid > 0) {
            await client.query(`
                INSERT INTO expenses (
                    expense_date, category, description, vendor_name, amount_before_tax, total_amount
                ) VALUES ($1, 'CHI PHÍ LÃI VAY', $2, $3, $4, $4)
            `, [
                repayment_date || new Date(),
                `Chi phí tiền lãi vay hợp đồng ${loan.loan_code} - ${loan.lender_name}`,
                loan.lender_name, iPaid
            ]);
        }

        await client.query('COMMIT');
        res.json({
            success: true,
            message: `Đã ghi nhận thanh toán ${totalPaid.toLocaleString('vi-VN')} đ và hạch toán Sổ Quỹ thành công!`,
            data: repRes.rows[0],
            cashCode
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Lỗi thanh toán khoản vay:', err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// Xóa khoản vay
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("DELETE FROM loan_repayments WHERE loan_id = $1", [id]);
        await pool.query("DELETE FROM bank_loans WHERE id = $1", [id]);
        res.json({ success: true, message: 'Đã xóa khoản vay' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
