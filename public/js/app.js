const ALL_SYSTEM_GROUPS = [
    { 
        group: 'Tổng Quan & Hệ Thống', 
        roles: ['ADMIN', 'SUPER_ADMIN', 'GIAM_DOC'], 
        items: [ 
            { id: 'admin-dash', icon: 'fa-chart-pie', title: 'Báo Cáo Doanh Thu', desc: 'KPI doanh thu, tăng trưởng & thống kê' }, 
            { id: 'business-health', icon: 'fa-heartbeat', title: 'Sức Khoẻ Doanh Nghiệp', desc: 'Báo cáo CFO, dòng tiền & tài chính' }, 
            { id: 'admin-products', icon: 'fa-solar-panel', title: 'Danh Mục Sản Phẩm', desc: 'Bảng giá, tấm pin & inverter' }, 
            { id: 'admin-approve', icon: 'fa-check-double', title: 'Duyệt Báo Giá', desc: 'Phê duyệt giá bán & chiết khấu sale' }, 
            { id: 'settings', icon: 'fa-cogs', title: 'Cài Đặt Hệ Thống', desc: 'Cấu hình công ty, kho & phân quyền' }, 
            { id: 'admin-users', icon: 'fa-user-shield', title: 'Quản Lý Tài Khoản (RBAC)', desc: 'Tài khoản nhân viên, mật khẩu & quyền' } 
        ] 
    },
    { 
        group: 'Bán Hàng & CRM', 
        roles: ['ADMIN', 'SALE', 'SALES', 'TRUONG_PHONG_KD', 'SALE_LEAD', 'SALE_ADMIN'], 
        items: [ 
            { id: 'sale-crm', icon: 'fa-users', title: 'Khách Hàng (CRM)', desc: 'Quản lý thông tin & lịch sử khách hàng' }, 
            { id: 'sale-orders', icon: 'fa-shopping-cart', title: 'Tạo Đơn Hàng', desc: 'Lập đơn bán buôn & bán sỉ' }, 
            { id: 'order-history', icon: 'fa-receipt', title: 'Quản Lý Đơn Hàng', desc: 'Theo dõi tiến độ đơn hàng' }, 
            { id: 'return-orders', icon: 'fa-boxes', title: 'Kho QC & Trả Hàng', desc: 'Quản lý hàng lỗi & đổi trả' }, 
            { id: 'sales-commissions', icon: 'fa-hand-holding-usd', title: 'Hoa Hồng Bán Hàng', desc: 'Tính hoa hồng doanh số kinh doanh' }, 
            { id: 'sale-boq', icon: 'fa-file-invoice-dollar', title: 'Báo Giá Dự Án (BOQ)', desc: 'Công cụ tính toán công suất & giá BOQ' }, 
            { id: 'boq-list', icon: 'fa-history', title: 'Danh Sách BOQ', desc: 'Lưu trữ & tra cứu hồ sơ BOQ' } 
        ] 
    },
    { 
        group: 'Thu Mua & Vật Tư', 
        roles: ['ADMIN', 'THU_MUA'], 
        items: [ 
            { id: 'suppliers', icon: 'fa-building', title: 'Quản Lý Nhà Cung Cấp', desc: 'Danh bạ NCC & điều khoản nhập' }, 
            { id: 'import-orders', icon: 'fa-ship', title: 'Đơn Nhập Khẩu', desc: 'Tiến độ tàu hàng, container quốc tế' }, 
            { id: 'purchases', icon: 'fa-shopping-cart', title: 'Mua Hàng', desc: 'Phiếu yêu cầu & mua hàng nội địa' }, 
            { id: 'procurement-inventory', icon: 'fa-warehouse', title: 'Tồn Kho & Giá Vốn', desc: 'Lượng tồn kho & giá vốn nhập' } 
        ] 
    },
    { 
        group: 'Kho Vận & Đóng Gói (WMS)', 
        roles: ['ADMIN', 'NHAN_VIEN_KHO', 'WAREHOUSE'], 
        items: [ 
            { id: 'inventory-dash', icon: 'fa-boxes', title: 'Sơ Đồ Tồn Kho', desc: 'Sơ đồ vị trí kệ hàng & tồn kho' }, 
            { id: 'warehouse-in', icon: 'fa-box-open', title: 'Lệnh Nhập Kho', desc: 'Tạo & xác nhận phiếu nhập kho' }, 
            { id: 'warehouse-out', icon: 'fa-dolly', title: 'Lệnh Xuất & Đóng Gói', desc: 'Tạo lệnh xuất kho giao hàng' } 
        ] 
    },
    { 
        group: 'Kỹ Thuật & Thi Công', 
        roles: ['ADMIN', 'BAO_HANH', 'KY_THUAT', 'TECH'], 
        items: [ 
            { id: 'project-list', icon: 'fa-folder-open', title: 'Lưu Trữ Hồ Sơ Dự Án', desc: 'Hồ sơ kỹ thuật, bản vẽ CAD' }, 
            { id: 'om-schedule', icon: 'fa-tools', title: 'Lịch Bảo Trì O&M', desc: 'Lập lịch bảo dưỡng định kỳ solar' }, 
            { id: 'warranty-list', icon: 'fa-barcode', title: 'Quản Lý Mã Serial', desc: 'Tra cứu serial pin & inverter' } 
        ] 
    },
    { 
        group: 'Quản Lý Dự Án & Nhà Thầu', 
        roles: ['ADMIN', 'SUPER_ADMIN', 'GIAM_DOC', 'SALE_ADMIN'], 
        items: [ 
            { id: 'project-contractors', icon: 'fa-project-diagram', title: 'Dự Án & Chỉ Định Thầu', desc: 'Quản lý tổng thầu & giao việc' }, 
            { id: 'contractor-teams', icon: 'fa-user-shield', title: 'Hồ Sơ Danh Bạ Nhà Thầu', desc: 'Danh bạ đội thi công, giám sát' }, 
            { id: 'bidding-marketplace', icon: 'fa-gavel', title: 'Sàn Đấu Thầu Công Trình', desc: 'Đăng tin công trình, mời thầu' } 
        ] 
    },
    { 
        group: 'Nhân Sự & Tiền Lương', 
        roles: ['ADMIN', 'KE_TOAN', 'HR'], 
        items: [ 
            { id: 'hr-employees', icon: 'fa-id-badge', title: 'Hồ Sơ Nhân Sự', desc: 'Hồ sơ nhân viên & hợp đồng' }, 
            { id: 'debt-kpi', icon: 'fa-medal', title: 'KPI Thu Nợ & Thưởng Phạt', desc: 'Đánh giá KPI thu hồi công nợ' }, 
            { id: 'payroll-manager', icon: 'fa-file-invoice-dollar', title: 'Bảng Lương & Chấm Công', desc: 'Bảng lương tháng & bảo hiểm' } 
        ] 
    },
    { 
        group: 'Vốn & Khoản Vay (CFO)', 
        roles: ['ADMIN', 'KE_TOAN'], 
        items: [ 
            { id: 'finance-loans', icon: 'fa-university', title: 'Vay & Lãi Vay Ngân Hàng', desc: 'Khế ước vay, lịch trả nợ' }, 
            { id: 'finance-capital', icon: 'fa-chart-pie', title: 'Cơ Cấu Nguồn Vốn & Cổ Đông', desc: 'Vốn điều lệ, cổ phần cổ đông' } 
        ] 
    },
    { 
        group: 'Kế Toán & Tài Chính', 
        roles: ['ADMIN', 'KE_TOAN'], 
        items: [ 
            { id: 'accounting-vault', icon: 'fa-vault', title: 'Két Sắt Hồ Sơ & Thuế', desc: 'Kho tài liệu quyết toán thuế' }, 
            { id: 'accounting-cashbook', icon: 'fa-book-journal-whills', title: 'Sổ Quỹ Tiền Mặt (Thu/Chi)', desc: 'Phiếu thu, phiếu chi tiền mặt/NH' }, 
            { id: 'accounting-cash', icon: 'fa-wallet', title: 'Công Nợ Phải Thu (131)', desc: 'Theo dõi nợ khách hàng' }, 
            { id: 'accounting-payments', icon: 'fa-file-invoice-dollar', title: 'Phải Trả NCC & UNC (331)', desc: 'Lệnh chi tiền & UNC nhà cung cấp' }, 
            { id: 'contract-billing', icon: 'fa-file-contract', title: 'Hợp Đồng & Thanh Toán', desc: 'Soạn thảo & ký hợp đồng online' }, 
            { id: 'accounting-vat', icon: 'fa-file-invoice', title: 'Quản Lý Hóa Đơn VAT', desc: 'Hóa đơn điện tử VAT e-Invoice' }, 
            { id: 'accounting-tax', icon: 'fa-file-excel', title: 'Báo Cáo Thuế (HTKK)', desc: 'Kết xuất dữ liệu thuế HTKK' } 
        ] 
    },
    {
        group: 'Cổng Nghiệm Thu Nhà Thầu',
        roles: ['NHA_THAU_THI_CONG', 'THAU_THI_CONG', 'NHA_THAU_GIAM_SAT', 'GIAM_SAT', 'NHA_CUNG_CAP', 'SUPPLIER'],
        items: [
            { id: 'contractor-portal', icon: 'fa-clipboard-check', title: 'Dự Án & Hồ Sơ Nghiệm Thu', desc: 'Gửi báo cáo tiến độ, hình ảnh thi công' },
            { id: 'contractor-my-profile', icon: 'fa-id-card', title: 'Hồ Sơ Năng Lực', desc: 'Hồ sơ năng lực nhà thầu' }
        ]
    }
];

