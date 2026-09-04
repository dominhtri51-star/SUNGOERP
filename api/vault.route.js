const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const pool = require('../config/database');

// ==========================================
// CẤU HÌNH LƯU FILE KÉT SẮT CHỨNG TỪ
// ==========================================
const vaultUploadDir = path.join(__dirname, '../public/uploads/vault');
if (!fs.existsSync(vaultUploadDir)) {
    fs.mkdirSync(vaultUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, vaultUploadDir);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname) || '.pdf';
        const cleanName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
        cb(null, `vault_${Date.now()}_${cleanName}${ext}`);
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// Đường dẫn file JSON nghiệp vụ
const importsFile = path.join(__dirname, '../data/imports.json');
const purchasesFile = path.join(__dirname, '../data/purchases.json');
const quotationsFile = path.join(__dirname, '../data/quotations.json');

function readJsonFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) return [];
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        return [];
    }
}

function writeJsonFile(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        return false;
    }
}

// Khởi tạo bảng CSDL cho Két Sắt nếu chưa có
async function initVaultTables() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tax_vault_documents (
                id SERIAL PRIMARY KEY,
                vault_code VARCHAR(100),
                category VARCHAR(100) NOT NULL,
                sub_category VARCHAR(100),
                title VARCHAR(255) NOT NULL,
                doc_number VARCHAR(100),
                doc_date DATE,
                partner_name VARCHAR(255),
                partner_tax_code VARCHAR(50),
                amount NUMERIC DEFAULT 0,
                vat_amount NUMERIC DEFAULT 0,
                file_url TEXT,
                file_name VARCHAR(255),
                file_type VARCHAR(50),
                note TEXT,
                period_tag VARCHAR(20),
                is_verified BOOLEAN DEFAULT true,
                is_locked BOOLEAN DEFAULT false,
                source_module VARCHAR(100) DEFAULT 'MANUAL_DEPOSIT',
                ref_id VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by VARCHAR(100) DEFAULT 'ADMIN'
            );

            CREATE TABLE IF NOT EXISTS tax_vault_locks (
                id SERIAL PRIMARY KEY,
                period_key VARCHAR(50) UNIQUE NOT NULL,
                period_type VARCHAR(20) DEFAULT 'MONTH',
                locked_by VARCHAR(100) DEFAULT 'ADMIN',
                lock_reason TEXT,
                locked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
    } catch (e) {
        console.error('Init tax_vault tables error:', e.message);
    }
}
initVaultTables();

