const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// GET: LẤY DANH SÁCH ĐƠN HÀNG (Sạch biến rác, Kèm Customer Tier)
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT o.*, c.full_name as customer_name_joined, c.phone as customer_phone, c.tier as customer_tier
            FROM orders o 
            LEFT JOIN customers c ON o.customer_id = c.id 
            ORDER BY o.id DESC LIMIT 150
        `);
        const orders = result.rows;
        if (orders.length > 0) {
            const orderIds = orders.map(o => o.id);
            // KHÔNG CÒN GỌI oi.qty NỮA, CHỈ DÙNG oi.quantity
            const itemsRes = await pool.query("SELECT oi.order_id, p.product_name, oi.price, oi.quantity, oi.product_id FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ANY($1)", [orderIds]);
            orders.forEach(o => { o.items = itemsRes.rows.filter(i => i.order_id === o.id); });
        }
        res.json({ success: true, data: orders });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET: LẤY CHI TIẾT 1 ĐƠN HÀNG
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const orderRes = await pool.query(`
            SELECT o.*, c.full_name as customer_name_joined, c.phone as customer_phone, c.address as customer_address, c.tier as customer_tier
            FROM orders o 
            LEFT JOIN customers c ON o.customer_id = c.id 
            WHERE o.id = $1
        `, [id]);
        if(orderRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy đơn hàng' });
        
        // SELECT oi.* ĐÃ TỰ ĐỘNG CHUẨN VÌ DB CHỈ CÒN CỘT QUANTITY
        const itemsRes = await pool.query('SELECT oi.*, p.product_name, p.sku FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = $1', [id]);
        const docsRes = await pool.query('SELECT * FROM order_docs WHERE order_id = $1 ORDER BY id DESC', [id]);
        res.json({ success: true, data: { ...orderRes.rows[0], items: itemsRes.rows, docs: docsRes.rows } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST: TẠO ĐƠN HÀNG MỚI (Từ POS)
router.post('/', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { customer_id, customer_name, total_amount, paid_amount, payment_method, notes, items } = req.body;
        const order_code = 'DH-' + Math.floor(Date.now() / 1000).toString();
        const finalTotal = parseFloat(total_amount) || 0;
        const finalPaid = paid_amount !== undefined ? parseFloat(paid_amount) : finalTotal;
        const finalPaymentMethod = payment_method || 'TIEN_MAT';
        const finalNotes = notes || '';

        const orderRes = await client.query(
            "INSERT INTO orders (order_code, customer_id, customer_name, total_amount, paid_amount, payment_method, notes, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', NOW()) RETURNING id",
            [order_code, customer_id || null, customer_name || 'Khách Lẻ', finalTotal, finalPaid, finalPaymentMethod, finalNotes]
        );
        const orderId = orderRes.rows[0].id;
        
        // TRỪ KHO NGAY KHI TẠO ĐƠN & GHI ĐÚNG CỘT QUANTITY
        if (items && Array.isArray(items)) {
            for (let item of items) {
                const qty = parseFloat(item.quantity) || 1;
                const price = parseFloat(item.price) || 0;
                const itemTotal = qty * price;
                await client.query(
                    "INSERT INTO order_items (order_id, product_id, quantity, price, total) VALUES ($1, $2, $3, $4, $5)", 
                    [orderId, item.product_id, qty, price, itemTotal]
                );
                await client.query("UPDATE products SET stock_qty = GREATEST(0, stock_qty - $1) WHERE id = $2", [qty, item.product_id]);
            }
        }
        await client.query('COMMIT');
        res.json({ success: true, orderId, order_code });
    } catch (err) { 
        await client.query('ROLLBACK'); 
        res.status(500).json({ success: false, error: err.message }); 
    } finally { client.release(); }
});

// PUT: CẬP NHẬT CHI TIẾT ĐƠN HÀNG
router.put('/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { delivery_company, driver_name, license_plate, notes, paid_amount, status, payment_method, items, cancel_reason, refund_amount } = req.body;
        
        const oldOrder = await client.query('SELECT status, paid_amount, customer_id FROM orders WHERE id=$1', [req.params.id]);
        if (oldOrder.rows.length === 0) throw new Error('Không tìm thấy đơn hàng');
        const oldStatus = oldOrder.rows[0].status;
        const custId = oldOrder.rows[0].customer_id;

        let newTotalAmount = 0;
        if (items && items.length > 0) {
            // Lấy tên khách hàng từ đơn hiện tại để gán cho bảo hành
            const custNameRes = await client.query('SELECT customer_name FROM orders WHERE id=$1', [req.params.id]);
            const warrantyCustomer = custNameRes.rows[0]?.customer_name || 'Khách Lẻ';

            for(let i of items) {
                const itemTotal = i.quantity * i.price;
                newTotalAmount += itemTotal;
                // CẬP NHẬT VÀO CỘT QUANTITY (Loại bỏ qty)
                await client.query(
                    "UPDATE order_items SET quantity=$1, price=$2, total=$3, serial_number=$4 WHERE id=$5", 
                    [i.quantity, i.price, itemTotal, i.serial_number || '', i.id]
                );

                // [THÊM MỚI] Tự động kích hoạt bảo hành
                if (i.serial_number && i.serial_number.trim() !== '') {
                    await client.query(`
                        INSERT INTO warranties (serial_number, sku, customer_name, warranty_months, activated_at) 
                        VALUES (
                            $1, 
                            (SELECT sku FROM products WHERE id = $2), 
                            $3, 
                            120, 
                            CURRENT_TIMESTAMP
                        )
                        ON CONFLICT (serial_number) DO NOTHING
                    `, [i.serial_number.trim(), i.product_id, warrantyCustomer]);
                }
            }
        }

        // KỊCH BẢN HỦY ĐƠN: CỘNG LẠI TỒN KHO THỰC TẾ
        let finalNotes = notes || '';
        if (oldStatus !== 'CANCELLED' && status === 'CANCELLED') {
            if (items && items.length > 0) {
                for(let i of items) {
                    await client.query("UPDATE products SET stock_qty = stock_qty + $1 WHERE id = $2", [i.quantity, i.product_id]);
                }
            }
            finalNotes = `[HỆ THỐNG]: Đã hoàn lại tồn kho. Lý do hủy: ${cancel_reason || 'Không có'}. Hoàn tiền khách: ${refund_amount || 0}đ.\n` + finalNotes;
        }

        await client.query(
            "UPDATE orders SET delivery_company=$1, driver_name=$2, license_plate=$3, notes=$4, paid_amount=$5, status=$6, payment_method=$7, total_amount=$8 WHERE id=$9",
            [delivery_company, driver_name, license_plate, finalNotes, paid_amount, status, payment_method, newTotalAmount, req.params.id]
        );
        
        // --- BẮT ĐẦU: ĐỒNG BỘ CÔNG NỢ & DOANH SỐ VỀ CRM ---
        if (custId) {
            await client.query(`
                UPDATE customers 
                SET 
                    current_debt = (SELECT COALESCE(SUM(total_amount - paid_amount), 0) FROM orders WHERE customer_id = $1 AND status NOT IN ('CANCELLED', 'RETURNED')),
                    total_sales = (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE customer_id = $1 AND status NOT IN ('CANCELLED', 'RETURNED'))
                WHERE id = $1
            `, [custId]);
        }
        // --- KẾT THÚC: ĐỒNG BỘ ---

        await client.query('COMMIT');
        res.json({ success: true });
    } catch(e) { 
        await client.query('ROLLBACK'); 
        res.status(500).json({ success: false, error: e.message }); 
    } finally { client.release(); }
});

// API ĐỔI TRẠNG THÁI NHANH (MỚI THÊM)
router.put('/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        
        // 1. Cập nhật trạng thái đơn hàng
        await pool.query("UPDATE orders SET status = $1 WHERE id = $2", [status, req.params.id]);
        
        // 2. Lấy customer_id để đồng bộ
        const orderInfo = await pool.query("SELECT customer_id FROM orders WHERE id = $1", [req.params.id]);
        const custId = orderInfo.rows[0] ? orderInfo.rows[0].customer_id : null;
        
        // 3. Đồng bộ Công Nợ & Doanh Số về bảng customers
        if (custId) {
            await pool.query(`
                UPDATE customers 
                SET 
                    current_debt = (SELECT COALESCE(SUM(total_amount - paid_amount), 0) FROM orders WHERE customer_id = $1 AND status NOT IN ('CANCELLED', 'RETURNED')),
                    total_sales = (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE customer_id = $1 AND status NOT IN ('CANCELLED', 'RETURNED'))
                WHERE id = $1
            `, [custId]);
        }
        
        res.json({ success: true });
    } catch(e) { 
        res.status(500).json({ success: false, error: e.message }); 
    }
});

// API TẢI TÀI LIỆU
router.post('/:id/docs', async (req, res) => { 
    try {
        const { file_name, file_data } = req.body;
        await pool.query("INSERT INTO order_docs (order_id, doc_type, file_url) VALUES ($1, $2, $3)", [req.params.id, file_name, file_data]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/:id/docs/:docId', async (req, res) => {
    try {
        await pool.query("DELETE FROM order_docs WHERE id = $1 AND order_id = $2", [req.params.docId, req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ===================================
// API TRẢ HÀNG VÀ KIỂM ĐỊNH KHO QC
// ===================================
router.post('/:id/return', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { reason, deduction_fee, refund_amount, return_items } = req.body;
        
        const orderRes = await client.query('SELECT order_code, customer_name FROM orders WHERE id = $1', [req.params.id]);
        const o = orderRes.rows[0];

        const retRes = await client.query(
            "INSERT INTO return_orders (order_id, order_code, customer_name, reason, deduction_fee, refund_amount, status) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING_QC') RETURNING id",
            [req.params.id, o.order_code, o.customer_name, reason, deduction_fee, refund_amount]
        );
        const returnId = retRes.rows[0].id;

        for (let item of return_items) {
            if(item.return_qty > 0) {
                await client.query(
                    "INSERT INTO return_items (return_id, product_id, product_name, return_qty, price) VALUES ($1, $2, $3, $4, $5)",
                    [returnId, item.product_id, item.product_name, item.return_qty, item.price]
                );
            }
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch(e) { await client.query('ROLLBACK'); res.status(500).json({ success: false, error: e.message }); } finally { client.release(); }
});

router.get('/returns/list', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM return_orders ORDER BY id DESC");
        const returns = result.rows;
        if (returns.length > 0) {
            const retIds = returns.map(r => r.id);
            const itemsRes = await pool.query("SELECT * FROM return_items WHERE return_id = ANY($1)", [retIds]);
            returns.forEach(r => { r.items = itemsRes.rows.filter(i => i.return_id === r.id); });
        }
        res.json({ success: true, data: returns });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/returns/:id/process', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { qc_items } = req.body;
        
        for (let item of qc_items) {
            if (item.good_qty > 0) {
                await client.query("UPDATE products SET stock_qty = stock_qty + $1 WHERE id = $2", [item.good_qty, item.product_id]);
            }
            if (item.defect_qty > 0) {
                await client.query("UPDATE products SET defective_qty = defective_qty + $1 WHERE id = $2", [item.defect_qty, item.product_id]);
            }
        }
        
        await client.query("UPDATE return_orders SET status = 'COMPLETED' WHERE id = $1", [req.params.id]);
        await client.query('COMMIT');
        res.json({ success: true });
    } catch(e) { await client.query('ROLLBACK'); res.status(500).json({ success: false, error: e.message }); } finally { client.release(); }
});

// API DÀNH RIÊNG CHO KHO: Cập nhật vận chuyển & Serial (Bảo toàn tuyệt đối Giá tiền)
router.put('/:id/wms-out', async (req, res) => {
    const client = await pool.connect();
    const fs = require('fs');
    const path = require('path');
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const { delivery_company, driver_name, license_plate, notes, status, items, delivery_proofs } = req.body;

        // Xử lý Upload Ảnh Giao Hàng
        let proofUrls = [];
        if (delivery_proofs && Array.isArray(delivery_proofs)) {
            const uploadDir = path.join(__dirname, '../public/uploads/proofs');
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
            
            for (let i = 0; i < delivery_proofs.length; i++) {
                const proof = delivery_proofs[i];
                if (proof.startsWith('data:image')) {
                    const base64Data = proof.replace(/^data:image\/\w+;base64,/, '');
                    const fileName = 'proof_' + id + '_' + Date.now() + '_' + i + '.jpg';
                    fs.writeFileSync(path.join(uploadDir, fileName), base64Data, 'base64');
                    proofUrls.push('/uploads/proofs/' + fileName);
                } else {
                    proofUrls.push(proof); // Ảnh cũ đã có URL
                }
            }
        }
        const proofsJson = JSON.stringify(proofUrls);

        // Update thông tin (TUYỆT ĐỐI KHÔNG CHẠM VÀO GIÁ TIỀN)
        await client.query(`
            UPDATE orders 
            SET delivery_company = COALESCE($1, delivery_company),
                driver_name = COALESCE($2, driver_name),
                license_plate = COALESCE($3, license_plate),
                notes = COALESCE($4, notes),
                status = COALESCE($5, status),
                delivery_proofs = $6
            WHERE id = $7
        `, [delivery_company, driver_name, license_plate, notes, status, proofsJson, id]);

        // Lấy tên khách hàng trước khi chạy vòng lặp
        const custNameRes = await client.query('SELECT customer_name FROM orders WHERE id=$1', [id]);
        const warrantyCustomer = custNameRes.rows[0]?.customer_name || 'Khách Lẻ';

        // Update Serial
        if (items && items.length > 0) {
            for (let i of items) {
                await client.query("UPDATE order_items SET serial_number = $1 WHERE product_id = $2 AND order_id = $3", 
                [i.serial_number || '', i.product_id, id]);

                // [THÊM MỚI] Tự động kích hoạt bảo hành
                if (i.serial_number && i.serial_number.trim() !== '') {
                    await client.query(`
                        INSERT INTO warranties (serial_number, sku, customer_name, warranty_months, activated_at) 
                        VALUES (
                            $1, 
                            (SELECT sku FROM products WHERE id = $2), 
                            $3, 
                            120, 
                            CURRENT_TIMESTAMP
                        )
                        ON CONFLICT (serial_number) DO NOTHING
                    `, [i.serial_number.trim(), i.product_id, warrantyCustomer]);
                }
            }
        }
        await client.query('COMMIT');
        res.json({ success: true, proofUrls });
    } catch(e) { 
        await client.query('ROLLBACK'); 
        res.status(500).json({ success: false, error: e.message }); 
    } finally { client.release(); }
});

// TỰ ĐỘNG DỌN DẸP ĐƠN CHỜ XÁC NHẬN QUÁ 30 NGÀY (AUTO-CLEANUP)
(async () => {
    try {
        await pool.query("DELETE FROM orders WHERE status = 'PENDING' AND created_at < NOW() - INTERVAL '30 days'");
        console.log("[Auto-Cleanup] Đã dọn dẹp các đơn PENDING quá hạn 30 ngày lúc Server khởi động.");
    } catch(e) {}
})();
setInterval(async () => {
    try {
        await pool.query("DELETE FROM orders WHERE status = 'PENDING' AND created_at < NOW() - INTERVAL '30 days'");
    } catch(e) {}
}, 60 * 60 * 1000); // Rà soát đều đặn mỗi tiếng một lần

// [BẢO MẬT KÉP] XÓA ĐƠN HÀNG VĨNH VIỄN
router.delete('/:id/force', async (req, res) => {
    try {
        const orderId = req.params.id;
        const orderRes = await pool.query('SELECT status FROM orders WHERE id = $1', [orderId]);
        if (orderRes.rows.length === 0) return res.json({ success: false, error: 'Không tìm thấy đơn hàng!' });
        
        const status = orderRes.rows[0].status;
        const { password } = req.body;
        const ADMIN_PASSWORD = 'sungo123'; 

        // NẾU ĐƠN KHÔNG PHẢI "CHỜ XÁC NHẬN" -> ADMIN MỚI CÓ QUYỀN TRẢM
        if (status !== 'PENDING' && status !== 'NEW') {
            if (password !== ADMIN_PASSWORD) {
                return res.status(403).json({ success: false, error: 'Đơn đã xử lý hoặc đã hủy/trả! Cần Mật khẩu Admin để tiêu hủy.' });
            }
            
            // Phục hồi Tồn kho (Nếu đơn hàng đang ở trạng thái đã trừ kho)
            if (['PACKED', 'SHIPPING_CMD', 'SHIPPED', 'COMPLETED'].includes(status)) {
                const itemsRes = await pool.query('SELECT product_id, quantity FROM order_items WHERE order_id = $1', [orderId]);
                for (let item of itemsRes.rows) {
                    if (item.product_id) {
                        await pool.query('UPDATE products SET stock_qty = stock_qty + $1 WHERE id = $2', [item.quantity, item.product_id]);
                    }
                }
            }
        }

        // Tiêu hủy sạch sẽ toàn bộ chứng cứ
        await pool.query('DELETE FROM order_docs WHERE order_id = $1', [orderId]);
        await pool.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);
        await pool.query('DELETE FROM order_timeline WHERE order_id = $1', [orderId]);
        await pool.query('DELETE FROM orders WHERE id = $1', [orderId]);

        res.json({ success: true, message: 'Đã xóa sạch sẽ!' });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});
// API UPLOAD CHỨNG TỪ (Đã cấu hình tự động tạo nơi lưu file)
router.post('/:id/docs', (req, res) => {
    try {
        const id = req.params.id; // Lấy ID đơn hàng
        const payload = req.body;

        if (!payload.file_data) {
            return res.status(400).json({success: false, error: 'Thiếu file data'});
        }

        const fs = require('fs');
        const path = require('path');
        
        // 1. CHỈ ĐỊNH NƠI LƯU FILE (Tự động tạo thư mục nếu chưa có)
        const uploadDir = path.join(__dirname, '../public/uploads/proofs');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        // 2. Giải mã file Base64
        const matches = payload.file_data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches) return res.status(400).json({success: false, error: 'File sai định dạng'});

        const buffer = Buffer.from(matches[2], 'base64');
        const ext = payload.file_name.toLowerCase().includes('pdf') ? '.pdf' : '.jpg';
        const fileName = 'proof_' + id + '_' + Date.now() + ext;
        const uploadPath = path.join(uploadDir, fileName);

        // 3. Ghi file thẳng vào ổ cứng
        fs.writeFileSync(uploadPath, buffer);
        const fileUrl = '/uploads/proofs/' + fileName;

        // 4. Lưu đường dẫn vào Database
        const dbFile = path.join(__dirname, '../data/orders.json');
        if (fs.existsSync(dbFile)) {
            let data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
            const idx = data.findIndex(x => x.id == id);
            if (idx !== -1) {
                if(!data[idx].docs) data[idx].docs = [];
                data[idx].docs.push({ id: Date.now(), doc_type: payload.file_name, file_url: fileUrl });
                fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
                return res.json({success: true, file_url: fileUrl});
            }
        }
        res.status(404).json({success: false, error: 'Không tìm thấy đơn hàng trong Database'});
    } catch(e) { 
        console.error("LỖI UPLOAD:", e);
        res.status(500).json({success: false, error: e.message}); 
    }
});

// API XÓA FILE CHỨNG TỪ
router.delete('/:id/docs/:docId', (req, res) => {
    try {
        const id = req.params.id;
        const docId = parseInt(req.params.docId);
        const fs = require('fs');
        const path = require('path');
        const dbFile = path.join(__dirname, '../data/orders.json');
        
        if (fs.existsSync(dbFile)) {
            let data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
            const idx = data.findIndex(x => x.id == id);
            if (idx !== -1 && data[idx].docs) {
                data[idx].docs = data[idx].docs.filter(d => d.id !== docId);
                fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
                return res.json({success: true});
            }
        }
        res.status(404).json({success: false});
    } catch(e) { res.status(500).json({success: false}); }
});

// [POST] ĐÍNH KÈM FILE VÀO ĐƠN HÀNG (Bổ sung file, không ghi đè toàn bộ đơn)
router.post('/:id/attach-file', async (req, res) => {
    try {
        const orderId = req.params.id;
        const { fileUrl } = req.body;
        
        const getOrder = await pool.query('SELECT attached_files FROM orders WHERE id = $1', [orderId]);
        if (getOrder.rows.length === 0) return res.json({ success: false, error: 'Không tìm thấy đơn hàng' });
        
        let files = [];
        const dbFiles = getOrder.rows[0].attached_files;
        if (typeof dbFiles === 'string') {
            try { files = JSON.parse(dbFiles); } catch(e) {}
        } else if (Array.isArray(dbFiles)) {
            files = dbFiles;
        }
        
        files.push(fileUrl);
        await pool.query('UPDATE orders SET attached_files = $1 WHERE id = $2', [JSON.stringify(files), orderId]);
        
        res.json({ success: true, files: files });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

module.exports = router;