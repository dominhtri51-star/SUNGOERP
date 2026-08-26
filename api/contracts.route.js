const express = require('express');
const router = express.Router();
const pool = require('../config/database.js');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '../public/uploads/contracts');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, uploadDir); },
    filename: function (req, file, cb) { cb(null, 'unc-' + Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')); }
});
const upload = multer({ storage: storage });

// Helper: Chuyển đổi số thành chữ tiếng Việt chuẩn cho tiền tệ
function docSoThanhChu(so) {
    if (!so || isNaN(so) || so == 0) return 'Không đồng';
    const ChuSo = [' không ', ' một ', ' hai ', ' ba ', ' bốn ', ' năm ', ' sáu ', ' bảy ', ' tám ', ' chín '];
    const Tien = ['', ' nghìn', ' triệu', ' tỷ', ' nghìn tỷ', ' triệu tỷ'];
    
    function docBlock3(so) {
        let tram = Math.floor(so / 100);
        let chuc = Math.floor((so % 100) / 10);
        let donvi = so % 10;
        let ketQua = '';
        if (tram == 0 && chuc == 0 && donvi == 0) return '';
        if (tram != 0) {
            ketQua += ChuSo[tram] + 'trăm';
            if (chuc == 0 && donvi != 0) ketQua += ' linh';
        }
        if (chuc != 0 && chuc != 1) {
            ketQua += ChuSo[chuc] + 'mươi';
            if (chuc == 0 && donvi != 0) ketQua += ' linh';
        }
        if (chuc == 1) ketQua += ' mười';
        switch (donvi) {
            case 1:
                if (chuc != 0 && chuc != 1) ketQua += ' mốt';
                else ketQua += ChuSo[donvi];
                break;
            case 5:
                if (chuc == 0) ketQua += ChuSo[donvi];
                else ketQua += ' lăm';
                break;
            default:
                if (donvi != 0) ketQua += ChuSo[donvi];
                break;
        }
        return ketQua;
    }

    let viTri = [];
    let soTam = Math.abs(Math.round(so));
    while (soTam > 0) {
        viTri.push(soTam % 1000);
        soTam = Math.floor(soTam / 1000);
    }

    let chuoi = '';
    for (let i = viTri.length - 1; i >= 0; i--) {
        let block = docBlock3(viTri[i]);
        if (block != '') {
            chuoi += block + Tien[i];
        }
    }

    chuoi = chuoi.trim();
    if (!chuoi) return 'Không đồng';
    chuoi = chuoi.charAt(0).toUpperCase() + chuoi.slice(1) + ' đồng';
    return chuoi.replace(/\s+/g, ' ');
}

