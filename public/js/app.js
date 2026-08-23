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
    
    { group: 'Kho Vận & Đóng Gói (WMS)', roles: ['ADMIN', 'NHAN_VIEN_KHO'], items: [ { id: 'inventory-dash', icon: 'fa-boxes', title: 'Sơ Đồ Tồn Kho' }, { id: 'warehouse-in', icon: 'fa-box-open', title: 'Lệnh Nhập Kho' }, { id: 'warehouse-out', icon: 'fa-dolly', title: 'Lệnh Xuất & Đóng Gói' } ] },
    { group: 'Kỹ Thuật & Thi Công', roles: ['ADMIN', 'BAO_HANH'], items: [ { id: 'project-list', icon: 'fa-hard-hat', title: 'Quản Trị Dự Án' }, { id: 'om-schedule', icon: 'fa-tools', title: 'Lịch Bảo Trì O&M' }, { id: 'warranty-list', icon: 'fa-barcode', title: 'Quản Lý Mã Serial' } ] },
    { group: 'Kế Toán & Tài Chính', roles: ['ADMIN', 'KE_TOAN'], items: [ { id: 'accounting-cash', icon: 'fa-wallet', title: 'Sổ Quỹ & Công Nợ' },{ id: 'accounting-payments', icon: 'fa-wallet', title: 'Sổ Quỹ & Thanh Toán' }, { id: 'contract-billing', icon: 'fa-file-contract', title: 'Hợp Đồng & Thanh Toán' }, { id: 'accounting-vat', icon: 'fa-file-invoice', title: 'Quản Lý Hóa Đơn VAT' }, { id: 'accounting-tax', icon: 'fa-file-excel', title: 'Báo Cáo Thuế (HTKK)' } ] }
];

function getMenuForRole(role) { 
    // Nếu là SUPER_ADMIN -> Cho phép xem toàn bộ chức năng của hệ thống
    if (role === 'SUPER_ADMIN') return baseMenus; 
    
    const userRole = role === 'KY_THUAT' ? 'BAO_HANH' : role; 
    return baseMenus.filter(g => g.roles.includes(userRole)); 
}

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

function initApp() {
    const userDataStr = localStorage.getItem('sungo_user');
    if (!userDataStr) return window.location.href = '/index.html';
    
    const currentUser = JSON.parse(userDataStr);
    document.getElementById('user-name').innerText = currentUser.name;
    
    // --- CẬP NHẬT: Hiển thị chức vụ và Mã Nhân Viên (KPI) trên Sidebar ---
    document.getElementById('user-role').innerText = `${currentUser.role} | Mã NV: ${currentUser.empId || 'N/A'}`;
    
    const userGroups = getMenuForRole(currentUser.role);
    if(userGroups.length === 0) return logout();
    
    let menuHtml = ''; 
    let firstMenu = null;
    
    userGroups.forEach(group => {
        menuHtml += `<div class="px-6 py-2 mt-4 border-t border-slate-700/50 pt-4 first:border-0 first:mt-0 first:pt-2"><p class="text-[10px] font-black text-slate-500 uppercase tracking-widest">${group.group}</p></div>`;
        group.items.forEach(m => {
            if(!firstMenu) firstMenu = m;
            menuHtml += `<a id="menu-btn-${m.id}" onclick="loadModule('${m.id}', '${m.title}')" class="menu-item flex items-center px-6 py-2.5 text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-amber-400 cursor-pointer transition"><i class="fas ${m.icon} w-5 text-center"></i><span class="ml-3">${m.title}</span></a>`;
        });
    });
    
    document.getElementById('sidebar-menu').innerHTML = menuHtml;
    if (firstMenu) loadModule(firstMenu.id, firstMenu.title);
}

async function loadModule(moduleId, title) {
    document.getElementById('page-title').innerText = title;
    
    document.querySelectorAll('.menu-item').forEach(el => { 
        el.classList.remove('text-amber-400', 'bg-slate-800', 'border-r-4', 'border-amber-400'); 
        el.classList.add('text-slate-400'); 
    });
    
    const activeBtn = document.getElementById(`menu-btn-${moduleId}`);
    if(activeBtn) { 
        activeBtn.classList.remove('text-slate-400'); 
        activeBtn.classList.add('text-amber-400', 'bg-slate-800', 'border-r-4', 'border-amber-400'); 
    }
    
    const contentDiv = document.getElementById('main-content');
    contentDiv.innerHTML = `<div class="p-6 text-center text-slate-400"><i class="fas fa-spinner fa-spin mr-2"></i>Đang tải module...</div>`;
    
    try {
        const res = await fetch(`/modules/${moduleId}.html?v=` + new Date().getTime());
        if (!res.ok) throw new Error("Chưa có file");
        
        contentDiv.innerHTML = await res.text();
        
        // TRẢ LẠI LUỒNG CHẠY SCRIPT GỐC
        // Bỏ cơ chế bọc IIFE toàn cục vì nó làm ẩn các hàm của các module khác
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

window.onload = initApp;