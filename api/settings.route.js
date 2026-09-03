const express = require('express');
const router = express.Router();

function isAuthorizedAdmin(req) {
    if (req.user && req.user.role) {
        const userRole = String(req.user.role).toUpperCase().trim();
        const adminRoles = ["ADMIN", "SUPER_ADMIN", "GIAM_DOC", "TONG_GIAM_DOC", "DIRECTOR"];
        return adminRoles.includes(userRole);
    }
    return false;
}
const pool = require('../config/database');

const fs = require('fs');
const path = require('path');

const settingsFile = path.join(__dirname, '../data/settings.json');

const DEFAULT_ROLE_PERMISSIONS = {
    'ADMIN': { '*': 'EDIT' },
    'SUPER_ADMIN': { '*': 'EDIT' },
    'GIAM_DOC': { '*': 'EDIT' },
    'SALE_ADMIN': {
        'admin-products': 'EDIT',
        'sale-crm': 'EDIT',
        'sale-orders': 'EDIT',
        'order-history': 'EDIT',
        'return-orders': 'EDIT',
        'sales-commissions': 'EDIT',
        'sale-boq': 'EDIT',
        'sale-boq-hybrid': 'EDIT',
        'sale-boq-ongrid': 'EDIT',
        'sale-boq-offgrid': 'EDIT',
        'sale-boq-pump': 'EDIT',
        'boq-list': 'EDIT',
        'admin-approve': 'EDIT',
        'inventory-dash': 'VIEW',
        'marketplace': 'EDIT',
        'bidding-marketplace': 'EDIT',
        'project-contractors': 'EDIT'
    },
    'SALE': {
        'admin-products': 'VIEW', // Nhân viên kinh doanh: Chỉ Xem sản phẩm (không sửa/xóa được)
        'sale-crm': 'EDIT',
        'sale-orders': 'EDIT',
        'order-history': 'EDIT',
        'return-orders': 'EDIT',
        'sales-commissions': 'VIEW',
        'sale-boq': 'EDIT',
        'sale-boq-hybrid': 'EDIT',
        'sale-boq-ongrid': 'EDIT',
        'sale-boq-offgrid': 'EDIT',
        'sale-boq-pump': 'EDIT',
        'boq-list': 'EDIT',
        'marketplace': 'EDIT'
    },
    'THU_MUA': {
        'admin-products': 'EDIT',
        'suppliers': 'EDIT',
        'import-orders': 'EDIT',
        'purchases': 'EDIT',
        'procurement-inventory': 'EDIT',
        'marketplace': 'EDIT'
    },
    'NHAN_VIEN_KHO': {
        'admin-products': 'VIEW',
        'inventory-dash': 'EDIT',
        'warehouse-in': 'EDIT',
        'warehouse-out': 'EDIT',
        'return-orders': 'EDIT'
    },
    'KE_TOAN': {
        'admin-products': 'VIEW',
        'accounting-vault': 'EDIT',
        'accounting-cashbook': 'EDIT',
        'accounting-cash': 'EDIT',
        'accounting-payments': 'EDIT',
        'contract-billing': 'EDIT',
        'accounting-vat': 'EDIT',
        'accounting-tax': 'EDIT',
        'business-health': 'EDIT',
        'hr-employees': 'EDIT',
        'attendance-manager': 'EDIT',
        'sales-commissions': 'EDIT',
        'debt-kpi': 'EDIT',
        'payroll-manager': 'EDIT',
        'finance-loans': 'EDIT',
        'finance-capital': 'EDIT'
    },
    'KY_THUAT': {
        'admin-products': 'VIEW',
        'project-list': 'EDIT',
        'om-schedule': 'EDIT',
        'warranty-list': 'EDIT'
    },
    'HR': {
        'hr-employees': 'EDIT',
        'attendance-manager': 'EDIT',
        'payroll-manager': 'EDIT',
        'debt-kpi': 'EDIT',
        'sales-commissions': 'VIEW'
    },
    'NHA_THAU_THI_CONG': {
        'marketplace': 'EDIT',
        'bidding-marketplace': 'EDIT',
        'contractor-portal': 'EDIT',
        'contractor-my-profile': 'EDIT'
    },
    'THAU_THI_CONG': {
        'marketplace': 'EDIT',
        'bidding-marketplace': 'EDIT',
        'contractor-portal': 'EDIT',
        'contractor-my-profile': 'EDIT'
    },
    'NHA_THAU_GIAM_SAT': {
        'marketplace': 'EDIT',
        'bidding-marketplace': 'EDIT',
        'contractor-portal': 'EDIT',
        'contractor-my-profile': 'EDIT'
    },
    'GIAM_SAT': {
        'marketplace': 'EDIT',
        'bidding-marketplace': 'EDIT',
        'contractor-portal': 'EDIT',
        'contractor-my-profile': 'EDIT'
    },
    'NHA_CUNG_CAP': {
        'marketplace': 'EDIT',
        'bidding-marketplace': 'EDIT',
        'contractor-portal': 'EDIT',
        'contractor-my-profile': 'EDIT'
    },
    'SUPPLIER': {
        'marketplace': 'EDIT',
        'bidding-marketplace': 'EDIT',
        'contractor-portal': 'EDIT',
        'contractor-my-profile': 'EDIT'
    }
};

