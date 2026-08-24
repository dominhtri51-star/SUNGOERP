const baseMenus = [
    { group: 'Tổng Quan & Hệ Thống', roles: ['ADMIN'], items: [ { id: 'admin-dash', icon: 'fa-chart-pie', title: 'Báo Cáo Doanh Thu' }, { id: 'admin-products', icon: 'fa-solar-panel', title: 'Danh Mục Sản Phẩm' }, { id: 'admin-approve', icon: 'fa-check-double', title: 'Duyệt Báo Giá' }, { id: 'settings', icon: 'fa-cogs', title: 'Cài Đặt Hệ Thống' }, { id: 'admin-users', icon: 'fa-user-shield', title: 'Phân Quyền (RBAC)' } ] },
    { group: 'Bán Hàng & CRM', roles: ['ADMIN', 'SALE'], items: [ { id: 'sale-crm', icon: 'fa-users', title: 'Khách Hàng (CRM)' }, { id: 'sale-orders', icon: 'fa-shopping-cart', title: 'Tạo Đơn Hàng' }, { id: 'order-history', icon: 'fa-receipt', title: 'Quản Lý Đơn Hàng' }, { id: 'sale-boq', icon: 'fa-file-invoice-dollar', title: 'Báo Giá Dự Án (BOQ)' }, { id: 'boq-list', icon: 'fa-history', title: 'Danh Sách BOQ' } ] },
    
    // ĐÃ THÊM MODULE NHÀ CUNG CẤP VÀO ĐÂY
    { group: 'Thu Mua & Vật Tư', roles: ['ADMIN', 'THU_MUA'], items: [ 
        { id: 'suppliers', icon: 'fa-building', title: 'Quản Lý Nhà Cung Cấp' }, 
        { id: 'import-orders', icon: 'fa-ship', title: 'Đơn Nhập Khẩu' }, 
        { id: 'purchases', icon: 'fa-shopping-cart', title: 'Mua Hàng' }, 
        { id: 'procurement-inventory', icon: 'fa-warehouse', title: 'Tồn Kho & Giá Vốn' } 
    ] },
    
    // NHÓM CHỨC NĂNG LỚN: SÀN CÔNG TRÌNH & ĐẤU THẦU NHÀ THẦU EPC
    { 
        group: 'Sàn Công Trình & Nhà Thầu', 
        roles: ['ADMIN', 'SUPER_ADMIN', 'NHA_THAU_THI_CONG', 'NHA_THAU_GIAM_SAT', 'NHA_CUNG_CAP', 'BAO_HANH', 'SALE'], 
        items: [ 
            { id: 'bidding-marketplace', icon: 'fa-gavel', title: 'Sàn Đấu Thầu Công Trình' }, 
            { id: 'contractor-progress', icon: 'fa-tasks', title: 'Tiến Độ & Check-in GPS' }, 
            { id: 'contractor-handover', icon: 'fa-camera-retro', title: '6 Ảnh Nghiệm Thu & App' }, 
            { id: 'contractor-eval', icon: 'fa-star', title: 'Quyết Toán & Đánh Giá ★' }, 
            { id: 'contractor-teams', icon: 'fa-user-shield', title: 'Hồ Sơ Năng Lực Nhà Thầu' } 
        ] 
    },

    { group: 'Kế Toán & Tài Chính', roles: ['ADMIN', 'KE_TOAN'], items: [ { id: 'accounting-vault', icon: 'fa-vault', title: 'Két Sắt Hồ Sơ & Thuế' }, { id: 'accounting-cash', icon: 'fa-wallet', title: 'Sổ Quỹ & Công Nợ' },{ id: 'accounting-payments', icon: 'fa-wallet', title: 'Sổ Quỹ & Thanh Toán' }, { id: 'contract-billing', icon: 'fa-file-contract', title: 'Hợp Đồng & Thanh Toán' }, { id: 'accounting-vat', icon: 'fa-file-invoice', title: 'Quản Lý Hóa Đơn VAT' }, { id: 'accounting-tax', icon: 'fa-file-excel', title: 'Báo Cáo Thuế (HTKK)' } ] }
];

