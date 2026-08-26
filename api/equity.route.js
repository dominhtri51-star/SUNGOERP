const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// 1. DANH SÁCH CỔ ĐÔNG & THÀNH VIÊN GÓP VỐN
router.get('/shareholders', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT s.*,
                   (SELECT COUNT(*) FROM equity_transactions t WHERE t.shareholder_id = s.id) AS total_tx_count,
                   (SELECT COALESCE(SUM(CASE WHEN tx_type = 'CONTRIBUTE' THEN amount ELSE 0 END), 0) FROM equity_transactions t WHERE t.shareholder_id = s.id) AS total_contributed_history,
                   (SELECT COALESCE(SUM(CASE WHEN tx_type = 'DIVIDEND' THEN amount ELSE 0 END), 0) FROM equity_transactions t WHERE t.shareholder_id = s.id) AS total_dividends_received
            FROM shareholders s
            ORDER BY s.ownership_percentage DESC, s.id ASC
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('Lỗi lấy danh sách cổ đông:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Thêm cổ đông
router.post('/shareholders', async (req, res) => {
    try {
        const {
            shareholder_code, full_name, id_card_number, phone, email,
            address, ownership_percentage, committed_capital, contributed_capital, status
        } = req.body;

        let code = shareholder_code;
        if (!code || code.trim() === '') {
            const countRes = await pool.query("SELECT COUNT(*) FROM shareholders");
            code = 'CD' + String(parseInt(countRes.rows[0].count) + 1).padStart(3, '0');
        }

        const result = await pool.query(`
            INSERT INTO shareholders (
                shareholder_code, full_name, id_card_number, phone, email,
                address, ownership_percentage, committed_capital, contributed_capital, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
        `, [
            code, full_name, id_card_number || '', phone || '', email || '',
            address || '', parseFloat(ownership_percentage) || 0,
            parseFloat(committed_capital) || 0, parseFloat(contributed_capital) || 0,
            status || 'ACTIVE'
        ]);

        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Sửa cổ đông
router.put('/shareholders/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            shareholder_code, full_name, id_card_number, phone, email,
            address, ownership_percentage, committed_capital, contributed_capital, status
        } = req.body;

        const result = await pool.query(`
            UPDATE shareholders SET
                shareholder_code = $1, full_name = $2, id_card_number = $3, phone = $4, email = $5,
                address = $6, ownership_percentage = $7, committed_capital = $8, contributed_capital = $9, status = $10
            WHERE id = $11
            RETURNING *
        `, [
            shareholder_code, full_name, id_card_number, phone, email,
            address, parseFloat(ownership_percentage) || 0,
            parseFloat(committed_capital) || 0, parseFloat(contributed_capital) || 0,
            status, id
        ]);

        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. LỊCH SỬ GIAO DỊCH BIẾN ĐỘNG VỐN & CỔ TỨC
router.get('/transactions', async (req, res) => {
    try {
        const { shareholder_id, tx_type } = req.query;
        let query = `
            SELECT t.*,
                   s.shareholder_code,
                   s.full_name AS shareholder_name
            FROM equity_transactions t
            JOIN shareholders s ON t.shareholder_id = s.id
            WHERE 1=1
        `;
        const params = [];
        if (shareholder_id) {
            params.push(shareholder_id);
            query += ` AND t.shareholder_id = $${params.length}`;
        }
        if (tx_type) {
            params.push(tx_type);
            query += ` AND t.tx_type = $${params.length}`;
        }

        query += " ORDER BY t.tx_date DESC, t.id DESC";
        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Ghi nhận biến động vốn (Góp vốn / Rút vốn / Chia cổ tức) -> Hạch toán tự động vào Sổ Quỹ
router.post('/transactions', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { shareholder_id, tx_type, amount, tx_date, payment_method, notes } = req.body;

        const shRes = await client.query("SELECT * FROM shareholders WHERE id = $1", [shareholder_id]);
        if (shRes.rows.length === 0) throw new Error('Không tìm thấy cổ đông');
        const shareholder = shRes.rows[0];

        const numAmount = parseFloat(amount) || 0;
        if (numAmount <= 0) throw new Error('Số tiền phải lớn hơn 0');

        // 1. Lưu bản ghi giao dịch vốn
        const txRes = await client.query(`
            INSERT INTO equity_transactions (
                shareholder_id, tx_type, amount, tx_date, payment_method, notes
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [
            shareholder_id, tx_type, numAmount, tx_date || new Date(),
            payment_method || 'CHUYEN_KHOAN', notes || ''
        ]);

        // 2. Cập nhật số vốn thực góp của cổ đông
        if (tx_type === 'CONTRIBUTE') {
            await client.query(
                "UPDATE shareholders SET contributed_capital = contributed_capital + $1 WHERE id = $2",
                [numAmount, shareholder_id]
            );

            // Tự động sinh Phiếu Thu trong Sổ Quỹ (cash_transactions)
            const cashCode = 'PT-VON-' + Date.now().toString().slice(-6);
            await client.query(`
                INSERT INTO cash_transactions (code, type, target_name, amount, notes)
                VALUES ($1, 'THU', $2, $3, $4)
            `, [
                cashCode, shareholder.full_name, numAmount,
                `Góp vốn điều lệ/bổ sung từ Cổ đông ${shareholder.full_name} (${shareholder.shareholder_code}) - ${notes || ''}`
            ]);
        } else if (tx_type === 'WITHDRAW') {
            await client.query(
                "UPDATE shareholders SET contributed_capital = GREATEST(0, contributed_capital - $1) WHERE id = $2",
                [numAmount, shareholder_id]
            );

            // Tự động sinh Phiếu Chi trong Sổ Quỹ
            const cashCode = 'PC-RUTVON-' + Date.now().toString().slice(-6);
            await client.query(`
                INSERT INTO cash_transactions (code, type, target_name, amount, notes)
                VALUES ($1, 'CHI', $2, $3, $4)
            `, [
                cashCode, shareholder.full_name, numAmount,
                `Rút vốn hoàn trả Cổ đông ${shareholder.full_name} (${shareholder.shareholder_code}) - ${notes || ''}`
            ]);
        } else if (tx_type === 'DIVIDEND') {
            // Tự động sinh Phiếu Chi trong Sổ Quỹ
            const cashCode = 'PC-COTUC-' + Date.now().toString().slice(-6);
            await client.query(`
                INSERT INTO cash_transactions (code, type, target_name, amount, notes)
                VALUES ($1, 'CHI', $2, $3, $4)
            `, [
                cashCode, shareholder.full_name, numAmount,
                `Chi trả cổ tức lợi nhuận cho Cổ đông ${shareholder.full_name} - ${notes || ''}`
            ]);
        }

        await client.query('COMMIT');
        res.json({
            success: true,
            message: 'Đã ghi nhận biến động vốn và hạch toán Sổ Quỹ thành công!',
            data: txRes.rows[0]
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Lỗi ghi nhận giao dịch vốn:', err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// 3. TỔNG HỢP CƠ CẤU NGUỒN VỐN DOANH NGHIỆP (CFO CAPITAL STRUCTURE)
router.get('/structure-summary', async (req, res) => {
    try {
        // Vốn thực góp của các cổ đông
        const shRes = await pool.query(`
            SELECT 
                COALESCE(SUM(committed_capital), 0) AS total_committed_capital,
                COALESCE(SUM(contributed_capital), 0) AS total_contributed_capital,
                COUNT(id) AS total_shareholders
            FROM shareholders
            WHERE status = 'ACTIVE'
        `);

        // Dư nợ vay ngân hàng thực tế
        const loanRes = await pool.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN loan_type = 'SHORT_TERM' THEN current_principal ELSE 0 END), 0) AS bank_debt_short,
                COALESCE(SUM(CASE WHEN loan_type = 'LONG_TERM' THEN current_principal ELSE 0 END), 0) AS bank_debt_long,
                COALESCE(SUM(current_principal), 0) AS total_bank_debt
            FROM bank_loans
            WHERE status = 'ACTIVE'
        `);

        // Tiền mặt hiện có trong quỹ
        const cashRes = await pool.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN type = 'THU' THEN amount ELSE 0 END), 0) -
                COALESCE(SUM(CASE WHEN type = 'CHI' THEN amount ELSE 0 END), 0) AS net_cash
            FROM cash_transactions
        `);

        const contributedCapital = parseFloat(shRes.rows[0].total_contributed_capital) || 2500000000;
        const totalBankDebt = parseFloat(loanRes.rows[0].total_bank_debt) || 0;
        const bankDebtShort = parseFloat(loanRes.rows[0].bank_debt_short) || 0;
        const bankDebtLong = parseFloat(loanRes.rows[0].bank_debt_long) || 0;
        const currentCash = parseFloat(cashRes.rows[0].net_cash) || 0;

        res.json({
            success: true,
            data: {
                equity: {
                    committed_capital: parseFloat(shRes.rows[0].total_committed_capital) || 2500000000,
                    contributed_capital: contributedCapital,
                    shareholders_count: parseInt(shRes.rows[0].total_shareholders) || 2
                },
                debt: {
                    bank_debt_short: bankDebtShort,
                    bank_debt_long: bankDebtLong,
                    total_bank_debt: totalBankDebt
                },
                cash: currentCash
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