const DEFAULT_QUOTE_TEMPLATES = {
    hybrid: {
        title: "BẢNG BÁO GIÁ HỆ THỐNG ĐIỆN MẶT TRỜI HYBRID ATS BACKUP",
        tech_solution: "HYBRID ATS BACKUP",
        tech_desc: "Tự động chuyển nguồn 10ms",
        primary_color: "#f59e0b",
        notes: "1. Bảo hành tấm pin mặt trời 12 năm vật lý, 30 năm hiệu suất trên 80%.\n2. Bảo hành biến tần Inverter Hybrid Cergy 05 năm chính hãng (1 đổi 1 trong 12 tháng đầu).\n3. Bảo hành Pin lưu trữ Lithium Apess 05 năm (6.000 chu kỳ nạp xả).\n4. Bảo hành toàn bộ hệ thống tủ điện ATS & cơ điện 02 năm trọn gói.",
        left_sign: "ĐẠI DIỆN KHÁCH HÀNG",
        right_sign: "ĐẠI DIỆN SUNGO SOLAR"
    },
    ongrid: {
        title: "BẢNG BÁO GIÁ HỆ THỐNG ĐIỆN MẶT TRỜI HÒA LƯỚI BÁM TẢI (ZERO-EXPORT)",
        tech_solution: "HÒA LƯỚI BÁM TẢI (ZERO-EXPORT)",
        tech_desc: "Chống phát ngược lưới 100%",
        primary_color: "#ea580c",
        notes: "1. Bảo hành tấm pin mặt trời 12 năm vật lý, 30 năm hiệu suất trên 80%.\n2. Bảo hành biến tần Inverter On-Grid 05 năm chính hãng.\n3. Bảo hành đồng hồ đo Smart Meter bám tải 02 năm.\n4. Bảo hành hệ thống kết cấu nhôm và an toàn điện 02 năm.",
        left_sign: "ĐẠI DIỆN KHÁCH HÀNG",
        right_sign: "ĐẠI DIỆN SUNGO SOLAR"
    },
    offgrid: {
        title: "BẢNG BÁO GIÁ HỆ THỐNG ĐIỆN MẶT TRỜI ĐỘC LẬP (OFF-GRID)",
        tech_solution: "ĐỘC LẬP CHUYÊN DỤNG (OFF-GRID)",
        tech_desc: "Tự chủ 100% nguồn điện 24/7",
        primary_color: "#059669",
        notes: "1. Bảo hành tấm pin mặt trời 12 năm vật lý, 30 năm hiệu suất trên 80%.\n2. Bảo hành biến tần Inverter Off-Grid 03 - 05 năm chính hãng.\n3. Bảo hành Pin lưu trữ Lithium 05 năm (BMS bảo vệ quá tải/quá nhiệt).\n4. Bảo hành hệ thống vận hành 02 năm trọn gói.",
        left_sign: "ĐẠI DIỆN KHÁCH HÀNG",
        right_sign: "ĐẠI DIỆN SUNGO SOLAR"
    },
    pump: {
        title: "BẢNG BÁO GIÁ HỆ THỐNG BƠM NƯỚC NĂNG LƯỢNG MẶT TRỜI (SOLAR PUMP)",
        tech_solution: "BƠM NĂNG LƯỢNG MẶT TRỜI (SOLAR PUMP)",
        tech_desc: "Tự động bơm theo cường độ nắng",
        primary_color: "#0284c7",
        notes: "1. Bảo hành tấm pin năng lượng mặt trời 12 năm vật lý, 30 năm hiệu suất.\n2. Bảo hành biến tần bơm Solar Pump Inverter 02 - 03 năm chính hãng.\n3. Bảo hành cảm biến mực nước, phao điện chống cạn và chống sét 02 năm.\n4. Miễn phí hướng dẫn vận hành & hỗ trợ kỹ thuật trọn đời.",
        left_sign: "ĐẠI DIỆN KHÁCH HÀNG",
        right_sign: "ĐẠI DIỆN SUNGO SOLAR"
    }
};