function getMenuForRole(role) { 
    // Nếu là SUPER_ADMIN hoặc ADMIN -> Toàn quyền hệ thống
    if (role === 'SUPER_ADMIN' || role === 'ADMIN') return baseMenus; 
    
    // 1. NHÀ THẦU THI CÔNG (ĐỐI TÁC NGOÀI / FREELANCER) - CHỈ XEM CỔNG THI CÔNG
    if (role === 'NHA_THAU_THI_CONG' || role === 'THAU_THI_CONG') {
        return [
            {
                group: 'Cổng Đối Tác Thi Công',
                roles: ['NHA_THAU_THI_CONG'],
                items: [
                    { id: 'contractor-bidding', icon: 'fa-gavel', title: 'Sàn Tìm Việc & Báo Giá' },
                    { id: 'contractor-active', icon: 'fa-hard-hat', title: 'Công Trình Đang Thi Công' },
                    { id: 'contractor-payout', icon: 'fa-wallet', title: 'Quyết Toán & Điểm Uy Tín ★' },
                    { id: 'contractor-my-profile', icon: 'fa-id-card', title: 'Hồ Sơ Năng Lực Đội Thợ' }
                ]
            }
        ];
    }

    // 2. NHÀ THẦU GIÁM SÁT (ĐỐI TÁC NGOÀI / FREELANCER) - CHỈ XEM CỔNG GIÁM SÁT
    if (role === 'NHA_THAU_GIAM_SAT' || role === 'GIAM_SAT') {
        return [
            {
                group: 'Cổng Đối Tác Giám Sát',
                roles: ['NHA_THAU_GIAM_SAT'],
                items: [
                    { id: 'supervisor-projects', icon: 'fa-clipboard-check', title: 'Giám Sát Hiện Trường' },
                    { id: 'supervisor-inspection', icon: 'fa-camera-retro', title: 'Kiểm Tra 6 Ảnh & Nghiệm Thu' },
                    { id: 'supervisor-evaluation', icon: 'fa-star', title: 'Chấm Điểm & Đánh Giá Đội Thợ' }
                ]
            }
        ];
    }

    // 3. NHÀ CUNG CẤP VẬT TƯ (ĐỐI TÁC NGOÀI) - CHỈ XEM CỔNG NHÀ CUNG CẤP
    if (role === 'NHA_CUNG_CAP' || role === 'SUPPLIER') {
        return [
            {
                group: 'Cổng Đối Tác Cung Cấp Vật Tư',
                roles: ['NHA_CUNG_CAP'],
                items: [
                    { id: 'supplier-bom-requests', icon: 'fa-boxes', title: 'Nhu Cầu Vật Tư (BOM)' },
                    { id: 'supplier-quotes', icon: 'fa-file-invoice-dollar', title: 'Chào Giá Cung Ứng' },
                    { id: 'supplier-products', icon: 'fa-tags', title: 'Danh Mục Sản Phẩm' }
                ]
            }
        ];
    }

    // TRƯỜNG HỢP SALE ADMIN (Trưởng phòng Sale): Quyền Sale + Duyệt Báo Giá + Sơ Đồ Tồn Kho
    if (role === 'SALE_ADMIN' || role === 'ADMIN_SALE' || role === 'TRUONG_PHONG_SALE') {
        return [
            { 
                group: 'Bán Hàng & CRM', 
                roles: ['SALE_ADMIN'], 
                items: [ 
                    { id: 'sale-crm', icon: 'fa-users', title: 'Khách Hàng (CRM)' }, 
                    { id: 'sale-orders', icon: 'fa-shopping-cart', title: 'Tạo Đơn Hàng' }, 
                    { id: 'order-history', icon: 'fa-receipt', title: 'Quản Lý Đơn Hàng' }, 
                    { id: 'sale-boq', icon: 'fa-file-invoice-dollar', title: 'Báo Giá Dự Án (BOQ)' }, 
                    { id: 'boq-list', icon: 'fa-history', title: 'Danh Sách BOQ' } 
                ] 
            },
            { 
                group: 'Quản Trị & Phê Duyệt Sale', 
                roles: ['SALE_ADMIN'], 
                items: [ 
                    { id: 'admin-approve', icon: 'fa-check-double', title: 'Duyệt Báo Giá' },
                    { id: 'inventory-dash', icon: 'fa-boxes', title: 'Sơ Đồ Tồn Kho' }
                ] 
            },
            {
                group: 'Sàn Công Trình & Nhà Thầu',
                roles: ['SALE_ADMIN'],
                items: [
                    { id: 'bidding-marketplace', icon: 'fa-gavel', title: 'Sàn Đấu Thầu Công Trình' }
                ]
            }
        ];
    }

    const userRole = role === 'KY_THUAT' ? 'BAO_HANH' : role; 
    return baseMenus.filter(g => g.roles.includes(userRole)); 
}
window.getMenuForRole = getMenuForRole;

