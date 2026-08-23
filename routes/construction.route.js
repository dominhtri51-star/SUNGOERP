const express = require('express');
const router = express.Router();
const pool = require('../config/db') || require('../config/database') || require('./db');

// Lấy danh sách tất cả dự án
router.get('/projects', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM projects ORDER BY id DESC');
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Lỗi GET /projects:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Lấy 1 dự án
router.get('/projects/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy dự án' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Tạo dự án mới
router.post('/projects', async (req, res) => {
  try {
    const b = req.body;
    const code = b.project_code || ('DA-' + Math.floor(1000 + Math.random() * 9000));
    const sql = `
      INSERT INTO projects (
        project_code, project_name, customer_name, customer_phone, 
        address, system_type, capacity_kwp, battery_kwh, inverter_brand, 
        lead_engineer, status, progress
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *;
    `;
    const values = [
      code, 
      b.project_name || 'Dự án mới', 
      b.customer_name || 'Khách hàng', 
      b.customer_phone || '',
      b.address || '', 
      b.system_type || 'Hybrid', 
      parseFloat(b.capacity_kwp) || 0,
      parseFloat(b.battery_kwh) || 0, 
      b.inverter_brand || 'SUNGO',
      b.lead_engineer || 'Kỹ sư phụ trách', 
      b.status || 'IN_PROGRESS', 
      parseInt(b.progress) || 0
    ];
    const { rows } = await pool.query(sql, values);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Lỗi POST /projects:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Lấy nghiệm thu theo ID dự án
router.get('/handover/:projectId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM project_handover WHERE project_id = $1 ORDER BY id DESC LIMIT 1',
      [req.params.projectId]
    );
    res.json({ success: true, data: rows[0] || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Lưu nghiệm thu & 6 ảnh
router.post('/handover/:projectId', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const b = req.body;
    
    await pool.query('DELETE FROM project_handover WHERE project_id = $1', [projectId]);

    const sql = `
      INSERT INTO project_handover (
        project_id, customer_name, customer_phone, address, installed_kwp,
        app_name, app_account, app_password, app_status,
        img_panels, img_cabinet, img_inverter, img_battery, img_wiring, img_app, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *;
    `;
    const values = [
      projectId, b.customer_name || '', b.customer_phone || '', b.address || '', parseFloat(b.installed_kwp) || 0,
      b.app_name || '', b.app_account || '', b.app_password || '', b.app_status || 'HOẠT ĐỘNG MƯỢT MÀ',
      b.img_panels || '', b.img_cabinet || '', b.img_inverter || '',
      b.img_battery || '', b.img_wiring || '', b.img_app || '', b.notes || ''
    ];
    const { rows } = await pool.query(sql, values);

    if (b.progress !== undefined) {
      await pool.query('UPDATE projects SET progress = $1, status = $2 WHERE id = $3', [
        parseInt(b.progress) || 100, 
        parseInt(b.progress) >= 100 ? 'COMPLETED' : 'IN_PROGRESS', 
        projectId
      ]);
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Lỗi POST /handover:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