// Khởi tạo bảng Cài đặt hệ thống
const initTable = async () => {
    try {
        const dataDir = path.join(__dirname, '../data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

        if (pool && typeof pool.query === 'function') {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS system_settings (
                    setting_key VARCHAR(100) PRIMARY KEY,
                    setting_value TEXT
                );
            `);
            
            const defaults = [
                ['store_name', 'CÔNG TY TNHH NĂNG LƯỢNG MẶT TRỜI SUNGO'],
                ['store_phone', '0937.039.889'],
                ['company_hotline', '0937.039.889'],
                ['company_email', 'contact@sungo.vn'],
                ['company_website', 'www.sungo.vn'],
                ['store_address', '419/13 Song Hành Hà Nội, P. Trường Thọ, TP. Thủ Đức, TP.HCM'],
                ['store_tax', '0315614349'],
                ['store_logo', 'https://sungo.vn/wp-content/uploads/2023/11/logo-sungo.png'],
                ['quote_title', 'HÓA ĐƠN BÁN HÀNG KIÊM PHIẾU BẢO HÀNH'],
                ['quote_primary_color', '#f59e0b'],
                ['quote_bank_title', 'Thanh toán tiền mặt hoặc chuyển khoản:'],
                ['quote_bank_name', 'Techcombank'],
                ['quote_bank_code', 'TCB'],
                ['quote_bank_account_number', '19036668888019'],
                ['quote_bank_account_holder', 'CÔNG TY TNHH NĂNG LƯỢNG MẶT TRỜI SUNGO'],
                ['quote_show_qr', 'true'],
                ['quote_notes', 'Cảm ơn Quý khách đã tin tưởng và sử dụng sản phẩm & giải pháp của SUNGO SOLAR!'],
                ['quote_left_sign_title', 'KHÁCH HÀNG'],
                ['quote_right_sign_title', 'NGƯỜI BÁN'],
                ['quote_store_name', 'CÔNG TY TNHH NĂNG LƯỢNG MẶT TRỜI SUNGO'],
                ['quote_store_tax', '0315614349'],
                ['quote_store_phone', '0937.039.889'],
                ['quote_store_address', '419/13 Song Hành Hà Nội, P. Trường Thọ, TP. Thủ Đức, TP.HCM'],
                ['quote_store_logo', 'https://sungo.vn/wp-content/uploads/2023/11/logo-sungo.png'],
                ['delivery_notes', 'Hàng hóa đã xuất kho vui lòng kiểm tra kỹ. Không nhận đổi trả nếu không phải lỗi từ Nhà sản xuất.'],
                ['quote_templates', JSON.stringify(DEFAULT_QUOTE_TEMPLATES)],
                ['role_permissions', JSON.stringify(DEFAULT_ROLE_PERMISSIONS)]
            ];

            for (const [k, v] of defaults) {
                await pool.query(
                    'INSERT INTO system_settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO NOTHING',
                    [k, v]
                );
            }
        }
    } catch(e) { console.error("Lỗi tạo bảng system_settings:", e.message); }
};
initTable();

// Lấy danh sách cấu hình
router.get('/', async (req, res) => {
    let data = {};
    try {
        if (pool && typeof pool.query === 'function') {
            const { rows } = await pool.query('SELECT * FROM system_settings');
            rows.forEach(r => { 
                try {
                    data[r.setting_key] = JSON.parse(r.setting_value);
                } catch (err) {
                    data[r.setting_key] = r.setting_value; 
                }
            });
        }
    } catch(e) {
        console.warn("DB settings fallback:", e.message);
    }
    
    // Merge fallback từ file nếu có
    try {
        if (fs.existsSync(settingsFile)) {
            const fileData = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
            data = { ...fileData, ...data };
        }
    } catch(e) {}

    // Đảm bảo luôn có role_permissions đầy đủ
    let mergedPerms = { ...DEFAULT_ROLE_PERMISSIONS };
    if (data.role_permissions && typeof data.role_permissions === 'object') {
        for (const [r, perms] of Object.entries(data.role_permissions)) {
            mergedPerms[r] = perms;
        }
    }
    const contractorRoles = ['NHA_THAU_THI_CONG', 'THAU_THI_CONG', 'NHA_THAU_GIAM_SAT', 'GIAM_SAT', 'NHA_CUNG_CAP', 'SUPPLIER'];
    for (const cr of contractorRoles) {
        if (!mergedPerms[cr]) {
            mergedPerms[cr] = {
                'marketplace': 'EDIT',
                'bidding-marketplace': 'EDIT',
                'contractor-portal': 'EDIT',
                'contractor-my-profile': 'EDIT'
            };
        } else if (Array.isArray(mergedPerms[cr])) {
            if (!mergedPerms[cr].includes('marketplace')) mergedPerms[cr].push('marketplace');
            if (!mergedPerms[cr].includes('bidding-marketplace')) mergedPerms[cr].push('bidding-marketplace');
        } else if (typeof mergedPerms[cr] === 'object') {
            mergedPerms[cr]['marketplace'] = 'EDIT';
            mergedPerms[cr]['bidding-marketplace'] = 'EDIT';
            mergedPerms[cr]['contractor-portal'] = 'EDIT';
            mergedPerms[cr]['contractor-my-profile'] = 'EDIT';
        }
    }
    data.role_permissions = mergedPerms;

    // Đảm bảo luôn có quote_templates đầy đủ cho 4 hệ thống
    if (!data.quote_templates || typeof data.quote_templates !== 'object') {
        data.quote_templates = DEFAULT_QUOTE_TEMPLATES;
    } else {
        data.quote_templates = { ...DEFAULT_QUOTE_TEMPLATES, ...data.quote_templates };
    }

    return res.json({ success: true, data });
});

// Lưu cấu hình
router.put('/', async (req, res) => {
    if (!isAuthorizedAdmin(req)) {
        return res.status(403).json({ success: false, error: "⛔ TỪ CHỐI TRUY CẬP: Chỉ tài khoản Quản trị viên (Admin) hoặc Giám đốc mới có quyền cấu hình hệ thống & mẫu in!" });
    }
    let client;
    try {
        if (pool && typeof pool.connect === 'function') {
            client = await pool.connect();
            await client.query('BEGIN');
            
            for (const [key, value] of Object.entries(req.body)) {
                const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
                await client.query(
                    'INSERT INTO system_settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value',
                    [key, strValue]
                );
            }
            
            await client.query('COMMIT');
        }

        // Đồng bộ lưu ra file JSON fallback
        try {
            const dataDir = path.join(__dirname, '../data');
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
            let current = {};
            if (fs.existsSync(settingsFile)) {
                try { current = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch(e) {}
            }
            current = { ...current, ...req.body };
            fs.writeFileSync(settingsFile, JSON.stringify(current, null, 2), 'utf8');
        } catch(fe) {
            console.warn("Lỗi ghi file settings.json fallback:", fe.message);
        }

        res.json({ success: true });
    } catch(e) {
        if (client) await client.query('ROLLBACK');
        console.error("Lỗi API lưu cấu hình:", e);
        res.status(500).json({ success: false, error: e.message });
    } finally { 
        if (client) client.release(); 
    }
});

module.exports = router;