const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const dbFile = path.join(__dirname, '../data/inventory.json');

function readDB() { try { return JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch(e) { return []; } }
function writeDB(data) { fs.writeFileSync(dbFile, JSON.stringify(data, null, 2), 'utf8'); }

router.get('/', (req, res) => { res.json({ success: true, data: readDB() }); });

router.post('/', (req, res) => {
    try {
        const data = readDB();
        const payload = req.body;
        const newId = data.length > 0 ? Math.max(...data.map(d => d.id || 0)) + 1 : 1;
        const newItem = { id: newId, ...payload, updated_at: new Date().toISOString() };
        data.push(newItem);
        writeDB(data);
        res.status(201).json({ success: true, data: newItem });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.put('/:id', (req, res) => {
    try {
        let data = readDB();
        const id = parseInt(req.params.id);
        const index = data.findIndex(x => x.id === id);
        if (index !== -1) {
            data[index] = { ...data[index], ...req.body, updated_at: new Date().toISOString() };
            writeDB(data);
            res.json({ success: true, data: data[index] });
        } else res.status(404).json({ success: false });
    } catch (e) { res.status(500).json({ success: false }); }
});

module.exports = router;