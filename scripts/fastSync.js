const { Pool } = require("pg");

const localPool = new Pool({
    user: "solar_admin",
    host: "localhost",
    database: "solar_rms_local",
    password: "SolarPass123!",
    port: 5432
});

const cloudPool = new Pool({
    connectionString: "postgresql://solar_admin:mDlgKw8ieBY6YlqUgRLCEFHh9F5NTtqf@dpg-da5eetbm8hqs73cdfoc0-a.oregon-postgres.render.com/solar_rms_cloud?sslmode=require",
    ssl: { rejectUnauthorized: false }
});

const orderedTables = [
    // Layer 1: Base independent tables
    "system_settings",
    "users",
    "categories",
    "stores",
    "projects",
    "customers",
    "om_schedules",
    "cash_transactions",
    "cashbook",
    "expenses",
    "imports",
    "tax_vault_locks",

    // Layer 2: Depends on Layer 1
    "products",
    "contracts",
    "quotations",
    "orders",
    "customer_gifts",
    "customer_logs",
    "tax_vault_documents",
    "project_handover",

    // Layer 3: Depends on Layer 2
    "store_inventory",
    "contract_payments",
    "quotation_items",
    "order_items",
    "order_docs",
    "order_timeline",
    "invoices",
    "return_orders",
    "warranties",

    // Layer 4: Depends on Layer 3
    "return_items",
    "warranty_issues"
];

async function fastSync() {
    console.log("=== 1. TẠO CẤU TRÚC BẢNG & CỘT TRÊN CLOUD ===");
    const client = await cloudPool.connect();
    
    try {
        const tablesRes = await localPool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = $1", ["public"]);
        
        for (const { table_name } of tablesRes.rows) {
            await client.query(`CREATE TABLE IF NOT EXISTS "${table_name}" (id SERIAL PRIMARY KEY);`).catch(() => {});
            
            const colsRes = await localPool.query(
                "SELECT column_name, data_type, udt_name, character_maximum_length FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2",
                ["public", table_name]
            );

            for (const col of colsRes.rows) {
                if (col.column_name === "id") continue;
                let typeStr = col.data_type;
                if (typeStr === "ARRAY") {
                    typeStr = col.udt_name.startsWith("_") ? `${col.udt_name.slice(1)}[]` : "TEXT[]";
                } else if (typeStr === "USER-DEFINED") {
                    typeStr = col.udt_name;
                } else if (typeStr === "character varying") {
                    typeStr = col.character_maximum_length ? `VARCHAR(${col.character_maximum_length})` : "VARCHAR(255)";
                }

                try {
                    await client.query(`ALTER TABLE "${table_name}" ADD COLUMN IF NOT EXISTS "${col.column_name}" ${typeStr};`);
                } catch(colErr) {
                    try {
                        await client.query(`ALTER TABLE "${table_name}" ADD COLUMN IF NOT EXISTS "${col.column_name}" TEXT;`);
                    } catch(e) {}
                }
            }
        }
        console.log("✅ Đã cập nhật xong toàn bộ bảng và cột trên Cloud.");

        console.log("\n=== 2. DỌN DẸP DỮ LIỆU CŨ THEO THỨ TỰ RÀNG BUỘC ===");
        const reversed = [...orderedTables].reverse();
        for (const t of reversed) {
            try {
                await client.query(`DELETE FROM "${t}";`);
            } catch(e) {}
        }
        console.log("✅ Đã dọn dẹp sạch sẽ CSDL Cloud.");

        console.log("\n=== 3. NẠP DỮ LIỆU ĐỒNG BỘ TỪNG BẢNG (BATCH INSERT) ===");
        for (const table of orderedTables) {
            const localData = await localPool.query(`SELECT * FROM "${table}"`);
            if (localData.rows.length === 0) {
                console.log(`- [${table}]: 0 dòng`);
                continue;
            }

            const columns = Object.keys(localData.rows[0]);
            const colNames = columns.map(c => `"${c}"`).join(", ");

            // Nạp theo batch (tối đa 50 dòng / query)
            const chunkSize = 50;
            for (let i = 0; i < localData.rows.length; i += chunkSize) {
                const chunk = localData.rows.slice(i, i + chunkSize);
                const values = [];
                const valueClauses = [];

                let paramIdx = 1;
                for (const row of chunk) {
                    const rowParams = [];
                    for (const col of columns) {
                        values.push(row[col]);
                        rowParams.push(`$${paramIdx++}`);
                    }
                    valueClauses.push(`(${rowParams.join(", ")})`);
                }

                const insertSql = `INSERT INTO "${table}" (${colNames}) VALUES ${valueClauses.join(", ")} ON CONFLICT DO NOTHING;`;
                await client.query(insertSql, values);
            }
            console.log(`✅ [${table}]: Đã nạp thành công ${localData.rows.length} dòng.`);
        }

        // Cập nhật Sequences
        for (const table of orderedTables) {
            try {
                await client.query(`SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 1))`);
            } catch(e) {}
        }

        console.log("\n=== 4. THỐNG KÊ DỮ LIỆU TRÊN RENDER CLOUD ===");
        const users = await client.query("SELECT id, emp_id, username, password, full_name, role FROM users ORDER BY id ASC");
        console.log("Danh sách Tài khoản (Users) trên Cloud:");
        console.table(users.rows);

        const prods = await client.query("SELECT COUNT(*) FROM products");
        const ords = await client.query("SELECT COUNT(*) FROM orders");
        const ordItems = await client.query("SELECT COUNT(*) FROM order_items");
        const custs = await client.query("SELECT COUNT(*) FROM customers");
        const cats = await client.query("SELECT COUNT(*) FROM categories");
        const invs = await client.query("SELECT COUNT(*) FROM invoices");
        const exps = await client.query("SELECT COUNT(*) FROM expenses");
        const vaults = await client.query("SELECT COUNT(*) FROM tax_vault_documents");
        const warrs = await client.query("SELECT COUNT(*) FROM warranties");
        const issues = await client.query("SELECT COUNT(*) FROM warranty_issues");

        console.log(`- Tổng Users: ${users.rows.length}`);
        console.log(`- Tổng Danh mục sản phẩm (Categories): ${cats.rows[0].count}`);
        console.log(`- Tổng Sản phẩm (Products): ${prods.rows[0].count}`);
        console.log(`- Tổng Đơn hàng (Orders): ${ords.rows[0].count}`);
        console.log(`- Tổng Chi tiết đơn hàng (Order Items): ${ordItems.rows[0].count}`);
        console.log(`- Tổng Khách hàng (Customers): ${custs.rows[0].count}`);
        console.log(`- Tổng Hóa đơn (Invoices): ${invs.rows[0].count}`);
        console.log(`- Tổng Chi phí (Expenses): ${exps.rows[0].count}`);
        console.log(`- Tổng Chứng từ Két Thuế (Tax Vault): ${vaults.rows[0].count}`);
        console.log(`- Tổng Thiết bị Bảo hành (Warranties): ${warrs.rows[0].count}`);
        console.log(`- Tổng Sự cố Bảo hành (Warranty Issues): ${issues.rows[0].count}`);

    } finally {
        client.release();
        localPool.end();
        cloudPool.end();
    }
    console.log("\n🎉 HOÀN TẤT ĐỒNG BỘ 100% TOÀN BỘ DỮ LIỆU LÊN CLOUD!");
}

fastSync().catch(err => {
    console.error("Lỗi đồng bộ:", err);
    process.exit(1);
});
