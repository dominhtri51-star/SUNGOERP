-- ==========================================
-- SOLAR RMS / SUNGO ERP DATABASE SCHEMA
-- Hệ quản trị cơ sở dữ liệu: PostgreSQL
-- ==========================================

-- 1. BẢNG TÀI KHOẢN NGƯỜI DÙNG (USERS)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    emp_id VARCHAR(50),
    username VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'STAFF',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tài khoản admin mặc định (user: admin / pass: 123456)
INSERT INTO users (emp_id, username, password, full_name, role) 
VALUES ('EMP001', 'admin', '123456', 'Quản Trị Viên', 'ADMIN')
ON CONFLICT (username) DO NOTHING;

-- 2. BẢNG DANH MỤC SẢN PHẨM (CATEGORIES)
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    parent_id INTEGER DEFAULT NULL
);

-- 3. BẢNG SẢN PHẨM (PRODUCTS)
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(100) UNIQUE,
    product_name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    description TEXT,
    image_url TEXT,
    doc_cocq TEXT,
    doc_datasheet TEXT,
    doc_catalog TEXT,
    doc_manual TEXT,
    import_price NUMERIC DEFAULT 0,
    retail_price NUMERIC DEFAULT 0,
    price_2 NUMERIC DEFAULT 0,
    price_3 NUMERIC DEFAULT 0,
    price_4 NUMERIC DEFAULT 0,
    price_5 NUMERIC DEFAULT 0,
    price_6 NUMERIC DEFAULT 0,
    stock_qty NUMERIC DEFAULT 0,
    virtual_stock NUMERIC DEFAULT 0,
    unit VARCHAR(50) DEFAULT 'Bộ',
    accounting_code VARCHAR(100),
    accounting_name VARCHAR(255),
    vat_rate NUMERIC DEFAULT 8,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. BẢNG KHÁCH HÀNG (CUSTOMERS)
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    customer_code VARCHAR(100) UNIQUE,
    name VARCHAR(255),
    full_name VARCHAR(255),
    phone VARCHAR(50),
    nickname VARCHAR(100),
    address TEXT,
    vat_company VARCHAR(255),
    vat_taxcode VARCHAR(50),
    vat_address TEXT,
    vat_email VARCHAR(100),
    reward_points NUMERIC DEFAULT 0,
    current_debt NUMERIC DEFAULT 0,
    debt_limit NUMERIC DEFAULT 0,
    total_sales NUMERIC DEFAULT 0,
    tier INTEGER DEFAULT 1,
    vip_level INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. BẢNG ĐƠN HÀNG (ORDERS)
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    order_code VARCHAR(100) UNIQUE NOT NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    customer_name VARCHAR(255),
    total_amount NUMERIC DEFAULT 0,
    paid_amount NUMERIC DEFAULT 0,
    status VARCHAR(50) DEFAULT 'PENDING',
    payment_method VARCHAR(50),
    delivery_company VARCHAR(100),
    driver_name VARCHAR(100),
    license_plate VARCHAR(50),
    notes TEXT,
    cancel_reason TEXT,
    refund_amount NUMERIC DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. BẢNG CHI TIẾT ĐƠN HÀNG (ORDER_ITEMS)
CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    quantity NUMERIC DEFAULT 1,
    price NUMERIC DEFAULT 0,
    total NUMERIC DEFAULT 0,
    serial_number TEXT
);

