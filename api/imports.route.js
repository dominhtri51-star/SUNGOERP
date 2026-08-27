const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const googleDriveService = require('../services/googleDrive.service');

const dbFile = path.join(__dirname, '../data/imports.json');

function readDB() {
    try { 
        if (!fs.existsSync(dbFile)) return [];
        return JSON.parse(fs.readFileSync(dbFile, 'utf8')); 
    } catch(e) { return []; }
}

function writeDB(data) {
    fs.writeFileSync(dbFile, JSON.stringify(data, null, 2), 'utf8');
}

// 1. Lấy danh sách PO
router.get('/', (req, res) => { res.json({ success: true, data: readDB() }); });

// 2. Tạo PO mới (Khởi tạo Két sắt rỗng)
router.post('/', (req, res) => {
    try {
        let data = readDB();
        const payload = req.body;
        const newId = data.length > 0 ? Math.max(...data.map(d => Number(d.id) || 0)) + 1 : 1;
        const newImport = {
            id: newId, po_code: payload.po_code || 'PO-' + Date.now(), note: payload.note || '',
            ...payload, 
            docs: {}, // Két sắt chứng từ độc lập
            created_at: new Date().toISOString()
        };
        data.unshift(newImport);
        writeDB(data);
        res.status(201).json({ success: true, data: newImport });
    } catch (e) { res.status(500).json({ success: false }); }
});

router.get('/:id', (req, res) => {
    const data = readDB();
    const item = data.find(x => Number(x.id) === Number(req.params.id));
    if(item) res.json({ success: true, data: item }); else res.status(404).json({ success: false });
});

// 3. Sửa PO (BỌC THÉP: Tuyệt đối không chạm vào docs)
router.put('/:id', (req, res) => {
    try {
        let data = readDB();
        const index = data.findIndex(x => Number(x.id) === Number(req.params.id));
        if (index !== -1) {
            const preservedDocs = data[index].docs || {}; 
            data[index] = { ...data[index], ...req.body, docs: preservedDocs, updated_at: new Date().toISOString() };
            writeDB(data); res.json({ success: true, data: data[index] });
        } else res.status(404).json({ success: false });
    } catch (e) { res.status(500).json({ success: false }); }
});

router.put('/:id/status', (req, res) => {
    try {
        let data = readDB();
        const index = data.findIndex(x => Number(x.id) === Number(req.params.id));
        if (index !== -1) { data[index].status = req.body.status; writeDB(data); res.json({ success: true }); } 
        else res.status(404).json({ success: false });
    } catch (e) { res.status(500).json({ success: false }); }
});

router.put('/:id/note', (req, res) => {
    try {
        let data = readDB();
        const index = data.findIndex(x => Number(x.id) === Number(req.params.id));
        if (index !== -1) { data[index].note = req.body.note; writeDB(data); res.json({ success: true }); } 
        else res.status(404).json({ success: false });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ===============================================
// MODULE KÉT SẮT CHỨNG TỪ (DOCUMENT VAULT)
// ===============================================

router.get('/:id/docs', (req, res) => {
    try {
        const item = readDB().find(x => Number(x.id) === Number(req.params.id));
        if (item) {
            let docs = item.docs;
            if (!docs || Array.isArray(docs) || typeof docs !== 'object') docs = {};
            return res.json({success: true, docs: docs});
        }
        res.json({success: false});
    } catch(e) { res.json({success: false}); }
});

router.post('/:id/docs', async (req, res) => {
    try {
        const id = req.params.id;
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

        let data = readDB();
        const index = data.findIndex(x => Number(x.id) === Number(id));
        
        if (index !== -1) {
            let currentDocs = data[index].docs;
            if (!currentDocs || Array.isArray(currentDocs) || typeof currentDocs !== 'object') currentDocs = {};
            
            const dType = payload.doc_type || 'commercial';
            if (!currentDocs[dType] || !Array.isArray(currentDocs[dType])) currentDocs[dType] = [];
            
            // Bổ sung Metadata theo mô hình chuẩn
            currentDocs[dType].push({ 
                name: payload.doc_note || payload.file_name, 
                url: fileUrl,
                original_name: payload.file_name,
                storage: uploadResult.storage,
                fileId: uploadResult.fileId || null,
                uploaded_at: new Date().toISOString()
            });
            
            data[index].docs = currentDocs;
            writeDB(data);
            
            return res.json({ success: true, docs: data[index].docs });
        }
        res.status(404).json({ success: false, error: 'Không tìm thấy PO' });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.delete('/:id/docs', (req, res) => {
    try {
        const id = req.params.id;
        const type = req.body.doc_type;
        const url = req.body.file_url;
        
        let data = readDB();
        const index = data.findIndex(x => Number(x.id) === Number(id));
        if (index !== -1) {
            if (!data[index].docs || Array.isArray(data[index].docs) || typeof data[index].docs !== 'object') {
                data[index].docs = {};
            }
            if (data[index].docs[type]) {
                data[index].docs[type] = data[index].docs[type].filter(d => d.url !== url);
                writeDB(data);
            }
            res.json({ success: true, docs: data[index].docs });
        } else {
            res.status(404).json({ success: false });
        }
    } catch (error) { res.status(500).json({ success: false }); }
});

module.exports = router;