// Helper xác định kỳ kê khai thuế từ ngày (Format: YYYY-MM hoặc YYYY-QX)
function getPeriodTag(dateStr) {
    if (!dateStr) {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'UNKNOWN';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}`;
}

function getQuarterTag(dateStr) {
    if (!dateStr) return '2026-Q1';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'UNKNOWN';
    const yyyy = d.getFullYear();
    const q = Math.floor(d.getMonth() / 3) + 1;
    return `${yyyy}-Q${q}`;
}

// =========================================================================
// HÀM TẬP HỢP TOÀN BỘ CHỨNG TỪ TỪ TẤT CẢ CÁC PHÂN HỆ VÀO KÉT SẮT (AGGREGATOR)
// =========================================================================
async function aggregateAllVaultDocuments() {
    const allDocs = [];

    // Lấy danh sách kỳ đã bị khóa
    let lockedPeriods = new Set();
    try {
        const lockRes = await pool.query("SELECT period_key FROM tax_vault_locks");
        lockedPeriods = new Set(lockRes.rows.map(r => r.period_key));
    } catch (e) {}

    // -------------------------------------------------------------
    // 1. KHOANG: NGUỒN GỐC HÀNG HÓA & NGOẠI THƯƠNG (IMPORTS & CO/CQ)
    // -------------------------------------------------------------
    const importsData = readJsonFile(importsFile);
    importsData.forEach(item => {
        const pTag = getPeriodTag(item.created_at || item.eta);
        const qTag = getQuarterTag(item.created_at || item.eta);
        const isLocked = lockedPeriods.has(pTag) || lockedPeriods.has(qTag);

        const docList = [];
        if (item.docs && typeof item.docs === 'object') {
            Object.keys(item.docs).forEach(dType => {
                const arr = Array.isArray(item.docs[dType]) ? item.docs[dType] : [item.docs[dType]];
                arr.forEach(d => {
                    if (d && (d.url || d.file_url)) {
                        docList.push({
                            id: d.id,
                            name: d.name || d.original_name || dType,
                            url: d.url || d.file_url,
                            type: (d.url||'').endsWith('.pdf') ? 'pdf' : ((d.url||'').endsWith('.xml') ? 'xml' : 'image'),
                            doc_type: dType
                        });
                    }
                });
            });
        }

        const hasCO = docList.some(d => (d.doc_type === 'cert' || d.doc_type === 'co_cq' || (d.name||'').toLowerCase().includes('co') || (d.name||'').toLowerCase().includes('cq') || (d.name||'').toLowerCase().includes('cert')));
        const hasCustoms = docList.some(d => (d.doc_type === 'customs' || (d.name||'').toLowerCase().includes('hải quan') || (d.name||'').toLowerCase().includes('to khai')));
        const hasBL = docList.some(d => (d.doc_type === 'transport' || d.doc_type === 'bl' || (d.name||'').toLowerCase().includes('b/l') || (d.name||'').toLowerCase().includes('vận đơn') || (d.name||'').toLowerCase().includes('thắng')));

        const riskNotes = [];
        if (!hasCustoms) riskNotes.push('Thiếu Tờ khai Hải quan điện tử');
        if (!hasCO) riskNotes.push('Thiếu Chứng nhận xuất xứ C/O hoặc C/Q');

        allDocs.push({
            id: `IMP-${item.id}`,
            vault_code: `VLT-HQ-${String(item.id).padStart(5, '0')}`,
            category: 'ORIGIN_CO_CQ',
            category_label: 'Nguồn Gốc & Nhập Khẩu',
            sub_category: 'Tờ khai HQ & C/O, C/Q',
            code: item.po_code || `PO-IMP-${item.id}`,
            title: `Lô Hàng Nhập Khẩu: ${item.note || item.po_code || 'Nhập khẩu thiết bị'}`,
            date: (item.created_at || new Date().toISOString()).split('T')[0],
            period_tag: pTag,
            quarter_tag: qTag,
            partner_name: item.supplier_name || 'Nhà Cung Cấp Ngoại Thương',
            partner_tax_code: 'QUỐC TẾ',
            amount: parseFloat(item.total_value || item.total_amount || 0),
            currency: item.currency || 'USD',
            vat_rate: 0,
            vat_amount: 0,
            docs: docList,
            docs_count: docList.length,
            items_summary: item.note || 'Thiết bị & vật tư Solar',
            compliance_status: riskNotes.length === 0 ? 'VALID' : 'MISSING_DOCS',
            risk_notes: riskNotes,
            is_locked: isLocked,
            source_module: 'IMPORTS',
            ref_id: item.po_code
        });
    });

    // Gom chứng nhận C/O, C/Q từ danh mục sản phẩm (bảng products)
    try {
        const prodDocsRes = await pool.query("SELECT id, sku, product_name, doc_cocq, doc_datasheet, doc_catalog, created_at FROM products WHERE (doc_cocq IS NOT NULL AND doc_cocq != '') OR (doc_datasheet IS NOT NULL AND doc_datasheet != '') LIMIT 50");
        prodDocsRes.rows.forEach(p => {
            const pTag = getPeriodTag(p.created_at);
            const qTag = getQuarterTag(p.created_at);
            const docList = [];
            if (p.doc_cocq) docList.push({ name: `Chứng chỉ C/O, C/Q (${p.sku})`, url: p.doc_cocq, type: 'pdf', doc_type: 'co_cq' });
            if (p.doc_datasheet) docList.push({ name: `Datasheet kỹ thuật (${p.sku})`, url: p.doc_datasheet, type: 'pdf', doc_type: 'datasheet' });

            allDocs.push({
                id: `PRD-${p.id}`,
                vault_code: `VLT-CQ-${String(p.id).padStart(5, '0')}`,
                category: 'ORIGIN_CO_CQ',
                category_label: 'Nguồn Gốc & Nhập Khẩu',
                sub_category: 'Chứng Nhận C/O, C/Q Thiết Bị',
                code: p.sku || `SKU-${p.id}`,
                title: `Hồ sơ Xuất xứ & Chất lượng: ${p.product_name}`,
                date: (p.created_at ? new Date(p.created_at).toISOString() : new Date().toISOString()).split('T')[0],
                period_tag: pTag,
                quarter_tag: qTag,
                partner_name: 'Nhà Sản Xuất Chính Hãng',
                partner_tax_code: 'OEM',
                amount: 0,
                vat_rate: 0,
                vat_amount: 0,
                docs: docList,
                docs_count: docList.length,
                items_summary: p.product_name,
                compliance_status: 'VALID',
                risk_notes: [],
                is_locked: false,
                source_module: 'PRODUCTS',
                ref_id: p.sku
            });
        });
    } catch (e) {}

    // -------------------------------------------------------------
    // 2. KHOANG: MUA HÀNG NỘI ĐỊA & NHẬP KHO (PURCHASES & EXPENSES)
    // -------------------------------------------------------------
    const purchasesData = readJsonFile(purchasesFile);
    purchasesData.forEach(item => {
        const pTag = getPeriodTag(item.created_at || item.receive_date);
        const qTag = getQuarterTag(item.created_at || item.receive_date);
        const isLocked = lockedPeriods.has(pTag) || lockedPeriods.has(qTag);

        const docList = [];
        if (item.docs && typeof item.docs === 'object') {
            Object.keys(item.docs).forEach(dType => {
                const arr = Array.isArray(item.docs[dType]) ? item.docs[dType] : [item.docs[dType]];
                arr.forEach(d => {
                    if (d && (d.url || d.file_url)) {
                        docList.push({
                            id: d.id,
                            name: d.name || d.original_name || 'Biên nhận kho',
                            url: d.url || d.file_url,
                            type: (d.url||'').endsWith('.pdf') ? 'pdf' : 'image',
                            doc_type: dType
                        });
                    }
                });
            });
        }

        const totalAmt = parseFloat(item.total_amount || 0);
        const riskNotes = [];
        if (totalAmt >= 20000000 && docList.length === 0) {
            riskNotes.push('Đơn mua >20Tr cần có chứng từ thanh toán không dùng tiền mặt (UNC/Báo nợ)');
        }
        if (item.status !== 'Hoàn Tất Nhập Kho') {
            riskNotes.push('Đơn hàng chưa hoàn tất thủ tục nhập kho thực tế');
        }

        allDocs.push({
            id: `PUR-${item.id}`,
            vault_code: `VLT-NK-${String(item.id).padStart(5, '0')}`,
            category: 'INBOUND_PURCHASE',
            category_label: 'Mua Hàng & Nhập Kho',
            sub_category: 'Phiếu Nhập Kho & HĐ Mua',
            code: item.po_code || `PO-${item.id}`,
            title: `Lệnh Mua Hàng & Nhập Kho: ${item.note || item.po_code}`,
            date: (item.created_at || new Date().toISOString()).split('T')[0],
            period_tag: pTag,
            quarter_tag: qTag,
            partner_name: item.supplier_name || 'Nhà Cung Cấp Trong Nước',
            partner_tax_code: '',
            amount: totalAmt,
            vat_rate: 8,
            vat_amount: Math.round(totalAmt * 0.08),
            docs: docList,
            docs_count: docList.length,
            delivery_note: item.delivery_note || '',
            vehicle_info: item.vehicle_info || '',
            items_summary: (item.items || []).map(it => `${it.product_name || it.name || 'Vật tư'} (SL: ${it.quantity || it.actual_qty || 1})`).join('; ') || item.note,
            compliance_status: riskNotes.length === 0 ? 'VALID' : 'MISSING_DOCS',
            risk_notes: riskNotes,
            is_locked: isLocked,
            source_module: 'PURCHASES',
            ref_id: item.po_code
        });
    });

    // Gom Hóa đơn đầu vào (bảng expenses trong PostgreSQL)
    try {
        const expRes = await pool.query("SELECT * FROM expenses ORDER BY id DESC");
        expRes.rows.forEach(exp => {
            const pTag = getPeriodTag(exp.expense_date);
            const qTag = getQuarterTag(exp.expense_date);
            const isLocked = lockedPeriods.has(pTag) || lockedPeriods.has(qTag);

            const totalAmt = parseFloat(exp.total_amount || 0);
            const riskNotes = [];
            if (totalAmt >= 20000000) {
                riskNotes.push('Chi phí >20Tr bắt buộc phải lưu kèm Ủy Nhiệm Chi (UNC) ngân hàng để đủ điều kiện khấu trừ thuế GTGT & TNDN');
            }
            if (!exp.has_invoice) {
                riskNotes.push('Chi phí không có hóa đơn đỏ (không được khấu trừ VAT)');
            }

            allDocs.push({
                id: `EXP-${exp.id}`,
                vault_code: `VLT-CP-${String(exp.id).padStart(5, '0')}`,
                category: 'INBOUND_PURCHASE',
                category_label: 'Mua Hàng & Chi Phí Đầu Vào',
                sub_category: exp.has_invoice ? 'Hóa Đơn Đầu Vào XML/TCT' : 'Chi Phí Nội Bộ',
                code: exp.invoice_no ? `HĐ-${exp.invoice_no}` : `CP-${exp.id}`,
                title: `Chi phí: ${exp.description || exp.category || 'Nhập hàng/Chi phí'}`,
                date: (exp.expense_date ? new Date(exp.expense_date).toISOString() : new Date().toISOString()).split('T')[0],
                period_tag: pTag,
                quarter_tag: qTag,
                partner_name: exp.vendor_name || 'Nhà Cung Cấp',
                partner_tax_code: exp.vendor_tax_code || '',
                amount: parseFloat(exp.amount_before_tax || 0),
                vat_rate: exp.vat_rate || 0,
                vat_amount: parseFloat(exp.vat_amount || 0),
                total_amount: totalAmt,
                docs: exp.invoice_no ? [{ name: `HĐĐT #${exp.invoice_no}`, url: '', type: 'xml' }] : [],
                docs_count: exp.has_invoice ? 1 : 0,
                compliance_status: riskNotes.length === 0 ? 'VALID' : 'WARNING',
                risk_notes: riskNotes,
                is_locked: isLocked,
                source_module: 'EXPENSES',
                ref_id: exp.invoice_no
            });
        });
    } catch (e) {}

    // -------------------------------------------------------------
    // 3. KHOANG: BÁN HÀNG & XUẤT KHO VẬN CHUYỂN (ORDERS & WMS OUT)
    // -------------------------------------------------------------
    try {
        const orderRes = await pool.query(`
            SELECT o.*, c.full_name as c_name, c.vat_company, c.vat_taxcode, c.vat_address 
            FROM orders o 
            LEFT JOIN customers c ON o.customer_id = c.id 
            ORDER BY o.id DESC LIMIT 300
        `);

        if (orderRes.rows.length > 0) {
            const oIds = orderRes.rows.map(r => r.id);
            const itemsRes = await pool.query("SELECT oi.*, p.product_name, p.sku FROM order_items oi LEFT JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ANY($1)", [oIds]);
            const docsRes = await pool.query("SELECT * FROM order_docs WHERE order_id = ANY($1)", [oIds]);

            orderRes.rows.forEach(ord => {
                const pTag = getPeriodTag(ord.created_at);
                const qTag = getQuarterTag(ord.created_at);
                const isLocked = lockedPeriods.has(pTag) || lockedPeriods.has(qTag);

                const items = itemsRes.rows.filter(i => i.order_id === ord.id);
                const oDocs = docsRes.rows.filter(d => d.order_id === ord.id);

                const docList = [];
                let proofs = [];
                try {
                    if (typeof ord.delivery_proofs === 'string') proofs = JSON.parse(ord.delivery_proofs);
                    else if (Array.isArray(ord.delivery_proofs)) proofs = ord.delivery_proofs;
                } catch (e) {}
                proofs.forEach((url, pIdx) => {
                    docList.push({
                        name: `Ảnh giao nhận hàng thực tế #${pIdx + 1}`,
                        url: url,
                        type: 'image',
                        tag: 'DELIVERY_PROOF'
                    });
                });

                oDocs.forEach(d => {
                    docList.push({
                        id: d.id,
                        name: d.doc_name || d.doc_type || 'Chứng từ giao hàng',
                        url: d.doc_url || d.file_url,
                        type: (d.doc_url||'').endsWith('.pdf') ? 'pdf' : 'image',
                        tag: 'ORDER_DOC'
                    });
                });

                const serials = items.map(i => i.serial_number).filter(Boolean);
                const totalAmt = parseFloat(ord.total_amount || 0);

                const riskNotes = [];
                if (ord.status === 'COMPLETED' && docList.length === 0) {
                    riskNotes.push('Đơn hàng đã hoàn tất nhưng chưa có ảnh nghiệm thu bàn giao hoặc biên bản giao nhận');
                }
                if (serials.length === 0 && items.some(i => (i.product_name || '').toLowerCase().includes('inverter') || (i.product_name || '').toLowerCase().includes('pin'))) {
                    riskNotes.push('Chưa cập nhật số Serial thiết bị xuất kho');
                }

                allDocs.push({
                    id: `ORD-${ord.id}`,
                    vault_code: `VLT-XK-${String(ord.id).padStart(5, '0')}`,
                    category: 'OUTBOUND_DISPATCH',
                    category_label: 'Xuất Kho & Vận Chuyển',
                    sub_category: 'Phiếu Xuất Kho & Biên Bản Giao Hàng',
                    code: ord.order_code,
                    title: `Xuất kho Đơn hàng #${ord.order_code} - Khách: ${ord.customer_name || ord.c_name || 'Khách lẻ'}`,
                    date: (ord.created_at ? new Date(ord.created_at).toISOString() : new Date().toISOString()).split('T')[0],
                    period_tag: pTag,
                    quarter_tag: qTag,
                    partner_name: ord.customer_name || ord.c_name || 'Khách Hàng',
                    partner_tax_code: ord.vat_taxcode || '',
                    amount: totalAmt,
                    paid_amount: parseFloat(ord.paid_amount || 0),
                    payment_method: ord.payment_method || 'TIEN_MAT',
                    vat_rate: 8,
                    vat_amount: Math.round(totalAmt * 0.08),
                    docs: docList,
                    docs_count: docList.length,
                    delivery_company: ord.delivery_company || '',
                    driver_name: ord.driver_name || '',
                    license_plate: ord.license_plate || '',
                    serial_numbers: serials,
                    items_summary: items.map(i => `${i.product_name || i.sku || 'Sản phẩm'} x${i.quantity || 1}`).join('; '),
                    compliance_status: riskNotes.length === 0 ? 'VALID' : 'WARNING',
                    risk_notes: riskNotes,
                    is_locked: isLocked,
                    source_module: 'ORDERS',
                    ref_id: ord.order_code
                });
            });
        }
    } catch (e) {}

    // -------------------------------------------------------------
    // -------------------------------------------------------------
    // 4. KHOANG: BÁO GIÁ & HỢP ĐỒNG KINH TẾ (QUOTATIONS & CONTRACTS)
    // -------------------------------------------------------------
    
    // 4A. Báo giá dự án BOQ: CHỈ LƯU TRỮ VÀO KÉT SẮT KHI ĐÃ ĐƯỢC CHỐT / DUYỆT (APPROVED, WON, SIGNED, CONFIRMED)
    let quotationsData = [];
    try {
        if (pool && typeof pool.query === 'function') {
            const qDbRes = await pool.query("SELECT * FROM quotations WHERE status IN ('APPROVED', 'WON', 'SIGNED', 'CONFIRMED', 'DA_CHOT') OR converted_order_code IS NOT NULL ORDER BY id DESC");
            if (qDbRes.rows.length > 0) quotationsData = qDbRes.rows;
        }
    } catch(e) {}
    if (quotationsData.length === 0) {
        quotationsData = readJsonFile(quotationsFile).filter(q => ['APPROVED', 'WON', 'SIGNED', 'CONFIRMED', 'DA_CHOT'].includes(q.status) || !!q.converted_order_code);
    }

    quotationsData.forEach(q => {
        const pTag = getPeriodTag(q.created_at);
        const qTag = getQuarterTag(q.created_at);
        const isLocked = lockedPeriods.has(pTag) || lockedPeriods.has(qTag);

        const totalAmt = parseFloat(q.total_amount || q.total_value || 0);
        const docList = [];
        if (q.pdf_url) {
            docList.push({ name: 'Bản in Báo giá PDF', url: q.pdf_url, type: 'pdf', tag: 'BOQ_PDF' });
        }
        if (q.quotation_code) {
            docList.push({
                name: 'Liên Kết Báo Giá Dự Án BOQ',
                url: `/dashboard.html#sale-boq-hybrid`,
                type: 'link',
                tag: 'BOQ_LINK'
            });
        }

        allDocs.push({
            id: `QUO-${q.quotation_id || q.id}`,
            vault_code: `VLT-BG-${String(q.quotation_id || q.id).padStart(5, '0')}`,
            category: 'CONTRACT_BOQ',
            category_label: 'Báo Giá & Hợp Đồng',
            sub_category: 'Báo Giá Dự Án (BOQ Đã Chốt)',
            code: q.quotation_code,
            title: `Báo giá BOQ: ${q.project_name || q.quotation_code}`,
            date: (q.created_at || new Date().toISOString()).split('T')[0],
            period_tag: pTag,
            quarter_tag: qTag,
            partner_name: q.customer_name || 'Khách Hàng',
            partner_tax_code: '',
            amount: totalAmt,
            profit_margin: q.profit_margin || 0,
            status: q.status || 'WON',
            docs: docList,
            docs_count: docList.length,
            items_summary: (q.items || []).map(i => `${i.product_name || i.name || 'Thiết bị'} x${i.quantity || i.qty || 1}`).join('; '),
            compliance_status: 'VALID',
            risk_notes: q.profit_margin < 15 ? ['Biên lợi nhuận dưới mức sàn tiêu chuẩn 15%'] : [],
            is_locked: isLocked,
            source_module: 'QUOTATIONS',
            ref_id: q.quotation_code
        });
    });

    // 4B. Báo giá đơn hàng & Báo giá đã ký điện tử: CHỈ LƯU KHI CÓ CHỮ KÝ HOẶC ĐÃ XÁC NHẬN / XUẤT HÀNG
    try {
        const orderQuotesRes = await pool.query(`
            SELECT o.*, 
                   c.full_name as c_name, c.vat_company, c.vat_taxcode, c.vat_address,
                   e.full_name as salesperson_name
            FROM orders o 
            LEFT JOIN customers c ON o.customer_id = c.id 
            LEFT JOIN employees e ON o.employee_id = e.id
            WHERE (o.status IN ('CONFIRMED', 'DELIVERED', 'SHIPPED', 'COMPLETED', 'PAID', 'Đã Hoàn Tất') 
               OR o.customer_signature IS NOT NULL 
               OR o.sales_signature IS NOT NULL)
              AND o.status NOT IN ('CANCELLED', 'DRAFT', 'RETURNED')
            ORDER BY o.id DESC LIMIT 300
        `);

        for (let ord of orderQuotesRes.rows) {
            const pTag = getPeriodTag(ord.created_at);
            const qTag = getQuarterTag(ord.created_at);
            const isLocked = lockedPeriods.has(pTag) || lockedPeriods.has(qTag);

            const docList = [];
            const hasCustSig = !!ord.customer_signature;
            const hasSalesSig = !!ord.sales_signature;
            const isSigned = hasCustSig || hasSalesSig;

            if (hasCustSig) {
                docList.push({
                    id: `CUST-SIG-${ord.id}`,
                    name: `Chữ ký Khách Hàng (${ord.customer_signed_name || ord.customer_name || 'Khách Hàng'})`,
                    url: ord.customer_signature,
                    type: 'image',
                    tag: 'CUSTOMER_E_SIGNATURE'
                });
            }

            if (hasSalesSig) {
                docList.push({
                    id: `SALES-SIG-${ord.id}`,
                    name: `Chữ ký Đại Diện SUNGO (${ord.sales_signed_name || ord.salesperson_name || 'NVKD'})`,
                    url: ord.sales_signature,
                    type: 'image',
                    tag: 'COMPANY_E_SIGNATURE'
                });
            }

            // Cổng link ký báo giá trực tuyến
            const signToken = ord.quote_sign_token || ord.order_code || ord.id;
            docList.push({
                id: `QUOTE-LINK-${ord.id}`,
                name: 'Cổng Ký Báo Giá Điện Tử Trực Tuyến',
                url: `/sign-quote.html?token=${encodeURIComponent(signToken)}`,
                type: 'link',
                tag: 'QUOTE_PORTAL_LINK'
            });

            const totalAmt = parseFloat(ord.total_amount || 0);
            const riskNotes = [];
            if (!isSigned) {
                riskNotes.push('Báo giá đơn hàng chưa có chữ ký xác nhận của khách hàng hoặc NVKD');
            }

            allDocs.push({
                id: `ORD-QUOTE-${ord.id}`,
                vault_code: `VLT-BG-ORD-${String(ord.id).padStart(5, '0')}`,
                category: 'CONTRACT_BOQ',
                category_label: 'Báo Giá & Hợp Đồng',
                sub_category: isSigned ? 'Báo Giá Đơn Hàng Đã Ký' : 'Báo Giá Bán Hàng (Chờ Ký)',
                code: ord.order_code,
                title: `Báo Giá Đơn Hàng #${ord.order_code} - ${ord.customer_name || ord.c_name || 'Khách Lẻ'}`,
                date: (ord.created_at ? new Date(ord.created_at).toISOString() : new Date().toISOString()).split('T')[0],
                period_tag: pTag,
                quarter_tag: qTag,
                partner_name: ord.customer_name || ord.c_name || 'Khách Hàng',
                partner_tax_code: ord.vat_taxcode || '',
                amount: totalAmt,
                paid_amount: parseFloat(ord.paid_amount || 0),
                status: isSigned ? 'SIGNED' : 'QUOTING',
                has_signature: isSigned,
                docs: docList,
                docs_count: docList.length,
                compliance_status: isSigned ? 'VALID' : 'WARNING',
                risk_notes: riskNotes,
                is_locked: isLocked,
                source_module: 'ORDERS_QUOTATION',
                ref_id: ord.order_code
            });
        }
    } catch (e) {
        console.error('Error loading order quotations in vault:', e.message);
    }

    // 4C. Hợp đồng kinh tế (bảng contracts trong PostgreSQL)
    try {
        const contractRes = await pool.query("SELECT * FROM contracts ORDER BY id DESC");
        for (let c of contractRes.rows) {
            const pTag = getPeriodTag(c.created_at);
            const qTag = getQuarterTag(c.created_at);
            const isLocked = lockedPeriods.has(pTag) || lockedPeriods.has(qTag);

            const payRes = await pool.query("SELECT * FROM contract_payments WHERE contract_id = $1 ORDER BY payment_date DESC", [c.id]);
            const payments = payRes.rows;

            const docList = [];

            // 1. Chữ ký điện tử bên A (Khách hàng)
            if (c.e_signature_a) {
                docList.push({
                    id: `SIG-A-${c.id}`,
                    name: `Chữ ký điện tử Khách Hàng (Bên A - ${c.customer_representative || c.customer_name})`,
                    url: c.e_signature_a,
                    type: 'image',
                    tag: 'CUSTOMER_E_SIGNATURE'
                });
            }

            // 2. Chữ ký điện tử bên B (SUNGO)
            if (c.e_signature_b) {
                docList.push({
                    id: `SIG-B-${c.id}`,
                    name: 'Chữ ký điện tử Đại Diện SUNGO (Bên B)',
                    url: c.e_signature_b,
                    type: 'image',
                    tag: 'COMPANY_E_SIGNATURE'
                });
            }

            // 3. Con dấu số doanh nghiệp (CA)
            if (c.digital_stamp_b && typeof c.digital_stamp_b === 'object') {
                docList.push({
                    id: `STAMP-B-${c.id}`,
                    name: `Con dấu số Doanh Nghiệp CA (${c.digital_stamp_b.subject_cn || 'SUNGO'})`,
                    url: '',
                    type: 'ca_cert',
                    tag: 'DIGITAL_CERT'
                });
            }

            // 4. File PDF / Scan gốc có chữ ký & đóng dấu đính kèm
            if (c.signed_file_url) {
                docList.push({
                    id: `FILE-${c.id}`,
                    name: c.signed_file_name || 'Bản Scan Hợp Đồng Đã Ký & Đóng Dấu',
                    url: c.signed_file_url,
                    type: 'pdf',
                    tag: 'SIGNED_CONTRACT_SCAN'
                });
            }

            // 5. Đường link xem và ký hợp đồng trực tuyến
            const signToken = c.signing_token || c.contract_code;
            if (signToken) {
                docList.push({
                    id: `LINK-${c.id}`,
                    name: 'Cổng Ký Hợp Đồng Trực Tuyến (Online Portal)',
                    url: `/sign-contract.html?token=${encodeURIComponent(signToken)}`,
                    type: 'link',
                    tag: 'SIGN_PORTAL_LINK'
                });
            }

            // 6. Chứng từ thanh toán ngân hàng (UNC)
            payments.forEach((p, pIdx) => {
                if (p.proof_url) {
                    docList.push({
                        id: p.id,
                        name: `UNC/Biên lai thanh toán đợt #${pIdx + 1} (${new Intl.NumberFormat('vi-VN').format(p.amount)}đ)`,
                        url: p.proof_url,
                        type: (p.proof_url||'').endsWith('.pdf') ? 'pdf' : 'image',
                        amount: parseFloat(p.amount)
                    });
                }
            });

            const totalVal = parseFloat(c.total_value || 0);
            const paidVal = parseFloat(c.paid_amount || 0);
            const isSigned = (c.contract_status === 'SIGNED' || c.contract_status === 'APPROVED' || !!c.e_signature_a || !!c.e_signature_b || !!c.signed_file_url);

            const riskNotes = [];
            if (!isSigned) {
                riskNotes.push('Hợp đồng chưa có chữ ký xác nhận của khách hàng hoặc đại diện');
            }
            if (paidVal > 0 && payments.filter(p => p.proof_url).length === 0) {
                riskNotes.push('Hợp đồng đã nhận thanh toán nhưng thiếu ủy nhiệm chi hoặc chứng từ báo có ngân hàng');
            }

            allDocs.push({
                id: `CTR-${c.id}`,
                vault_code: `VLT-HD-${String(c.id).padStart(5, '0')}`,
                category: 'CONTRACT_BOQ',
                category_label: 'Báo Giá & Hợp Đồng',
                sub_category: isSigned ? 'Hợp Đồng Kinh Tế Đã Ký (EPC)' : 'Hợp Đồng Kinh Tế (Chờ Ký)',
                code: c.contract_code,
                title: `Hợp Đồng Kinh Tế: #${c.contract_code} - ${c.customer_name}`,
                date: (c.created_at ? new Date(c.created_at).toISOString() : new Date().toISOString()).split('T')[0],
                period_tag: pTag,
                quarter_tag: qTag,
                partner_name: c.customer_name,
                partner_tax_code: c.customer_tax_code || '',
                amount: totalVal,
                paid_amount: paidVal,
                contract_status: c.contract_status || (isSigned ? 'SIGNED' : 'DRAFT'),
                payment_status: c.payment_status || 'Chờ Đặt Cọc',
                has_signature: isSigned,
                docs: docList,
                docs_count: docList.length,
                compliance_status: (isSigned && riskNotes.length === 0) ? 'VALID' : (isSigned ? 'WARNING' : 'MISSING_DOCS'),
                risk_notes: riskNotes,
                is_locked: isLocked,
                source_module: 'CONTRACTS',
                ref_id: c.contract_code
            });
        }
    } catch (e) {
        console.error('Error loading contracts in vault:', e.message);
    }

    // -------------------------------------------------------------
    // 5. KHOANG: HÓA ĐƠN GTGT & DÒNG TIỀN (INVOICES & CASHBOOKS)
    // -------------------------------------------------------------
    try {
        const invRes = await pool.query("SELECT * FROM invoices ORDER BY id DESC");
        invRes.rows.forEach(inv => {
            const pTag = getPeriodTag(inv.issued_at || inv.created_at);
            const qTag = getQuarterTag(inv.issued_at || inv.created_at);
            const isLocked = lockedPeriods.has(pTag) || lockedPeriods.has(qTag);

            const isIssued = inv.status === 'Đã Phát Hành';
            const riskNotes = [];
            if (!isIssued) {
                riskNotes.push('Hóa đơn đang ở trạng thái Chờ Phát Hành');
            }
            if (!inv.tax_code && inv.total_amount >= 20000000) {
                riskNotes.push('Hóa đơn doanh nghiệp trên 20Tr thiếu Mã Số Thuế');
            }

            allDocs.push({
                id: `INV-${inv.id}`,
                vault_code: `VLT-VAT-${String(inv.id).padStart(5, '0')}`,
                category: 'TAX_INVOICE',
                category_label: 'Hóa Đơn GTGT & Báo Cáo Thuế',
                sub_category: 'Hóa Đơn Điện Tử Bán Ra',
                code: inv.invoice_no ? `HĐ-${inv.invoice_no}` : `HD-PENDING-${inv.id}`,
                title: `HĐĐT GTGT #${inv.invoice_no || 'Chưa cấp số'} - ${inv.company_name || inv.customer_name}`,
                date: (inv.issued_at ? new Date(inv.issued_at).toISOString() : new Date(inv.created_at).toISOString()).split('T')[0],
                period_tag: pTag,
                quarter_tag: qTag,
                partner_name: inv.company_name || inv.customer_name || 'Khách Hàng',
                partner_tax_code: inv.tax_code || '',
                partner_address: inv.company_address || '',
                amount: parseFloat(inv.total_amount || 0),
                vat_rate: inv.vat_rate || 8,
                vat_amount: parseFloat(inv.vat_amount || 0),
                status: inv.status || 'Chờ Phát Hành',
                provider: inv.provider || 'VinInvoice',
                docs: inv.invoice_no ? [{ name: `e-Invoice #${inv.invoice_no} (${inv.provider})`, url: '', type: 'xml' }] : [],
                docs_count: inv.invoice_no ? 1 : 0,
                compliance_status: riskNotes.length === 0 ? 'VALID' : 'WARNING',
                risk_notes: riskNotes,
                is_locked: isLocked,
                source_module: 'INVOICES',
                ref_id: inv.ref_id
            });
        });
    } catch (e) {}

    // Sổ quỹ tiền mặt (cash_transactions)
    try {
        const cashRes = await pool.query("SELECT * FROM cash_transactions ORDER BY id DESC LIMIT 100");
        cashRes.rows.forEach(c => {
            const pTag = getPeriodTag(c.created_at);
            const qTag = getQuarterTag(c.created_at);
            const isLocked = lockedPeriods.has(pTag) || lockedPeriods.has(qTag);

            allDocs.push({
                id: `CSH-${c.id}`,
                vault_code: `VLT-SQ-${String(c.id).padStart(5, '0')}`,
                category: 'CASH_BANKING',
                category_label: 'Sổ Quỹ & Ngân Hàng',
                sub_category: c.type === 'THU' ? 'Phiếu Thu Tiền Mặt' : 'Phiếu Chi Tiền Mặt',
                code: c.code || `${c.type}-${c.id}`,
                title: `${c.type === 'THU' ? 'Phiếu Thu' : 'Phiếu Chi'}: ${c.notes || c.target_name}`,
                date: (c.created_at ? new Date(c.created_at).toISOString() : new Date().toISOString()).split('T')[0],
                period_tag: pTag,
                quarter_tag: qTag,
                partner_name: c.target_name || 'Đối Tác',
                partner_tax_code: '',
                amount: parseFloat(c.amount || 0),
                type: c.type,
                docs: [],
                docs_count: 0,
                compliance_status: 'VALID',
                risk_notes: parseFloat(c.amount || 0) >= 20000000 && c.type === 'CHI' ? ['Chi tiền mặt trên 20Tr - Cơ quan thuế không chấp nhận chi phí hợp lý nếu thanh toán tiền mặt'] : [],
                is_locked: isLocked,
                source_module: 'ACCOUNTING_CASH',
                ref_id: c.code
            });
        });
    } catch (e) {}

    // -------------------------------------------------------------
    // 6. KHOANG: CHỨNG TỪ LƯU TRỮ TRONG BẢNG tax_vault_documents
    // -------------------------------------------------------------
    try {
        const customDocs = await pool.query("SELECT * FROM tax_vault_documents ORDER BY id DESC");
        
        // Tách riêng các file bổ sung (SUPPLEMENT_ATTACHMENT) và hồ sơ độc lập
        const supplementMap = new Map();
        const standaloneDocs = [];

        customDocs.rows.forEach(cd => {
            if (cd.source_module === 'SUPPLEMENT_ATTACHMENT' || (cd.ref_id && cd.ref_id.trim() !== '')) {
                const targetKey = cd.ref_id || cd.vault_code;
                if (!supplementMap.has(targetKey)) {
                    supplementMap.set(targetKey, []);
                }
                supplementMap.get(targetKey).push(cd);
            }
            
            // Nếu không phải là file bổ sung gắn vào mã khác, hiển thị như một hồ sơ độc lập
            if (cd.source_module !== 'SUPPLEMENT_ATTACHMENT') {
                const pTag = cd.period_tag || getPeriodTag(cd.doc_date || cd.created_at);
                const qTag = getQuarterTag(cd.doc_date || cd.created_at);
                const isLocked = cd.is_locked || lockedPeriods.has(pTag) || lockedPeriods.has(qTag);

                standaloneDocs.push({
                    id: `VLT-${cd.id}`,
                    vault_code: cd.vault_code || `VLT-MAN-${String(cd.id).padStart(5, '0')}`,
                    category: cd.category || 'LEGAL_COMPLIANCE',
                    category_label: cd.category === 'ORIGIN_CO_CQ' ? 'Nguồn Gốc & Nhập Khẩu' :
                                    (cd.category === 'INBOUND_PURCHASE' ? 'Mua Hàng & Nhập Kho' :
                                    (cd.category === 'OUTBOUND_DISPATCH' ? 'Xuất Kho & Vận Chuyển' :
                                    (cd.category === 'CONTRACT_BOQ' ? 'Báo Giá & Hợp Đồng' :
                                    (cd.category === 'TAX_INVOICE' ? 'Hóa Đơn GTGT & Thuế' : 'Hồ Sơ Pháp Lý & Kiểm Tra')))),
                    sub_category: cd.sub_category || 'Chứng Từ Lưu Trữ Bổ Sung',
                    code: cd.doc_number || `DOC-${cd.id}`,
                    title: cd.title,
                    date: (cd.doc_date ? new Date(cd.doc_date).toISOString() : new Date(cd.created_at).toISOString()).split('T')[0],
                    period_tag: pTag,
                    quarter_tag: qTag,
                    partner_name: cd.partner_name || '',
                    partner_tax_code: cd.partner_tax_code || '',
                    amount: parseFloat(cd.amount || 0),
                    vat_amount: parseFloat(cd.vat_amount || 0),
                    docs: cd.file_url ? [{ id: cd.id, name: cd.file_name || cd.title, url: cd.file_url, type: cd.file_type || 'pdf', note: cd.note }] : [],
                    docs_count: cd.file_url ? 1 : 0,
                    note: cd.note || '',
                    compliance_status: cd.is_verified ? 'VALID' : 'WARNING',
                    risk_notes: [],
                    is_locked: isLocked,
                    source_module: 'MANUAL_DEPOSIT',
                    ref_id: cd.ref_id
                });
            }
        });

        // Bổ sung các file đính kèm thêm vào các chứng từ gốc tương ứng
        allDocs.forEach(d => {
            const possibleKeys = [d.id, d.code, d.vault_code, d.ref_id].filter(Boolean);
            possibleKeys.forEach(key => {
                if (supplementMap.has(key)) {
                    const supps = supplementMap.get(key);
                    supps.forEach(s => {
                        if (s.file_url && !d.docs.some(x => x.url === s.file_url)) {
                            d.docs.push({
                                id: s.id,
                                name: s.file_name || s.title,
                                url: s.file_url,
                                type: s.file_type || 'pdf',
                                doc_type: s.sub_category || 'SUPPLEMENT',
                                note: s.note,
                                uploaded_at: s.created_at,
                                is_supplement: true
                            });
                            d.docs_count = d.docs.length;

                            // Giải phóng rủi ro thuế nếu đã bổ sung chứng từ tương ứng
                            const subLow = (s.sub_category || '').toLowerCase() + ' ' + (s.title || '').toLowerCase() + ' ' + (s.file_name || '').toLowerCase();
                            if (subLow.includes('unc') || subLow.includes('ngân hàng') || subLow.includes('thanh toán')) {
                                d.risk_notes = d.risk_notes.filter(r => !r.includes('UNC') && !r.includes('tiền mặt'));
                            }
                            if (subLow.includes('co') || subLow.includes('cq') || subLow.includes('xuất xứ') || subLow.includes('chất lượng')) {
                                d.risk_notes = d.risk_notes.filter(r => !r.includes('C/O'));
                            }
                            if (subLow.includes('hải quan') || subLow.includes('tờ khai') || subLow.includes('customs')) {
                                d.risk_notes = d.risk_notes.filter(r => !r.includes('Hải quan'));
                            }
                            if (subLow.includes('nghiệm thu') || subLow.includes('giao nhận') || subLow.includes('bàn giao') || subLow.includes('biên bản')) {
                                d.risk_notes = d.risk_notes.filter(r => !r.includes('nghiệm thu') && !r.includes('biên bản'));
                            }
                            if (d.risk_notes.length === 0) {
                                d.compliance_status = 'VALID';
                            }
                        }
                    });
                }
            });
        });

        // Ghép thêm standalone docs vào danh sách
        standaloneDocs.forEach(sd => allDocs.push(sd));

    } catch (e) {
        console.error('Error merging supplementary docs:', e.message);
    }

    // Sắp xếp chứng từ mới nhất lên đầu
    allDocs.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    return allDocs;
}