const DEFAULT_ROLE_PERMISSIONS = {
    'ADMIN': ['*'],
    'SUPER_ADMIN': ['*'],
    'GIAM_DOC': ['*'],
    'SALE_ADMIN': ['sale-crm', 'sale-orders', 'order-history', 'return-orders', 'sales-commissions', 'sale-boq', 'boq-list', 'admin-approve', 'inventory-dash', 'bidding-marketplace'],
    'SALE': ['sale-crm', 'sale-orders', 'order-history', 'return-orders', 'sales-commissions', 'sale-boq', 'boq-list'],
    'SALES': ['sale-crm', 'sale-orders', 'order-history', 'return-orders', 'sales-commissions', 'sale-boq', 'boq-list'],
    'THU_MUA': ['suppliers', 'import-orders', 'purchases', 'procurement-inventory'],
    'NHAN_VIEN_KHO': ['inventory-dash', 'warehouse-in', 'warehouse-out', 'return-orders'],
    'WAREHOUSE': ['inventory-dash', 'warehouse-in', 'warehouse-out', 'return-orders'],
    'KE_TOAN': ['accounting-vault', 'accounting-cashbook', 'accounting-cash', 'accounting-payments', 'contract-billing', 'accounting-vat', 'accounting-tax', 'business-health', 'hr-employees', 'sales-commissions', 'debt-kpi', 'payroll-manager', 'finance-loans', 'finance-capital'],
    'KY_THUAT': ['project-list', 'om-schedule', 'warranty-list'],
    'TECH': ['project-list', 'om-schedule', 'warranty-list'],
    'BAO_HANH': ['project-list', 'om-schedule', 'warranty-list'],
    'HR': ['hr-employees', 'payroll-manager', 'debt-kpi', 'sales-commissions'],
    'NHA_THAU_THI_CONG': ['contractor-portal', 'contractor-my-profile'],
    'THAU_THI_CONG': ['contractor-portal', 'contractor-my-profile'],
    'NHA_THAU_GIAM_SAT': ['contractor-portal', 'contractor-my-profile'],
    'GIAM_SAT': ['contractor-portal', 'contractor-my-profile'],
    'NHA_CUNG_CAP': ['contractor-portal', 'contractor-my-profile'],
    'SUPPLIER': ['contractor-portal', 'contractor-my-profile']
};