// 1. GET: Danh sách Hợp đồng & Thống kê KPI
router.get('/', async (req, res) => {
    try {
        const { type, status, search } = req.query;
        let query = `SELECT * FROM contracts`;
        const params = [];
        const conditions = [];

        if (type && type !== 'ALL') {
            params.push(type);
            conditions.push(`contract_type = $${params.length}`);
        }
        if (status && status !== 'ALL') {
            params.push(status);
            conditions.push(`payment_status = $${params.length}`);
        }
        if (search && search.trim()) {
            params.push(`%${search.trim()}%`);
            conditions.push(`(contract_code ILIKE $${params.length} OR customer_name ILIKE $${params.length} OR customer_company ILIKE $${params.length} OR order_code ILIKE $${params.length})`);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        query += ' ORDER BY id DESC';

        const contracts = await pool.query(query, params);

        let totalExpected = 0;
        let totalCollected = 0;
        let totalDebt = 0;
        let countMuaBan = 0;
        let countThiCong = 0;
        let countNguyenTac = 0;

        for (let c of contracts.rows) {
            const payments = await pool.query(`SELECT * FROM contract_payments WHERE contract_id = $1 ORDER BY payment_date DESC, id DESC`, [c.id]);
            c.history = payments.rows;

            if (typeof c.items_snapshot === 'string') {
                try { c.items_snapshot = JSON.parse(c.items_snapshot); } catch(e) { c.items_snapshot = []; }
            }
            if (typeof c.payment_terms === 'string') {
                try { c.payment_terms = JSON.parse(c.payment_terms); } catch(e) { c.payment_terms = []; }
            }
            if (typeof c.signing_request === 'string') {
                try { c.signing_request = JSON.parse(c.signing_request); } catch(e) { c.signing_request = null; }
            }
            if (typeof c.digital_stamp_a === 'string') {
                try { c.digital_stamp_a = JSON.parse(c.digital_stamp_a); } catch(e) { c.digital_stamp_a = null; }
            }
            if (typeof c.digital_stamp_b === 'string') {
                try { c.digital_stamp_b = JSON.parse(c.digital_stamp_b); } catch(e) { c.digital_stamp_b = null; }
            }

            if (!c.signing_token) {
                const tok = crypto.randomBytes(16).toString('hex');
                await pool.query('UPDATE contracts SET signing_token = $1 WHERE id = $2', [tok, c.id]);
                c.signing_token = tok;
            }

            const val = parseFloat(c.total_value || 0);
            const paid = parseFloat(c.paid_amount || 0);
            totalExpected += val;
            totalCollected += paid;
            if (val > paid) totalDebt += (val - paid);

            if (c.contract_type === 'MUA_BAN') countMuaBan++;
            else if (c.contract_type === 'THI_CONG') countThiCong++;
            else if (c.contract_type === 'NGUYEN_TAC') countNguyenTac++;
        }

        res.json({
            success: true,
            summary: {
                total_expected: totalExpected,
                total_collected: totalCollected,
                total_debt: totalDebt,
                count_total: contracts.rows.length,
                count_mua_ban: countMuaBan,
                count_thi_cong: countThiCong,
                count_nguyen_tac: countNguyenTac
            },
            data: contracts.rows
        });
    } catch (err) { 
        res.status(500).json({ success: false, error: err.message }); 
    }
});

// 1b. GET: LẤY CẤU HÌNH CHỨNG THƯ SỐ & CHỮ KÝ SỐ DOANH NGHIỆP
router.get('/digital-cert-settings', async (req, res) => {
    try {
        const result = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'digital_cert_config'");
        let config = {
            company_name: 'CÔNG TY TNHH ĐIỆN MẶT TRỜI SUNGO',
            tax_code: '0315614349',
            representative: 'ÔNG ĐỖ MINH TRÍ',
            position: 'Giám Đốc',
            ca_provider: 'Viettel-CA',
            cert_serial: '54:02:16:88:99:AA:BB:CC',
            cert_valid_from: '2024-01-01',
            cert_valid_to: '2027-12-31',
            signing_method: 'Cloud HSM (Ký Số Tập Trung)',
            stamp_type: 'VECTOR_STAMP',
            stamp_image_url: '',
            bank_account: '19134128005010',
            bank_name: 'Techcombank - Ngân hàng TMCP Kỹ Thương Việt Nam',
            headquarters: 'Tầng 2, Tòa nhà Mộc Gia số 121A - 123 – 125 Tân Thắng, Phường Tân Sơn Nhì, Thành phố Hồ Chí Minh',
            hotline: '0855.959.656 / 0359.591.212'
        };

        if (result.rows.length > 0 && result.rows[0].setting_value) {
            try {
                config = { ...config, ...JSON.parse(result.rows[0].setting_value) };
            } catch(e) {}
        }
        res.json({ success: true, data: config });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 1c. POST: LƯU CẤU HÌNH CHỨNG THƯ SỐ & CHỮ KÝ SỐ DOANH NGHIỆP
router.post('/digital-cert-settings', async (req, res) => {
    try {
        const config = req.body;
        await pool.query(`
            INSERT INTO system_settings (setting_key, setting_value) 
            VALUES ('digital_cert_config', $1) 
            ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value
        `, [JSON.stringify(config)]);

        res.json({ success: true, message: '✅ Đã lưu cấu hình Chứng Thư Số & Chữ Ký Số Doanh Nghiệp thành công!', data: config });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 1d. PUBLIC API: LẤY CHI TIẾT HỢP ĐỒNG QUA SIGNING TOKEN (CHO KHÁCH HÀNG KÝ ONLINE)
router.get('/public/sign/:token', async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM contracts WHERE signing_token = $1`, [req.params.token]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy hợp đồng hoặc đường link ký đã hết hạn!' });

        const contract = result.rows[0];
        const payments = await pool.query(`SELECT * FROM contract_payments WHERE contract_id = $1 ORDER BY payment_date DESC, id DESC`, [contract.id]);
        contract.history = payments.rows;

        if (typeof contract.items_snapshot === 'string') {
            try { contract.items_snapshot = JSON.parse(contract.items_snapshot); } catch(e) { contract.items_snapshot = []; }
        }
        if (typeof contract.payment_terms === 'string') {
            try { contract.payment_terms = JSON.parse(contract.payment_terms); } catch(e) { contract.payment_terms = []; }
        }
        if (typeof contract.signing_request === 'string') {
            try { contract.signing_request = JSON.parse(contract.signing_request); } catch(e) { contract.signing_request = null; }
        }
        if (typeof contract.digital_stamp_a === 'string') {
            try { contract.digital_stamp_a = JSON.parse(contract.digital_stamp_a); } catch(e) { contract.digital_stamp_a = null; }
        }
        if (typeof contract.digital_stamp_b === 'string') {
            try { contract.digital_stamp_b = JSON.parse(contract.digital_stamp_b); } catch(e) { contract.digital_stamp_b = null; }
        }

        // Lấy cấu hình công ty SUNGO
        const certRes = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'digital_cert_config'");
        let certConfig = {
            company_name: 'CÔNG TY TNHH ĐIỆN MẶT TRỜI SUNGO',
            tax_code: '0315614349',
            representative: 'ÔNG ĐỖ MINH TRÍ',
            position: 'Giám Đốc',
            ca_provider: 'Viettel-CA',
            bank_account: '19134128005010',
            bank_name: 'Techcombank',
            headquarters: 'Tầng 2, Tòa nhà Mộc Gia số 121A - 123 – 125 Tân Thắng, Phường Tân Sơn Nhì, Thành phố Hồ Chí Minh',
            hotline: '0855.959.656 / 0359.591.212'
        };
        if (certRes.rows.length > 0 && certRes.rows[0].setting_value) {
            try { certConfig = { ...certConfig, ...JSON.parse(certRes.rows[0].setting_value) }; } catch(e) {}
        }

        res.json({ success: true, data: contract, certConfig });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 1e. PUBLIC API: KHÁCH HÀNG (BÊN A) KÝ TAY ĐIỆN TỬ QUA LINK
router.post('/public/sign-e-sig/:token', async (req, res) => {
    try {
        const { signature_base64 } = req.body;
        if (!signature_base64) return res.status(400).json({ success: false, error: 'Vui lòng cung cấp chữ ký điện tử!' });

        const updateRes = await pool.query(`
            UPDATE contracts 
            SET e_signature_a = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE signing_token = $2
            RETURNING *
        `, [signature_base64, req.params.token]);

        if (updateRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy hợp đồng!' });

        res.json({ success: true, message: '✅ Bên A đã ký tay điện tử thành công!', data: updateRes.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 1f. PUBLIC API: KHÁCH HÀNG DOANH NGHIỆP (BÊN A) ĐÓNG DẤU CHỮ KÝ SỐ CA QUA LINK
router.post('/public/sign-digital-stamp/:token', async (req, res) => {
    try {
        const { company_name, tax_code, representative, position, ca_provider, cert_serial, note } = req.body;
        const contractRes = await pool.query(`SELECT * FROM contracts WHERE signing_token = $1`, [req.params.token]);
        if (contractRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy hợp đồng!' });

        const contract = contractRes.rows[0];
        const timestamp = new Date().toISOString();
        const compName = (company_name || contract.customer_company || contract.customer_name).toUpperCase();
        const compTax = tax_code || contract.customer_taxcode || '';
        const signerName = (representative || contract.customer_representative || contract.customer_name).toUpperCase();
        const signerPos = position || contract.customer_position || 'Đại diện theo pháp luật';
        const caProv = ca_provider || 'Doanh Nghiệp CA';

        const hashInput = `${contract.contract_code}-${contract.total_value}-${compName}-${compTax}-${signerName}-${timestamp}`;
        const hash = crypto.createHash('sha256').update(hashInput).digest('hex').toUpperCase();

        const stampA = {
            company: compName,
            tax_code: compTax,
            representative: signerName,
            position: signerPos,
            signer: `${signerName} - ${signerPos}`.toUpperCase(),
            ca_provider: caProv,
            certificate_authority: `${caProv} Certified`,
            certificate_serial: cert_serial || 'CA-A-' + Date.now(),
            note: note || 'Bên A xác nhận ký số và cam kết thực hiện hợp đồng',
            signed_at: timestamp,
            hash: hash,
            is_valid: true
        };

        const updateRes = await pool.query(`
            UPDATE contracts 
            SET digital_stamp_a = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *
        `, [JSON.stringify(stampA), contract.id]);

        res.json({
            success: true,
            message: `✅ Khách hàng (${compName}) đã đóng dấu chữ ký số Doanh nghiệp thành công!`,
            data: updateRes.rows[0]
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 1g. PUBLIC API: KHÁCH HÀNG TẢI FILE HỢP ĐỒNG ĐÃ KÝ LÊN QUA LINK
router.post('/public/upload-signed-file/:token', upload.single('signed_file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'Vui lòng chọn file hợp đồng đã ký (PDF hoặc Ảnh scan)!' });
        const fileUrl = `/uploads/contracts/${req.file.filename}`;
        const fileName = req.file.originalname;

        const updateRes = await pool.query(`
            UPDATE contracts 
            SET signed_file_url = $1,
                signed_file_name = $2,
                signed_file_uploaded_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE signing_token = $3
            RETURNING *
        `, [fileUrl, fileName, req.params.token]);

        if (updateRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy hợp đồng!' });

        res.json({
            success: true,
            message: `✅ Đã tải file hợp đồng đã ký (${fileName}) lên hệ thống thành công!`,
            file_url: fileUrl,
            data: updateRes.rows[0]
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. GET: Chi tiết 1 Hợp đồng
router.get('/:id', async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM contracts WHERE id = $1`, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy hợp đồng' });

        const contract = result.rows[0];

        // Tự động gán signing_token nếu chưa có
        if (!contract.signing_token) {
            const tok = crypto.randomBytes(16).toString('hex');
            await pool.query('UPDATE contracts SET signing_token = $1 WHERE id = $2', [tok, contract.id]);
            contract.signing_token = tok;
        }

        const payments = await pool.query(`SELECT * FROM contract_payments WHERE contract_id = $1 ORDER BY payment_date DESC, id DESC`, [contract.id]);
        contract.history = payments.rows;

        if (typeof contract.items_snapshot === 'string') {
            try { contract.items_snapshot = JSON.parse(contract.items_snapshot); } catch(e) { contract.items_snapshot = []; }
        }
        if (typeof contract.payment_terms === 'string') {
            try { contract.payment_terms = JSON.parse(contract.payment_terms); } catch(e) { contract.payment_terms = []; }
        }
        if (typeof contract.signing_request === 'string') {
            try { contract.signing_request = JSON.parse(contract.signing_request); } catch(e) { contract.signing_request = null; }
        }
        if (typeof contract.digital_stamp_a === 'string') {
            try { contract.digital_stamp_a = JSON.parse(contract.digital_stamp_a); } catch(e) { contract.digital_stamp_a = null; }
        }
        if (typeof contract.digital_stamp_b === 'string') {
            try { contract.digital_stamp_b = JSON.parse(contract.digital_stamp_b); } catch(e) { contract.digital_stamp_b = null; }
        }

        res.json({ success: true, data: contract });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. POST: TỰ ĐỘNG TẠO HỢP ĐỒNG MUA BÁN KHI CÓ ĐƠN HÀNG / LỆNH XUẤT HÀNG
router.post('/from-order/:orderId', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { orderId } = req.params;

        // Lấy thông tin đơn hàng & Khách hàng
        const orderRes = await client.query(`
            SELECT o.*, 
                   c.full_name as c_fullname, 
                   c.phone as c_phone, 
                   c.address as c_address, 
                   c.vat_company, 
                   c.vat_taxcode, 
                   c.vat_address, 
                   c.vat_email
            FROM orders o
            LEFT JOIN customers c ON o.customer_id = c.id
            WHERE o.id::text = $1 OR o.order_code = $1
        `, [orderId.toString()]);

        if (orderRes.rows.length === 0) {
            throw new Error(`Không tìm thấy đơn hàng #${orderId}`);
        }

        const o = orderRes.rows[0];

        // Lấy thông tin pháp nhân xuất hóa đơn từ CRM Customers
        let custCompany = o.vat_company || '';
        let custTaxCode = o.vat_taxcode || '';
        let custAddress = o.vat_address || '';
        let custPhone = o.customer_phone || o.c_phone || '';
        let custRep = o.c_fullname || o.customer_name || '';
        let custEmail = o.vat_email || '';

        if (!custCompany || !custTaxCode) {
            let custRes;
            if (o.customer_id) {
                custRes = await client.query('SELECT * FROM customers WHERE id = $1', [o.customer_id]);
            } else if (o.customer_name) {
                custRes = await client.query('SELECT * FROM customers WHERE vat_company ILIKE $1 OR full_name ILIKE $1 OR name ILIKE $1 LIMIT 1', [o.customer_name.trim()]);
            }
            if (custRes && custRes.rows.length > 0) {
                const c = custRes.rows[0];
                custCompany = c.vat_company || c.full_name || c.name || custCompany;
                custTaxCode = c.vat_taxcode || custTaxCode;
                custAddress = c.vat_address || c.address || custAddress;
                custPhone = c.phone || custPhone;
                custRep = c.full_name || c.name || custRep;
                custEmail = c.vat_email || custEmail;
            }
        }

        if (!custCompany) custCompany = o.customer_name || o.c_fullname || 'Khách Hàng Mua Hàng';
        if (!custAddress) custAddress = o.customer_address || o.c_address || '';

        // Lấy danh sách sản phẩm trong đơn hàng
        const itemsRes = await client.query(`
            SELECT oi.*, p.product_name, p.sku, p.unit
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = $1
        `, [o.id]);

        const items = itemsRes.rows.map((item, idx) => ({
            stt: idx + 1,
            product_id: item.product_id,
            sku: item.sku || '',
            product_name: item.product_name,
            unit: item.unit || 'Bộ',
            quantity: parseFloat(item.quantity || 1),
            price: parseFloat(item.price || 0),
            total_amount: parseFloat(item.quantity || 1) * parseFloat(item.price || 0)
        }));

        const totalValue = parseFloat(o.total_amount || 0);
        const totalValueText = docSoThanhChu(totalValue);

        // Sinh mã HĐMB chuẩn
        const currentYear = new Date().getFullYear();
        const countRes = await client.query("SELECT COUNT(*) FROM contracts WHERE contract_type = 'MUA_BAN'");
        const seq = String(parseInt(countRes.rows[0].count) + 1).padStart(3, '0');
        const contractCode = `${seq}/HĐMB.SG/${currentYear}`;

        // Thiết lập tiến độ thanh toán 2 đợt chuẩn cho HĐ Mua bán
        const depositAmt = Math.round(totalValue * 0.3);
        const remainAmt = totalValue - depositAmt;
        const paymentTerms = [
            {
                stage: 1,
                name: 'Đợt 1: Tạm ứng ngay sau khi ký HĐ',
                pct: 30,
                amount: depositAmt,
                status: o.paid_amount >= depositAmt ? 'PAID' : 'PENDING',
                note: 'Thanh toán tạm ứng để chuẩn bị hàng hoá xuất kho'
            },
            {
                stage: 2,
                name: 'Đợt 2: Thanh toán phần còn lại khi nhận hàng',
                pct: 70,
                amount: remainAmt,
                status: o.paid_amount >= totalValue ? 'PAID' : 'PENDING',
                note: 'Thanh toán ngay khi giao hàng đầy đủ tại chân công trình/kho Bên A'
            }
        ];

        const warrantyTerms = `• Tấm Pin năng lượng mặt trời được bảo hành 12 năm và bảo hành hiệu suất năm thứ 25 là trên 83% (theo quy định của nhà sản xuất).\n• Bảo hành biến tần Inverter 05 năm theo quy định nhà sản xuất.\n• Bảo hành Pin lưu trữ Lithium 05 năm theo tiêu chuẩn hãng.`;

        const insertRes = await client.query(`
            INSERT INTO contracts (
                contract_type, contract_code, order_id, order_code, 
                customer_id, customer_name, customer_company, customer_taxcode, 
                customer_address, customer_phone, customer_representative, customer_position, 
                project_address, total_value, total_value_text, paid_amount, 
                payment_status, contract_status, items_snapshot, payment_terms, warranty_terms,
                effective_date
            ) VALUES (
                'MUA_BAN', $1, $2, $3, 
                $4, $5, $6, $7, 
                $8, $9, $10, $11, 
                $12, $13, $14, $15, 
                $16, 'DRAFT', $17, $18, $19,
                CURRENT_DATE
            ) RETURNING *
        `, [
            contractCode, o.id, o.order_code,
            o.customer_id || null, custRep, custCompany, custTaxCode,
            custAddress, custPhone, custRep, 'Đại diện',
            custAddress || o.customer_address || '', totalValue, totalValueText, parseFloat(o.paid_amount || 0),
            (parseFloat(o.paid_amount || 0) >= totalValue) ? 'Đã Hoàn Tất' : ((parseFloat(o.paid_amount || 0) > 0) ? 'Đang Thanh Toán' : 'Chờ Đặt Cọc'),
            JSON.stringify(items), JSON.stringify(paymentTerms), warrantyTerms
        ]);

        await client.query('COMMIT');
        res.status(201).json({
            success: true,
            message: `✅ Đã tự động tạo Hợp đồng Mua bán #${contractCode} từ Đơn hàng ${o.order_code}!`,
            data: insertRes.rows[0]
        });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// 4. POST: TẠO HỢP ĐỒNG MỚI (MUA BÁN, THI CÔNG, NGUYÊN TẮC)
router.post('/', async (req, res) => {
    try {
        const {
            contract_type, contract_code, order_id, order_code,
            customer_id, customer_name, customer_company, customer_taxcode,
            customer_address, customer_phone, customer_representative, customer_position,
            project_address, total_value, payment_terms, items_snapshot, warranty_terms,
            effective_date, expiry_date, custom_clauses
        } = req.body;

        const type = contract_type || 'MUA_BAN';
        const currentYear = new Date().getFullYear();
        
        let autoCode = contract_code;
        if (!autoCode || autoCode.trim() === '') {
            const countRes = await pool.query("SELECT COUNT(*) FROM contracts WHERE contract_type = $1", [type]);
            const seq = String(parseInt(countRes.rows[0].count) + 1).padStart(3, '0');
            if (type === 'MUA_BAN') autoCode = `${seq}/HĐMB.SG/${currentYear}`;
            else if (type === 'THI_CONG') autoCode = `${seq}/HĐTC/SUNGO/${currentYear}`;
            else autoCode = `${seq}/HĐNT/SUNGO/${currentYear}`;
        }

        const totalVal = parseFloat(total_value || 0);
        const totalValText = docSoThanhChu(totalVal);

        // Chuẩn bị payment terms mặc định theo loại
        let finalTerms = payment_terms || [];
        if (Array.isArray(finalTerms) && finalTerms.length === 0) {
            if (type === 'THI_CONG') {
                // Mặc định 4 đợt chặt chẽ cho HĐ Thi Công
                finalTerms = [
                    { stage: 1, name: 'Đợt 1: Tạm ứng khi ký kết HĐ', pct: 30, amount: Math.round(totalVal * 0.3), status: 'PENDING', note: 'Xuất HĐ VAT trong ngày & chuẩn bị vật tư' },
                    { stage: 2, name: 'Đợt 2: Tập kết vật tư tại công trình', pct: 40, amount: Math.round(totalVal * 0.4), status: 'PENDING', note: 'Vật tư tấm pin, Inverter, khung giá đỡ đến chân công trình' },
                    { stage: 3, name: 'Đợt 3: Hoàn thành lắp đặt, đóng điện & chạy thử', pct: 20, amount: Math.round(totalVal * 0.2), status: 'PENDING', note: 'Hệ thống phát điện hòa lưới ổn định' },
                    { stage: 4, name: 'Đợt 4: Nghiệm thu bàn giao & Kích hoạt bảo hành', pct: 10, amount: totalVal - (Math.round(totalVal * 0.3) + Math.round(totalVal * 0.4) + Math.round(totalVal * 0.2)), status: 'PENDING', note: 'Bàn giao hồ sơ hoàn công và mã bảo hành điện tử' }
                ];
            } else if (type === 'MUA_BAN') {
                finalTerms = [
                    { stage: 1, name: 'Đợt 1: Tạm ứng khi ký HĐ', pct: 30, amount: Math.round(totalVal * 0.3), status: 'PENDING', note: 'Thanh toán tạm ứng chuẩn bị hàng' },
                    { stage: 2, name: 'Đợt 2: Thanh toán khi giao hàng', pct: 70, amount: totalVal - Math.round(totalVal * 0.3), status: 'PENDING', note: 'Thanh toán ngay khi giao nhận hàng' }
                ];
            } else {
                // HỢP ĐỒNG NGUYÊN TẮC: KHÔNG CÓ TIẾN ĐỘ THANH TOÁN (100% trước khi giao từng đợt)
                finalTerms = [];
            }
        }

        const insertRes = await pool.query(`
            INSERT INTO contracts (
                contract_type, contract_code, order_id, order_code, 
                customer_id, customer_name, customer_company, customer_taxcode, 
                customer_address, customer_phone, customer_representative, customer_position, 
                project_address, total_value, total_value_text, paid_amount, 
                payment_status, contract_status, items_snapshot, payment_terms, warranty_terms,
                effective_date, expiry_date, custom_clauses
            ) VALUES (
                $1, $2, $3, $4, 
                $5, $6, $7, $8, 
                $9, $10, $11, $12, 
                $13, $14, $15, 0, 
                'Chờ Ký', 'DRAFT', $16, $17, $18,
                $19, $20, $21
            ) RETURNING *
        `, [
            type, autoCode, order_id || null, order_code || null,
            customer_id || null, customer_name || '', customer_company || customer_name || '', customer_taxcode || '',
            customer_address || '', customer_phone || '', customer_representative || customer_name || '', customer_position || 'Giám Đốc',
            project_address || customer_address || '', totalVal, totalValText,
            JSON.stringify(items_snapshot || []), JSON.stringify(finalTerms), warranty_terms || '',
            effective_date || new Date().toISOString().slice(0, 10),
            expiry_date || (type === 'NGUYEN_TAC' ? `${currentYear}-12-31` : null),
            custom_clauses || ''
        ]);

        res.status(201).json({
            success: true,
            message: `✅ Đã tạo thành công hợp đồng #${autoCode}!`,
            data: insertRes.rows[0]
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5. PUT: CẬP NHẬT THÔNG TIN HỢP ĐỒNG (Chỉnh sửa điều khoản, sản phẩm, tiến độ)
router.put('/:id', async (req, res) => {
    try {
        const {
            customer_name, customer_company, customer_taxcode, customer_address,
            customer_phone, customer_representative, customer_position, project_address,
            total_value, items_snapshot, payment_terms, warranty_terms, custom_clauses,
            effective_date, expiry_date
        } = req.body;

        const totalVal = parseFloat(total_value || 0);
        const totalValText = docSoThanhChu(totalVal);

        const updateRes = await pool.query(`
            UPDATE contracts SET
                customer_name = COALESCE($1, customer_name),
                customer_company = COALESCE($2, customer_company),
                customer_taxcode = COALESCE($3, customer_taxcode),
                customer_address = COALESCE($4, customer_address),
                customer_phone = COALESCE($5, customer_phone),
                customer_representative = COALESCE($6, customer_representative),
                customer_position = COALESCE($7, customer_position),
                project_address = COALESCE($8, project_address),
                total_value = COALESCE($9, total_value),
                total_value_text = $10,
                items_snapshot = COALESCE($11, items_snapshot),
                payment_terms = COALESCE($12, payment_terms),
                warranty_terms = COALESCE($13, warranty_terms),
                custom_clauses = COALESCE($14, custom_clauses),
                effective_date = COALESCE($15, effective_date),
                expiry_date = COALESCE($16, expiry_date),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $17
            RETURNING *
        `, [
            customer_name, customer_company, customer_taxcode, customer_address,
            customer_phone, customer_representative, customer_position, project_address,
            totalVal, totalValText,
            items_snapshot ? JSON.stringify(items_snapshot) : null,
            payment_terms ? JSON.stringify(payment_terms) : null,
            warranty_terms, custom_clauses,
            effective_date, expiry_date,
            req.params.id
        ]);

        if (updateRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy hợp đồng' });
        res.json({ success: true, message: 'Đã cập nhật hợp đồng thành công!', data: updateRes.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. POST: KÝ ĐIỆN TỬ (BÊN A HOẶC BÊN B)
router.post('/:id/sign-e-sig', async (req, res) => {
    try {
        const { party, signature_base64 } = req.body; // party: 'A' hoặc 'B'
        if (!signature_base64) return res.status(400).json({ success: false, error: 'Thiếu dữ liệu chữ ký' });

        const col = party === 'B' ? 'e_signature_b' : 'e_signature_a';
        const updateRes = await pool.query(`
            UPDATE contracts 
            SET ${col} = $1,
                contract_status = CASE WHEN contract_status = 'DRAFT' THEN 'SIGNED' ELSE contract_status END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *
        `, [signature_base64, req.params.id]);

        res.json({ success: true, message: `✅ Đã lưu chữ ký điện tử Bên ${party} thành công!`, data: updateRes.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 7c. POST: KẾ TOÁN TRƯỞNG THỰC HIỆN ĐỐI SOÁT & LÊN LỆNH TRÌNH GIÁM ĐỐC KÝ SỐ
router.post('/:id/submit-for-approval', async (req, res) => {
    try {
        const { prepared_by, prepared_note, ktt_pin } = req.body;
        const contractRes = await pool.query(`SELECT * FROM contracts WHERE id = $1`, [req.params.id]);
        if (contractRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy hợp đồng' });

        const contract = contractRes.rows[0];
        const timestamp = new Date().toISOString();

        const signingRequest = {
            prepared_by: prepared_by || 'KẾ TOÁN TRƯỞNG',
            prepared_role: 'KẾ TOÁN TRƯỞNG',
            prepared_at: timestamp,
            prepared_note: prepared_note || 'Đã kiểm tra đối soát hồ sơ VAT trong CRM, bảng giá và các đợt giải ngân. Kính trình Giám đốc phê duyệt ký số.',
            status: 'PENDING_DIRECTOR'
        };

        const updateRes = await pool.query(`
            UPDATE contracts 
            SET contract_status = 'PENDING_DIRECTOR_APPROVAL',
                signing_request = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *
        `, [JSON.stringify(signingRequest), req.params.id]);

        res.json({
            success: true,
            message: `✅ Kế toán trưởng đã lên lệnh trình ký thành công! Hợp đồng #${contract.contract_code} đang chờ Giám Đốc ĐỖ MINH TRÍ phê duyệt ký số.`,
            data: updateRes.rows[0]
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 7d. POST: GIÁM ĐỐC PHÊ DUYỆT & ĐÓNG DẤU CHỮ KÝ SỐ DOANH NGHIỆP SUNGO (CHỊU TRÁCH NHIỆM HOÀN TOÀN)
router.post('/:id/digital-stamp', async (req, res) => {
    try {
        const { director_name, approval_note, director_pin } = req.body;

        const contractRes = await pool.query(`SELECT * FROM contracts WHERE id = $1`, [req.params.id]);
        if (contractRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy hợp đồng' });

        const contract = contractRes.rows[0];

        // Lấy thông tin lệnh trình ký của KTT nếu có
        let signingRequest = {};
        if (contract.signing_request) {
            try {
                signingRequest = typeof contract.signing_request === 'string' ? JSON.parse(contract.signing_request) : contract.signing_request;
            } catch(e) {}
        }

        // Lấy cấu hình chứng thư số mới nhất
        const certRes = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'digital_cert_config'");
        let certConfig = {
            company_name: 'CÔNG TY TNHH ĐIỆN MẶT TRỜI SUNGO',
            tax_code: '0315614349',
            representative: 'ÔNG ĐỖ MINH TRÍ',
            position: 'Giám Đốc',
            ca_provider: 'Viettel-CA / VNPT-CA',
            cert_serial: 'SUNGO-CA-88997722-VN',
            signing_method: 'Cloud HSM (Ký Số Tập Trung)',
            stamp_type: 'VECTOR_STAMP',
            stamp_image_url: ''
        };

        if (certRes.rows.length > 0 && certRes.rows[0].setting_value) {
            try { certConfig = { ...certConfig, ...JSON.parse(certRes.rows[0].setting_value) }; } catch(e) {}
        }

        const timestamp = new Date().toISOString();
        const finalDirector = (director_name || certConfig.representative || 'ÔNG ĐỖ MINH TRÍ').toUpperCase();

        const hashInput = `${contract.contract_code}-${contract.total_value}-${contract.customer_company}-${certConfig.tax_code}-${finalDirector}-${timestamp}`;
        const hash = crypto.createHash('sha256').update(hashInput).digest('hex').toUpperCase();

        const digitalStamp = {
            company: certConfig.company_name,
            tax_code: certConfig.tax_code,
            signer: `${certConfig.representative} - ${certConfig.position}`.toUpperCase(),
            prepared_by: signingRequest.prepared_by || 'KẾ TOÁN TRƯỞNG',
            prepared_role: 'KẾ TOÁN TRƯỞNG (NGƯỜI THỰC HIỆN)',
            prepared_at: signingRequest.prepared_at || timestamp,
            prepared_note: signingRequest.prepared_note || 'Đã đối soát hồ sơ VAT trong CRM và danh mục đơn giá',
            approved_by: finalDirector,
            approved_role: 'GIÁM ĐỐC (NGƯỜI PHÊ DUYỆT & CHỊU TRÁCH NHIỆM PHÁP LÝ HOÀN TOÀN)',
            approval_note: approval_note || 'Ban Giám Đốc phê duyệt ban hành và chịu trách nhiệm pháp lý',
            approved_at: timestamp,
            certificate_serial: certConfig.cert_serial,
            certificate_authority: `${certConfig.ca_provider} Certified`,
            signing_method: certConfig.signing_method,
            stamp_type: certConfig.stamp_type,
            stamp_image_url: certConfig.stamp_image_url || '',
            signed_at: timestamp,
            hash: hash,
            is_valid: true
        };

        const updateRes = await pool.query(`
            UPDATE contracts 
            SET digital_stamp_b = $1,
                contract_status = 'SIGNED',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *
        `, [JSON.stringify(digitalStamp), req.params.id]);

        res.json({
            success: true,
            message: `✅ Giám Đốc (${finalDirector}) đã phê duyệt và đóng dấu chữ ký số Doanh Nghiệp SUNGO thành công!`,
            data: updateRes.rows[0]
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 7e. POST: GIÁM ĐỐC TỪ CHỐI / YÊU CẦU KẾ TOÁN TRƯỞNG CHỈNH SỬA LẠI
router.post('/:id/director-reject', async (req, res) => {
    try {
        const { reject_reason, director_name } = req.body;
        const contractRes = await pool.query(`SELECT * FROM contracts WHERE id = $1`, [req.params.id]);
        if (contractRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy hợp đồng' });

        const contract = contractRes.rows[0];
        let signingRequest = {};
        if (contract.signing_request) {
            try { signingRequest = typeof contract.signing_request === 'string' ? JSON.parse(contract.signing_request) : contract.signing_request; } catch(e) {}
        }

        signingRequest.status = 'REJECTED';
        signingRequest.rejected_by = director_name || 'GIÁM ĐỐC ĐỖ MINH TRÍ';
        signingRequest.rejected_at = new Date().toISOString();
        signingRequest.reject_reason = reject_reason || 'Yêu cầu kiểm tra đối soát lại thông tin hóa đơn VAT và giá bán.';

        const updateRes = await pool.query(`
            UPDATE contracts 
            SET contract_status = 'DRAFT',
                signing_request = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *
        `, [JSON.stringify(signingRequest), req.params.id]);

        res.json({
            success: true,
            message: `✅ Đã trả hồ sơ hợp đồng #${contract.contract_code} về cho Kế toán trưởng chỉnh sửa lại theo chỉ đạo của Giám Đốc!`,
            data: updateRes.rows[0]
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 7f. POST: THU HỒI / HỦY CHỮ KÝ SỐ ĐỂ CHỈNH SỬA LẠI HỢP ĐỒNG
router.post('/:id/revoke-stamp', async (req, res) => {
    try {
        const { revoke_reason, revoked_by } = req.body;
        const contractRes = await pool.query(`SELECT * FROM contracts WHERE id = $1`, [req.params.id]);
        if (contractRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy hợp đồng' });

        const contract = contractRes.rows[0];
        if (!contract.digital_stamp_b) {
            return res.status(400).json({ success: false, error: 'Hợp đồng này chưa đóng dấu chữ ký số!' });
        }

        const updateRes = await pool.query(`
            UPDATE contracts 
            SET digital_stamp_b = NULL,
                contract_status = 'DRAFT',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
        `, [req.params.id]);

        res.json({
            success: true,
            message: `✅ Đã thu hồi chữ ký số thành công. Hợp đồng #${contract.contract_code} đã chuyển về trạng thái Dự Thảo để Kế toán trưởng chỉnh sửa!`,
            data: updateRes.rows[0]
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 8. POST: THU TIỀN THEO TIẾN ĐỘ HỢP ĐỒNG (KIỂM SOÁT TIẾN ĐỘ THANH TOÁN CHẶT CHẼ)
router.post('/:id/pay', upload.single('proof_file'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const amount = parseFloat(req.body.amount || 0);
        const stageIndex = parseInt(req.body.stage_index || 1);
        const paymentMethod = req.body.payment_method || 'Chuyển Khoản';
        const note = req.body.note || '';
        const vatInvoiceNo = req.body.vat_invoice_no || '';
        const proofUrl = req.file ? `/uploads/contracts/${req.file.filename}` : null;

        if (amount <= 0) throw new Error('Số tiền thanh toán phải lớn hơn 0');

        const contractRes = await client.query(`SELECT * FROM contracts WHERE id = $1`, [id]);
        if (contractRes.rows.length === 0) throw new Error('Không tìm thấy Hợp đồng');
        const contract = contractRes.rows[0];

        // 1. Lưu bản ghi thanh toán
        await client.query(`
            INSERT INTO contract_payments (contract_id, amount, payment_method, proof_url, vat_invoice_no, stage_index, note)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [id, amount, paymentMethod, proofUrl, vatInvoiceNo, stageIndex, note]);

        // 2. Cập nhật tiến độ thanh toán payment_terms JSONB
        let terms = contract.payment_terms || [];
        if (typeof terms === 'string') {
            try { terms = JSON.parse(terms); } catch(e) { terms = []; }
        }

        const targetStage = terms.find(t => t.stage === stageIndex);
        if (targetStage) {
            targetStage.status = 'PAID';
            targetStage.paid_at = new Date().toISOString();
            if (vatInvoiceNo) targetStage.vat_invoice_no = vatInvoiceNo;
        }

        const newPaid = parseFloat(contract.paid_amount || 0) + amount;
        const totalVal = parseFloat(contract.total_value || 0);

        let newPaymentStatus = 'Đang Thanh Toán';
        if (newPaid >= totalVal) {
            newPaymentStatus = 'Đã Hoàn Tất';
        } else if (newPaid > 0) {
            newPaymentStatus = 'Đang Thanh Toán';
        } else {
            newPaymentStatus = 'Chờ Đặt Cọc';
        }

        await client.query(`
            UPDATE contracts 
            SET paid_amount = $1, 
                payment_status = $2, 
                payment_terms = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
        `, [newPaid, newPaymentStatus, JSON.stringify(terms), id]);

        // 3. Tự động đồng bộ sang Sổ Quỹ (cash_transactions)
        try {
            const receiptCode = 'PT-HĐ-' + Date.now().toString().slice(-6);
            await client.query(`
                INSERT INTO cash_transactions (code, type, target_name, amount, payment_method, notes)
                VALUES ($1, 'THU', $2, $3, $4, $5)
            `, [
                receiptCode,
                contract.customer_company || contract.customer_name,
                amount,
                paymentMethod,
                `Thu tiền tiến độ Đợt ${stageIndex} HĐ ${contract.contract_code}: ${note || ''}`
            ]);
        } catch (cashErr) {
            console.error("Lỗi đồng bộ Sổ Quỹ từ Hợp đồng:", cashErr.message);
        }

        await client.query('COMMIT');
        res.json({
            success: true,
            message: `✅ Đã ghi nhận thu tiền Đợt ${stageIndex} (${new Intl.NumberFormat('vi-VN').format(amount)} đ) và cập nhật tiến độ hợp đồng!`,
            paid_amount: newPaid,
            payment_status: newPaymentStatus
        });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// 9. POST: TẢI FILE HỢP ĐỒNG ĐÃ KÝ (HỢP ĐỒNG GIẤY SCAN / PDF KÝ NGOÀI)
router.post('/:id/upload-signed-file', upload.single('signed_file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'Vui lòng chọn file hợp đồng đã ký (PDF hoặc Ảnh scan)!' });
        const fileUrl = `/uploads/contracts/${req.file.filename}`;
        const fileName = req.file.originalname;

        const updateRes = await pool.query(`
            UPDATE contracts 
            SET signed_file_url = $1,
                signed_file_name = $2,
                signed_file_uploaded_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING *
        `, [fileUrl, fileName, req.params.id]);

        if (updateRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy hợp đồng!' });

        res.json({
            success: true,
            message: `✅ Đã tải và lưu trữ file hợp đồng đã ký (${fileName}) thành công!`,
            file_url: fileUrl,
            data: updateRes.rows[0]
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 10. DELETE: GỠ FILE HỢP ĐỒNG ĐÃ KÝ
router.delete('/:id/remove-signed-file', async (req, res) => {
    try {
        const updateRes = await pool.query(`
            UPDATE contracts 
            SET signed_file_url = NULL,
                signed_file_name = NULL,
                signed_file_uploaded_at = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
        `, [req.params.id]);

        res.json({
            success: true,
            message: `✅ Đã gỡ file hợp đồng đính kèm thành công!`,
            data: updateRes.rows[0]
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 11. DELETE: XÓA HỢP ĐỒNG
router.delete('/:id', async (req, res) => {
    try {
        await pool.query(`DELETE FROM contracts WHERE id = $1`, [req.params.id]);
        res.json({ success: true, message: 'Đã xóa hợp đồng' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;