function logout() { 
    localStorage.removeItem('sungo_user'); 
    window.location.href = '/index.html'; 
}

// --- HÀM MỚI: Lấy mã nhân viên để phục vụ API và tính KPI ---
window.getCurrentEmployeeId = function() {
    const userDataStr = localStorage.getItem('sungo_user');
    if (userDataStr) {
        return JSON.parse(userDataStr).empId || 'UNKNOWN';
    }
    return 'UNKNOWN';
};

window.__appInitialized = false;

function initApp() {
    if (window.__appInitialized) return;
    window.__appInitialized = true;

    const userDataStr = localStorage.getItem('sungo_user');
    if (!userDataStr) return window.location.href = '/index.html';
    
    const currentUser = JSON.parse(userDataStr);
    const userNameEl = document.getElementById('user-name');
    if (userNameEl) userNameEl.innerText = currentUser.name;
    
    const userRoleEl = document.getElementById('user-role');
    if (userRoleEl) userRoleEl.innerText = `${currentUser.role} | Mã NV: ${currentUser.empId || 'N/A'}`;
    
    const userGroups = getMenuForRole(currentUser.role);
    if (userGroups.length === 0) return logout();
    
    let menuHtml = ''; 
    let firstMenu = null;
    let targetMenu = null;
    const hashModule = window.location.hash ? window.location.hash.replace('#', '') : null;
    
    userGroups.forEach(group => {
        menuHtml += `<div class="px-6 py-2 mt-4 border-t border-slate-700/50 pt-4 first:border-0 first:mt-0 first:pt-2"><p class="text-[10px] font-black text-slate-500 uppercase tracking-widest">${group.group}</p></div>`;
        group.items.forEach(m => {
            if (!firstMenu) firstMenu = m;
            if (hashModule && m.id === hashModule) targetMenu = m;
            menuHtml += `<a id="menu-btn-${m.id}" onclick="loadModule('${m.id}', '${m.title}')" class="menu-item flex items-center px-6 py-2.5 text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-amber-400 cursor-pointer transition"><i class="fas ${m.icon} w-5 text-center"></i><span class="ml-3">${m.title}</span></a>`;
        });
    });
    
    const sidebarEl = document.getElementById('sidebar-menu');
    if (sidebarEl) sidebarEl.innerHTML = menuHtml;
    
    const menuToLoad = targetMenu || firstMenu;
    if (menuToLoad) loadModule(menuToLoad.id, menuToLoad.title);
}

const moduleCache = {};

async function loadModule(moduleId, title) {
    window.location.hash = moduleId;
    const pageTitleEl = document.getElementById('page-title');
    if (pageTitleEl) pageTitleEl.innerText = title;
    
    document.querySelectorAll('.menu-item').forEach(el => { 
        el.classList.remove('text-amber-400', 'bg-slate-800', 'border-r-4', 'border-amber-400'); 
        el.classList.add('text-slate-400'); 
    });
    
    const activeBtn = document.getElementById(`menu-btn-${moduleId}`);
    if (activeBtn) { 
        activeBtn.classList.remove('text-slate-400'); 
        activeBtn.classList.add('text-amber-400', 'bg-slate-800', 'border-r-4', 'border-amber-400'); 
    }
    
    const contentDiv = document.getElementById('main-content');
    if (!contentDiv) return;
    
    try {
        let html = moduleCache[moduleId];
        if (!html) {
            contentDiv.innerHTML = `<div class="p-6 text-center text-slate-400"><i class="fas fa-spinner fa-spin mr-2"></i>Đang tải module...</div>`;
            const res = await fetch(`/modules/${moduleId}.html?v=` + Date.now());
            if (!res.ok) throw new Error("Chưa có file");
            html = await res.text();
            moduleCache[moduleId] = html;
        }
        
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
        contentDiv.innerHTML = `<div class="flex flex-col items-center justify-center h-64 text-slate-400"><i class="fas fa-code text-4xl mb-3 text-amber-500"></i><p>Module chưa sẵn sàng.</p></div>`; 
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}