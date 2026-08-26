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

        // 2. Tạo sẵn các tài khoản mặc định
        await pool.query(`
            INSERT INTO users (emp_id, username, password, full_name, role) VALUES
            ('EMP001', 'admin', '123456', 'Quản Trị Viên', 'ADMIN'),
            ('EMP002', 'minhtri', '123456', 'Minh Trí', 'ADMIN'),
            ('TC001', 'thauthicong', '123456', 'Đội Thi Công Solar Fast', 'NHA_THAU_THI_CONG'),
            ('GS001', 'thaugiamsat', '123456', 'Đơn Vị Giám Sát EPC Pro', 'NHA_THAU_GIAM_SAT'),
            ('NCC001', 'nhacungcap', '123456', 'Nhà Cung Cấp Pin & Inverter SunPower', 'NHA_CUNG_CAP')
            ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = EXCLUDED.role, full_name = EXCLUDED.full_name;
        `);
        console.log("✅ Đã khởi tạo bảng users và các tài khoản nhà thầu / admin (pass: 123456) thành công!");

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

            -- Đảm bảo cột employee_id tồn tại trong bảng orders
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='employee_id') THEN
                    ALTER TABLE orders ADD COLUMN employee_id INTEGER;
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
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='min_gross_profit_threshold') THEN
                    ALTER TABLE employees ADD COLUMN min_gross_profit_threshold NUMERIC DEFAULT 0;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='department_role') THEN
                    ALTER TABLE employees ADD COLUMN department_role VARCHAR(50) DEFAULT 'STAFF';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='manager_id') THEN
                    ALTER TABLE employees ADD COLUMN manager_id INTEGER REFERENCES employees(id) ON DELETE SET NULL;
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

        console.log("✅ Khởi tạo và đồng bộ toàn bộ CSDL Tài Chính - Nhân Sự - Kiểm Kê Kho & Quản Trị Chi Phí thành công!");
    } catch (err) {
        console.error("⚠️ Cảnh báo khởi tạo CSDL:", err.message);
    }
}

module.exports = autoInitDatabase;
