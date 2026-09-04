const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const router = express.Router();

const dbFile = path.join(__dirname, '../data/suppliers.json');

function readFallbackDB() {
    try { 
        if (!fs.existsSync(dbFile)) return [];
        return JSON.parse(fs.readFileSync(dbFile, 'utf8')); 
    } catch(e) { return []; }
}
function writeFallbackDB(data) {
    try { fs.writeFileSync(dbFile, JSON.stringify(data, null, 2), 'utf8'); } catch(e) {}
}

function formatSupplierRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        supplier_code: row.supplier_code,
        name: row.name,
        phone: row.phone || '',
        email: row.email || '',
        tax_code: row.tax_code || '',
        address: row.address || '',
        note: row.note || '',
        advance_pct: parseFloat(row.advance_pct) || 0,
        remain_pct: parseFloat(row.remain_pct) || 100,
        debt_days: parseInt(row.debt_days) || 0,
        credit_limit: parseFloat(row.credit_limit) || 0,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

// [GET] Lấy danh sách NCC (Đọc từ PostgreSQL DB)
router.get('/', async (req, res) => {
    try {
        if (pool && typeof pool.query === 'function') {
            const result = await pool.query("SELECT * FROM suppliers ORDER BY id DESC");
            const data = result.rows.map(formatSupplierRow);
            writeFallbackDB(data);
            return res.json({ success: true, data: data });
        }
    } catch (e) {
        console.warn("PostgreSQL suppliers read fallback:", e.message);
    }
    res.json({ success: true, data: readFallbackDB() });
});

// [POST] Thêm mới NCC (Lưu vào PostgreSQL DB)
router.post('/', async (req, res) => {
    try {
        const payload = req.body;
        const name = (payload.name || '').trim();
        if (!name) return res.status(400).json({ success: false, error: 'Tên nhà cung cấp không được để trống' });

        const supplierCode = (payload.supplier_code || '').trim() || ('NCC' + Math.floor(1000 + Math.random() * 9000));
        const phone = (payload.phone || '').trim();
        const email = (payload.email || '').trim();
        const taxCode = (payload.tax_code || '').trim();
        const address = (payload.address || '').trim();
        const note = (payload.note || '').trim();
        const advancePct = parseInt(payload.advance_pct) || 0;
        const remainPct = parseInt(payload.remain_pct) || 100;
        const debtDays = parseInt(payload.debt_days) || 0;
        const creditLimit = parseFloat(payload.credit_limit) || 0;

        let newSupplier = null;

        if (pool && typeof pool.query === 'function') {
            try {
                const query = `
                    INSERT INTO suppliers (
                        supplier_code, name, phone, email, tax_code, address, note,
                        advance_pct, remain_pct, debt_days, credit_limit, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
                    RETURNING *
                `;
                const result = await pool.query(query, [
                    supplierCode, name, phone, email, taxCode, address, note,
                    advancePct, remainPct, debtDays, creditLimit
                ]);
                newSupplier = formatSupplierRow(result.rows[0]);
            } catch (dbErr) {
                console.error("Lỗi insert DB suppliers:", dbErr.message);
            }
        }

        if (!newSupplier) {
            const data = readFallbackDB();
            const newId = data.length > 0 ? Math.max(...data.map(d => d.id || 0)) + 1 : 1;
            newSupplier = {
                id: newId,
                supplier_code: supplierCode,
                name: name,
                phone: phone,
                email: email,
                tax_code: taxCode,
                address: address,
                note: note,
                advance_pct: advancePct,
                remain_pct: remainPct,
                debt_days: debtDays,
                credit_limit: creditLimit,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            data.unshift(newSupplier);
            writeFallbackDB(data);
        }

        res.status(201).json({ success: true, data: newSupplier });
    } catch (e) {
        console.error("Lỗi API POST /api/suppliers:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// [PUT] Cập nhật thông tin NCC (Lưu vào PostgreSQL DB)
router.put('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const payload = req.body;
        const name = (payload.name || '').trim();
        const supplierCode = (payload.supplier_code || '').trim();
        const phone = (payload.phone || '').trim();
        const email = (payload.email || '').trim();
        const taxCode = (payload.tax_code || '').trim();
        const address = (payload.address || '').trim();
        const note = (payload.note || '').trim();
        const advancePct = parseInt(payload.advance_pct) || 0;
        const remainPct = parseInt(payload.remain_pct) || 100;
        const debtDays = parseInt(payload.debt_days) || 0;
        const creditLimit = parseFloat(payload.credit_limit) || 0;

        let updatedSupplier = null;

        if (pool && typeof pool.query === 'function') {
            try {
                const query = `
                    UPDATE suppliers 
                    SET 
                        name = COALESCE(NULLIF($1, ''), name),
                        supplier_code = COALESCE(NULLIF($2, ''), supplier_code),
                        phone = $3,
                        email = $4,
                        tax_code = $5,
                        address = $6,
                        note = $7,
                        advance_pct = $8,
                        remain_pct = $9,
                        debt_days = $10,
                        credit_limit = $11,
                        updated_at = NOW()
                    WHERE id = $12
                    RETURNING *
                `;
                const result = await pool.query(query, [
                    name, supplierCode, phone, email, taxCode, address, note,
                    advancePct, remainPct, debtDays, creditLimit, id
                ]);
                if (result.rows.length > 0) {
                    updatedSupplier = formatSupplierRow(result.rows[0]);
                }
            } catch (dbErr) {
                console.error("Lỗi update DB suppliers:", dbErr.message);
            }
        }

        let data = readFallbackDB();
        const index = data.findIndex(x => x.id === id);
        if (index !== -1) {
            data[index] = { ...data[index], ...payload, updated_at: new Date().toISOString() };
            writeFallbackDB(data);
            if (!updatedSupplier) updatedSupplier = data[index];
        }

        if (updatedSupplier) {
            res.json({ success: true, data: updatedSupplier });
        } else {
            res.status(404).json({ success: false, error: 'Không tìm thấy Nhà Cung Cấp' });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// [DELETE] Xóa NCC (Xóa khỏi PostgreSQL DB)
router.delete('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (pool && typeof pool.query === 'function') {
            try {
                await pool.query("DELETE FROM suppliers WHERE id = $1", [id]);
            } catch (dbErr) {
                console.error("Lỗi delete DB suppliers:", dbErr.message);
            }
        }

        let data = readFallbackDB();
        const filteredData = data.filter(x => x.id !== id);
        writeFallbackDB(filteredData);

        res.json({ success: true, message: 'Đã xóa Nhà Cung Cấp thành công!' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;