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
    vat_rate INTEGER DEFAULT 0,
    vat_amount NUMERIC DEFAULT 0,
    invoice_no VARCHAR(50),
    status VARCHAR(50) DEFAULT 'Chờ Phát Hành',
    provider VARCHAR(100),
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