-- 7. BẢNG TÀI LIỆU ĐÍNH KÈM ĐƠN HÀNG (ORDER_DOCS)
CREATE TABLE IF NOT EXISTS order_docs (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
    doc_name VARCHAR(255),
    doc_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. BẢNG HỢP ĐỒNG (CONTRACTS)
CREATE TABLE IF NOT EXISTS contracts (
    id SERIAL PRIMARY KEY,
    contract_code VARCHAR(50) UNIQUE NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    total_value NUMERIC NOT NULL,
    paid_amount NUMERIC DEFAULT 0,
    payment_status VARCHAR(50) DEFAULT 'Chờ Đặt Cọc',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. BẢNG THANH TOÁN HỢP ĐỒNG (CONTRACT_PAYMENTS)
CREATE TABLE IF NOT EXISTS contract_payments (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL,
    payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    proof_url TEXT,
    note TEXT
);

-- 10. BẢNG BẢO HÀNH (WARRANTIES)
CREATE TABLE IF NOT EXISTS warranties (
    id SERIAL PRIMARY KEY,
    serial_number VARCHAR(100) UNIQUE NOT NULL,
    sku VARCHAR(100),
    customer_name VARCHAR(255),
    activated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 11. BẢNG SỰ CỐ BẢO HÀNH (WARRANTY_ISSUES)
CREATE TABLE IF NOT EXISTS warranty_issues (
    id SERIAL PRIMARY KEY,
    serial_number VARCHAR(100),
    detail TEXT,
    status VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 12. BẢNG LỊCH O&M BẢO TRÌ (OM_SCHEDULES)
CREATE TABLE IF NOT EXISTS om_schedules (
    id SERIAL PRIMARY KEY,
    scheduled_date DATE NOT NULL,
    project_name VARCHAR(255) NOT NULL,
    system_type VARCHAR(100) DEFAULT 'Khác',
    address TEXT,
    task TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 13. BẢNG HÓA ĐƠN VAT (INVOICES)
CREATE TABLE IF NOT EXISTS invoices (
    id SERIAL PRIMARY KEY,
    ref_type VARCHAR(50),
    ref_id VARCHAR(100),
    customer_name VARCHAR(255),
    tax_code VARCHAR(50),
    company_name VARCHAR(255),
    company_address TEXT,
    vat_email VARCHAR(100),
    total_amount NUMERIC DEFAULT 0,
    amount_before_tax NUMERIC DEFAULT 0,
    vat_rate INTEGER DEFAULT 8,
    vat_amount NUMERIC DEFAULT 0,
    invoice_no VARCHAR(50),
    invoice_symbol VARCHAR(50) DEFAULT '1C26T-AA/26E',
    draft_code VARCHAR(100),
    status VARCHAR(50) DEFAULT 'PENDING_DRAFT', -- PENDING_DRAFT (Chờ Lập Nháp), DRAFT_CREATED (Đã Lập Nháp e-Invoice), ISSUED (Đã Phát Hành), CANCELLED (Đã Hủy)
    provider VARCHAR(100) DEFAULT 'VinInvoice',
    items_snapshot JSONB DEFAULT '[]'::jsonb,
    einv_link TEXT,
    notes TEXT,
    ktt_notes TEXT,
    issued_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 14. BẢNG CHI PHÍ ĐẦU VÀO (EXPENSES)
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

-- 15. BẢNG SỔ QUỸ TIỀN MẶT (CASH_TRANSACTIONS)
CREATE TABLE IF NOT EXISTS cash_transactions (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50),
    type VARCHAR(10),
    target_name VARCHAR(255),
    amount NUMERIC(15,2),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 16. BẢNG CÀI ĐẶT HỆ THỐNG (SYSTEM_SETTINGS)
CREATE TABLE IF NOT EXISTS system_settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    setting_value TEXT
);

INSERT INTO system_settings (setting_key, setting_value) VALUES 
('store_name', 'SUNGO ERP - NĂNG LƯỢNG THÔNG MINH'),
('store_phone', '09xx.xxx.xxx'),
('store_address', 'Tp. Hồ Chí Minh, Việt Nam'),
('store_tax', ''),
('store_logo', ''),
('quote_notes', 'Cảm ơn Quý khách đã tin tưởng và sử dụng sản phẩm của chúng tôi!'),
('delivery_notes', 'Hàng hóa đã xuất kho vui lòng kiểm tra kỹ. Không nhận đổi trả nếu không phải lỗi từ Nhà sản xuất.')
ON CONFLICT (setting_key) DO NOTHING;

-- 17. BẢNG KÉT SẮT CHỨNG TỪ PHÁP LÝ & BÁO CÁO THUẾ (TAX_VAULT_DOCUMENTS)
CREATE TABLE IF NOT EXISTS tax_vault_documents (
    id SERIAL PRIMARY KEY,
    vault_code VARCHAR(100) UNIQUE,
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

-- 18. BẢNG KHÓA SỔ NIÊM PHONG KÉT SẮT THEO KỲ THUẾ (TAX_VAULT_LOCKS)
CREATE TABLE IF NOT EXISTS tax_vault_locks (
    id SERIAL PRIMARY KEY,
    period_key VARCHAR(50) UNIQUE NOT NULL,
    period_type VARCHAR(20) DEFAULT 'MONTH',
    locked_by VARCHAR(100) DEFAULT 'ADMIN',
    lock_reason TEXT,
    locked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 19. BẢNG PHÒNG BAN (DEPARTMENTS)
-- ==========================================
CREATE TABLE IF NOT EXISTS departments (
    id SERIAL PRIMARY KEY,
    dept_code VARCHAR(50) UNIQUE NOT NULL,
    dept_name VARCHAR(100) NOT NULL,
    manager_emp_id INTEGER,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO departments (dept_code, dept_name, description) VALUES
('BGD', 'Ban Giám Đốc', 'Điều hành & Hoạch định chiến lược công ty'),
('KD', 'Phòng Kinh Doanh & Bán Hàng', 'Phát triển khách sỉ, đại lý và bán hàng trực tiếp'),
('EPC', 'Phòng Kỹ Thuật & Thi Công EPC', 'Thiết kế BOQ, lắp đặt, nghiệm thu và bảo trì O&M'),
('KHO', 'Phòng Kho Vận & Thu Mua', 'Quản trị tồn kho, thu mua vật tư, nhập xuất hàng'),
('TCKT', 'Phòng Kế Toán & Tài Chính', 'Quản trị dòng tiền, thuế, công nợ, tiền lương'),
('HCNS', 'Phòng Hành Chính & Nhân Sự', 'Quản trị nhân sự, tuyển dụng, bảo hiểm, nội quy')
ON CONFLICT (dept_code) DO NOTHING;

-- ==========================================
-- 20. BẢNG HỒ SƠ NHÂN SỰ (EMPLOYEES)
-- ==========================================
CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    emp_code VARCHAR(50) UNIQUE NOT NULL,
    user_id INTEGER,
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    full_name VARCHAR(255) NOT NULL,
    gender VARCHAR(10) DEFAULT 'Nam',
    dob DATE,
    id_card_number VARCHAR(50),
    phone VARCHAR(50),
    email VARCHAR(100),
    address TEXT,
    position VARCHAR(100),
    contract_type VARCHAR(50) DEFAULT 'CHINH_THUC',
    start_date DATE DEFAULT CURRENT_DATE,
    end_date DATE,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    base_salary NUMERIC DEFAULT 0,
    insurance_salary NUMERIC DEFAULT 0,
    bank_account_no VARCHAR(50),
    bank_name VARCHAR(100),
    bank_branch VARCHAR(100),
    
    -- CẤU HÌNH HOA HỒNG & PHÂN CẤP QUẢN LÝ
    commission_rate_wholesale NUMERIC DEFAULT 5, -- % hoa hồng khách sỉ của nhân viên
    commission_rate_boq NUMERIC DEFAULT 10, -- % hoa hồng BOQ/EPC của nhân viên
    min_gross_profit_threshold NUMERIC DEFAULT 0, -- Mức Lợi Nhuận Gộp Tối Thiểu / Tháng để bắt đầu tính hoa hồng (bù lương cứng)
    department_role VARCHAR(50) DEFAULT 'STAFF', -- 'STAFF' (Nhân viên) hoặc 'MANAGER' (Trưởng phòng kinh doanh)
    manager_id INTEGER REFERENCES employees(id) ON DELETE SET NULL, -- Trưởng phòng quản lý trực tiếp
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 21. BẢNG BẢO HIỂM NHÂN VIÊN (EMPLOYEE_INSURANCES)
-- ==========================================
CREATE TABLE IF NOT EXISTS employee_insurances (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE UNIQUE,
    bhxh_code VARCHAR(50),
    bhyt_code VARCHAR(50),
    hospital_name VARCHAR(255),
    has_bhxh BOOLEAN DEFAULT true,
    has_bhyt BOOLEAN DEFAULT true,
    has_bhtn BOOLEAN DEFAULT true,
    has_kpcd BOOLEAN DEFAULT true,
    start_month VARCHAR(7),
    status VARCHAR(50) DEFAULT 'DANG_DONG',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 22. BẢNG HOA HỒNG BÁN HÀNG & DỰ ÁN (SALES_COMMISSIONS)
-- ==========================================
CREATE TABLE IF NOT EXISTS sales_commissions (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    ref_type VARCHAR(50) NOT NULL, -- 'ORDER' (Đơn hàng sỉ: 5% GP) hoặc 'CONTRACT' / 'BOQ' (Dự án: 10% GP)
    ref_id VARCHAR(100) NOT NULL,
    ref_code VARCHAR(100) NOT NULL,
    customer_name VARCHAR(255),
    revenue_amount NUMERIC DEFAULT 0,
    cogs_amount NUMERIC DEFAULT 0,
    gross_profit NUMERIC DEFAULT 0,
    commission_rate NUMERIC DEFAULT 5, -- 5% cho sỉ, 10% cho BOQ
    commission_amount NUMERIC NOT NULL,
    paid_status VARCHAR(50) DEFAULT 'PENDING', -- PENDING (Chờ khách trả xong), ELIGIBLE (Đủ điều kiện chi), INCLUDED_PAYROLL (Đã vào bảng lương), PAID (Đã chi)
    payroll_period VARCHAR(7), -- '2026-08'
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 23. BẢNG TỔNG HỢP BẢNG LƯƠNG THÁNG (PAYROLLS)
-- ==========================================
CREATE TABLE IF NOT EXISTS payrolls (
    id SERIAL PRIMARY KEY,
    period_key VARCHAR(7) UNIQUE NOT NULL, -- '2026-08'
    standard_working_days NUMERIC DEFAULT 26,
    total_gross_salary NUMERIC DEFAULT 0,
    total_commission NUMERIC DEFAULT 0,
    total_allowance NUMERIC DEFAULT 0,
    total_bonus NUMERIC DEFAULT 0,
    total_insurance_emp NUMERIC DEFAULT 0,
    total_insurance_comp NUMERIC DEFAULT 0,
    total_advance NUMERIC DEFAULT 0,
    total_net_salary NUMERIC DEFAULT 0,
    status VARCHAR(50) DEFAULT 'DRAFT', -- DRAFT, APPROVED, PAID
    approved_by VARCHAR(100),
    approved_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 24. BẢNG CHI TIẾT PHIẾU LƯƠNG TỪNG NHÂN VIÊN (PAYROLL_ITEMS)
-- ==========================================
CREATE TABLE IF NOT EXISTS payroll_items (
    id SERIAL PRIMARY KEY,
    payroll_id INTEGER REFERENCES payrolls(id) ON DELETE CASCADE,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    actual_working_days NUMERIC DEFAULT 26,
    paid_leave_days NUMERIC DEFAULT 0,
    unpaid_leave_days NUMERIC DEFAULT 0,
    base_salary NUMERIC DEFAULT 0,
    salary_by_days NUMERIC DEFAULT 0,
    allowance_meal NUMERIC DEFAULT 0,
    allowance_phone_gas NUMERIC DEFAULT 0,
    allowance_responsibility NUMERIC DEFAULT 0,
    total_commission NUMERIC DEFAULT 0,
    bonus_amount NUMERIC DEFAULT 0,
    gross_income NUMERIC DEFAULT 0,
    
    -- Bảo hiểm NLĐ chịu (Khấu trừ vào lương 10.5%)
    ins_bhxh_emp NUMERIC DEFAULT 0,
    ins_bhyt_emp NUMERIC DEFAULT 0,
    ins_bhtn_emp NUMERIC DEFAULT 0,
    total_ins_emp NUMERIC DEFAULT 0,
    
    -- Bảo hiểm Công ty chịu (Chi phí DN 23.5%)
    ins_bhxh_comp NUMERIC DEFAULT 0,
    ins_bhyt_comp NUMERIC DEFAULT 0,
    ins_bhtn_comp NUMERIC DEFAULT 0,
    ins_kpcd_comp NUMERIC DEFAULT 0,
    total_ins_comp NUMERIC DEFAULT 0,
    
    advance_amount NUMERIC DEFAULT 0,
    deduction_penalty NUMERIC DEFAULT 0,
    personal_tax NUMERIC DEFAULT 0,
    net_salary NUMERIC DEFAULT 0,
    payment_status VARCHAR(50) DEFAULT 'UNPAID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 25. BẢNG QUẢN LÝ HỢP ĐỒNG VAY NGÂN HÀNG & TÍN DỤNG (BANK_LOANS)
-- ==========================================
CREATE TABLE IF NOT EXISTS bank_loans (
    id SERIAL PRIMARY KEY,
    loan_code VARCHAR(50) UNIQUE NOT NULL,
    lender_name VARCHAR(255) NOT NULL,
    loan_type VARCHAR(50) DEFAULT 'SHORT_TERM', -- SHORT_TERM, LONG_TERM, OVERDRAFT
    purpose TEXT,
    original_principal NUMERIC NOT NULL,
    current_principal NUMERIC NOT NULL,
    interest_rate NUMERIC NOT NULL, -- %/năm
    disbursement_date DATE NOT NULL,
    maturity_date DATE NOT NULL,
    term_months INTEGER NOT NULL,
    repayment_method VARCHAR(50) DEFAULT 'EQUAL_PRINCIPAL', -- EQUAL_PRINCIPAL, BULLET, ANNUITY
    payment_day_of_month INTEGER DEFAULT 25,
    collateral TEXT,
    status VARCHAR(50) DEFAULT 'ACTIVE', -- ACTIVE, CLOSED
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 26. BẢNG LỊCH SỬ TRẢ NỢ GỐC & LÃI VAY (LOAN_REPAYMENTS)
-- ==========================================
CREATE TABLE IF NOT EXISTS loan_repayments (
    id SERIAL PRIMARY KEY,
    loan_id INTEGER REFERENCES bank_loans(id) ON DELETE CASCADE,
    repayment_date DATE NOT NULL,
    principal_paid NUMERIC DEFAULT 0,
    interest_paid NUMERIC DEFAULT 0,
    total_paid NUMERIC DEFAULT 0,
    remaining_principal NUMERIC NOT NULL,
    payment_proof_url TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 27. BẢNG CỔ ĐÔNG & THÀNH VIÊN GÓP VỐN (SHAREHOLDERS)
-- ==========================================
CREATE TABLE IF NOT EXISTS shareholders (
    id SERIAL PRIMARY KEY,
    shareholder_code VARCHAR(50) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    id_card_number VARCHAR(50),
    phone VARCHAR(50),
    email VARCHAR(100),
    address TEXT,
    ownership_percentage NUMERIC DEFAULT 0, -- % sở hữu
    committed_capital NUMERIC DEFAULT 0, -- Vốn cam kết góp
    contributed_capital NUMERIC DEFAULT 0, -- Vốn thực tế đã góp
    status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 28. BẢNG BIẾN ĐỘNG NGUỒN VỐN & CỔ TỨC (EQUITY_TRANSACTIONS)
-- ==========================================
CREATE TABLE IF NOT EXISTS equity_transactions (
    id SERIAL PRIMARY KEY,
    shareholder_id INTEGER REFERENCES shareholders(id) ON DELETE CASCADE,
    tx_type VARCHAR(50) NOT NULL, -- CONTRIBUTE (Góp vốn), WITHDRAW (Rút vốn), DIVIDEND (Chia cổ tức)
    amount NUMERIC NOT NULL,
    tx_date DATE NOT NULL,
    payment_method VARCHAR(50) DEFAULT 'CHUYEN_KHOAN',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 29. BẢNG KIỂM KÊ KHO & NHẬP TỒN ĐẦU KỲ THỰC TẾ (INVENTORY_AUDITS)
-- ==========================================
CREATE TABLE IF NOT EXISTS inventory_audits (
    id SERIAL PRIMARY KEY,
    audit_code VARCHAR(50) UNIQUE NOT NULL,
    audit_type VARCHAR(50) DEFAULT 'INITIAL_IMPORT', -- INITIAL_IMPORT, PERIODIC_AUDIT, ADJUSTMENT
    warehouse_name VARCHAR(100) DEFAULT 'Kho Tổng',
    auditor_name VARCHAR(100) NOT NULL,
    audit_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    total_items INTEGER DEFAULT 0,
    total_system_qty NUMERIC DEFAULT 0,
    total_actual_qty NUMERIC DEFAULT 0,
    total_variance_qty NUMERIC DEFAULT 0,
    total_variance_value NUMERIC DEFAULT 0,
    items_snapshot JSONB DEFAULT '[]'::jsonb,
    proof_images JSONB DEFAULT '[]'::jsonb,
    status VARCHAR(50) DEFAULT 'COMPLETED',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 30. BẢNG ĐÁNH GIÁ KPI THU HỒI CÔNG NỢ & THƯỞNG PHẠT (DEBT_KPI_EVALUATIONS)
-- ==========================================
CREATE TABLE IF NOT EXISTS debt_kpi_evaluations (
    id SERIAL PRIMARY KEY,
    period_key VARCHAR(7) NOT NULL, -- '2026-08'
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    total_due_debt NUMERIC DEFAULT 0,
    total_collected_debt NUMERIC DEFAULT 0,
    collection_rate NUMERIC DEFAULT 0, -- % thu hồi
    kpi_tier VARCHAR(50), -- 'TIER_UNDER_70', 'TIER_70_84', 'TIER_85_94', 'TIER_95_100'
    reward_penalty_amount NUMERIC DEFAULT 0, -- Số tiền thưởng (+) hoặc phạt (-)
    notes TEXT,
    status VARCHAR(50) DEFAULT 'CALCULATED', -- CALCULATED, APPLIED_PAYROLL
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unq_debt_kpi_period_emp UNIQUE (period_key, employee_id)
);