window.ALL_SYSTEM_GROUPS = ALL_SYSTEM_GROUPS;
window.DEFAULT_ROLE_PERMISSIONS = DEFAULT_ROLE_PERMISSIONS;
const baseMenus = ALL_SYSTEM_GROUPS;

// Cấu hình phím tắt thanh điều hướng Mobile Bottom Tab Bar theo từng Vai Trò
const roleBottomNavs = {
    'ADMIN': [
        { id: 'admin-dash', icon: 'fa-chart-pie', label: 'Báo Cáo' },
        { id: 'sale-orders', icon: 'fa-cart-plus', label: 'Bán Hàng' },
        { id: 'order-history', icon: 'fa-receipt', label: 'Đơn Hàng' },
        { id: 'inventory-dash', icon: 'fa-boxes', label: 'Tồn Kho' },
        { id: '__more__', icon: 'fa-bars', label: 'Tất Cả' }
    ],
    'SUPER_ADMIN': [
        { id: 'admin-dash', icon: 'fa-chart-pie', label: 'Báo Cáo' },
        { id: 'sale-orders', icon: 'fa-cart-plus', label: 'Bán Hàng' },
        { id: 'order-history', icon: 'fa-receipt', label: 'Đơn Hàng' },
        { id: 'inventory-dash', icon: 'fa-boxes', label: 'Tồn Kho' },
        { id: '__more__', icon: 'fa-bars', label: 'Tất Cả' }
    ],
    'GIAM_DOC': [
        { id: 'admin-dash', icon: 'fa-chart-pie', label: 'Báo Cáo' },
        { id: 'sale-orders', icon: 'fa-cart-plus', label: 'Bán Hàng' },
        { id: 'order-history', icon: 'fa-receipt', label: 'Đơn Hàng' },
        { id: 'business-health', icon: 'fa-heartbeat', label: 'Tài Chính' },
        { id: '__more__', icon: 'fa-bars', label: 'Tất Cả' }
    ],
    'SALE': [
        { id: 'sale-orders', icon: 'fa-cart-plus', label: 'Tạo Đơn' },
        { id: 'sale-crm', icon: 'fa-users', label: 'Khách CRM' },
        { id: 'order-history', icon: 'fa-receipt', label: 'Đơn Hàng' },
        { id: 'sale-boq', icon: 'fa-file-invoice-dollar', label: 'Báo Giá' },
        { id: '__more__', icon: 'fa-bars', label: 'Menu' }
    ],
    'SALES': [
        { id: 'sale-orders', icon: 'fa-cart-plus', label: 'Tạo Đơn' },
        { id: 'sale-crm', icon: 'fa-users', label: 'Khách CRM' },
        { id: 'order-history', icon: 'fa-receipt', label: 'Đơn Hàng' },
        { id: 'sale-boq', icon: 'fa-file-invoice-dollar', label: 'Báo Giá' },
        { id: '__more__', icon: 'fa-bars', label: 'Menu' }
    ],
    'TRUONG_PHONG_KD': [
        { id: 'sale-crm', icon: 'fa-users', label: 'Khách CRM' },
        { id: 'sales-commissions', icon: 'fa-hand-holding-usd', label: 'Hoa Hồng Đội' },
        { id: 'sale-boq', icon: 'fa-file-invoice-dollar', label: 'Báo Giá' },
        { id: 'order-history', icon: 'fa-receipt', label: 'Đơn Hàng' },
        { id: '__more__', icon: 'fa-bars', label: 'Menu' }
    ],
    'SALE_LEAD': [
        { id: 'sale-crm', icon: 'fa-users', label: 'Khách CRM' },
        { id: 'sales-commissions', icon: 'fa-hand-holding-usd', label: 'Hoa Hồng Đội' },
        { id: 'sale-boq', icon: 'fa-file-invoice-dollar', label: 'Báo Giá' },
        { id: 'order-history', icon: 'fa-receipt', label: 'Đơn Hàng' },
        { id: '__more__', icon: 'fa-bars', label: 'Menu' }
    ],
    'SALE_ADMIN': [
        { id: 'sale-crm', icon: 'fa-users', label: 'Khách CRM' },
        { id: 'admin-approve', icon: 'fa-check-double', label: 'Duyệt Giá' },
        { id: 'project-contractors', icon: 'fa-project-diagram', label: 'Dự Án Thầu' },
        { id: 'order-history', icon: 'fa-receipt', label: 'Đơn Hàng' },
        { id: '__more__', icon: 'fa-bars', label: 'Menu' }
    ],
    'NHA_THAU_THI_CONG': [
        { id: 'contractor-portal', icon: 'fa-clipboard-check', label: 'Dự Án Giao' },
        { id: 'contractor-my-profile', icon: 'fa-id-card', label: 'Hồ Sơ' },
        { id: '__more__', icon: 'fa-bars', label: 'Menu' }
    ],
    'THAU_THI_CONG': [
        { id: 'contractor-portal', icon: 'fa-clipboard-check', label: 'Dự Án Giao' },
        { id: 'contractor-my-profile', icon: 'fa-id-card', label: 'Hồ Sơ' },
        { id: '__more__', icon: 'fa-bars', label: 'Menu' }
    ],
    'NHA_THAU_GIAM_SAT': [
        { id: 'contractor-portal', icon: 'fa-clipboard-check', label: 'Dự Án Giao' },
        { id: 'contractor-my-profile', icon: 'fa-id-card', label: 'Hồ Sơ' },
        { id: '__more__', icon: 'fa-bars', label: 'Menu' }
    ],
    'GIAM_SAT': [
        { id: 'contractor-portal', icon: 'fa-clipboard-check', label: 'Dự Án Giao' },
        { id: 'contractor-my-profile', icon: 'fa-id-card', label: 'Hồ Sơ' },
        { id: '__more__', icon: 'fa-bars', label: 'Menu' }
    ],
    'NHA_CUNG_CAP': [
        { id: 'contractor-portal', icon: 'fa-clipboard-check', label: 'Dự Án Giao' },
        { id: 'contractor-my-profile', icon: 'fa-id-card', label: 'Hồ Sơ' },
        { id: '__more__', icon: 'fa-bars', label: 'Menu' }
    ],
    'SUPPLIER': [
        { id: 'contractor-portal', icon: 'fa-clipboard-check', label: 'Dự Án Giao' },
        { id: 'contractor-my-profile', icon: 'fa-id-card', label: 'Hồ Sơ' },
        { id: '__more__', icon: 'fa-bars', label: 'Menu' }
    ],
    'THU_MUA': [
        { id: 'suppliers', icon: 'fa-building', label: 'Nhà Cung Cấp' },
        { id: 'procurement-inventory', icon: 'fa-warehouse', label: 'Tồn Kho' },
        { id: 'import-orders', icon: 'fa-ship', label: 'Nhập Khẩu' },
        { id: 'purchases', icon: 'fa-shopping-cart', label: 'Mua Hàng' },
        { id: '__more__', icon: 'fa-bars', label: 'Menu' }
    ],
    'WAREHOUSE': [
        { id: 'warehouse-out', icon: 'fa-truck-loading', label: 'Xuất Kho' },
        { id: 'warehouse-in', icon: 'fa-dolly', label: 'Nhập Kho' },
        { id: 'procurement-inventory', icon: 'fa-warehouse', label: 'Tồn Kho' },
        { id: '__more__', icon: 'fa-bars', label: 'Menu' }
    ],
    'KE_TOAN': [
        { id: 'accounting-vault', icon: 'fa-vault', label: 'Két Sắt' },
        { id: 'accounting-cashbook', icon: 'fa-book-journal-whills', label: 'Sổ Quỹ' },
        { id: 'accounting-cash', icon: 'fa-wallet', label: 'Công Nợ 131' },
        { id: 'accounting-vat', icon: 'fa-file-invoice', label: 'VAT' },
        { id: '__more__', icon: 'fa-bars', label: 'Menu' }
    ],
    'KY_THUAT': [
        { id: 'project-list', icon: 'fa-folder-open', label: 'Hồ Sơ DA' },
        { id: 'om-schedule', icon: 'fa-tools', label: 'Lịch O&M' },
        { id: 'warranty-list', icon: 'fa-barcode', label: 'Mã Serial' },
        { id: '__more__', icon: 'fa-bars', label: 'Menu' }
    ],
    'TECH': [
        { id: 'project-list', icon: 'fa-folder-open', label: 'Hồ Sơ DA' },
        { id: 'om-schedule', icon: 'fa-tools', label: 'Lịch O&M' },
        { id: 'warranty-list', icon: 'fa-barcode', label: 'Mã Serial' },
        { id: '__more__', icon: 'fa-bars', label: 'Menu' }
    ],
    'BAO_HANH': [
        { id: 'project-list', icon: 'fa-folder-open', label: 'Hồ Sơ DA' },
        { id: 'om-schedule', icon: 'fa-tools', label: 'Lịch O&M' },
        { id: 'warranty-list', icon: 'fa-barcode', label: 'Mã Serial' },
        { id: '__more__', icon: 'fa-bars', label: 'Menu' }
    ]
};

