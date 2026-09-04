const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const router = express.Router();
const googleDriveService = require('../services/googleDrive.service');

const dbFile = path.join(__dirname, '../data/imports.json');

function readFallbackDB() {
    try { 
        if (!fs.existsSync(dbFile)) return [];
        return JSON.parse(fs.readFileSync(dbFile, 'utf8')); 
    } catch(e) { return []; }
}

function writeFallbackDB(data) {
    try { fs.writeFileSync(dbFile, JSON.stringify(data, null, 2), 'utf8'); } catch(e) {}
}

function formatImportRow(row) {
    if (!row) return null;
    let docs = row.docs;
    if (typeof docs === 'string') {
        try { docs = JSON.parse(docs); } catch(e) { docs = {}; }
    }
    if (!docs || typeof docs !== 'object') docs = {};

    let items = row.items;
    if (typeof items === 'string') {
        try { items = JSON.parse(items); } catch(e) { items = []; }
    }
    if (!Array.isArray(items)) items = [];

    return {
        id: row.id,
        po_code: row.po_code,
        supplier_name: row.supplier_name || '',
        note: row.note || '',
        status: row.status || 'Chờ Thanh Toán',
        total_value: parseFloat(row.total_value) || 0,
        currency: row.currency || 'USD',
        exchange_rate: parseFloat(row.exchange_rate) || 25400,
        eta_date: row.eta_date,
        tracking_number: row.tracking_number || '',
        items: items,
        docs: docs,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

// 1. Lấy danh sách PO
router.get('/', async (req, res) => {
    try {
        if (pool && typeof pool.query === 'function') {
            const result = await pool.query("SELECT * FROM imports ORDER BY id DESC");
            const data = result.rows.map(formatImportRow);
            writeFallbackDB(data);
            return res.json({ success: true, data: data });
        }
    } catch (e) {
        console.warn("PostgreSQL imports read fallback:", e.message);
    }
    res.json({ success: true, data: readFallbackDB() });
});

// 2. Tạo PO mới (Khởi tạo Két sắt rỗng)
router.post('/', async (req, res) => {
    try {
        const payload = req.body;
        const poCode = (payload.po_code || '').trim() || ('PO-' + Date.now());
        const supplierName = (payload.supplier_name || '').trim();
        const note = (payload.note || '').trim();
        const status = payload.status || 'Chờ Thanh Toán';
        const totalValue = parseFloat(payload.total_value) || 0;
        const currency = payload.currency || 'USD';
        const etaDate = payload.eta_date || null;
        const items = Array.isArray(payload.items) ? payload.items : [];
        const docs = (payload.docs && typeof payload.docs === 'object') ? payload.docs : {};

        let newImport = null;

        if (pool && typeof pool.query === 'function') {
            try {
                const query = `
                    INSERT INTO imports (
                        po_code, supplier_name, note, status, total_value, currency, eta_date,
                        items, docs, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
                    RETURNING *
                `;
                const result = await pool.query(query, [
                    poCode, supplierName, note, status, totalValue, currency, etaDate,
                    JSON.stringify(items), JSON.stringify(docs)
                ]);
                newImport = formatImportRow(result.rows[0]);
            } catch (dbErr) {
                console.error("Lỗi insert DB imports:", dbErr.message);
            }
        }

        if (!newImport) {
            let data = readFallbackDB();
            const newId = data.length > 0 ? Math.max(...data.map(d => Number(d.id) || 0)) + 1 : 1;
            newImport = {
                id: newId,
                po_code: poCode,
                supplier_name: supplierName,
                note: note,
                status: status,
                total_value: totalValue,
                currency: currency,
                eta_date: etaDate,
                items: items,
                docs: docs,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            data.unshift(newImport);
            writeFallbackDB(data);
        }

        res.status(201).json({ success: true, data: newImport });
    } catch (e) {
        console.error("Lỗi API POST /api/imports:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (pool && typeof pool.query === 'function') {
            const result = await pool.query("SELECT * FROM imports WHERE id = $1", [id]);
            if (result.rows.length > 0) {
                return res.json({ success: true, data: formatImportRow(result.rows[0]) });
            }
        }
    } catch (e) {}

    const data = readFallbackDB();
    const item = data.find(x => Number(x.id) === Number(req.params.id));
    if (item) res.json({ success: true, data: item }); else res.status(404).json({ success: false });
});

// 3. Sửa PO (BỌC THÉP: Tuyệt đối không chạm vào docs)
router.put('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const payload = req.body;
        const poCode = (payload.po_code || '').trim();
        const supplierName = (payload.supplier_name || '').trim();
        const note = (payload.note || '').trim();
        const totalValue = parseFloat(payload.total_value) || 0;
        const currency = payload.currency || 'USD';
        const etaDate = payload.eta_date || null;

        let updatedImport = null;

        if (pool && typeof pool.query === 'function') {
            try {
                const query = `
                    UPDATE imports 
                    SET 
                        po_code = COALESCE(NULLIF($1, ''), po_code),
                        supplier_name = COALESCE(NULLIF($2, ''), supplier_name),
                        note = $3,
                        total_value = $4,
                        currency = $5,
                        eta_date = $6,
                        updated_at = NOW()
                    WHERE id = $7
                    RETURNING *
                `;
                const result = await pool.query(query, [
                    poCode, supplierName, note, totalValue, currency, etaDate, id
                ]);
                if (result.rows.length > 0) {
                    updatedImport = formatImportRow(result.rows[0]);
                }
            } catch (dbErr) {
                console.error("Lỗi update DB imports:", dbErr.message);
            }
        }

        let data = readFallbackDB();
        const index = data.findIndex(x => Number(x.id) === Number(req.params.id));
        if (index !== -1) {
            const preservedDocs = data[index].docs || {}; 
            data[index] = { ...data[index], ...payload, docs: preservedDocs, updated_at: new Date().toISOString() };
            writeFallbackDB(data);
            if (!updatedImport) updatedImport = data[index];
        }

        if (updatedImport) {
            res.json({ success: true, data: updatedImport });
        } else {
            res.status(404).json({ success: false });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.put('/:id/status', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { status } = req.body;

        if (pool && typeof pool.query === 'function') {
            try {
                await pool.query("UPDATE imports SET status = $1, updated_at = NOW() WHERE id = $2", [status, id]);
            } catch(e) {}
        }

        let data = readFallbackDB();
        const index = data.findIndex(x => Number(x.id) === Number(id));
        if (index !== -1) { 
            data[index].status = status; 
            writeFallbackDB(data); 
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

router.put('/:id/note', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { note } = req.body;

        if (pool && typeof pool.query === 'function') {
            try {
                await pool.query("UPDATE imports SET note = $1, updated_at = NOW() WHERE id = $2", [note, id]);
            } catch(e) {}
        }

        let data = readFallbackDB();
        const index = data.findIndex(x => Number(x.id) === Number(id));
        if (index !== -1) { 
            data[index].note = note; 
            writeFallbackDB(data); 
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// ===============================================
// MODULE KÉT SẮT CHỨNG TỪ (DOCUMENT VAULT)
// ===============================================

router.get('/:id/docs', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (pool && typeof pool.query === 'function') {
            const result = await pool.query("SELECT docs FROM imports WHERE id = $1", [id]);
            if (result.rows.length > 0) {
                let docs = result.rows[0].docs;
                if (typeof docs === 'string') {
                    try { docs = JSON.parse(docs); } catch(e) { docs = {}; }
                }
                if (!docs || typeof docs !== 'object') docs = {};
                return res.json({ success: true, docs: docs });
            }
        }

        const item = readFallbackDB().find(x => Number(x.id) === Number(id));
        if (item) {
            let docs = item.docs;
            if (!docs || Array.isArray(docs) || typeof docs !== 'object') docs = {};
            return res.json({ success: true, docs: docs });
        }
        res.json({ success: false });
    } catch(e) { res.json({ success: false }); }
});

router.post('/:id/docs', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const payload = req.body;
        if (!payload.file_data) return res.status(400).json({ success: false, error: 'Thiếu dữ liệu file' });

        let buffer;
        let mimeType = 'application/octet-stream';
        const matches = payload.file_data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches) {
            mimeType = matches[1];
            buffer = Buffer.from(matches[2], 'base64');
        } else {
            const parts = payload.file_data.split('base64,');
            buffer = parts.length === 2 ? Buffer.from(parts[1], 'base64') : Buffer.from(payload.file_data.split(',')[1] || payload.file_data, 'base64');
        }

        const ext = (payload.file_name || '').toLowerCase().includes('.pdf') ? '.pdf' : 
                   ((payload.file_name || '').toLowerCase().includes('.xls') ? '.xlsx' : '.jpg');
        const rawFileName = payload.file_name || `import_${payload.doc_type || 'doc'}_${id}_${Date.now()}${ext}`;

        const uploadResult = await googleDriveService.uploadFile({
            buffer: buffer,
            originalname: rawFileName,
            mimetype: mimeType,
            subfolder: 'proofs'
        });

        const fileUrl = uploadResult.url;

        let currentDocs = {};
        if (pool && typeof pool.query === 'function') {
            const result = await pool.query("SELECT docs FROM imports WHERE id = $1", [id]);
            if (result.rows.length > 0) {
                let dbDocs = result.rows[0].docs;
                if (typeof dbDocs === 'string') {
                    try { dbDocs = JSON.parse(dbDocs); } catch(e) { dbDocs = {}; }
                }
                if (dbDocs && typeof dbDocs === 'object') currentDocs = dbDocs;
            }
        }

        if (Object.keys(currentDocs).length === 0) {
            let fileData = readFallbackDB();
            const fIdx = fileData.findIndex(x => Number(x.id) === Number(id));
            if (fIdx !== -1 && fileData[fIdx].docs) currentDocs = fileData[fIdx].docs;
        }

        const dType = payload.doc_type || 'commercial';
        if (!currentDocs[dType] || !Array.isArray(currentDocs[dType])) currentDocs[dType] = [];

        currentDocs[dType].push({ 
            name: payload.doc_note || payload.file_name, 
            url: fileUrl,
            original_name: payload.file_name,
            storage: uploadResult.storage,
            fileId: uploadResult.fileId || null,
            uploaded_at: new Date().toISOString()
        });

        if (pool && typeof pool.query === 'function') {
            await pool.query("UPDATE imports SET docs = $1, updated_at = NOW() WHERE id = $2", [JSON.stringify(currentDocs), id]);
        }

        let fileData = readFallbackDB();
        const fIdx = fileData.findIndex(x => Number(x.id) === Number(id));
        if (fIdx !== -1) {
            fileData[fIdx].docs = currentDocs;
            writeFallbackDB(fileData);
        }

        return res.json({ success: true, docs: currentDocs });
    } catch (error) { 
        console.error("Lỗi POST /api/imports/:id/docs:", error);
        res.status(500).json({ success: false, error: error.message }); 
    }
});

router.delete('/:id/docs', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const type = req.body.doc_type;
        const url = req.body.file_url;
        
        let currentDocs = {};
        if (pool && typeof pool.query === 'function') {
            const result = await pool.query("SELECT docs FROM imports WHERE id = $1", [id]);
            if (result.rows.length > 0) {
                let dbDocs = result.rows[0].docs;
                if (typeof dbDocs === 'string') {
                    try { dbDocs = JSON.parse(dbDocs); } catch(e) { dbDocs = {}; }
                }
                if (dbDocs && typeof dbDocs === 'object') currentDocs = dbDocs;
            }
        }

        if (Object.keys(currentDocs).length === 0) {
            let fileData = readFallbackDB();
            const fIdx = fileData.findIndex(x => Number(x.id) === Number(id));
            if (fIdx !== -1 && fileData[fIdx].docs) currentDocs = fileData[fIdx].docs;
        }

        if (currentDocs[type]) {
            currentDocs[type] = currentDocs[type].filter(d => d.url !== url);
        }

        if (pool && typeof pool.query === 'function') {
            await pool.query("UPDATE imports SET docs = $1, updated_at = NOW() WHERE id = $2", [JSON.stringify(currentDocs), id]);
        }

        let fileData = readFallbackDB();
        const fIdx = fileData.findIndex(x => Number(x.id) === Number(id));
        if (fIdx !== -1) {
            fileData[fIdx].docs = currentDocs;
            writeFallbackDB(fileData);
        }

        res.json({ success: true, docs: currentDocs });
    } catch (error) { 
        res.status(500).json({ success: false, error: error.message }); 
    }
});

// Xóa Đơn Hàng Nhập Khẩu
router.delete('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (pool && typeof pool.query === 'function') {
            await pool.query("DELETE FROM imports WHERE id = $1", [id]);
        }
        let data = readFallbackDB();
        data = data.filter(x => Number(x.id) !== Number(id));
        writeFallbackDB(data);

        res.json({ success: true, message: 'Đã xóa Lô Hàng Nhập Khẩu thành công!' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;