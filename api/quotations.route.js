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

function findQuotationIndex(data, rawId) {
    if (!rawId) return -1;
    const strId = String(rawId).trim();
    const numId = parseInt(strId, 10);
    return data.findIndex(x => (
        (!isNaN(numId) && (x.quotation_id === numId || x.id === numId || parseInt(x.quotation_id) === numId || parseInt(x.id) === numId)) ||
        (x.quotation_code && x.quotation_code.toLowerCase() === strId.toLowerCase()) ||
        (x.code && x.code.toLowerCase() === strId.toLowerCase())
    ));
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
router.get('/', async (req, res) => {
    try {
        if (pool && typeof pool.query === 'function') {
            try {
                const dbRes = await pool.query("SELECT * FROM quotations ORDER BY id DESC");
                if (dbRes.rows.length > 0) {
                    const data = dbRes.rows.map(row => {
                        let items = row.items;
                        if (typeof items === 'string') {
                            try { items = JSON.parse(items); } catch(e) { items = []; }
                        }
                        let laborItems = row.labor_items;
                        if (typeof laborItems === 'string') {
                            try { laborItems = JSON.parse(laborItems); } catch(e) { laborItems = []; }
                        }
                        return enrichQuotation({
                            ...row,
                            quotation_id: row.id,
                            items: items || [],
                            labor_items: laborItems || []
                        });
                    });
                    writeDB(data);
                    return res.json({ success: true, data: data });
                }
            } catch(dbErr) {
                console.warn("Lỗi đọc DB quotations, fallback sang JSON:", dbErr.message);
            }
        }
        const rawData = readDB();
        const data = rawData.map(enrichQuotation);
        res.json({ success: true, data: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// [POST] Tạo Báo giá mới
router.post('/', async (req, res) => {
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

        // Lưu vào PostgreSQL DB
        if (pool && typeof pool.query === 'function') {
            try {
                await pool.query(`
                    INSERT INTO quotations (
                        quotation_code, store_id, brand_name, project_name, customer_name,
                        phone, sale_name, created_by, emp_id, system_type, monthly_bill,
                        system_kwp, total_amount, total_cost, profit_margin, is_below_floor,
                        payback_years, npv_amount, roe_percent, status, items, labor_items,
                        created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW(), NOW())
                    ON CONFLICT (quotation_code) DO NOTHING
                `, [
                    newQuotation.quotation_code, newQuotation.store_id || 1, newQuotation.brand_name, newQuotation.project_name, newQuotation.customer_name,
                    newQuotation.phone, newQuotation.sale_name, newQuotation.created_by, newQuotation.emp_id, newQuotation.system_type, newQuotation.monthly_bill || 0,
                    newQuotation.system_kwp || 0, newQuotation.total_amount || 0, newQuotation.total_cost || 0, newQuotation.profit_margin || 0, newQuotation.is_below_floor || false,
                    newQuotation.payback_years || 0, newQuotation.npv_amount || 0, newQuotation.roe_percent || 0, newQuotation.status || 'QUOTING',
                    JSON.stringify(newQuotation.items || []), JSON.stringify(newQuotation.labor_items || [])
                ]);
            } catch (dbErr) {
                console.error("Lỗi insert DB quotations:", dbErr.message);
            }
        }
        
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

// [GET] Lấy chi tiết bóc tách vật tư & nhân công
router.get('/:id/details', (req, res) => {
    try {
        const data = readDB();
        const idx = findQuotationIndex(data, req.params.id);
        const q = idx !== -1 ? data[idx] : null;
        
        if (q) {
            const enriched = enrichQuotation(q);
            const allDetails = [
                ...(enriched.items || []).map(i => ({ ...i, is_labor: false })),
                ...(enriched.labor_items || []).map(l => ({ 
                    ...l, 
                    is_labor: true, 
                    product_name: l.name || l.item_name || 'Hạng mục thi công', 
                    quantity: parseFloat(l.qty || l.quantity || 1), 
                    price: parseFloat(l.price || l.unit_price || 0),
                    total: parseFloat(l.qty || l.quantity || 1) * parseFloat(l.price || l.unit_price || 0)
                }))
            ];
            res.json({ success: true, data: allDetails, quotation: enriched });
        } else {
            res.status(404).json({ success: false, error: 'Không tìm thấy chi tiết báo giá' });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// [GET] Lấy chi tiết Báo giá theo ID hoặc Mã Code
router.get('/:id', (req, res) => {
    try {
        const data = readDB();
        const idx = findQuotationIndex(data, req.params.id);
        const q = idx !== -1 ? data[idx] : null;
        
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
router.put('/:id', async (req, res) => {
    try {
        const data = readDB();
        const idx = findQuotationIndex(data, req.params.id);
        
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

        if (pool && typeof pool.query === 'function') {
            try {
                await pool.query(`
                    UPDATE quotations 
                    SET 
                        brand_name = COALESCE($1, brand_name),
                        project_name = COALESCE($2, project_name),
                        customer_name = COALESCE($3, customer_name),
                        phone = COALESCE($4, phone),
                        total_amount = $5,
                        total_cost = $6,
                        profit_margin = $7,
                        is_below_floor = $8,
                        status = $9,
                        items = $10,
                        labor_items = $11,
                        updated_at = NOW()
                    WHERE quotation_code = $12 OR id = $13
                `, [
                    data[idx].brand_name, data[idx].project_name, data[idx].customer_name, data[idx].phone,
                    totalAmount, Math.round(totalCost), profitMargin, isBelowFloor, status,
                    JSON.stringify(data[idx].items || []), JSON.stringify(data[idx].labor_items || []),
                    data[idx].quotation_code, parseInt(req.params.id) || 0
                ]);
            } catch(dbErr) {}
        }

        writeDB(data);
        console.log(`✅ Đã cập nhật thành công báo giá: ${data[idx].quotation_code} [${status}]`);
        res.json({ success: true, quotation: enrichQuotation(data[idx]) });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// [PUT] Cập nhật Trạng Thái Báo Giá (Duyệt / Từ Chối / Đang Báo Giá / Khách Chốt)
router.put('/:id/status', async (req, res) => {
    try {
        const data = readDB();
        const idx = findQuotationIndex(data, req.params.id);
        
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

        if (pool && typeof pool.query === 'function') {
            try {
                await pool.query(`
                    UPDATE quotations 
                    SET 
                        status = $1,
                        approved_by = $2,
                        approved_at = $3,
                        reject_reason = $4,
                        rejected_by = $5,
                        rejected_at = $6,
                        admin_notes = $7,
                        updated_at = NOW()
                    WHERE quotation_code = $8 OR id = $9
                `, [
                    data[idx].status, data[idx].approved_by || null, data[idx].approved_at || null,
                    data[idx].reject_reason || null, data[idx].rejected_by || null, data[idx].rejected_at || null,
                    data[idx].admin_notes || null, data[idx].quotation_code, parseInt(req.params.id) || 0
                ]);
            } catch(dbErr) {}
        }

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
        const idx = findQuotationIndex(data, req.params.id);
        
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

// [DELETE] Xóa Báo Giá & Tiêu Hủy Đồng Bộ Đơn Hàng, Sổ Quỹ, Hợp Đồng & Công Nợ Liên Quan
router.delete('/:id', async (req, res) => {
    try {
        let data = readDB();
        const idx = findQuotationIndex(data, req.params.id);
        
        if (idx === -1) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy báo giá để xóa' });
        }

        const q = data[idx];
        const qCode = (q.quotation_code || q.code || '').trim();
        const convOrderCode = (q.converted_order_code || '').trim();
        const convOrderId = q.converted_order_id || null;

        // Xử lý dọn dẹp liên kết trong PostgreSQL nếu có DB
        if (pool && typeof pool.query === 'function') {
            try {
                // 1. Tìm các đơn hàng liên quan đến Báo Giá này
                let linkedOrders = [];
                try {
                    const ordQuery = `
                        SELECT id, customer_id, order_code, status, total_amount, paid_amount 
                        FROM orders 
                        WHERE (order_code = $1 AND $1 != '') 
                           OR (order_code = $2 AND $2 != '') 
                           OR (order_code LIKE $3 AND $3 != '')
                           OR (notes LIKE $4 AND $4 != '')
                    `;
                    const ordRes = await pool.query(ordQuery, [
                        convOrderCode, 
                        'DH-' + qCode, 
                        '%' + qCode + '%', 
                        '%' + qCode + '%'
                    ]);
                    linkedOrders = ordRes.rows || [];
                } catch (ordFindErr) {
                    console.warn("Lỗi tìm đơn hàng liên quan báo giá:", ordFindErr.message);
                }

                // 2. Dọn dẹp từng đơn hàng liên quan
                const affectedCustIds = new Set();
                for (const ord of linkedOrders) {
                    if (ord.customer_id) affectedCustIds.add(ord.customer_id);

                    // Khôi phục tồn kho nếu đơn đã xuất hàng
                    if (['PACKED', 'SHIPPING_CMD', 'SHIPPED', 'COMPLETED'].includes(ord.status)) {
                        try {
                            const itemsRes = await pool.query('SELECT product_id, quantity FROM order_items WHERE order_id = $1', [ord.id]);
                            for (let item of itemsRes.rows) {
                                if (item.product_id) {
                                    await pool.query('UPDATE products SET stock_qty = stock_qty + $1 WHERE id = $2', [item.quantity, item.product_id]);
                                }
                            }
                        } catch(stkErr) {}
                    }

                    // Dọn dẹp các chứng từ / bảng con của đơn
                    try { await pool.query('DELETE FROM cash_transactions WHERE order_id = $1 OR order_code = $2 OR notes LIKE $3', [ord.id, ord.order_code, '%' + ord.order_code + '%']); } catch(e) {}
                    try { await pool.query('DELETE FROM order_docs WHERE order_id = $1', [ord.id]); } catch(e) {}
                    try { await pool.query('DELETE FROM order_items WHERE order_id = $1', [ord.id]); } catch(e) {}
                    try { await pool.query('DELETE FROM return_items WHERE return_order_id IN (SELECT id FROM return_orders WHERE order_id = $1)', [ord.id]); } catch(e) {}
                    try { await pool.query('DELETE FROM return_orders WHERE order_id = $1', [ord.id]); } catch(e) {}
                    try { await pool.query('DELETE FROM orders WHERE id = $1', [ord.id]); } catch(e) {}
                }

                // 3. Dọn dẹp các phiếu thu / chi trong Sổ Quỹ (cash_transactions) liên quan trực tiếp đến mã BOQ
                if (qCode) {
                    try {
                        await pool.query("DELETE FROM cash_transactions WHERE notes LIKE $1 OR ref_code LIKE $1", ['%' + qCode + '%']);
                    } catch(e) {}
                }

                // 4. Dọn dẹp Hợp đồng & Thanh toán Hợp đồng (contracts & contract_payments) liên quan đến mã BOQ
                if (qCode) {
                    try {
                        const contractRes = await pool.query("SELECT id FROM contracts WHERE contract_code LIKE $1", ['%' + qCode + '%']);
                        for (let c of contractRes.rows) {
                            try { await pool.query("DELETE FROM contract_payments WHERE contract_id = $1", [c.id]); } catch(e) {}
                            try { await pool.query("DELETE FROM contracts WHERE id = $1", [c.id]); } catch(e) {}
                        }
                    } catch(e) {}
                }

                // 5. Dọn dẹp Bảo Hành / O&M nếu có liên quan
                if (qCode) {
                    try { await pool.query("DELETE FROM warranties WHERE notes LIKE $1", ['%' + qCode + '%']); } catch(e) {}
                    try { await pool.query("DELETE FROM om_schedules WHERE notes LIKE $1", ['%' + qCode + '%']); } catch(e) {}
                }

                // 6. Cập nhật lại Công Nợ & Doanh Số cho các Khách Hàng bị ảnh hưởng
                for (const custId of affectedCustIds) {
                    try {
                        await pool.query(`
                            UPDATE customers 
                            SET 
                                current_debt = (SELECT COALESCE(SUM(total_amount - paid_amount), 0) FROM orders WHERE customer_id = $1 AND status NOT IN ('CANCELLED', 'RETURNED')),
                                total_sales = (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE customer_id = $1 AND status NOT IN ('CANCELLED', 'RETURNED'))
                            WHERE id = $1
                        `, [custId]);
                    } catch (custErr) {}
                }

                // 7. Xóa khỏi bảng PostgreSQL quotations
                try {
                    await pool.query("DELETE FROM quotations WHERE quotation_code = $1 OR id = $2", [qCode, parseInt(req.params.id) || 0]);
                } catch (qDelErr) {}
            } catch (dbErr) {
                console.error("Lỗi dọn dẹp liên kết CSDL khi xóa báo giá:", dbErr);
            }
        }

        // Xóa Báo Giá khỏi danh sách
        data.splice(idx, 1);
        writeDB(data);

        console.log(`🗑️ Đã xóa hoàn toàn Báo Giá ${qCode} và toàn bộ chứng từ nợ, đơn hàng, sổ quỹ liên quan!`);
        res.json({ 
            success: true, 
            message: `Đã xóa thành công Báo Giá ${qCode} và tự động dọn dẹp các chứng từ, đơn hàng, công nợ & sổ quỹ liên quan!` 
        });
    } catch (e) {
        console.error("Lỗi API DELETE /api/quotations:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