function getMenuForRole(role, customModules = [], dynamicRolePerms = null) { 
    const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'GIAM_DOC';
    if (isAdmin) return ALL_SYSTEM_GROUPS; 
    
    // CỔNG DÀNH RIÊNG CHO NHÀ THẦU NẾU CHƯA CÓ CẤU HÌNH ĐẶC BIỆT
    const isContractor = role === 'NHA_THAU_THI_CONG' || role === 'THAU_THI_CONG' || role === 'NHA_THAU_GIAM_SAT' || role === 'GIAM_SAT' || role === 'NHA_CUNG_CAP' || role === 'SUPPLIER';

    // Lấy danh sách quyền của role từ dynamicRolePerms (nếu có) hoặc DEFAULT_ROLE_PERMISSIONS
    let rolePerms = [];
    const permsMap = dynamicRolePerms || window.__rolePermissions || {};
    
    if (permsMap && permsMap[role] && Array.isArray(permsMap[role])) {
        rolePerms = permsMap[role];
    } else if (DEFAULT_ROLE_PERMISSIONS[role]) {
        rolePerms = DEFAULT_ROLE_PERMISSIONS[role];
    } else {
        const uRole = (role === 'KY_THUAT' || role === 'TECH') ? 'KY_THUAT' : role;
        rolePerms = DEFAULT_ROLE_PERMISSIONS[uRole] || [];
    }

    if (rolePerms.includes('*') || rolePerms.includes('all')) {
        return ALL_SYSTEM_GROUPS;
    }

    // Gộp quyền của Role với custom_modules được cấp riêng cho nhân viên này
    const extraMods = Array.isArray(customModules) ? customModules : [];
    const allowedSet = new Set([...rolePerms, ...extraMods]);

    // Lọc các nhóm menu theo danh sách được phép
    const visibleGroups = [];
    ALL_SYSTEM_GROUPS.forEach(group => {
        const allowedItems = group.items.filter(item => allowedSet.has(item.id));
        if (allowedItems.length > 0) {
            visibleGroups.push({
                group: group.group,
                roles: group.roles,
                items: allowedItems
            });
        }
    });

    return visibleGroups;
}
window.getMenuForRole = getMenuForRole;

