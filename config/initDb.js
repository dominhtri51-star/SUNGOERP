const pool = require("./database");
const fs = require("fs");
const path = require("path");

async function autoInitDatabase() {
    console.log("🔄 Đang kiểm tra và tự động khởi tạo CSDL...");
    try {
        // 1. Tạo bảng users nếu chưa có
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                emp_id VARCHAR(50),
                username VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                full_name VARCHAR(255),
                role VARCHAR(50) DEFAULT 'ADMIN',
                custom_modules JSONB DEFAULT '[]'::jsonb,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Đảm bảo cột custom_modules tồn tại trong bảng users
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='custom_modules') THEN
                    ALTER TABLE users ADD COLUMN custom_modules JSONB DEFAULT '[]'::jsonb;
                END IF;
            END $$;
        `);

        // 2. Chỉ tạo tài khoản ban đầu nếu CSDL hoàn toàn chưa có người dùng nào
        const userCountRes = await pool.query("SELECT COUNT(*) FROM users");
        if (parseInt(userCountRes.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO users (emp_id, username, password, full_name, role) VALUES
                ('EMP002', 'minhtri', '123456', 'Minh Trí', 'ADMIN'),
                ('TC001', 'thauthicong', '123456', 'Đội Thi Công Solar Fast', 'NHA_THAU_THI_CONG'),
                ('GS001', 'thaugiamsat', '123456', 'Đơn Vị Giám Sát EPC Pro', 'NHA_THAU_GIAM_SAT'),
                ('NCC001', 'nhacungcap', '123456', 'Nhà Cung Cấp Pin & Inverter SunPower', 'NHA_CUNG_CAP')
                ON CONFLICT (username) DO NOTHING;
            `);
            console.log("✅ Đã khởi tạo tài khoản quản trị ban đầu cho CSDL mới!");
        }

        // 3. Thực thi file schema.sql để tạo tất cả các bảng còn lại
        const schemaPath = path.join(__dirname, "..", "database", "schema.sql");
        if (fs.existsSync(schemaPath)) {
            const schemaSql = fs.readFileSync(schemaPath, "utf8");
            await pool.query(schemaSql);
            console.log("✅ Toàn bộ 16 bảng CSDL đã được khởi tạo tự động!");
        }

        // 4. Tạo bảng customer_logs và customer_gifts nếu chưa có
        await pool.query(`
            CREATE TABLE IF NOT EXISTS customer_logs (
                id SERIAL PRIMARY KEY,
                customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
                note TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS customer_gifts (
                id SERIAL PRIMARY KEY,
                customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
                gift_name VARCHAR(255) NOT NULL,
                gift_value NUMERIC DEFAULT 0,
                occasion VARCHAR(100) DEFAULT 'Tri ân khách hàng',
                giver_name VARCHAR(100) DEFAULT '',
                note TEXT DEFAULT '',
                gift_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Đảm bảo các cột mở rộng tồn tại trong bảng customer_gifts
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customer_gifts' AND column_name='occasion') THEN
                    ALTER TABLE customer_gifts ADD COLUMN occasion VARCHAR(100) DEFAULT 'Tri ân khách hàng';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customer_gifts' AND column_name='giver_name') THEN
                    ALTER TABLE customer_gifts ADD COLUMN giver_name VARCHAR(100) DEFAULT '';
                END IF;
            END $$;

            -- Đảm bảo cột debt_limit tồn tại trong bảng customers
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='debt_limit') THEN
                    ALTER TABLE customers ADD COLUMN debt_limit NUMERIC DEFAULT 0;
                END IF;
            END $$;

            -- Đảm bảo các cột Chữ ký điện tử & Ký tay Báo giá trong bảng orders
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='employee_id') THEN
                    ALTER TABLE orders ADD COLUMN employee_id INTEGER;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='customer_signature') THEN
                    ALTER TABLE orders ADD COLUMN customer_signature TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='customer_signed_at') THEN
                    ALTER TABLE orders ADD COLUMN customer_signed_at TIMESTAMP;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='customer_signed_name') THEN
                    ALTER TABLE orders ADD COLUMN customer_signed_name VARCHAR(255);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='sales_signature') THEN
                    ALTER TABLE orders ADD COLUMN sales_signature TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='sales_signed_at') THEN
                    ALTER TABLE orders ADD COLUMN sales_signed_at TIMESTAMP;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='sales_signed_name') THEN
                    ALTER TABLE orders ADD COLUMN sales_signed_name VARCHAR(255);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='quote_sign_token') THEN
                    ALTER TABLE orders ADD COLUMN quote_sign_token VARCHAR(100);
                END IF;
            END $$;

            -- Đảm bảo các cột Mã kế toán & Tên kế toán & ĐVT & VAT trong bảng products
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='accounting_code') THEN
                    ALTER TABLE products ADD COLUMN accounting_code VARCHAR(100);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='accounting_name') THEN
                    ALTER TABLE products ADD COLUMN accounting_name VARCHAR(255);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='unit') THEN
                    ALTER TABLE products ADD COLUMN unit VARCHAR(50) DEFAULT 'Bộ';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='vat_rate') THEN
                    ALTER TABLE products ADD COLUMN vat_rate NUMERIC DEFAULT 8;
                END IF;
            END $$;

            -- Đảm bảo Unique Index và Defaults trên bảng products để hỗ trợ Bulk Upsert
            CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku ON products (sku);
            ALTER TABLE products ALTER COLUMN wholesale_price SET DEFAULT 0;
            ALTER TABLE products ALTER COLUMN wholesale_price DROP NOT NULL;
            ALTER TABLE products ALTER COLUMN unit SET DEFAULT 'Bộ';
            ALTER TABLE products ALTER COLUMN category SET DEFAULT 'Khác';
            ALTER TABLE products ALTER COLUMN retail_price SET DEFAULT 0;

            -- Đảm bảo các cột mở rộng trong bảng invoices (Phục vụ quy trình e-Invoice 4 bước & Snapshot dòng hàng)
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='invoice_symbol') THEN
                    ALTER TABLE invoices ADD COLUMN invoice_symbol VARCHAR(50) DEFAULT '1C26T-AA/26E';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='draft_code') THEN
                    ALTER TABLE invoices ADD COLUMN draft_code VARCHAR(100);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='items_snapshot') THEN
                    ALTER TABLE invoices ADD COLUMN items_snapshot JSONB DEFAULT '[]'::jsonb;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='amount_before_tax') THEN
                    ALTER TABLE invoices ADD COLUMN amount_before_tax NUMERIC DEFAULT 0;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='einv_link') THEN
                    ALTER TABLE invoices ADD COLUMN einv_link TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='notes') THEN
                    ALTER TABLE invoices ADD COLUMN notes TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='ktt_notes') THEN
                    ALTER TABLE invoices ADD COLUMN ktt_notes TEXT;
                END IF;

                -- Mở rộng bảng CONTRACTS (Hợp đồng Mua bán, Thi công, Nguyên tắc & Ký điện tử)
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='contract_type') THEN
                    ALTER TABLE contracts ADD COLUMN contract_type VARCHAR(50) DEFAULT 'MUA_BAN';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='order_id') THEN
                    ALTER TABLE contracts ADD COLUMN order_id INT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='order_code') THEN
                    ALTER TABLE contracts ADD COLUMN order_code VARCHAR(100);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='customer_id') THEN
                    ALTER TABLE contracts ADD COLUMN customer_id INT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='customer_company') THEN
                    ALTER TABLE contracts ADD COLUMN customer_company VARCHAR(255);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='customer_taxcode') THEN
                    ALTER TABLE contracts ADD COLUMN customer_taxcode VARCHAR(100);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='customer_address') THEN
                    ALTER TABLE contracts ADD COLUMN customer_address TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='customer_phone') THEN
                    ALTER TABLE contracts ADD COLUMN customer_phone VARCHAR(100);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='customer_representative') THEN
                    ALTER TABLE contracts ADD COLUMN customer_representative VARCHAR(255);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='customer_position') THEN
                    ALTER TABLE contracts ADD COLUMN customer_position VARCHAR(100);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='project_address') THEN
                    ALTER TABLE contracts ADD COLUMN project_address TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='total_value_text') THEN
                    ALTER TABLE contracts ADD COLUMN total_value_text TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='contract_status') THEN
                    ALTER TABLE contracts ADD COLUMN contract_status VARCHAR(50) DEFAULT 'DRAFT';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='items_snapshot') THEN
                    ALTER TABLE contracts ADD COLUMN items_snapshot JSONB DEFAULT '[]'::jsonb;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='payment_terms') THEN
                    ALTER TABLE contracts ADD COLUMN payment_terms JSONB DEFAULT '[]'::jsonb;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='warranty_terms') THEN
                    ALTER TABLE contracts ADD COLUMN warranty_terms TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='e_signature_a') THEN
                    ALTER TABLE contracts ADD COLUMN e_signature_a TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='e_signature_b') THEN
                    ALTER TABLE contracts ADD COLUMN e_signature_b TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='digital_stamp_b') THEN
                    ALTER TABLE contracts ADD COLUMN digital_stamp_b JSONB;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='effective_date') THEN
                    ALTER TABLE contracts ADD COLUMN effective_date DATE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='expiry_date') THEN
                    ALTER TABLE contracts ADD COLUMN expiry_date DATE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='custom_clauses') THEN
                    ALTER TABLE contracts ADD COLUMN custom_clauses TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='signing_request') THEN
                    ALTER TABLE contracts ADD COLUMN signing_request JSONB;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='signing_token') THEN
                    ALTER TABLE contracts ADD COLUMN signing_token VARCHAR(100);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='digital_stamp_a') THEN
                    ALTER TABLE contracts ADD COLUMN digital_stamp_a JSONB;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='signed_file_url') THEN
                    ALTER TABLE contracts ADD COLUMN signed_file_url TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='signed_file_name') THEN
                    ALTER TABLE contracts ADD COLUMN signed_file_name VARCHAR(255);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='signed_file_uploaded_at') THEN
                    ALTER TABLE contracts ADD COLUMN signed_file_uploaded_at TIMESTAMP;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contracts' AND column_name='updated_at') THEN
                    ALTER TABLE contracts ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
                END IF;

                -- Mở rộng bảng CONTRACT_PAYMENTS
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contract_payments' AND column_name='stage_index') THEN
                    ALTER TABLE contract_payments ADD COLUMN stage_index INT DEFAULT 1;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contract_payments' AND column_name='payment_method') THEN
                    ALTER TABLE contract_payments ADD COLUMN payment_method VARCHAR(50) DEFAULT 'Chuyển Khoản';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contract_payments' AND column_name='vat_invoice_no') THEN
                    ALTER TABLE contract_payments ADD COLUMN vat_invoice_no VARCHAR(50);
                END IF;
            END $$;

            -- Tự động gán fallback Tên & Mã Kế toán cho các sản phẩm chưa có
            UPDATE products 
            SET accounting_code = COALESCE(accounting_code, sku),
                accounting_name = COALESCE(accounting_name, product_name),
                unit = COALESCE(unit, 'Bộ'),
                vat_rate = COALESCE(vat_rate, 8)
            WHERE accounting_code IS NULL OR accounting_name IS NULL;
        `);

        // 5. Cấu hình bảng Kiểm kê kho nếu chưa có

        // 6. Tạo bảng inventory_audits nếu chưa có
        await pool.query(`
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
        `);

        // 7. Đồng bộ mở rộng bảng Sổ Quỹ (cash_transactions) & Bảng Chi Phí (expenses) cho Quản Trị Chi Phí Phân Tầng
        await pool.query(`
            DO $$ 
            BEGIN 
                -- Mở rộng bảng cash_transactions
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cash_transactions' AND column_name='category') THEN
                    ALTER TABLE cash_transactions ADD COLUMN category VARCHAR(100) DEFAULT 'Vận hành chung';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cash_transactions' AND column_name='tax_status') THEN
                    ALTER TABLE cash_transactions ADD COLUMN tax_status VARCHAR(50) DEFAULT 'KHONG_HOA_DON';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cash_transactions' AND column_name='source_fund') THEN
                    ALTER TABLE cash_transactions ADD COLUMN source_fund VARCHAR(50) DEFAULT 'TK_CONG_TY';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cash_transactions' AND column_name='attachment_url') THEN
                    ALTER TABLE cash_transactions ADD COLUMN attachment_url TEXT;
                END IF;

                -- Mở rộng bảng expenses
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expenses' AND column_name='tax_status') THEN
                    ALTER TABLE expenses ADD COLUMN tax_status VARCHAR(50) DEFAULT 'CO_HOA_DON';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expenses' AND column_name='source_fund') THEN
                    ALTER TABLE expenses ADD COLUMN source_fund VARCHAR(50) DEFAULT 'TK_CONG_TY';
                END IF;
                -- Mở rộng bảng employees cho Chính sách Hoa hồng & Phân cấp Quản lý
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='commission_rate_wholesale') THEN
                    ALTER TABLE employees ADD COLUMN commission_rate_wholesale NUMERIC DEFAULT 5;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='commission_rate_boq') THEN
                    ALTER TABLE employees ADD COLUMN commission_rate_boq NUMERIC DEFAULT 10;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='commission_rate_manager_wholesale') THEN
                    ALTER TABLE employees ADD COLUMN commission_rate_manager_wholesale NUMERIC DEFAULT 2;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='commission_rate_manager_boq') THEN
                    ALTER TABLE employees ADD COLUMN commission_rate_manager_boq NUMERIC DEFAULT 3;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='min_gross_profit_threshold') THEN
                    ALTER TABLE employees ADD COLUMN min_gross_profit_threshold NUMERIC DEFAULT 0;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='department_role') THEN
                    ALTER TABLE employees ADD COLUMN department_role VARCHAR(50) DEFAULT 'STAFF';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='manager_id') THEN
                    ALTER TABLE employees ADD COLUMN manager_id INTEGER REFERENCES employees(id) ON DELETE SET NULL;
                END IF;

                -- Mở rộng bảng sales_commissions cho Hoa hồng Quản lý Trưởng phòng (Manager Override)
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales_commissions' AND column_name='subordinate_id') THEN
                    ALTER TABLE sales_commissions ADD COLUMN subordinate_id INTEGER REFERENCES employees(id) ON DELETE SET NULL;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales_commissions' AND column_name='commission_type') THEN
                    ALTER TABLE sales_commissions ADD COLUMN commission_type VARCHAR(50) DEFAULT 'DIRECT';
                END IF;
            END $$;
        `);

        // 8. Tạo bảng debt_kpi_evaluations (Đánh giá KPI thu hồi công nợ theo bậc)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS debt_kpi_evaluations (
                id SERIAL PRIMARY KEY,
                period_key VARCHAR(7) NOT NULL,
                employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
                total_due_debt NUMERIC DEFAULT 0,
                total_collected_debt NUMERIC DEFAULT 0,
                collection_rate NUMERIC DEFAULT 0,
                kpi_tier VARCHAR(50),
                reward_penalty_amount NUMERIC DEFAULT 0,
                notes TEXT,
                status VARCHAR(50) DEFAULT 'CALCULATED',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT unq_debt_kpi_period_emp UNIQUE (period_key, employee_id)
            );
        `);

        // 9. Đồng bộ mở rộng bảng Bảo Hành (warranties) & Sự Cố / Ticket Yêu Cầu (warranty_issues)
        await pool.query(`
            DO $$ 
            BEGIN 
                -- Mở rộng bảng warranties
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warranties' AND column_name='customer_phone') THEN
                    ALTER TABLE warranties ADD COLUMN customer_phone VARCHAR(50);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warranties' AND column_name='customer_address') THEN
                    ALTER TABLE warranties ADD COLUMN customer_address TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warranties' AND column_name='customer_email') THEN
                    ALTER TABLE warranties ADD COLUMN customer_email VARCHAR(100);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warranties' AND column_name='purchase_date') THEN
                    ALTER TABLE warranties ADD COLUMN purchase_date DATE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warranties' AND column_name='installation_date') THEN
                    ALTER TABLE warranties ADD COLUMN installation_date DATE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warranties' AND column_name='expiry_date') THEN
                    ALTER TABLE warranties ADD COLUMN expiry_date DATE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warranties' AND column_name='proof_image') THEN
                    ALTER TABLE warranties ADD COLUMN proof_image TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warranties' AND column_name='notes') THEN
                    ALTER TABLE warranties ADD COLUMN notes TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warranties' AND column_name='status') THEN
                    ALTER TABLE warranties ADD COLUMN status VARCHAR(50) DEFAULT 'ACTIVE';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warranties' AND column_name='product_id') THEN
                    ALTER TABLE warranties ADD COLUMN product_id INTEGER;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warranties' AND column_name='custom_product_name') THEN
                    ALTER TABLE warranties ADD COLUMN custom_product_name VARCHAR(255);
                END IF;
                ALTER TABLE warranties DROP CONSTRAINT IF EXISTS warranties_sku_fkey;

                -- Mở rộng bảng warranty_issues cho Hệ thống Phiếu Yêu Cầu Bảo Hành Trực Tuyến
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warranty_issues' AND column_name='request_code') THEN
                    ALTER TABLE warranty_issues ADD COLUMN request_code VARCHAR(50);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warranty_issues' AND column_name='customer_name') THEN
                    ALTER TABLE warranty_issues ADD COLUMN customer_name VARCHAR(255);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warranty_issues' AND column_name='customer_phone') THEN
                    ALTER TABLE warranty_issues ADD COLUMN customer_phone VARCHAR(50);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warranty_issues' AND column_name='customer_address') THEN
                    ALTER TABLE warranty_issues ADD COLUMN customer_address TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warranty_issues' AND column_name='issue_type') THEN
                    ALTER TABLE warranty_issues ADD COLUMN issue_type VARCHAR(100) DEFAULT 'Sự cố thiết bị';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warranty_issues' AND column_name='error_code') THEN
                    ALTER TABLE warranty_issues ADD COLUMN error_code VARCHAR(100);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warranty_issues' AND column_name='images') THEN
                    ALTER TABLE warranty_issues ADD COLUMN images JSONB DEFAULT '[]'::jsonb;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warranty_issues' AND column_name='priority') THEN
                    ALTER TABLE warranty_issues ADD COLUMN priority VARCHAR(50) DEFAULT 'BINH_THUONG';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warranty_issues' AND column_name='service_type') THEN
                    ALTER TABLE warranty_issues ADD COLUMN service_type VARCHAR(50) DEFAULT 'GUI_TRUNG_TAM';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warranty_issues' AND column_name='technician_notes') THEN
                    ALTER TABLE warranty_issues ADD COLUMN technician_notes TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warranty_issues' AND column_name='updated_at') THEN
                    ALTER TABLE warranty_issues ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
                END IF;
            END $$;
        `);

        // 10. Khởi tạo Bảng Chấm Công & Thưởng Phạt Kỷ Luật Đi Trễ / Chuyên Cần
        await pool.query(`
            CREATE TABLE IF NOT EXISTS attendance_policies (
                id SERIAL PRIMARY KEY,
                policy_name VARCHAR(100) DEFAULT 'Quy chuẩn Công Ty',
                work_start_time VARCHAR(10) DEFAULT '08:00',
                work_end_time VARCHAR(10) DEFAULT '17:30',
                lunch_start_time VARCHAR(10) DEFAULT '12:00',
                lunch_end_time VARCHAR(10) DEFAULT '13:30',
                standard_daily_hours NUMERIC DEFAULT 8.0,
                grace_period_minutes INTEGER DEFAULT 5,
                free_late_count INTEGER DEFAULT 3,
                bonus_attendance_amount NUMERIC DEFAULT 500000,
                bonus_perfect_punctuality NUMERIC DEFAULT 300000,
                ot_rate_multiplier NUMERIC DEFAULT 1.5,
                penalty_late_tier1 NUMERIC DEFAULT 20000,
                penalty_late_tier2 NUMERIC DEFAULT 50000,
                penalty_late_tier3 NUMERIC DEFAULT 100000,
                penalty_late_tier4 NUMERIC DEFAULT 200000,
                penalty_accumulated_late_5 NUMERIC DEFAULT 200000,
                penalty_unauthorized_absent NUMERIC DEFAULT 200000,
                notes TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS attendance_logs (
                id SERIAL PRIMARY KEY,
                employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
                emp_code VARCHAR(50),
                scan_time TIMESTAMP NOT NULL,
                scan_type VARCHAR(50) DEFAULT 'AUTO',
                source VARCHAR(50) DEFAULT 'DEVICE_IMPORT',
                device_id VARCHAR(50),
                device_name VARCHAR(100),
                raw_data JSONB DEFAULT '{}'::jsonb,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS attendance_daily (
                id SERIAL PRIMARY KEY,
                employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
                work_date DATE NOT NULL,
                first_check_in TIMESTAMP,
                last_check_out TIMESTAMP,
                working_hours NUMERIC DEFAULT 0,
                late_minutes INTEGER DEFAULT 0,
                early_minutes INTEGER DEFAULT 0,
                ot_hours NUMERIC DEFAULT 0,
                working_day_value NUMERIC DEFAULT 1.0,
                leave_type VARCHAR(50) DEFAULT 'NONE',
                status VARCHAR(50) DEFAULT 'ON_TIME',
                penalty_amount NUMERIC DEFAULT 0,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT unq_attendance_emp_date UNIQUE (employee_id, work_date)
            );

            CREATE TABLE IF NOT EXISTS attendance_monthly_summary (
                id SERIAL PRIMARY KEY,
                period_key VARCHAR(7) NOT NULL,
                employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
                standard_working_days NUMERIC DEFAULT 26,
                total_actual_days NUMERIC DEFAULT 0,
                total_paid_leave_days NUMERIC DEFAULT 0,
                total_unpaid_leave_days NUMERIC DEFAULT 0,
                total_late_count INTEGER DEFAULT 0,
                total_late_minutes INTEGER DEFAULT 0,
                total_early_count INTEGER DEFAULT 0,
                total_ot_hours NUMERIC DEFAULT 0,
                is_attendance_bonus_awarded BOOLEAN DEFAULT FALSE,
                attendance_bonus_amount NUMERIC DEFAULT 0,
                total_attendance_penalty NUMERIC DEFAULT 0,
                status VARCHAR(50) DEFAULT 'CALCULATED',
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT unq_attendance_monthly_period_emp UNIQUE (period_key, employee_id)
            );
        `);

        // Khởi tạo 1 chính sách mặc định nếu chưa có
        const existingPolicy = await pool.query("SELECT id FROM attendance_policies LIMIT 1");
        if (existingPolicy.rows.length === 0) {
            await pool.query(`
                INSERT INTO attendance_policies (
                    policy_name, work_start_time, work_end_time, lunch_start_time, lunch_end_time,
                    standard_daily_hours, grace_period_minutes, free_late_count,
                    bonus_attendance_amount, bonus_perfect_punctuality, ot_rate_multiplier,
                    penalty_late_tier1, penalty_late_tier2, penalty_late_tier3, penalty_late_tier4,
                    penalty_accumulated_late_5, penalty_unauthorized_absent
                ) VALUES (
                    'Quy Chuẩn Chấm Công Công Ty', '08:00', '17:30', '12:00', '13:30',
                    8.0, 5, 3,
                    500000, 300000, 1.5,
                    20000, 50000, 100000, 200000,
                    200000, 200000
                )
            `);
        }

        // 11. Tự động đồng bộ tài khoản người dùng (users) sang hồ sơ nhân sự (employees) & Phòng ban
        try {
            await pool.query(`
                INSERT INTO departments (dept_code, dept_name, description) VALUES
                ('BGD', 'Ban Giám Đốc', 'Điều hành & Hoạch định chiến lược công ty'),
                ('KD', 'Phòng Kinh Doanh & Bán Hàng', 'Phát triển khách sỉ, đại lý và bán hàng trực tiếp'),
                ('EPC', 'Phòng Kỹ Thuật & Thi Công EPC', 'Thiết kế BOQ, lắp đặt, nghiệm thu và bảo trì O&M'),
                ('KHO', 'Phòng Kho Vận & Thu Mua', 'Quản trị tồn kho, thu mua vật tư, nhập xuất hàng'),
                ('TCKT', 'Phòng Kế Toán & Tài Chính', 'Quản trị dòng tiền, thuế, công nợ, tiền lương'),
                ('HCNS', 'Phòng Hành Chính & Nhân Sự', 'Quản trị nhân sự, tuyển dụng, bảo hiểm, nội quy')
                ON CONFLICT (dept_code) DO NOTHING;
            `);

            const usersRes = await pool.query("SELECT * FROM users");
            for (const u of usersRes.rows) {
                const uid = u.id || u.user_id;
                const empCode = (u.emp_id || ('EMP-' + u.username)).trim().toUpperCase();
                const fullName = u.full_name || u.username;
                let deptId = 1;
                let pos = 'Quản trị';
                let role = 'STAFF';
                let commWs = 5;
                let commBoq = 10;
                let minGp = 0;

                if (u.role === 'SALE' || u.role === 'SALES') {
                    deptId = 2;
                    pos = 'Nhân Viên Kinh Doanh';
                    commWs = 5;
                    commBoq = 10;
                    minGp = 10000000;
                } else if (u.role === 'KY_THUAT' || u.role === 'NHA_THAU_THI_CONG' || u.role === 'NHA_THAU_GIAM_SAT') {
                    deptId = 3;
                    pos = 'Kỹ Sư / Kỹ Thuật';
                    commWs = 3;
                    commBoq = 10;
                } else if (u.role === 'KE_TOAN') {
                    deptId = 5;
                    pos = 'Kế Toán';
                } else if (u.role === 'NHAN_VIEN_KHO') {
                    deptId = 4;
                    pos = 'Thủ Kho';
                } else if (['ADMIN', 'SUPER_ADMIN', 'GIAM_DOC'].includes(u.role)) {
                    deptId = 1;
                    pos = 'Ban Giám Đốc';
                    role = 'MANAGER';
                }

                const existing = await pool.query(
                    "SELECT id FROM employees WHERE UPPER(emp_code) = $1 OR user_id = $2",
                    [empCode, uid]
                );
                if (existing.rows.length === 0) {
                    await pool.query(`
                        INSERT INTO employees (
                            emp_code, user_id, department_id, full_name, position,
                            contract_type, start_date, status, base_salary, insurance_salary,
                            commission_rate_wholesale, commission_rate_boq, min_gross_profit_threshold,
                            department_role
                        ) VALUES ($1, $2, $3, $4, $5, 'CHINH_THUC', CURRENT_DATE, 'ACTIVE', 8000000, 5000000, $6, $7, $8, $9)
                    `, [empCode, uid, deptId, fullName, pos, commWs, commBoq, minGp, role]);
                } else {
                    await pool.query(`
                        UPDATE employees SET 
                            user_id = $1, department_id = COALESCE(department_id, $2),
                            full_name = COALESCE(full_name, $3), position = COALESCE(position, $4)
                        WHERE id = $5
                    `, [uid, deptId, fullName, pos, existing.rows[0].id]);
                }
            }
        } catch(e) {
            console.warn("⚠️ Không thể tự động đồng bộ employees trong initDb:", e.message);
        }

        // 35. Khởi tạo Bảng Suppliers (Nhà Cung Cấp & Công Nợ)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS suppliers (
                id SERIAL PRIMARY KEY,
                supplier_code VARCHAR(100) UNIQUE,
                name VARCHAR(255) NOT NULL,
                phone VARCHAR(50),
                email VARCHAR(100),
                tax_code VARCHAR(50),
                address TEXT,
                note TEXT,
                advance_pct NUMERIC DEFAULT 0,
                remain_pct NUMERIC DEFAULT 100,
                debt_days INTEGER DEFAULT 0,
                credit_limit NUMERIC DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Đảm bảo các cột mở rộng tồn tại trong suppliers
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='advance_pct') THEN
                    ALTER TABLE suppliers ADD COLUMN advance_pct NUMERIC DEFAULT 0;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='remain_pct') THEN
                    ALTER TABLE suppliers ADD COLUMN remain_pct NUMERIC DEFAULT 100;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='debt_days') THEN
                    ALTER TABLE suppliers ADD COLUMN debt_days INTEGER DEFAULT 0;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='credit_limit') THEN
                    ALTER TABLE suppliers ADD COLUMN credit_limit NUMERIC DEFAULT 0;
                END IF;
            END $$;
        `);

        // Seed danh sách nhà cung cấp mặc định nếu bảng trống
        try {
            const supCount = await pool.query("SELECT COUNT(*) FROM suppliers");
            if (parseInt(supCount.rows[0].count) === 0) {
                await pool.query(`
                    INSERT INTO suppliers (supplier_code, name, phone, email, tax_code, address, advance_pct, remain_pct, debt_days, credit_limit, note) VALUES
                    ('NCC-DEYE', 'Deye Inverter & ESS Battery Vietnam', '028.3888.6666', 'sales@deye.vn', '0315897451', 'Khu Công Nghệ Cao, TP. Thủ Đức, TP.HCM', 30, 70, 30, 1000000000, 'Nhà cung cấp Inverter Hybrid Deye & Pin Lithium lưu trữ'),
                    ('NCC-JINKO', 'Jinko Solar & Canadian Solar Distribution', '024.3999.8888', 'contact@jinkosolar.vn', '0106894523', 'Tòa nhà Landmark 72, Nam Từ Liêm, Hà Nội', 20, 80, 45, 2000000000, 'Phân phối tấm pin N-type TopCon 2 mặt kính'),
                    ('NCC-GROWATT', 'Growatt New Energy Vietnam Co., Ltd', '028.7300.9999', 'service@growatt.vn', '0316789123', 'Quận 7, TP. Hồ Chí Minh', 0, 100, 30, 500000000, 'Inverter hòa lưới & Hybrid Growatt'),
                    ('NCC-CADIVI', 'Cadivi / Taihan - Cáp & Phụ Kiện Điện Solar', '028.3822.4455', 'sales@cadivi.vn', '0300381564', 'Quận 1, TP. Hồ Chí Minh', 0, 100, 15, 300000000, 'Cáp điện DC 4.0/6.0mm2 chống cháy, tủ điện & phụ kiện')
                    ON CONFLICT (supplier_code) DO NOTHING;
                `);
                console.log("✅ Đã khởi tạo 4 Nhà cung cấp thiết bị Solar chuẩn mặc định!");
            }
        } catch(supErr) {}

        // 36. Khởi tạo Bảng Imports (Đơn Hàng Nhập Khẩu)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS imports (
                id SERIAL PRIMARY KEY,
                po_code VARCHAR(100) UNIQUE NOT NULL,
                supplier_name VARCHAR(255),
                note TEXT,
                status VARCHAR(50) DEFAULT 'Chờ Thanh Toán',
                items JSONB DEFAULT '[]'::jsonb,
                docs JSONB DEFAULT '{}'::jsonb,
                total_value NUMERIC DEFAULT 0,
                currency VARCHAR(20) DEFAULT 'USD',
                exchange_rate NUMERIC DEFAULT 25400,
                eta_date TIMESTAMP,
                tracking_number VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 37. Khởi tạo Bảng Purchases (Đơn Mua Hàng & Đối Soát WMS)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS purchases (
                id SERIAL PRIMARY KEY,
                po_code VARCHAR(100) UNIQUE NOT NULL,
                supplier_id INTEGER,
                supplier_name VARCHAR(255),
                note TEXT,
                status VARCHAR(50) DEFAULT 'Chờ Duyệt',
                items JSONB DEFAULT '[]'::jsonb,
                docs JSONB DEFAULT '{}'::jsonb,
                total_amount NUMERIC DEFAULT 0,
                receive_date TIMESTAMP,
                delivery_note TEXT,
                vehicle_info TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 38. Khởi tạo Bảng Quotations (Báo Giá BOQ)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS quotations (
                id SERIAL PRIMARY KEY,
                quotation_code VARCHAR(100) UNIQUE NOT NULL,
                store_id INTEGER DEFAULT 1,
                brand_name VARCHAR(100),
                project_name VARCHAR(255),
                customer_name VARCHAR(255),
                phone VARCHAR(50),
                sale_name VARCHAR(100),
                created_by VARCHAR(100),
                emp_id VARCHAR(50),
                system_type VARCHAR(50),
                monthly_bill NUMERIC DEFAULT 0,
                system_kwp NUMERIC DEFAULT 0,
                total_amount NUMERIC DEFAULT 0,
                total_cost NUMERIC DEFAULT 0,
                profit_margin NUMERIC DEFAULT 0,
                is_below_floor BOOLEAN DEFAULT FALSE,
                payback_years NUMERIC DEFAULT 0,
                npv_amount NUMERIC DEFAULT 0,
                roe_percent NUMERIC DEFAULT 0,
                status VARCHAR(50) DEFAULT 'QUOTING',
                items JSONB DEFAULT '[]'::jsonb,
                labor_items JSONB DEFAULT '[]'::jsonb,
                admin_notes TEXT,
                approved_by VARCHAR(100),
                approved_at TIMESTAMP,
                reject_reason TEXT,
                rejected_by VARCHAR(100),
                rejected_at TIMESTAMP,
                converted_order_code VARCHAR(100),
                converted_order_id INTEGER,
                converted_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Đồng bộ dữ liệu quotations từ quotations.json vào bảng quotations nếu bảng đang trống
        try {
            const qCount = await pool.query("SELECT COUNT(*) FROM quotations");
            if (parseInt(qCount.rows[0].count) === 0) {
                const qPath = path.join(__dirname, "..", "data", "quotations.json");
                if (fs.existsSync(qPath)) {
                    const qData = JSON.parse(fs.readFileSync(qPath, "utf8"));
                    for (let q of qData) {
                        try {
                            await pool.query(`
                                INSERT INTO quotations (
                                    id, quotation_code, store_id, brand_name, project_name, customer_name,
                                    phone, sale_name, created_by, emp_id, system_type, monthly_bill,
                                    system_kwp, total_amount, total_cost, profit_margin, is_below_floor,
                                    payback_years, npv_amount, roe_percent, status, items, labor_items,
                                    admin_notes, approved_by, approved_at, reject_reason, rejected_by,
                                    rejected_at, converted_order_code, converted_order_id, converted_at,
                                    created_at
                                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33)
                                ON CONFLICT (quotation_code) DO NOTHING
                            `, [
                                q.quotation_id || q.id, q.quotation_code, q.store_id || 1, q.brand_name, q.project_name, q.customer_name,
                                q.phone, q.sale_name, q.created_by, q.emp_id, q.system_type, q.monthly_bill || 0,
                                q.system_kwp || 0, q.total_amount || 0, q.total_cost || 0, q.profit_margin || 0, q.is_below_floor || false,
                                q.payback_years || 0, q.npv_amount || 0, q.roe_percent || 0, q.status || 'QUOTING', JSON.stringify(q.items || []), JSON.stringify(q.labor_items || []),
                                q.admin_notes, q.approved_by, q.approved_at, q.reject_reason, q.rejected_by,
                                q.rejected_at, q.converted_order_code, q.converted_order_id, q.converted_at,
                                q.created_at || new Date()
                            ]);
                        } catch(insErr) {}
                    }
                    console.log(`✅ Đã đồng bộ ${qData.length} Báo Giá BOQ vào PostgreSQL CSDL thành công!`);
                }
            }
        } catch(qErr) {}

        // 39. Khởi tạo Bảng Supplier Payments (Phiếu Chi NCC & UNC)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS supplier_payments (
                id SERIAL PRIMARY KEY,
                payment_code VARCHAR(100) UNIQUE NOT NULL,
                supplier_id INTEGER,
                supplier_name VARCHAR(255),
                amount NUMERIC DEFAULT 0,
                payment_method VARCHAR(100) DEFAULT 'Chuyển Khoản (UNC)',
                bank_account VARCHAR(100),
                bank_name VARCHAR(100),
                account_holder VARCHAR(255),
                note TEXT,
                status VARCHAR(50) DEFAULT 'Chờ Duyệt',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 40. Mở rộng trường vận chuyển và địa chỉ giao hàng trong bảng orders sang TEXT
        try {
            await pool.query(`
                DO $$ 
                BEGIN 
                    ALTER TABLE orders ALTER COLUMN license_plate TYPE TEXT;
                    ALTER TABLE orders ALTER COLUMN delivery_company TYPE TEXT;
                    ALTER TABLE orders ALTER COLUMN driver_name TYPE TEXT;
                EXCEPTION WHEN OTHERS THEN 
                    NULL;
                END $$;
            `);
        } catch(ordColErr) {}

        // 41. Chuẩn hóa SKU sản phẩm và tạo Unique Index chống trùng lặp không phân biệt hoa thường
        try {
            await pool.query(`
                DO $$ 
                BEGIN 
                    UPDATE products SET sku = UPPER(TRIM(sku)) WHERE sku <> UPPER(TRIM(sku));
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_upper_sku ON products (UPPER(TRIM(sku)));
                EXCEPTION WHEN OTHERS THEN 
                    NULL;
                END $$;
            `);
        } catch(skuErr) {}

        // 42. Thêm các cột lưu chi tiết chành xe & người nhận hàng trong bảng orders
        try {
            await pool.query(`
                DO $$ 
                BEGIN 
                    ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier_address TEXT;
                    ALTER TABLE orders ADD COLUMN IF NOT EXISTS recipient_name TEXT;
                    ALTER TABLE orders ADD COLUMN IF NOT EXISTS recipient_phone TEXT;
                    ALTER TABLE orders ADD COLUMN IF NOT EXISTS vehicle_plate TEXT;
                    ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_note TEXT;
                EXCEPTION WHEN OTHERS THEN 
                    NULL;
                END $$;
            `);
        } catch(ordShipColErr) {}

        // 43. Đảm bảo bảng insurance_policies luôn tồn tại
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS insurance_policies (
                    id SERIAL PRIMARY KEY,
                    policy_name VARCHAR(255) DEFAULT 'Quy Định Tỷ Lệ Đóng Bảo Hiểm Xã Hội & Kinh Phí Công Đoàn',
                    rate_bhxh_emp NUMERIC DEFAULT 8.0,
                    rate_bhyt_emp NUMERIC DEFAULT 1.5,
                    rate_bhtn_emp NUMERIC DEFAULT 1.0,
                    rate_bhxh_comp NUMERIC DEFAULT 17.5,
                    rate_bhyt_comp NUMERIC DEFAULT 3.0,
                    rate_bhtn_comp NUMERIC DEFAULT 1.0,
                    rate_kpcd_comp NUMERIC DEFAULT 2.0,
                    min_insurance_salary NUMERIC DEFAULT 5000000,
                    max_insurance_salary NUMERIC DEFAULT 46800000,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                INSERT INTO insurance_policies (
                    id, policy_name,
                    rate_bhxh_emp, rate_bhyt_emp, rate_bhtn_emp,
                    rate_bhxh_comp, rate_bhyt_comp, rate_bhtn_comp, rate_kpcd_comp,
                    min_insurance_salary, max_insurance_salary, notes
                ) VALUES (
                    1, 'Quy Định Tỷ Lệ Đóng Bảo Hiểm Xã Hội & Kinh Phí Công Đoàn',
                    8.0, 1.5, 1.0,
                    17.5, 3.0, 1.0, 2.0,
                    5000000, 46800000, 'Quy định chuẩn theo Luật BHXH Việt Nam: NLĐ đóng 10.5%, DN đóng 23.5% (tổng 34%)'
                ) ON CONFLICT (id) DO NOTHING;
            `);
        } catch(insPolErr) {}

        // 44. Đảm bảo bảng warehouse_kpi_policies và các trường KPI Kho tồn tại
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS warehouse_kpi_policies (
                    id SERIAL PRIMARY KEY,
                    policy_name VARCHAR(255) DEFAULT 'Chính sách KPI Xuất Kho',
                    rate_per_order NUMERIC DEFAULT 20000,
                    profit_percent NUMERIC DEFAULT 0,
                    min_orders_threshold INTEGER DEFAULT 0,
                    bonus_target_orders INTEGER DEFAULT 50,
                    bonus_tier_amount NUMERIC DEFAULT 500000,
                    is_active BOOLEAN DEFAULT TRUE,
                    notes TEXT DEFAULT '',
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                ALTER TABLE warehouse_kpi_policies ADD COLUMN IF NOT EXISTS profit_percent NUMERIC DEFAULT 0;

                INSERT INTO warehouse_kpi_policies (id, policy_name, rate_per_order, profit_percent, min_orders_threshold, bonus_target_orders, bonus_tier_amount, is_active)
                VALUES (1, 'Chính sách KPI Xuất Kho Mặc Định', 20000, 0, 0, 50, 500000, TRUE)
                ON CONFLICT (id) DO NOTHING;

                ALTER TABLE orders ADD COLUMN IF NOT EXISTS dispatched_by INTEGER REFERENCES employees(id);
                ALTER TABLE orders ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMP;
                ALTER TABLE orders ADD COLUMN IF NOT EXISTS warehouse_commission NUMERIC DEFAULT 0;

                ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS warehouse_commission NUMERIC DEFAULT 0;
            `);
        } catch(whKpiErr) {}

        // 45. Cơ chế Quỹ Lương Biến Đổi 70/30 & Quỹ Thưởng Tết Cuối Năm
        try {
            await pool.query(`
                ALTER TABLE employees ADD COLUMN IF NOT EXISTS commission_retention_rate NUMERIC DEFAULT 30;
                ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS commission_rate_retained NUMERIC DEFAULT 30;
                ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS commission_retained NUMERIC DEFAULT 0;
                ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS commission_paid NUMERIC DEFAULT 0;
                ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS cumulative_retained_bonus NUMERIC DEFAULT 0;
                ALTER TABLE payrolls ADD COLUMN IF NOT EXISTS total_commission_retained NUMERIC DEFAULT 0;

                CREATE TABLE IF NOT EXISTS year_end_bonus_policies (
                    id SERIAL PRIMARY KEY,
                    year INTEGER UNIQUE NOT NULL,
                    target_gross_profit NUMERIC DEFAULT 10000000000,
                    profit_sharing_percent NUMERIC DEFAULT 10.0,
                    status VARCHAR(50) DEFAULT 'ACTIVE',
                    notes TEXT DEFAULT '',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                INSERT INTO year_end_bonus_policies (year, target_gross_profit, profit_sharing_percent, status, notes)
                VALUES (2026, 10000000000, 10.0, 'ACTIVE', 'Chính sách thưởng vượt kế hoạch năm 2026')
                ON CONFLICT (year) DO NOTHING;
            `);
        } catch(yearEndErr) {}

        console.log("✅ Khởi tạo và đồng bộ toàn bộ CSDL Cổng Bảo Hành Điện Tử & ERP thành công!");
    } catch (err) {
        console.error("⚠️ Cảnh báo khởi tạo CSDL:", err.message);
    }
}

module.exports = autoInitDatabase;
