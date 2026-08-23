const express = require('express');
const router = express.Router();
const pool = require('../config/db') || require('../config/database') || require('./db');

// 1. LẤY DANH SÁCH KHÁCH HÀNG
router.get('/', async (req, res) => {
  try {
    const sql = `
      SELECT 
        id, 
        COALESCE(customer_code, 'KH-' || id) AS customer_code,
        COALESCE(name, full_name, 'Khách hàng') AS name,
        COALESCE(full_name, name, 'Khách hàng') AS full_name,
        COALESCE(phone, '') AS phone,
        COALESCE(nickname, '') AS nickname,
        COALESCE(address, '') AS address,
        COALESCE(vip_level, tier, 1) AS customer_tier,
        COALESCE(vip_level, tier, 1) AS vip_level,
        COALESCE(reward_points, points, 0) AS reward_points,
        COALESCE(total_spent, total_sales, 0) AS total_sales,
        0 AS current_debt,
        COALESCE(vat_company, company_name, '') AS vat_company,
        COALESCE(vat_taxcode, tax_code, '') AS vat_taxcode,
        COALESCE(vat_address, company_address, '') AS vat_address,
        COALESCE(vat_email, '') AS vat_email,
        created_at
      FROM customers 
      ORDER BY id DESC
    `;
    const { rows } = await pool.query(sql);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Lỗi GET /api/customers:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. TÌM KIẾM NHANH (DÙNG CHO POS & AUTOCOMPLETE)
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q ? req.query.q.trim() : '';
    if (!q) return res.json([]);
    const sql = `
      SELECT id, customer_code, full_name, name, phone, address, 
             COALESCE(vip_level, tier, 1) AS vip_level,
             COALESCE(reward_points, points, 0) AS reward_points
      FROM customers
      WHERE phone ILIKE $1 OR full_name ILIKE $1 OR name ILIKE $1 OR customer_code ILIKE $1 OR nickname ILIKE $1
      ORDER BY id DESC LIMIT 15
    `;
    const { rows } = await pool.query(sql, [`%${q}%`]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. TẠO MỚI KHÁCH HÀNG (TỪ NÚT "TẠO MỚI NGAY")
router.post('/', async (req, res) => {
  try {
    const b = req.body;
    const name = (b.name || b.full_name || 'Khách hàng mới').trim();
    const phone = (b.phone || '').trim();
    const nickname = (b.nickname || '').trim();
    const address = (b.address || '').trim();
    const vatCompany = (b.vat_company || b.company_name || '').trim();
    const vatTax = (b.vat_taxcode || b.tax_code || '').trim();
    const vatAddr = (b.vat_address || b.company_address || '').trim();
    const vatEmail = (b.vat_email || '').trim();
    const tier = parseInt(b.tier || b.vip_level || 1) || 1;
    const points = parseFloat(b.points || b.reward_points || 0) || 0;
    const code = 'KH-' + Math.floor(100000 + Math.random() * 900000);

    const sql = `
      INSERT INTO customers (
        customer_code, full_name, name, phone, nickname, address,
        vip_level, tier, reward_points, points, total_spent, total_sales,
        vat_company, company_name, vat_taxcode, tax_code,
        vat_address, company_address, vat_email
      ) VALUES ($1, $2, $2, $3, $4, $5, $6, $6, $7, $7, 0, 0, $8, $8, $9, $9, $10, $10, $11)
      ON CONFLICT (phone) DO UPDATE SET
        name = EXCLUDED.name,
        full_name = EXCLUDED.full_name,
        nickname = EXCLUDED.nickname,
        address = EXCLUDED.address,
        vat_company = EXCLUDED.vat_company,
        vat_taxcode = EXCLUDED.vat_taxcode,
        vat_address = EXCLUDED.vat_address,
        vat_email = EXCLUDED.vat_email
      RETURNING *;
    `;

    const values = [code, name, phone, nickname, address, tier, points, vatCompany, vatTax, vatAddr, vatEmail];
    const { rows } = await pool.query(sql, values);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Lỗi POST /api/customers:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. CẬP NHẬT HỒ SƠ & VAT (NÚT "LƯU HỒ SƠ")
router.put('/:id/profile', async (req, res) => {
  try {
    const { id } = req.params;
    const b = req.body;
    const name = (b.name || b.full_name || '').trim();
    const phone = (b.phone || '').trim();
    const nickname = (b.nickname || '').trim();
    const address = (b.address || '').trim();
    const vatCompany = (b.vat_company || '').trim();
    const vatTax = (b.vat_taxcode || '').trim();
    const vatAddr = (b.vat_address || '').trim();
    const vatEmail = (b.vat_email || '').trim();

    const sql = `
      UPDATE customers 
      SET name = $1, full_name = $1,
          phone = $2,
          nickname = $3,
          address = $4,
          vat_company = $5, company_name = $5,
          vat_taxcode = $6, tax_code = $6,
          vat_address = $7, company_address = $7,
          vat_email = $8
      WHERE id = $9
      RETURNING *;
    `;
    const { rows } = await pool.query(sql, [name, phone, nickname, address, vatCompany, vatTax, vatAddr, vatEmail, id]);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Lỗi PUT /:id/profile:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. CẬP NHẬT HẠNG TIER & ĐIỂM QUỸ (NÚT "CẬP NHẬT TRẠNG THÁI / CẬP NHẬT QUỸ")
router.put('/:id/tier', async (req, res) => {
  try {
    const { id } = req.params;
    const b = req.body;
    const tier = parseInt(b.tier || b.vip_level || 1) || 1;
    const points = b.points !== undefined ? parseFloat(b.points) : (b.reward_points !== undefined ? parseFloat(b.reward_points) : null);

    let sql, values;
    if (points !== null) {
      sql = `
        UPDATE customers 
        SET tier = $1, vip_level = $1,
            reward_points = $2, points = $2
        WHERE id = $3
        RETURNING *;
      `;
      values = [tier, points, id];
    } else {
      sql = `
        UPDATE customers 
        SET tier = $1, vip_level = $1
        WHERE id = $2
        RETURNING *;
      `;
      values = [tier, id];
    }

    const { rows } = await pool.query(sql, values);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Lỗi PUT /:id/tier:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. LẤY & THÊM QUÀ TẶNG (BẢNG customer_gifts)
router.get('/:id/gifts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, customer_id, gift_name, gift_value, note, gift_date FROM customer_gifts WHERE customer_id = $1 ORDER BY id DESC',
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.json({ success: true, data: [] });
  }
});

router.post('/:id/gifts', async (req, res) => {
  try {
    const { id } = req.params;
    const { gift_name, gift_value } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO customer_gifts (customer_id, gift_name, gift_value, note) VALUES ($1, $2, $3, $4) RETURNING *',
      [id, gift_name, parseFloat(gift_value) || 0, 'Quà tặng CRM']
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. NHẬT KÝ CHĂM SÓC
router.get('/:id/logs', async (req, res) => {
  res.json({ success: true, data: [] });
});
router.post('/:id/logs', async (req, res) => {
  res.json({ success: true });
});

// 8. XÓA ĐỐI TÁC
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM customer_gifts WHERE customer_id = $1', [req.params.id]);
    await pool.query('DELETE FROM customers WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Đã xóa đối tác' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