function isModuleAllowed(moduleId, user) {
    if (!user) return false;
    const role = user.role || 'GUEST';
    if (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'GIAM_DOC') return true;

    const customMods = user.custom_modules || [];
    if (Array.isArray(customMods) && customMods.includes(moduleId)) return true;

    const permsMap = window.__rolePermissions || {};
    const rolePerms = permsMap[role] || DEFAULT_ROLE_PERMISSIONS[role] || [];
    if (rolePerms.includes('*') || rolePerms.includes('all')) return true;
    return rolePerms.includes(moduleId);
}
window.isModuleAllowed = isModuleAllowed;

function logout() { 
    localStorage.removeItem('sungo_user'); 
    window.location.href = '/index.html'; 
}
window.logout = logout;

// --- HÀM MỚI: Lấy mã nhân viên để phục vụ API và tính KPI ---
window.getCurrentEmployeeId = function() {
    const userDataStr = localStorage.getItem('sungo_user');
    if (userDataStr) {
        return JSON.parse(userDataStr).empId || 'UNKNOWN';
    }
    return 'UNKNOWN';
};

// ==========================================
// CÁC HÀM XỬ LÝ GIAO DIỆN MOBILE & DRAWER
// ==========================================

window.openMobileSidebar = function() {
    const sidebar = document.getElementById('app-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (!sidebar || !backdrop) return;
    
    sidebar.classList.remove('-translate-x-full');
    backdrop.classList.remove('hidden');
    setTimeout(() => {
        backdrop.classList.add('opacity-100');
        backdrop.classList.remove('opacity-0');
    }, 10);
};

window.closeMobileSidebar = function() {
    const sidebar = document.getElementById('app-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (!sidebar || !backdrop) return;
    
    sidebar.classList.add('-translate-x-full');
    backdrop.classList.remove('opacity-100');
    backdrop.classList.add('opacity-0');
    setTimeout(() => {
        backdrop.classList.add('hidden');
    }, 300);
};

window.toggleMobileSidebar = function(force) {
    const sidebar = document.getElementById('app-sidebar');
    if (!sidebar) return;
    const isClosed = sidebar.classList.contains('-translate-x-full');
    if (force === true || (force === undefined && isClosed)) {
        window.openMobileSidebar();
    } else {
        window.closeMobileSidebar();
    }
};

window.toggleMobileProfileSheet = function(show) {
    const sheet = document.getElementById('mobile-profile-sheet');
    const backdrop = document.getElementById('profile-sheet-backdrop');
    if (!sheet || !backdrop) return;
    
    const isClosed = sheet.classList.contains('translate-y-full');
    const shouldOpen = show !== undefined ? show : isClosed;
    
    if (shouldOpen) {
        backdrop.classList.remove('hidden');
        sheet.classList.remove('translate-y-full');
        setTimeout(() => {
            backdrop.classList.add('opacity-100');
            backdrop.classList.remove('opacity-0');
        }, 10);
    } else {
        sheet.classList.add('translate-y-full');
        backdrop.classList.remove('opacity-100');
        backdrop.classList.add('opacity-0');
        setTimeout(() => {
            backdrop.classList.add('hidden');
        }, 300);
    }
};

// Render thanh Mobile Bottom Navigation Bar (Thanh điều hướng duy nhất trên mobile)
window.renderMobileBottomNav = function(role, activeModuleId) {
    const nav = document.getElementById('mobile-bottom-nav');
    if (!nav) return;
    
    const userRole = role === 'KY_THUAT' ? 'BAO_HANH' : role;
    const navItems = roleBottomNavs[userRole] || roleBottomNavs['ADMIN'] || [];
    
    const hasActiveItem = navItems.some(i => i.id === activeModuleId);
    
    let html = '';
    navItems.forEach(item => {
        if (item.id === '__more__') {
            const isMoreActive = !hasActiveItem;
            const activeColor = isMoreActive ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200';
            const activeBg = isMoreActive ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-400/40 shadow-xs' : 'text-slate-400';
            
            html += `
            <button onclick="toggleMobileSidebar()" class="flex-1 flex flex-col items-center justify-center py-1 ${activeColor} transition active:scale-90 cursor-pointer group">
                <div class="w-8 h-8 rounded-xl flex items-center justify-center transition ${activeBg}">
                    <i class="fas ${item.icon} text-sm"></i>
                </div>
                <span class="text-[10px] ${isMoreActive ? 'font-black' : 'font-bold'} mt-0.5 tracking-tight">${item.label}</span>
            </button>`;
        } else {
            const isActive = item.id === activeModuleId;
            const activeColor = isActive ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200';
            const activeBg = isActive ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-400/40 shadow-xs' : 'text-slate-400';
            
            html += `
            <button id="bottom-tab-${item.id}" onclick="loadModule('${item.id}', '${item.label}')" class="flex-1 flex flex-col items-center justify-center py-1 ${activeColor} transition active:scale-90 cursor-pointer group relative">
                <div class="w-8 h-8 rounded-xl flex items-center justify-center transition ${activeBg}">
                    <i class="fas ${item.icon} text-sm"></i>
                </div>
                <span class="text-[10px] ${isActive ? 'font-black' : 'font-semibold'} mt-0.5 tracking-tight truncate max-w-[64px] text-center">${item.label}</span>
            </button>`;
        }
    });
    
    nav.innerHTML = html;
};

window.__appInitialized = false;

window.reloadAppMenu = function() {
    const userDataStr = localStorage.getItem('sungo_user');
    if (!userDataStr) return;
    const currentUser = JSON.parse(userDataStr);
    
    const userGroups = getMenuForRole(currentUser.role, currentUser.custom_modules, window.__rolePermissions);
    let menuHtml = '';
    
    userGroups.forEach(group => {
        menuHtml += `<div class="px-5 py-2 mt-3 border-t border-slate-800/80 pt-3 first:border-0 first:mt-0 first:pt-1"><p class="text-[10px] font-black text-slate-500 uppercase tracking-widest">${group.group}</p></div>`;
        group.items.forEach(m => {
            menuHtml += `<a id="menu-btn-${m.id}" onclick="loadModule('${m.id}', '${m.title}')" class="menu-item flex items-center px-5 py-2.5 text-xs md:text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-amber-400 cursor-pointer transition rounded-xl mx-2 my-0.5"><i class="fas ${m.icon} w-5 text-center"></i><span class="ml-3 truncate">${m.title}</span></a>`;
        });
    });
    
    const sidebarEl = document.getElementById('sidebar-menu');
    if (sidebarEl) sidebarEl.innerHTML = menuHtml;
};

async function initApp() {
    if (window.__appInitialized) return;
    window.__appInitialized = true;

    const userDataStr = localStorage.getItem('sungo_user');
    if (!userDataStr) return window.location.href = '/index.html';
    
    const currentUser = JSON.parse(userDataStr);
    const roleInitials = (currentUser.role || 'AD').substring(0, 2).toUpperCase();
    
    // Tải cấu hình phân quyền động từ settings
    try {
        const setRes = await fetch('/api/settings?t=' + Date.now());
        const setJson = await setRes.json();
        if (setJson.success && setJson.data && setJson.data.role_permissions) {
            window.__rolePermissions = setJson.data.role_permissions;
        }
    } catch(e) {
        console.warn("Không tải được role_permissions động, dùng mặc định");
    }

    // Cập nhật tên và role trên Desktop
    const userNameEl = document.getElementById('user-name');
    if (userNameEl) userNameEl.innerText = currentUser.name;
    
    const userRoleEl = document.getElementById('user-role');
    if (userRoleEl) userRoleEl.innerText = `${currentUser.role} | Mã NV: ${currentUser.empId || 'N/A'}`;
    
    const avatarBadgeEl = document.getElementById('user-avatar-badge');
    if (avatarBadgeEl) avatarBadgeEl.innerText = roleInitials;

    // Cập nhật tên và avatar trên Mobile Header & Mobile Sheet
    const mobileAvatar = document.getElementById('mobile-user-avatar');
    if (mobileAvatar) mobileAvatar.innerText = roleInitials;

    const sheetAvatar = document.getElementById('sheet-user-avatar');
    if (sheetAvatar) sheetAvatar.innerText = roleInitials;

    const sheetName = document.getElementById('sheet-user-name');
    if (sheetName) sheetName.innerText = currentUser.name;

    const sheetRole = document.getElementById('sheet-user-role');
    if (sheetRole) sheetRole.innerText = currentUser.role;

    const sheetEmpId = document.getElementById('sheet-user-empid');
    if (sheetEmpId) sheetEmpId.innerText = `Mã NV: ${currentUser.empId || 'UNKNOWN'}`;
    
    const userGroups = getMenuForRole(currentUser.role, currentUser.custom_modules, window.__rolePermissions);
    if (userGroups.length === 0) return logout();
    
    let menuHtml = ''; 
    let firstMenu = null;
    let targetMenu = null;
    const hashModule = window.location.hash ? window.location.hash.replace('#', '') : null;
    
    userGroups.forEach(group => {
        menuHtml += `<div class="px-5 py-2 mt-3 border-t border-slate-800/80 pt-3 first:border-0 first:mt-0 first:pt-1"><p class="text-[10px] font-black text-slate-500 uppercase tracking-widest">${group.group}</p></div>`;
        group.items.forEach(m => {
            if (!firstMenu) firstMenu = m;
            if (hashModule && m.id === hashModule) targetMenu = m;
            menuHtml += `<a id="menu-btn-${m.id}" onclick="loadModule('${m.id}', '${m.title}')" class="menu-item flex items-center px-5 py-2.5 text-xs md:text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-amber-400 cursor-pointer transition rounded-xl mx-2 my-0.5"><i class="fas ${m.icon} w-5 text-center"></i><span class="ml-3 truncate">${m.title}</span></a>`;
        });
    });
    
    const sidebarEl = document.getElementById('sidebar-menu');
    if (sidebarEl) sidebarEl.innerHTML = menuHtml;
    
    const menuToLoad = targetMenu || firstMenu;
    if (menuToLoad) {
        loadModule(menuToLoad.id, menuToLoad.title);
    }
}

const moduleCache = {};

async function loadModule(moduleId, title) {
    window.location.hash = moduleId;
    
    // Cập nhật tiêu đề trang trên Desktop và Mobile Header
    const pageTitleEl = document.getElementById('page-title');
    if (pageTitleEl) pageTitleEl.innerText = title;

    const mobilePageTitleEl = document.getElementById('mobile-page-title');
    if (mobilePageTitleEl) mobilePageTitleEl.innerText = title;
    
    // Đóng mobile sidebar drawer nếu đang mở
    window.closeMobileSidebar();
    
    // Cập nhật active class cho Sidebar Menu
    document.querySelectorAll('.menu-item').forEach(el => { 
        el.classList.remove('text-amber-400', 'bg-slate-800', 'font-bold', 'shadow-xs'); 
        el.classList.add('text-slate-400'); 
    });
    
    const activeBtn = document.getElementById(`menu-btn-${moduleId}`);
    if (activeBtn) { 
        activeBtn.classList.remove('text-slate-400'); 
        activeBtn.classList.add('text-amber-400', 'bg-slate-800', 'font-bold', 'shadow-xs'); 
    }
    
    // Cập nhật active class cho Mobile Bottom Tab Bar
    const userDataStr = localStorage.getItem('sungo_user');
    const currentUser = userDataStr ? JSON.parse(userDataStr) : null;
    if (currentUser) {
        window.renderMobileBottomNav(currentUser.role, moduleId);
    }
    
    const contentDiv = document.getElementById('main-content');
    if (!contentDiv) return;
    
    // Cuộn mượt lên đầu trang
    contentDiv.scrollTo({ top: 0, behavior: 'smooth' });
    
    // KIỂM TRA QUYỀN TRUY CẬP (RBAC FIREWALL)
    if (currentUser && !isModuleAllowed(moduleId, currentUser)) {
        const allowedGroups = getMenuForRole(currentUser.role, currentUser.custom_modules, window.__rolePermissions);
        const firstAllowed = (allowedGroups[0] && allowedGroups[0].items[0]) ? allowedGroups[0].items[0] : null;

        contentDiv.innerHTML = `
            <div class="max-w-xl mx-auto my-12 bg-white rounded-3xl p-8 border border-red-200 shadow-xl text-center space-y-4">
                <div class="w-16 h-16 rounded-2xl bg-red-50 text-red-500 border border-red-100 flex items-center justify-center mx-auto text-2xl shadow-inner">
                    <i class="fas fa-lock"></i>
                </div>
                <div>
                    <h3 class="text-xl font-black text-slate-800">Không Có Quyền Truy Cập</h3>
                    <p class="text-xs text-slate-500 mt-1">Phân hệ: <span class="font-bold text-red-600">${title || moduleId}</span></p>
                </div>
                <div class="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-slate-700 text-left space-y-1">
                    <p class="font-bold text-amber-800 flex items-center gap-1.5"><i class="fas fa-info-circle"></i> Thông tin tài khoản:</p>
                    <p>• Họ tên: <b>${currentUser.name || 'N/A'}</b> (Mã NV: <b>${currentUser.empId || 'N/A'}</b>)</p>
                    <p>• Vai trò: <b>${currentUser.role}</b></p>
                    <p class="text-slate-500 text-[11px] pt-1">Vai trò hoặc tài khoản này chưa được cấu hình quyền xem phân hệ <b>${moduleId}</b>. Vui lòng liên hệ Quản trị viên để được phân quyền.</p>
                </div>
                ${firstAllowed ? `
                <button onclick="loadModule('${firstAllowed.id}', '${firstAllowed.title}')" class="bg-slate-900 hover:bg-slate-800 text-amber-400 font-bold px-6 py-3 rounded-xl text-xs transition uppercase tracking-wider shadow-md">
                    <i class="fas fa-arrow-left mr-1.5"></i> Về Phân Hệ Cho Phép (${firstAllowed.title})
                </button>
                ` : ''}
            </div>
        `;
        return;
    }

    try {
        contentDiv.innerHTML = `<div class="p-8 text-center text-slate-400 flex flex-col items-center justify-center space-y-3"><i class="fas fa-spinner fa-spin text-3xl text-amber-500"></i><p class="text-xs font-bold uppercase tracking-wider">Đang tải phân hệ...</p></div>`;
        const res = await fetch(`/modules/${moduleId}.html?v=` + Date.now());
        if (!res.ok) throw new Error("Chưa có file");
        const html = await res.text();
        contentDiv.innerHTML = html;
        
        const scripts = contentDiv.querySelectorAll('script');
        scripts.forEach(oldScript => {
            const newScript = document.createElement('script');
            Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
            
            if (oldScript.src) {
                newScript.src = oldScript.src;
            } else {
                newScript.appendChild(document.createTextNode(oldScript.innerHTML));
            }
            oldScript.parentNode.replaceChild(newScript, oldScript);
        });
        
    } catch (err) { 
        contentDiv.innerHTML = `<div class="flex flex-col items-center justify-center h-64 text-slate-400"><i class="fas fa-solar-panel text-4xl mb-3 text-amber-500"></i><p class="font-bold text-sm">Phân hệ đang được hoàn thiện.</p><p class="text-xs text-slate-400 mt-1">Vui lòng quay lại sau.</p></div>`; 
    }
}
window.loadModule = loadModule;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}