// =========================================================================
// API 1: [GET] TỔNG QUAN KÉT SẮT & CHỈ SỐ SẴN SÀNG THANH TRA (SUMMARY)
// =========================================================================
router.get('/summary', async (req, res) => {
    try {
        const allDocs = await aggregateAllVaultDocuments();

        const categoryCounts = {
            ORIGIN_CO_CQ: allDocs.filter(d => d.category === 'ORIGIN_CO_CQ').length,
            INBOUND_PURCHASE: allDocs.filter(d => d.category === 'INBOUND_PURCHASE').length,
            OUTBOUND_DISPATCH: allDocs.filter(d => d.category === 'OUTBOUND_DISPATCH').length,
            CONTRACT_BOQ: allDocs.filter(d => d.category === 'CONTRACT_BOQ').length,
            TAX_INVOICE: allDocs.filter(d => d.category === 'TAX_INVOICE').length,
            CASH_BANKING: allDocs.filter(d => d.category === 'CASH_BANKING').length,
            LEGAL_COMPLIANCE: allDocs.filter(d => d.category === 'LEGAL_COMPLIANCE').length
        };

        const riskDocs = allDocs.filter(d => d.risk_notes && d.risk_notes.length > 0);
        const missingUncList = allDocs.filter(d => (d.risk_notes || []).some(r => r.includes('UNC') || r.includes('tiền mặt')));
        const missingCoCqList = allDocs.filter(d => (d.risk_notes || []).some(r => r.includes('C/O') || r.includes('Hải quan')));
        const missingInvoiceList = allDocs.filter(d => (d.risk_notes || []).some(r => r.includes('hóa đơn')));

        const totalDocs = allDocs.length;
        const validDocs = allDocs.filter(d => d.compliance_status === 'VALID').length;
        const readinessScore = totalDocs > 0 ? Math.round((validDocs / totalDocs) * 100) : 100;

        let totalRevenue = 0;
        let totalExpense = 0;
        let totalVatOutput = 0;
        let totalVatInput = 0;

        allDocs.forEach(d => {
            if (d.category === 'TAX_INVOICE' && d.status === 'Đã Phát Hành') {
                totalRevenue += (d.amount || 0);
                totalVatOutput += (d.vat_amount || 0);
            } else if (d.category === 'INBOUND_PURCHASE' && d.source_module === 'EXPENSES') {
                totalExpense += (d.amount || 0);
                totalVatInput += (d.vat_amount || 0);
            }
        });

        const taxPayable = totalVatOutput - totalVatInput;

        let locks = [];
        try {
            const lockRes = await pool.query("SELECT * FROM tax_vault_locks ORDER BY locked_at DESC");
            locks = lockRes.rows;
        } catch (e) {}

        res.json({
            success: true,
            summary: {
                total_documents: totalDocs,
                valid_documents: validDocs,
                warning_documents: riskDocs.length,
                readiness_score: readinessScore,
                categories: categoryCounts,
                financials: {
                    total_revenue: totalRevenue,
                    total_expense: totalExpense,
                    vat_output: totalVatOutput,
                    vat_input: totalVatInput,
                    vat_payable: taxPayable > 0 ? taxPayable : 0
                },
                risks: {
                    total_risks: riskDocs.length,
                    missing_unc_count: missingUncList.length,
                    missing_cocq_count: missingCoCqList.length,
                    missing_invoice_count: missingInvoiceList.length
                },
                locks: locks
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// =========================================================================
// API 2: [GET] LẤY TOÀN BỘ CHỨNG TỪ KÈM BỘ LỌC ĐA CHIỀU (ALL DOCS & FILTER)
// =========================================================================
router.get('/all', async (req, res) => {
    try {
        const { category, period, quarter, search, risk_only, source } = req.query;
        let docs = await aggregateAllVaultDocuments();

        if (category && category !== 'ALL') {
            docs = docs.filter(d => d.category === category);
        }
        if (period && period !== 'ALL') {
            docs = docs.filter(d => d.period_tag === period || d.date?.startsWith(period));
        }
        if (quarter && quarter !== 'ALL') {
            docs = docs.filter(d => d.quarter_tag === quarter);
        }
        if (source && source !== 'ALL') {
            docs = docs.filter(d => d.source_module === source);
        }
        if (risk_only === 'true') {
            docs = docs.filter(d => d.risk_notes && d.risk_notes.length > 0);
        }
        if (search) {
            const q = search.toLowerCase();
            docs = docs.filter(d => 
                (d.code || '').toLowerCase().includes(q) ||
                (d.title || '').toLowerCase().includes(q) ||
                (d.partner_name || '').toLowerCase().includes(q) ||
                (d.partner_tax_code || '').toLowerCase().includes(q) ||
                (d.vault_code || '').toLowerCase().includes(q) ||
                (d.items_summary || '').toLowerCase().includes(q)
            );
        }

        res.json({
            success: true,
            total: docs.length,
            data: docs
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// =========================================================================
// API 3: [GET] DANH SÁCH GỢI Ý MÃ REF / MÃ KÉT SẮT (SUGGESTIONS)
// =========================================================================
router.get('/ref-suggestions', async (req, res) => {
    try {
        const docs = await aggregateAllVaultDocuments();
        const suggestions = docs.map(d => ({
            id: d.id,
            ref_code: d.code,
            vault_code: d.vault_code,
            title: d.title,
            partner_name: d.partner_name,
            category: d.category,
            category_label: d.category_label,
            date: d.date,
            docs_count: d.docs_count,
            source_module: d.source_module
        }));

        res.json({
            success: true,
            total: suggestions.length,
            data: suggestions
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// =========================================================================
// API 4: [GET] BỘ HỒ SƠ THANH TRA THEO KỲ & DỰ ÁN (AUDIT DOSSIER BUNDLES)
// =========================================================================
router.get('/audit-bundles', async (req, res) => {
    try {
        const allDocs = await aggregateAllVaultDocuments();
        const { group_by = 'period' } = req.query;

        const bundles = {};

        if (group_by === 'period') {
            allDocs.forEach(doc => {
                const pKey = doc.period_tag || 'Khác';
                if (!bundles[pKey]) {
                    bundles[pKey] = {
                        bundle_id: `BUNDLE-${pKey}`,
                        title: `Bộ Hồ Sơ Kỳ Thuế: Tháng ${pKey.replace('-', '/')}`,
                        period: pKey,
                        quarter: doc.quarter_tag,
                        is_locked: doc.is_locked,
                        chain: {
                            link1_quote_contract: [], // Báo giá & Hợp đồng
                            link2_invoice_out: [],    // Hóa đơn bán ra
                            link3_dispatch_wms: [],   // Phiếu xuất kho & Bàn giao
                            link4_invoice_in: [],     // Hóa đơn đầu vào & Phiếu nhập
                            link5_bank_payment: [],   // Chứng từ ngân hàng / UNC
                            link6_origin_cocq: []     // Tờ khai HQ, C/O, C/Q
                        },
                        total_amount_out: 0,
                        total_amount_in: 0,
                        total_docs: 0,
                        missing_links: []
                    };
                }

                bundles[pKey].total_docs++;

                if (doc.category === 'CONTRACT_BOQ') {
                    bundles[pKey].chain.link1_quote_contract.push(doc);
                } else if (doc.category === 'TAX_INVOICE') {
                    bundles[pKey].chain.link2_invoice_out.push(doc);
                    bundles[pKey].total_amount_out += (doc.amount || 0);
                } else if (doc.category === 'OUTBOUND_DISPATCH') {
                    bundles[pKey].chain.link3_dispatch_wms.push(doc);
                } else if (doc.category === 'INBOUND_PURCHASE') {
                    bundles[pKey].chain.link4_invoice_in.push(doc);
                    bundles[pKey].total_amount_in += (doc.amount || 0);
                } else if (doc.category === 'CASH_BANKING') {
                    bundles[pKey].chain.link5_bank_payment.push(doc);
                } else if (doc.category === 'ORIGIN_CO_CQ') {
                    bundles[pKey].chain.link6_origin_cocq.push(doc);
                }
            });
        }

        const bundleList = Object.values(bundles).map(b => {
            const hasL1 = b.chain.link1_quote_contract.length > 0;
            const hasL2 = b.chain.link2_invoice_out.length > 0;
            const hasL3 = b.chain.link3_dispatch_wms.length > 0;
            const hasL4 = b.chain.link4_invoice_in.length > 0;
            const hasL5 = b.chain.link5_bank_payment.length > 0;
            const hasL6 = b.chain.link6_origin_cocq.length > 0;

            const activeLinksCount = [hasL1, hasL2, hasL3, hasL4, hasL5, hasL6].filter(Boolean).length;
            const completeness = Math.round((activeLinksCount / 6) * 100);

            const missing = [];
            if (!hasL1) missing.push('Thiếu Báo giá / Hợp đồng');
            if (!hasL2) missing.push('Thiếu Hóa đơn bán ra');
            if (!hasL3) missing.push('Thiếu Phiếu xuất kho / Biên bản giao');
            if (!hasL4) missing.push('Thiếu Hóa đơn đầu vào');
            if (!hasL5) missing.push('Thiếu Chứng từ ngân hàng / UNC');
            if (!hasL6) missing.push('Thiếu Hồ sơ C/O, C/Q hoặc Tờ khai HQ');

            return {
                ...b,
                completeness: completeness,
                missing_links: missing,
                readiness_badge: completeness === 100 ? 'HOÀN HẢO' : (completeness >= 60 ? 'KHÁ' : 'CẦN BỔ SUNG')
            };
        });

        bundleList.sort((a, b) => b.period.localeCompare(a.period));

        res.json({
            success: true,
            total_bundles: bundleList.length,
            data: bundleList
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// =========================================================================
// API 5: [POST] BỔ SUNG / ĐÍNH KÈM CHỨNG TỪ VÀO MÃ KÉT SẮT / REF CÓ SẴN (ATTACH)
// =========================================================================
router.post('/attach-to-ref', upload.single('file'), async (req, res) => {
    try {
        const {
            target_id,
            ref_code,
            vault_code,
            doc_type = 'ChungTuBoSung',
            title,
            note,
            doc_number,
            doc_date
        } = req.body;

        if (!req.file) {
            return res.status(400).json({ success: false, error: 'Vui lòng chọn tệp tin cần đính kèm!' });
        }

        const cleanTargetId = target_id || ref_code || vault_code;
        if (!cleanTargetId) {
            return res.status(400).json({ success: false, error: 'Thiếu thông tin Mã Két Sắt hoặc Mã Ref cần bổ sung!' });
        }

        const fileUrl = `/uploads/vault/${req.file.filename}`;
        const fileName = req.file.originalname;
        const ext = path.extname(req.file.originalname).toLowerCase();
        const fileType = ext.includes('pdf') ? 'pdf' : (ext.includes('xml') ? 'xml' : (['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? 'image' : 'doc'));
        const finalTitle = title || `${doc_type}: ${fileName}`;

        // 1. Lưu bản ghi vào bảng tax_vault_documents để index và liên kết toàn diện
        const insertRes = await pool.query(`
            INSERT INTO tax_vault_documents (
                vault_code, category, sub_category, title, doc_number, doc_date,
                file_url, file_name, file_type, note, source_module, ref_id, is_verified
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'SUPPLEMENT_ATTACHMENT', $11, true)
            RETURNING *
        `, [
            vault_code || `VLT-ATT-${Date.now().toString().slice(-5)}`,
            'LEGAL_COMPLIANCE',
            doc_type,
            finalTitle,
            doc_number || '',
            doc_date || new Date(),
            fileUrl,
            fileName,
            fileType,
            note || '',
            cleanTargetId
        ]);

        // 2. Cập nhật trực tiếp vào phân hệ gốc nếu có thể
        if (cleanTargetId.startsWith('IMP-') || cleanTargetId.startsWith('PO-IMP-') || cleanTargetId.startsWith('AS0182')) {
            const impId = cleanTargetId.replace('IMP-', '');
            const importsData = readJsonFile(importsFile);
            const impItem = importsData.find(i => String(i.id) === impId || i.po_code === cleanTargetId);
            if (impItem) {
                if (!impItem.docs) impItem.docs = {};
                const bucket = doc_type.toLowerCase().includes('co') || doc_type.toLowerCase().includes('cert') ? 'cert' :
                               (doc_type.toLowerCase().includes('hải quan') || doc_type.toLowerCase().includes('customs') ? 'customs' : 'transport');
                if (!impItem.docs[bucket]) impItem.docs[bucket] = [];
                impItem.docs[bucket].push({
                    name: finalTitle,
                    url: fileUrl,
                    original_name: fileName,
                    uploaded_at: new Date().toISOString()
                });
                writeJsonFile(importsFile, importsData);
            }
        } else if (cleanTargetId.startsWith('PUR-') || cleanTargetId.startsWith('PO-DOM-')) {
            const purId = cleanTargetId.replace('PUR-', '');
            const purchasesData = readJsonFile(purchasesFile);
            const purItem = purchasesData.find(p => String(p.id) === purId || p.po_code === cleanTargetId);
            if (purItem) {
                if (!purItem.docs) purItem.docs = {};
                const bucket = doc_type.toLowerCase().includes('unc') ? 'unc' : 'wms_receipt';
                if (!purItem.docs[bucket]) purItem.docs[bucket] = [];
                purItem.docs[bucket].push({
                    name: finalTitle,
                    url: fileUrl,
                    original_name: fileName,
                    uploaded_at: new Date().toISOString()
                });
                writeJsonFile(purchasesFile, purchasesData);
            }
        } else if (cleanTargetId.startsWith('ORD-') || cleanTargetId.startsWith('DH-')) {
            const ordId = cleanTargetId.replace('ORD-', '');
            try {
                // Lấy ID order
                const oCheck = await pool.query("SELECT id FROM orders WHERE id = $1 OR order_code = $2", [isNaN(ordId) ? 0 : parseInt(ordId), cleanTargetId]);
                if (oCheck.rows.length > 0) {
                    await pool.query(`
                        INSERT INTO order_docs (order_id, doc_name, doc_url, doc_type) 
                        VALUES ($1, $2, $3, $4)
                    `, [oCheck.rows[0].id, finalTitle, fileUrl, doc_type]);
                }
            } catch (e) {}
        } else if (cleanTargetId.startsWith('CTR-') || cleanTargetId.startsWith('HD-')) {
            const ctrId = cleanTargetId.replace('CTR-', '');
            try {
                const cCheck = await pool.query("SELECT id FROM contracts WHERE id = $1 OR contract_code = $2", [isNaN(ctrId) ? 0 : parseInt(ctrId), cleanTargetId]);
                if (cCheck.rows.length > 0) {
                    await pool.query(`
                        INSERT INTO contract_payments (contract_id, amount, payment_date, proof_url, note) 
                        VALUES ($1, 0, CURRENT_DATE, $2, $3)
                    `, [cCheck.rows[0].id, fileUrl, finalTitle]);
                }
            } catch (e) {}
        }

        res.json({
            success: true,
            message: `✅ Đã bổ sung thành công tệp tin vào mã [${cleanTargetId}]!`,
            data: insertRes.rows[0]
        });

    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// =========================================================================
// API 6: [POST] NẠP HỒ SƠ MỚI ĐỘC LẬP VÀO KÉT SẮT (DEPOSIT DOC)
// =========================================================================
router.post('/deposit', upload.single('file'), async (req, res) => {
    try {
        const {
            category,
            sub_category,
            title,
            doc_number,
            doc_date,
            partner_name,
            partner_tax_code,
            amount,
            vat_amount,
            note,
            period_tag,
            ref_id
        } = req.body;

        if (!title || !category) {
            return res.status(400).json({ success: false, error: 'Vui lòng nhập Tên chứng từ và Danh mục khoang két sắt!' });
        }

        let fileUrl = '';
        let fileName = '';
        let fileType = 'pdf';

        if (req.file) {
            fileUrl = `/uploads/vault/${req.file.filename}`;
            fileName = req.file.originalname;
            const ext = path.extname(req.file.originalname).toLowerCase();
            fileType = ext.includes('pdf') ? 'pdf' : (ext.includes('xml') ? 'xml' : (['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? 'image' : 'doc'));
        }

        const vaultCode = `VLT-${Date.now().toString().slice(-6)}`;
        const finalPeriod = period_tag || getPeriodTag(doc_date);

        const result = await pool.query(`
            INSERT INTO tax_vault_documents (
                vault_code, category, sub_category, title, doc_number, doc_date,
                partner_name, partner_tax_code, amount, vat_amount, file_url,
                file_name, file_type, note, period_tag, source_module, ref_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'MANUAL_DEPOSIT', $16)
            RETURNING *
        `, [
            vaultCode,
            category,
            sub_category || 'Chứng từ bổ sung',
            title,
            doc_number || '',
            doc_date || new Date(),
            partner_name || '',
            partner_tax_code || '',
            parseFloat(amount) || 0,
            parseFloat(vat_amount) || 0,
            fileUrl,
            fileName,
            fileType,
            note || '',
            finalPeriod,
            ref_id || ''
        ]);

        res.json({
            success: true,
            message: `Đã nạp thành công chứng từ "${title}" vào Két Sắt!`,
            data: result.rows[0]
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// =========================================================================
// API 7: [POST] NIÊM PHONG / KHÓA SỔ KÉT SẮT THEO KỲ (LOCK / UNLOCK PERIOD)
// =========================================================================
router.post('/lock-period', async (req, res) => {
    try {
        const { period_key, action = 'LOCK', lock_reason = 'Khóa sổ quyết toán thuế', period_type = 'MONTH' } = req.body;
        if (!period_key) return res.status(400).json({ success: false, error: 'Thiếu thông tin kỳ cần niêm phong' });

        if (action === 'LOCK') {
            await pool.query(`
                INSERT INTO tax_vault_locks (period_key, period_type, lock_reason, locked_by, locked_at)
                VALUES ($1, $2, $3, 'ADMIN', CURRENT_TIMESTAMP)
                ON CONFLICT (period_key) DO UPDATE SET lock_reason = EXCLUDED.lock_reason, locked_at = CURRENT_TIMESTAMP
            `, [period_key, period_type, lock_reason]);
            res.json({ success: true, message: `🔒 Đã niêm phong Két Sắt cho kỳ [${period_key}] thành công!` });
        } else {
            await pool.query("DELETE FROM tax_vault_locks WHERE period_key = $1", [period_key]);
            res.json({ success: true, message: `🔓 Đã mở khóa niêm phong cho kỳ [${period_key}]!` });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// =========================================================================
// API 8: [DELETE] XÓA CHỨNG TỪ ĐÍNH KÈM / BỔ SUNG TRONG KÉT SẮT
// =========================================================================
router.delete('/doc/:id', async (req, res) => {
    try {
        const docId = req.params.id.replace('VLT-', '');
        const check = await pool.query("SELECT * FROM tax_vault_documents WHERE id = $1", [docId]);
        if (check.rows.length === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy chứng từ' });

        if (check.rows[0].file_url) {
            const filePath = path.join(__dirname, '../public', check.rows[0].file_url);
            if (fs.existsSync(filePath)) {
                try { fs.unlinkSync(filePath); } catch (e) {}
            }
        }

        await pool.query("DELETE FROM tax_vault_documents WHERE id = $1", [docId]);
        res.json({ success: true, message: 'Đã xóa chứng từ khỏi két sắt!' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// =========================================================================
// API 9: [GET] XUẤT BẢNG KÊ CHỨNG TỪ PHÁP LÝ & THUẾ (CSV / EXPORT)
// =========================================================================
router.get('/export-csv', async (req, res) => {
    try {
        const { period, category } = req.query;
        let docs = await aggregateAllVaultDocuments();

        if (period && period !== 'ALL') docs = docs.filter(d => d.period_tag === period);
        if (category && category !== 'ALL') docs = docs.filter(d => d.category === category);

        let csv = "\uFEFFMÃ KÉT SẮT,KHOANG CHỨNG TỪ,PHÂN LOẠI,MÃ SỐ CHỨNG TỪ,TÊN HỒ SƠ / CHỨNG TỪ,NGÀY LẬP,ĐỐI TÁC / KHÁCH HÀNG,MÃ SỐ THUẾ,DOANH SỐ / GIÁ TRỊ,THUẾ GTGT,SỐ LƯỢNG FILE,TÌNH TRẠNG PHÁP LÝ,CẢNH BÁO RỦI RO THUẾ\n";

        docs.forEach((d) => {
            const safeTitle = `"${(d.title || '').replace(/"/g, '""')}"`;
            const safePartner = `"${(d.partner_name || '').replace(/"/g, '""')}"`;
            const safeRisks = `"${(d.risk_notes || []).join('; ').replace(/"/g, '""')}"`;

            csv += `${d.vault_code},"${d.category_label}","${d.sub_category}",${d.code},${safeTitle},${d.date},${safePartner},"${d.partner_tax_code || ''}",${d.amount || 0},${d.vat_amount || 0},${d.docs_count || 0},"${d.compliance_status === 'VALID' ? 'Hợp lệ' : 'Cần bổ sung'}",${safeRisks}\n`;
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=Bang_Ke_Ket_Sat_Chung_Tu_Thue_${period || 'ALL'}.csv`);
        res.send(csv);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
