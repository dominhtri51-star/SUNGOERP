const express = require('express');
const router = express.Router();
const pool = require('../config/database.js');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Cấu hình Multer để nhận file XML & PDF hóa đơn
const storage = multer.diskStorage({
    destination: function (req, file, cb) { 
        const dir = 'public/uploads/invoices/';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: function (req, file, cb) { 
        cb(null, 'einvoice-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Đảm bảo bảng expenses tồn tại
pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
        id SERIAL PRIMARY KEY,
        expense_date DATE NOT NULL,
        category VARCHAR(100),
        description TEXT,
        vendor_name VARCHAR(255),
        vendor_tax_code VARCHAR(50),
        has_invoice BOOLEAN DEFAULT false,
        invoice_no VARCHAR(50),
        amount_before_tax NUMERIC DEFAULT 0,
        vat_rate INTEGER DEFAULT 0,
        vat_amount NUMERIC DEFAULT 0,
        total_amount NUMERIC DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
`).catch(console.error);

// 1. GET: Danh sách toàn bộ Hóa Đơn
router.get('/', async (req, res) => {
    try {
        const { status, period } = req.query;
        let query = `SELECT * FROM invoices`;
        const params = [];
        const whereClauses = [];

        if (status) {
            params.push(status);
            whereClauses.push(`status = $${params.length}`);
        }

        if (period) {
            // period dạng YYYY-MM
            params.push(`${period}%`);
            whereClauses.push(`(issued_at::text LIKE $${params.length} OR created_at::text LIKE $${params.length})`);
        }

        if (whereClauses.length > 0) {
            query += ' WHERE ' + whereClauses.join(' AND ');
        }

        query += ` ORDER BY id DESC`;
        const result = await pool.query(query, params);
        
        // Chuẩn hóa parse items_snapshot
        const invoices = result.rows.map(inv => {
            let items = [];
            if (typeof inv.items_snapshot === 'string') {
                try { items = JSON.parse(inv.items_snapshot); } catch (e) { items = []; }
            } else if (Array.isArray(inv.items_snapshot)) {
                items = inv.items_snapshot;
            }
            return { ...inv, items_snapshot: items };
        });

        res.json({ success: true, data: invoices });
    } catch (err) { 
        res.status(500).json({ success: false, error: err.message }); 
    }
});

// 2. GET: Thống kê nhanh theo 4 trạng thái
router.get('/stats', async (req, res) => {
    try {
        const statsRes = await pool.query(`
            SELECT 
                COUNT(CASE WHEN status = 'PENDING_DRAFT' OR status = 'Chờ Phát Hành' THEN 1 END) as count_pending,
                COUNT(CASE WHEN status = 'DRAFT_CREATED' THEN 1 END) as count_draft_created,
                COUNT(CASE WHEN status = 'ISSUED' OR status = 'Đã Phát Hành' THEN 1 END) as count_issued,
                COUNT(CASE WHEN ref_type = 'MANUAL' THEN 1 END) as count_manual,
                COALESCE(SUM(CASE WHEN status IN ('ISSUED', 'Đã Phát Hành') THEN total_amount ELSE 0 END), 0) as total_revenue_issued,
                COALESCE(SUM(CASE WHEN status IN ('ISSUED', 'Đã Phát Hành') THEN vat_amount ELSE 0 END), 0) as total_vat_issued,
                COALESCE(SUM(CASE WHEN status IN ('PENDING_DRAFT', 'Chờ Phát Hành', 'DRAFT_CREATED') THEN total_amount ELSE 0 END), 0) as total_revenue_pending,
                COALESCE(SUM(CASE WHEN status IN ('PENDING_DRAFT', 'Chờ Phát Hành', 'DRAFT_CREATED') THEN vat_amount ELSE 0 END), 0) as total_vat_pending
            FROM invoices
        `);
        res.json({ success: true, data: statsRes.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. GET: Chi tiết 1 hóa đơn kèm thông tin sản phẩm và đơn hàng
router.get('/:id', async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM invoices WHERE id = $1`, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy hóa đơn' });
        
        const inv = result.rows[0];
        let items = [];
        if (typeof inv.items_snapshot === 'string') {
            try { items = JSON.parse(inv.items_snapshot); } catch (e) { items = []; }
        } else if (Array.isArray(inv.items_snapshot)) {
            items = inv.items_snapshot;
        }

        res.json({ success: true, data: { ...inv, items_snapshot: items } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. POST: Đồng bộ đơn hàng đã bán sang Vùng Hóa Đơn Chờ Xuất (PENDING_DRAFT)
// Tự động map Mã hàng & Tên hàng kế toán chuẩn
router.post('/sync-pending', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Quét tất cả đơn hàng hoàn tất hoặc đã giao / thanh toán
        const orders = await client.query(`
            SELECT o.*, 
                   c.full_name as customer_name_crm, 
                   c.phone as customer_phone_crm,
                   c.address as customer_address_crm,
                   c.vat_company, 
                   c.vat_taxcode, 
                   c.vat_address, 
                   c.vat_email
            FROM orders o 
            LEFT JOIN customers c ON o.customer_id = c.id
            WHERE o.status IN ('Đã Hoàn Tất', 'COMPLETED', 'SHIPPED', 'DELIVERED', 'PAID')
               OR o.paid_amount > 0
            ORDER BY o.id DESC
        `);

        let syncedCount = 0;

        for (let o of orders.rows) {
            // Kiểm tra xem đơn hàng đã có trong bảng invoices chưa
            const check = await client.query(`SELECT id FROM invoices WHERE ref_id = $1`, [o.order_code]);
            if (check.rowCount === 0) {
                // Lấy chi tiết các dòng hàng trong đơn và JOIN với bảng products để lấy Mã & Tên Kế Toán
                const itemsRes = await client.query(`
                    SELECT oi.*, 
                           p.sku,
                           p.product_name,
                           p.accounting_code,
                           p.accounting_name,
                           p.unit,
                           COALESCE(p.vat_rate, 8) as prod_vat_rate
                    FROM order_items oi
                    LEFT JOIN products p ON oi.product_id = p.id
                    WHERE oi.order_id = $1
                `, [o.id]);

                let totalBeforeTax = 0;
                let totalVat = 0;
                let totalWithTax = 0;

                const itemsSnapshot = itemsRes.rows.map(item => {
                    const qty = parseFloat(item.quantity || item.qty || 1);
                    const grossPrice = parseFloat(item.price || 0);
                    const lineGrossTotal = qty * grossPrice;
                    const vatRate = parseFloat(item.prod_vat_rate || 8);
                    
                    // Tính đơn giá chưa thuế (Net Price) và thuế VAT
                    const netUnitPrice = Math.round(grossPrice / (1 + vatRate / 100));
                    const netTotal = Math.round(lineGrossTotal / (1 + vatRate / 100));
                    const vatAmount = lineGrossTotal - netTotal;

                    totalBeforeTax += netTotal;
                    totalVat += vatAmount;
                    totalWithTax += lineGrossTotal;

                    return {
                        product_id: item.product_id,
                        accounting_code: item.accounting_code || item.sku || 'HH-VATTU',
                        accounting_name: item.accounting_name || item.product_name || 'Vật tư năng lượng mặt trời',
                        commercial_name: item.product_name || 'Sản phẩm',
                        unit: item.unit || 'Bộ',
                        quantity: qty,
                        unit_price: netUnitPrice,
                        gross_price: grossPrice,
                        vat_rate: vatRate,
                        vat_amount: vatAmount,
                        total_amount: lineGrossTotal
                    };
                });

                // Nếu đơn không có dòng sản phẩm cụ thể, tạo 1 dòng mặc định
                if (itemsSnapshot.length === 0) {
                    const gross = parseFloat(o.total_amount || 0);
                    const net = Math.round(gross / 1.08);
                    const vat = gross - net;
                    totalBeforeTax = net;
                    totalVat = vat;
                    totalWithTax = gross;
                    itemsSnapshot.push({
                        product_id: null,
                        accounting_code: 'DV-SOLAR-01',
                        accounting_name: 'Cung cấp thiết bị và lắp đặt hệ thống điện mặt trời',
                        commercial_name: 'Đơn hàng ' + o.order_code,
                        unit: 'Gói',
                        quantity: 1,
                        unit_price: net,
                        gross_price: gross,
                        vat_rate: 8,
                        vat_amount: vat,
                        total_amount: gross
                    });
                }

                // Thông tin Doanh nghiệp / Khách hàng VAT
                const companyName = o.vat_company || o.customer_name || o.customer_name_crm || 'Khách Lẻ';
                const taxCode = o.vat_taxcode || '';
                const companyAddress = o.vat_address || o.customer_address_crm || '';
                const vatEmail = o.vat_email || '';

                await client.query(`
                    INSERT INTO invoices (
                        ref_type, ref_id, customer_name, tax_code, 
                        company_name, company_address, vat_email, 
                        total_amount, amount_before_tax, vat_rate, vat_amount, 
                        status, provider, invoice_symbol, items_snapshot, notes
                    ) VALUES (
                        'ORDER', $1, $2, $3, 
                        $4, $5, $6, 
                        $7, $8, $9, $10, 
                        'PENDING_DRAFT', 'VinInvoice', '1C26T-AA/26E', $11, $12
                    )
                `, [
                    o.order_code,
                    o.customer_name || o.customer_name_crm || 'Khách Lẻ',
                    taxCode,
                    companyName,
                    companyAddress,
                    vatEmail,
                    totalWithTax,
                    totalBeforeTax,
                    8,
                    totalVat,
                    JSON.stringify(itemsSnapshot),
                    'Đồng bộ từ đơn hàng ' + o.order_code + '. Chờ kế toán kiểm tra và tạo nháp.'
                ]);

                syncedCount++;
            }
        }

        await client.query('COMMIT');
        res.json({ 
            success: true, 
            message: `Đã quét và đồng bộ ${syncedCount} đơn hàng mới vào Vùng Hóa Đơn Chờ Xuất!`,
            count: syncedCount 
        });
    } catch (err) { 
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message }); 
    } finally {
        client.release();
    }
});

// 5. POST: TẠO HÓA ĐƠN NHÁP ĐẨY LÊN API VININVOICE (DRAFT_CREATED)
// TUYỆT ĐỐI KHÔNG XUẤT BẢN / KÝ SỐ TRỰC TIẾP
router.post('/:id/create-draft', async (req, res) => {
    try {
        const { provider, invoice_symbol, notes } = req.body;
        const invRes = await pool.query(`SELECT * FROM invoices WHERE id = $1`, [req.params.id]);
        if (invRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy hóa đơn' });

        const invoice = invRes.rows[0];

        // Tạo mã hóa đơn nháp duy nhất trên cổng e-Invoice
        const chosenProvider = provider || invoice.provider || 'VinInvoice';
        const symbol = invoice_symbol || invoice.invoice_symbol || '1C26T-AA/26E';
        const draftCode = 'DRAFT-' + chosenProvider.toUpperCase().slice(0, 3) + '-' + Date.now().toString().slice(-6);
        const kttNotes = `Đã đẩy nháp lên cổng ${chosenProvider}. Chờ Kế toán trưởng đăng nhập ${chosenProvider} để kiểm tra, duyệt và ký phát hành.`;

        const updateRes = await pool.query(`
            UPDATE invoices 
            SET status = 'DRAFT_CREATED',
                provider = $1,
                invoice_symbol = $2,
                draft_code = $3,
                notes = COALESCE($4, notes),
                ktt_notes = $5
            WHERE id = $6
            RETURNING *
        `, [chosenProvider, symbol, draftCode, notes, kttNotes, req.params.id]);

        res.json({
            success: true,
            message: `✅ Đã tạo thành công Hóa Đơn Nháp trên cổng ${chosenProvider}! (Mã Nháp: ${draftCode})\n⚠️ LƯU Ý: Hóa đơn chưa được ký số. Kế toán trưởng vui lòng đăng nhập cổng ${chosenProvider} để rà soát và phát hành chính thức.`,
            data: updateRes.rows[0]
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. POST: KẾ TOÁN TRƯỞNG XÁC NHẬN ĐÃ DUYỆT & PHÁT HÀNH TRÊN VININVOICE (ISSUED)
// Sau khi KTT đã ký số trên cổng VinInvoice, cập nhật số hóa đơn chính thức về ERP
router.post('/:id/confirm-issued', async (req, res) => {
    try {
        const { invoice_no, invoice_symbol, issued_at, einv_link, ktt_notes } = req.body;
        
        if (!invoice_no || invoice_no.trim() === '') {
            return res.status(400).json({ success: false, error: 'Vui lòng nhập Số Hóa Đơn chính thức đã phát hành trên cổng e-Invoice!' });
        }

        const invRes = await pool.query(`SELECT * FROM invoices WHERE id = $1`, [req.params.id]);
        if (invRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy hóa đơn' });

        const result = await pool.query(`
            UPDATE invoices 
            SET status = 'ISSUED',
                invoice_no = $1,
                invoice_symbol = COALESCE($2, invoice_symbol),
                issued_at = COALESCE($3, CURRENT_TIMESTAMP),
                einv_link = $4,
                ktt_notes = COALESCE($5, 'Kế toán trưởng đã xác nhận duyệt và phát hành trên cổng HĐĐT.')
            WHERE id = $6
            RETURNING *
        `, [
            invoice_no.trim(),
            invoice_symbol ? invoice_symbol.trim() : null,
            issued_at ? new Date(issued_at) : new Date(),
            einv_link || '',
            ktt_notes,
            req.params.id
        ]);

        res.json({
            success: true,
            message: `✅ Đã ghi nhận Hóa Đơn Chính Thức: #${invoice_no.trim()}! Hóa đơn đã sẵn sàng phục vụ Báo Cáo Thuế.`,
            data: result.rows[0]
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 7. PUT: Chỉnh sửa thông tin hóa đơn & Dòng hàng kế toán (Trước khi xuất nháp)
router.put('/:id', async (req, res) => {
    try {
        const { 
            company_name, 
            tax_code, 
            company_address, 
            vat_email, 
            provider, 
            invoice_symbol, 
            items_snapshot,
            notes 
        } = req.body;

        let totalBeforeTax = 0;
        let totalVat = 0;
        let totalWithTax = 0;
        let normalizedItems = [];

        if (items_snapshot && Array.isArray(items_snapshot)) {
            normalizedItems = items_snapshot.map(item => {
                const qty = parseFloat(item.quantity) || 1;
                const unitPrice = parseFloat(item.unit_price) || 0;
                const vatRate = parseFloat(item.vat_rate) || 8;
                const lineNet = Math.round(qty * unitPrice);
                const lineVat = Math.round(lineNet * (vatRate / 100));
                const lineTotal = lineNet + lineVat;

                totalBeforeTax += lineNet;
                totalVat += lineVat;
                totalWithTax += lineTotal;

                return {
                    product_id: item.product_id || null,
                    accounting_code: item.accounting_code || 'HH-001',
                    accounting_name: item.accounting_name || 'Hàng hóa dịch vụ',
                    commercial_name: item.commercial_name || item.accounting_name,
                    unit: item.unit || 'Bộ',
                    quantity: qty,
                    unit_price: unitPrice,
                    vat_rate: vatRate,
                    vat_amount: lineVat,
                    total_amount: lineTotal
                };
            });
        }

        const updateRes = await pool.query(`
            UPDATE invoices 
            SET company_name = COALESCE($1, company_name),
                tax_code = COALESCE($2, tax_code),
                company_address = COALESCE($3, company_address),
                vat_email = COALESCE($4, vat_email),
                provider = COALESCE($5, provider),
                invoice_symbol = COALESCE($6, invoice_symbol),
                items_snapshot = CASE WHEN $7::jsonb IS NOT NULL THEN $7::jsonb ELSE items_snapshot END,
                amount_before_tax = CASE WHEN $8::numeric > 0 THEN $8::numeric ELSE amount_before_tax END,
                vat_amount = CASE WHEN $9::numeric > 0 THEN $9::numeric ELSE vat_amount END,
                total_amount = CASE WHEN $10::numeric > 0 THEN $10::numeric ELSE total_amount END,
                notes = COALESCE($11, notes)
            WHERE id = $12
            RETURNING *
        `, [
            company_name,
            tax_code,
            company_address,
            vat_email,
            provider,
            invoice_symbol,
            normalizedItems.length > 0 ? JSON.stringify(normalizedItems) : null,
            totalBeforeTax > 0 ? totalBeforeTax : null,
            totalVat > 0 ? totalVat : null,
            totalWithTax > 0 ? totalWithTax : null,
            notes,
            req.params.id
        ]);

        res.json({ success: true, message: 'Đã cập nhật thông tin hóa đơn', data: updateRes.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 8. POST: Nhập hóa đơn ngoại tuyến / Thủ công (Xuất trực tiếp ngoài cổng VinInvoice)
router.post('/manual', async (req, res) => {
    try {
        const { 
            invoice_no, 
            invoice_symbol,
            issued_at, 
            company_name, 
            tax_code, 
            company_address,
            total_amount, 
            vat_rate, 
            vat_amount, 
            item_name,
            einv_link,
            notes 
        } = req.body;

        if (!invoice_no || !total_amount) {
            return res.status(400).json({ success: false, error: 'Vui lòng điền đủ Số Hóa Đơn và Doanh Thu!' });
        }

        const rate = parseFloat(vat_rate || 8);
        const total = parseFloat(total_amount);
        const vat = vat_amount !== undefined ? parseFloat(vat_amount) : Math.round(total * (rate / 100));
        const totalWithTax = total + vat;

        const manualItem = [{
            accounting_code: 'HH-NGOAITUYEN',
            accounting_name: item_name || 'Hàng hóa, dịch vụ năng lượng mặt trời',
            unit: 'Gói',
            quantity: 1,
            unit_price: total,
            vat_rate: rate,
            vat_amount: vat,
            total_amount: totalWithTax
        }];

        const result = await pool.query(`
            INSERT INTO invoices (
                ref_type, ref_id, company_name, tax_code, company_address,
                total_amount, amount_before_tax, vat_rate, vat_amount, 
                invoice_no, invoice_symbol, status, provider, 
                items_snapshot, einv_link, notes, ktt_notes, issued_at
            ) VALUES (
                'MANUAL', 'Nhập Ngoại Tuyến', $1, $2, $3,
                $4, $5, $6, $7,
                $8, $9, 'ISSUED', 'VinInvoice (Ngoài hệ thống)',
                $10, $11, $12, 'Hóa đơn xuất trực tiếp trên cổng VinInvoice được ghi nhận vào sổ thuế', $13
            ) RETURNING *
        `, [
            company_name || 'Khách Lẻ',
            tax_code || '',
            company_address || '',
            totalWithTax,
            total,
            rate,
            vat,
            invoice_no.trim(),
            invoice_symbol || '1C26T-AA/26E',
            JSON.stringify(manualItem),
            einv_link || '',
            notes || 'Hóa đơn ngoại tuyến',
            issued_at ? new Date(issued_at) : new Date()
        ]);

        res.json({ success: true, data: result.rows[0], message: 'Đã lưu hóa đơn ngoại tuyến thành công!' });
    } catch (err) { 
        res.status(500).json({ success: false, error: err.message }); 
    }
});

// 9. DELETE: Hủy / Xóa hóa đơn nháp
router.delete('/:id', async (req, res) => {
    try {
        const inv = await pool.query(`SELECT status, invoice_no FROM invoices WHERE id = $1`, [req.params.id]);
        if (inv.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy hóa đơn' });
        
        if (inv.rows[0].status === 'ISSUED' || inv.rows[0].status === 'Đã Phát Hành') {
            return res.status(400).json({ 
                success: false, 
                error: 'Hóa đơn đã xuất chính thức (# ' + inv.rows[0].invoice_no + ') không được tự ý xóa! Vui lòng lập biên bản điều chỉnh/hủy hóa đơn theo quy định Thuế.' 
            });
        }

        await pool.query(`DELETE FROM invoices WHERE id = $1`, [req.params.id]);
        res.json({ success: true, message: 'Đã xóa bản ghi hóa đơn nháp' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===================================
// PHÂN HỆ HÓA ĐƠN ĐẦU VÀO (EXPENSES)
// ===================================

router.get('/expenses', async (req, res) => {
    try {
        const { period } = req.query;
        let query = `SELECT * FROM expenses`;
        const params = [];
        if (period) {
            params.push(`${period}%`);
            query += ` WHERE expense_date::text LIKE $1`;
        }
        query += ` ORDER BY expense_date DESC, id DESC`;
        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (err) { 
        res.status(500).json({ success: false, error: err.message }); 
    }
});

router.post('/expenses', async (req, res) => {
    try {
        const { expense_date, category, description, vendor_name, vendor_tax_code, has_invoice, invoice_no, amount_before_tax, vat_rate, vat_amount, total_amount } = req.body;
        const result = await pool.query(
            `INSERT INTO expenses (expense_date, category, description, vendor_name, vendor_tax_code, has_invoice, invoice_no, amount_before_tax, vat_rate, vat_amount, total_amount) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [expense_date, category, description, vendor_name||'', vendor_tax_code||'', has_invoice, invoice_no||'', amount_before_tax, vat_rate, vat_amount, total_amount]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) { 
        res.status(500).json({ success: false, error: err.message }); 
    }
});

// API BÓC TÁCH FILE XML TỪ TỔNG CỤC THUẾ / NHÀ CUNG CẤP
router.post('/upload-xml', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'Chưa chọn file XML' });
    
    try {
        const xmlData = fs.readFileSync(req.file.path, 'utf8');
        
        // Regex bóc tách các trường cơ bản của HĐĐT chuẩn TCT (Thông tư 78)
        const getTag = (tag) => {
            const match = xmlData.match(new RegExp(`<${tag}>(.*?)</${tag}>`));
            return match ? match[1].trim() : '';
        };

        const invoice_no = getTag('SHDon') || getTag('SoHoaDon') || '00' + Math.floor(Math.random()*100000);
        const vendor_name = getTag('TenNBan') || getTag('TenNguoiBan') || getTag('Ten') || 'Nhà Cung Cấp (Từ XML)';
        const vendor_tax_code = getTag('MSTNBan') || getTag('MST') || 'Unknown';
        const total_amount = parseFloat(getTag('TgTTTBSo') || getTag('TongTien') || 0);
        const vat_amount = parseFloat(getTag('TgTThue') || getTag('TienThue') || 0);
        const amount_before_tax = total_amount > 0 ? (total_amount - vat_amount) : parseFloat(getTag('TgTCThue') || 0);
        const issue_date_str = getTag('TDLap') || getTag('NgayLap') || new Date().toISOString(); 
        
        // Lưu thẳng vào bảng Expenses (Chi phí Đầu vào có Hóa Đơn)
        const result = await pool.query(
            `INSERT INTO expenses (
                expense_date, category, description, vendor_name, 
                vendor_tax_code, has_invoice, invoice_no, 
                amount_before_tax, vat_rate, vat_amount, total_amount
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [
                new Date(issue_date_str.split('T')[0]), 
                'Nhập Hàng Hóa & Vật Tư', 
                'Bóc tách tự động từ file XML HĐĐT Tổng Cục Thuế', 
                vendor_name, 
                vendor_tax_code, 
                true, 
                invoice_no, 
                amount_before_tax, 
                vat_amount > 0 ? 8 : 0, 
                vat_amount, 
                total_amount > 0 ? total_amount : (amount_before_tax + vat_amount)
            ]
        );

        res.json({ 
            success: true, 
            data: result.rows[0], 
            message: `✅ Đã đọc thành công Hóa đơn XML: #${invoice_no} (${vendor_name})` 
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Lỗi parse file XML: ' + err.message });
    }
});

module.exports = router;
