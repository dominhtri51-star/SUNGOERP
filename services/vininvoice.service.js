const pool = require('../config/database.js');

let cachedLoginKey = null;
let cachedLoginKeyExpiry = 0;

const DEFAULT_CONFIG = {
    apiUrl: 'https://vininvoice.vn/api',
    username: '0315614349',
    password: '12345678',
    invoiceForm: '1',
    invoiceSerial: 'C26TMT',
    invoiceFormSerial: '1C26TMT'
};

const vininvoiceService = {
    /**
     * Lấy cấu hình kết nối VinInvoice từ bảng system_settings
     */
    getConfig: async function() {
        try {
            const res = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'vininvoice_api_config'");
            if (res.rows.length > 0 && res.rows[0].setting_value) {
                const parsed = typeof res.rows[0].setting_value === 'string' 
                    ? JSON.parse(res.rows[0].setting_value) 
                    : res.rows[0].setting_value;
                return { ...DEFAULT_CONFIG, ...parsed };
            }
        } catch(e) {
            console.warn('Lỗi đọc cấu hình VinInvoice:', e.message);
        }
        return { ...DEFAULT_CONFIG };
    },

    /**
     * Lưu cấu hình kết nối VinInvoice vào system_settings (Không làm thay đổi schema CSDL)
     */
    saveConfig: async function(newConfig) {
        const current = await this.getConfig();
        const updated = {
            apiUrl: (newConfig.apiUrl || current.apiUrl || DEFAULT_CONFIG.apiUrl).trim().replace(/\/+$/, ''),
            username: (newConfig.username || current.username || DEFAULT_CONFIG.username).trim(),
            password: (newConfig.password && newConfig.password.trim() !== '' && !newConfig.password.includes('•')
                ? newConfig.password 
                : current.password),
            invoiceForm: (newConfig.invoiceForm || current.invoiceForm || DEFAULT_CONFIG.invoiceForm).trim(),
            invoiceSerial: (newConfig.invoiceSerial || current.invoiceSerial || DEFAULT_CONFIG.invoiceSerial).trim().toUpperCase()
        };
        updated.invoiceFormSerial = `${updated.invoiceForm}${updated.invoiceSerial}`;

        await pool.query(`
            INSERT INTO system_settings (setting_key, setting_value)
            VALUES ('vininvoice_api_config', $1)
            ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value
        `, [JSON.stringify(updated)]);

        // Xóa cache login key để yêu cầu xác thực mới
        cachedLoginKey = null;
        cachedLoginKeyExpiry = 0;

        return updated;
    },

    /**
     * Lấy login_key (có cache 20 giờ, hiệu lực tối đa 24h của VinInvoice)
     */
    getLoginKey: async function(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && cachedLoginKey && cachedLoginKeyExpiry > now) {
            return cachedLoginKey;
        }

        const config = await this.getConfig();
        const authUrl = `${config.apiUrl}/rest/s1/iam-auth/login-key`;

        const res = await fetch(authUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: config.username,
                password: config.password
            })
        });

        const data = await res.json();
        if (res.status !== 200 || !data.login_key) {
            const errMsg = data.error || data.message || (data.errors ? JSON.stringify(data.errors) : 'Đăng nhập VinInvoice không thành công');
            throw new Error(`Xác thực VinInvoice thất bại: ${errMsg}`);
        }

        cachedLoginKey = data.login_key;
        // Cache trong 20 giờ
        cachedLoginKeyExpiry = now + 20 * 60 * 60 * 1000;
        return cachedLoginKey;
    },

    /**
     * Thử nghiệm kiểm tra kết nối API
     */
    testConnection: async function() {
        const config = await this.getConfig();
        const loginKey = await this.getLoginKey(true);
        return {
            success: true,
            message: `Kết nối API VinInvoice thành công! (Tài khoản: ${config.username}, Mẫu số: ${config.invoiceFormSerial})`,
            loginKey: loginKey,
            loginKeyPreview: loginKey ? `${loginKey.substring(0, 8)}...` : '',
            config: {
                apiUrl: config.apiUrl,
                username: config.username,
                invoiceForm: config.invoiceForm,
                invoiceSerial: config.invoiceSerial,
                invoiceFormSerial: config.invoiceFormSerial
            }
        };
    },

    /**
     * Đẩy tạo Hóa Đơn Nháp lên VinInvoice (create-from-3rd)
     * TUYỆT ĐỐI KHÔNG TỰ KÝ SỐ - CHỈ TẠO BẢN NHÁP CHO KTT DUYỆT & KÝ USB TOKEN
     */
    createDraftInvoice: async function(invoice, items = []) {
        const config = await this.getConfig();
        const loginKey = await this.getLoginKey();

        // 1. Chuẩn hóa ngày lập hóa đơn (YYYY-MM-DD HH:mm:ss)
        const d = invoice.created_at ? new Date(invoice.created_at) : new Date();
        const pad = n => String(n).padStart(2, '0');
        const invoiceDateStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

        // 2. Chuẩn hóa danh sách hàng hóa (productItems)
        if (!Array.isArray(items) || items.length === 0) {
            throw new Error('Hóa đơn không có danh mục sản phẩm/dịch vụ nào!');
        }

        const productItems = items.map((i, idx) => {
            const desc = (i.accounting_name || i.product_name || i.commercial_name || `Mặt hàng ${idx + 1}`).trim();
            const uom = (i.unit || 'Bộ').trim();
            const qty = parseFloat(i.quantity) || 1;
            const price = parseFloat(i.unit_price || i.price || 0);
            const rate = String(i.vat_rate !== undefined && i.vat_rate !== null ? i.vat_rate : (invoice.vat_rate || 8)).trim();
            const numRate = parseFloat(rate) || 0;
            const itemTotalPreTax = Math.round(qty * price * 100) / 100;
            const itemVat = Math.round(itemTotalPreTax * (numRate / 100));

            return {
                description: desc,
                Description: desc, // Hỗ trợ cả 2 chuẩn casing
                quantityUomDesc: uom,
                quantity: qty,
                amount: price,
                taxRate: rate,
                taxAmount: itemVat,
                discountPercent: "0",
                discountAmount: 0,
                isPromotion: "N",
                amountTotal: itemTotalPreTax
            };
        });

        // 3. Chuẩn hóa phân bổ thuế (taxTotalPayments)
        const taxGroupMap = {};
        productItems.forEach(item => {
            const r = item.taxRate || '8';
            if (!taxGroupMap[r]) {
                taxGroupMap[r] = {
                    taxRate: r,
                    amountExcludeTax: 0,
                    taxAmount: 0,
                    amountTotal: 0
                };
            }
            taxGroupMap[r].amountExcludeTax += item.amountTotal;
            taxGroupMap[r].taxAmount += item.taxAmount;
            taxGroupMap[r].amountTotal += (item.amountTotal + item.taxAmount);
        });

        const taxTotalPayments = Object.values(taxGroupMap);

        // 4. Tổng tiền sau thuế
        const calculatedTotal = productItems.reduce((acc, curr) => acc + curr.amountTotal + curr.taxAmount, 0);
        const finalInvoiceTotal = parseFloat(invoice.total_amount) > 0 ? parseFloat(invoice.total_amount) : calculatedTotal;

        // 5. Đóng gói payload đúng chuẩn v2.1 (bỏ qua paymentInstrumentEnumId để tránh lỗi enum DB VinInvoice)
        const payload = {
            invoiceForm: config.invoiceForm || '1',
            invoiceSerial: config.invoiceSerial || 'C26TMT',
            invoiceDate: invoiceDateStr,
            toPartyName: (invoice.company_name || invoice.buyer_company || 'Khách Hàng').trim(),
            toName: (invoice.buyer_name || invoice.customer_name || invoice.company_name || 'Khách Hàng').trim(),
            toPartyTaxId: (invoice.tax_code || '').trim(),
            toAddress: (invoice.company_address || invoice.buyer_address || 'Việt Nam').trim(),
            toEmailAddress: (invoice.vat_email || invoice.buyer_email || '').trim(),
            toTelecomNumber: (invoice.buyer_phone || '').trim(),
            currencyUomId: 'VND',
            exchangeRate: 1,
            invoiceTotal: finalInvoiceTotal,
            thirdPartyCode: (invoice.ref_code || `ERP-INV-${invoice.id}`).trim(),
            productItems: productItems,
            taxTotalPayments: taxTotalPayments
        };

        const createUrl = `${config.apiUrl}/rest/s1/iam-invoice/invoices/create-from-3rd`;
        const res = await fetch(createUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'login_key': loginKey
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.success === 'N' || data.errorCode >= 400 || !data.invoiceId) {
            const errStr = data.message || data.messages || data.errors || JSON.stringify(data);
            throw new Error(`VinInvoice từ chối tiếp nhận: ${errStr}`);
        }

        return {
            success: true,
            invoiceId: data.invoiceId,
            invoiceSerial: data.invoiceSerial || config.invoiceSerial,
            invoiceForm: data.invoiceForm || config.invoiceForm,
            invoiceDate: data.invoiceDate || invoiceDateStr,
            message: data.message || 'Thành công'
        };
    }
};

module.exports = vininvoiceService;
