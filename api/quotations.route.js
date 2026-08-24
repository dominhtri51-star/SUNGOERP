const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const pool = require('../config/database');

const dbFile = path.join(__dirname, '../data/quotations.json');

function readDB() {
    try {
        if (!fs.existsSync(dbFile)) return [];
        const content = fs.readFileSync(dbFile, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        return [];
    }
}

function writeDB(data) {
    fs.writeFileSync(dbFile, JSON.stringify(data, null, 2), 'utf8');
}

function enrichQuotation(q) {
    const items = q.items || [];
    let calculatedCost = 0;
    
    items.forEach(it => {
        const qty = parseFloat(it.quantity || it.qty || 1);
        const price = parseFloat(it.price || it.unit_price || 0);
        const wsPrice = parseFloat(it.wholesale_price || (price * 0.85));
        calculatedCost += wsPrice * qty;
    });

    const totalAmount = parseFloat(q.total_amount || q.total_value || 0);
    const totalCost = q.total_cost ? parseFloat(q.total_cost) : Math.round(calculatedCost);
    const profitMargin = totalAmount > 0 ? parseFloat((((totalAmount - totalCost) / totalAmount) * 100).toFixed(1)) : 0;
    const isBelowFloor = profitMargin < 15.0;

    const brand = (q.brand_name || '').toUpperCase();
    let sysType = q.system_type;
    if (!sysType) {
        if (brand.includes('HYBRID') || (q.quotation_code || '').startsWith('HYB')) sysType = 'HYBRID';
        else if (brand.includes('PUMP') || brand.includes('BƠM') || (q.quotation_code || '').startsWith('PUMP')) sysType = 'PUMP';
        else if (brand.includes('ONGRID') || brand.includes('BÁM TẢI') || (q.quotation_code || '').startsWith('ONG')) sysType = 'ONGRID';
        else sysType = 'OFFGRID';
    }

    return {
        ...q,
        system_type: sysType,
        total_amount: totalAmount,
        total_cost: totalCost,
        profit_margin: profitMargin,
        is_below_floor: isBelowFloor,
        project_name: q.project_name || `Dự án Điện Mặt Trời ${sysType} ${q.system_kwp || ''}kWp`,
        customer_name: q.customer_name || 'Khách Hàng',
        phone: q.phone || q.customer_phone || '090xxxxxxx',
        sale_name: q.sale_name || q.created_by || 'Nguyễn Văn A (Sale)',
        status: q.status || (isBelowFloor ? 'PENDING_APPROVAL' : 'QUOTING')
    };
}

// [GET] Lấy danh sách Báo giá (Đã đồng bộ đầy đủ thông số Lợi nhuận & Trạng thái)
router.get('/', (req, res) => {
    try {
        const rawData = readDB();
        const data = rawData.map(enrichQuotation);
        res.json({ success: true, data: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// [POST] Tạo Báo giá mới
router.post('/', (req, res) => {
    try {
        const data = readDB();
        const payload = req.body;
        
        // Tự động nhảy số ID
        const newId = data.length > 0 ? Math.max(...data.map(d => d.quotation_id || d.id || 0)) + 1 : 1;
        
        // Xác định tiền tố mã báo giá
        let prefix = 'HYB';
        const brand = (payload.brand_name || '').toUpperCase();
        if (brand.includes('ONGRID') || brand.includes('ON-GRID') || brand.includes('BÁM TẢI')) prefix = 'ONG';
        else if (brand.includes('PUMP') || brand.includes('BƠM')) prefix = 'PUMP';
        else if (brand.includes('OFF-GRID') || brand.includes('OFFGRID') || brand.includes('ĐỘC LẬP')) prefix = 'OFF';
        else prefix = 'HYB';

        const codeNumber = Math.floor(100000 + Math.random() * 900000);
        const quotation_code = payload.quotation_code || `${prefix}-${codeNumber}`;

        const items = payload.items || [];
        let totalCost = 0;
        items.forEach(it => {
            const qty = parseFloat(it.quantity || 1);
            const price = parseFloat(it.price || it.unit_price || 0);
            const wsPrice = parseFloat(it.wholesale_price || (price * 0.85));
            totalCost += wsPrice * qty;
        });

        const totalAmount = parseFloat(payload.total_amount || 0);
        const profitMargin = totalAmount > 0 ? parseFloat((((totalAmount - totalCost) / totalAmount) * 100).toFixed(1)) : 0;
        const isBelowFloor = profitMargin < 15.0;

        let status = payload.status;
        if (!status) {
            status = isBelowFloor ? 'PENDING_APPROVAL' : 'QUOTING';
        }

        const newQuotation = {
            quotation_id: newId,
            quotation_code: quotation_code,
            ...payload,
            total_amount: totalAmount,
            total_cost: Math.round(totalCost),
            profit_margin: profitMargin,
            is_below_floor: isBelowFloor,
            status: status,
            created_at: new Date().toISOString()
        };
        
        // Lưu vào đầu danh sách
        data.unshift(newQuotation);
        writeDB(data);
        
        console.log(`✅ Đã lưu thành công báo giá: ${newQuotation.quotation_code} [${newQuotation.status}]`);
        res.status(201).json({ success: true, quotation: enrichQuotation(newQuotation) });
        
    } catch (e) {
        console.error("❌ Lỗi khi lưu Báo Giá:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// [GET] Lấy chi tiết Báo giá theo ID
router.get('/:id', (req, res) => {
    try {
        const data = readDB();
        const id = parseInt(req.params.id);
        const q = data.find(x => (x.quotation_id === id || x.id === id));
        
        if (q) {
            const enriched = enrichQuotation(q);
            res.json({ success: true, quotation: enriched, items: enriched.items || [] });
        } else {
            res.status(404).json({ success: false, error: 'Không tìm thấy báo giá' });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// [PUT] Cập nhật / Sửa Báo Giá Toàn Diện
router.put('/:id', (req, res) => {
    try {
        const data = readDB();
        const id = parseInt(req.params.id);
        const idx = data.findIndex(x => (x.quotation_id === id || x.id === id));
        
        if (idx === -1) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy báo giá để cập nhật' });
        }

        const payload = req.body;
        const items = payload.items || data[idx].items || [];
        let totalCost = 0;
        items.forEach(it => {
            const qty = parseFloat(it.quantity || it.qty || 1);
            const price = parseFloat(it.price || it.unit_price || 0);
            const wsPrice = parseFloat(it.wholesale_price || (price * 0.85));
            totalCost += wsPrice * qty;
        });

        const totalAmount = parseFloat(payload.total_amount || data[idx].total_amount || 0);
        const profitMargin = totalAmount > 0 ? parseFloat((((totalAmount - totalCost) / totalAmount) * 100).toFixed(1)) : 0;
        const isBelowFloor = profitMargin < 15.0;

        let status = payload.status || data[idx].status;
        if (payload.status_reset) {
            status = isBelowFloor ? 'PENDING_APPROVAL' : 'QUOTING';
        }

        data[idx] = {
            ...data[idx],
            ...payload,
            total_amount: totalAmount,
            total_cost: Math.round(totalCost),
            profit_margin: profitMargin,
            is_below_floor: isBelowFloor,
            status: status,
            updated_at: new Date().toISOString()
        };

        writeDB(data);
        console.log(`✅ Đã cập nhật thành công báo giá: ${data[idx].quotation_code} [${status}]`);
        res.json({ success: true, quotation: enrichQuotation(data[idx]) });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// [PUT] Cập nhật Trạng Thái Báo Giá (Duyệt / Từ Chối / Đang Báo Giá / Khách Chốt)
router.put('/:id/status', (req, res) => {
    try {
        const data = readDB();
        const id = parseInt(req.params.id);
        const idx = data.findIndex(x => (x.quotation_id === id || x.id === id));
        
        if (idx === -1) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy báo giá' });
        }

        const { status, approved_by, reject_reason, notes } = req.body;
        if (!status) {
            return res.status(400).json({ success: false, error: 'Vui lòng cung cấp trạng thái cần cập nhật' });
        }

        data[idx].status = status;
        if (status === 'APPROVED') {
            data[idx].approved_by = approved_by || 'Admin';
            data[idx].approved_at = new Date().toISOString();
        } else if (status === 'REJECTED') {
            data[idx].reject_reason = reject_reason || 'Không đạt biên lợi nhuận yêu cầu';
            data[idx].rejected_by = approved_by || 'Admin';
            data[idx].rejected_at = new Date().toISOString();
        }
        if (notes) data[idx].admin_notes = notes;

        writeDB(data);

        console.log(`⚡ Đã cập nhật trạng thái Báo Giá ${data[idx].quotation_code} sang: ${status}`);
        res.json({ success: true, quotation: enrichQuotation(data[idx]) });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// [POST] Chuyển đổi Báo Giá thành Đơn Hàng (Sale Order)
router.post('/:id/convert-to-order', async (req, res) => {
    try {
        const data = readDB();
        const id = parseInt(req.params.id);
        const idx = data.findIndex(x => (x.quotation_id === id || x.id === id));
        
        if (idx === -1) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy báo giá để chuyển đơn' });
        }

        const q = enrichQuotation(data[idx]);
        const order_code = 'DH-' + (q.quotation_code || ('BOQ' + Math.floor(Date.now()/1000)));

        let orderId = null;

        // Lưu vào PostgreSQL nếu kết nối sẵn sàng
        try {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const orderRes = await client.query(
                    "INSERT INTO orders (order_code, customer_name, customer_phone, total_amount, status, created_at, notes) VALUES ($1, $2, $3, $4, 'PENDING', NOW(), $5) RETURNING id",
                    [order_code, q.customer_name, q.phone, q.total_amount, `Tạo tự động từ Báo Giá BOQ: ${q.quotation_code}`]
                );
                orderId = orderRes.rows[0].id;

                for (let it of (q.items || [])) {
                    const qty = parseFloat(it.quantity || it.qty || 1);
                    const price = parseFloat(it.price || it.unit_price || 0);
                    const itemTotal = qty * price;
                    const pId = it.product_id || null;

                    await client.query(
                        "INSERT INTO order_items (order_id, product_id, sku, product_name, quantity, price, total) VALUES ($1, $2, $3, $4, $5, $6, $7)",
                        [orderId, pId, it.sku || '', it.product_name || 'Vật tư BOQ', qty, price, itemTotal]
                    );

                    if (pId) {
                        await client.query("UPDATE products SET stock_qty = stock_qty - $1 WHERE id = $2 AND stock_qty >= $1", [qty, pId]);
                    }
                }
                await client.query('COMMIT');
            } catch (dbErr) {
                await client.query('ROLLBACK');
                console.error("Lỗi insert DB Order:", dbErr);
            } finally {
                client.release();
            }
        } catch (poolErr) {
            console.error("Lỗi kết nối pool DB:", poolErr);
        }

        // Cập nhật trạng thái báo giá sang WON (Khách chốt / Đã lên đơn)
        data[idx].status = 'WON';
        data[idx].converted_order_code = order_code;
        data[idx].converted_order_id = orderId;
        data[idx].converted_at = new Date().toISOString();
        writeDB(data);

        res.json({
            success: true,
            message: `Đã chuyển đổi Báo Giá ${q.quotation_code} thành Đơn Hàng ${order_code} thành công!`,
            order_code: order_code,
            order_id: orderId,
            quotation: enrichQuotation(data[idx])
        });

    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// [DELETE] Xóa báo giá
router.delete('/:id', (req, res) => {
    try {
        let data = readDB();
        const id = parseInt(req.params.id);
        const initialLength = data.length;
        data = data.filter(x => (x.quotation_id !== id && x.id !== id));
        
        if (data.length === initialLength) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy báo giá để xóa' });
        }

        writeDB(data);
        res.json({ success: true, message: 'Đã xóa báo giá thành công' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
