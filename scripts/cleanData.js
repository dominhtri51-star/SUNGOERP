const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

// 1. Cấu hình kết nối CSDL Local
const localPool = new Pool({
    user: process.env.DB_USER || "solar_admin",
    host: process.env.DB_HOST || "localhost",
    database: process.env.DB_NAME || "solar_rms_local",
    password: process.env.DB_PASSWORD || "SolarPass123!",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    ssl: false
});

// 2. Cấu hình kết nối CSDL Cloud (Render)
const cloudPool = new Pool({
    connectionString: "postgresql://solar_admin:mDlgKw8ieBY6YlqUgRLCEFHh9F5NTtqf@dpg-da5eetbm8hqs73cdfoc0-a.oregon-postgres.render.com/solar_rms_cloud?sslmode=require",
    ssl: { rejectUnauthorized: false }
});

// Danh sách các bảng dữ liệu giao dịch / demo cần dọn sạch
const tablesToClean = [
    "return_items",
    "warranty_issues",
    "order_items",
    "order_docs",
    "order_timeline",
    "quotation_items",
    "customer_gifts",
    "customer_logs",
    "contract_payments",
    "loan_repayments",
    "equity_transactions",
    "payroll_items",
    "employee_insurances",
    "sales_commissions",
    "debt_kpi_evaluations",
    "store_inventory",
    "inventory_audits",
    "project_handover",
    "invoices",
    "tax_vault_documents",
    "tax_vault_locks",
    "warranties",
    "om_schedules",
    "return_orders",
    "orders",
    "quotations",
    "contracts",
    "expenses",
    "cash_transactions",
    "cashbook",
    "imports",
    "payrolls",
    "bank_loans",
    "shareholders",
    "employees",
    "projects",
    "customers",
    "products"
];

// Danh sách các file JSON trong thư mục data cần làm sạch về []
const jsonFilesToClean = [
    "bidding_handovers.json",
    "bidding_projects.json",
    "contractor_teams.json",
    "customers.json",
    "handovers.json",
    "imports.json",
    "inventory.json",
    "payments.json",
    "project_bids.json",
    "projects.json",
    "purchases.json",
    "quotations.json",
    "suppliers.json"
];

// Danh sách các thư mục upload file demo cần dọn sạch
const uploadDirsToClean = [
    path.join(__dirname, "..", "public", "uploads", "contracts"),
    path.join(__dirname, "..", "public", "uploads", "proofs"),
    path.join(__dirname, "..", "public", "uploads", "vault")
];

async function cleanDatabase(poolInstance, dbName) {
    console.log(`\n🧹 ĐANG DỌN DẸP CSDL [${dbName}]...`);
    try {
        // Tìm các bảng thực tế tồn tại trong CSDL
        const existingRes = await poolInstance.query(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
        );
        const existingTables = existingRes.rows.map(r => r.table_name);
        const validTables = tablesToClean.filter(t => existingTables.includes(t));

        if (validTables.length > 0) {
            const truncateQuery = `TRUNCATE TABLE ${validTables.map(t => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE;`;
            await poolInstance.query(truncateQuery);
            validTables.forEach(t => console.log(`  ✅ Đã làm sạch & reset Sequence: ${t}`));
        }

        console.log(`🎉 HOÀN TẤT LÀM SẠCH CSDL [${dbName}]!`);
    } catch (err) {
        console.error(`❌ Lỗi dọn dẹp [${dbName}]:`, err.message);
    }
}

function cleanJSONFiles() {
    console.log("\n🧹 ĐANG DỌN DẸP CÁC FILE JSON TRONG THƯ MỤC DATA...");
    const dataDir = path.join(__dirname, "..", "data");
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    for (const file of jsonFilesToClean) {
        const filePath = path.join(dataDir, file);
        try {
            fs.writeFileSync(filePath, "[]\n", "utf8");
            console.log(`  ✅ Đã làm sạch: data/${file}`);
        } catch (e) {
            console.warn(`  ⚠️ Không thể ghi file data/${file}:`, e.message);
        }
    }
}

function cleanUploadFiles() {
    console.log("\n🧹 ĐANG DỌN DẸP CÁC FILE UPLOAD DEMO...");
    for (const dir of uploadDirsToClean) {
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                if (file === ".gitkeep" || file === ".DS_Store") continue;
                const fullPath = path.join(dir, file);
                try {
                    if (fs.statSync(fullPath).isFile()) {
                        fs.unlinkSync(fullPath);
                        console.log(`  🗑️ Đã xóa file demo: ${path.relative(path.join(__dirname, ".."), fullPath)}`);
                    }
                } catch (e) {}
            }
        } else {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}

async function verifyDatabase(poolInstance, dbName) {
    console.log(`\n📊 KIỂM TRA THỐNG KÊ SAU KHI DỌN DẸP [${dbName}]:`);
    try {
        const checkTables = [
            "products", "orders", "order_items", "quotations", "customers",
            "expenses", "cash_transactions", "invoices", "contracts",
            "warranties", "om_schedules", "projects", "employees",
            "bank_loans", "shareholders", "tax_vault_documents"
        ];

        for (const t of checkTables) {
            try {
                const countRes = await poolInstance.query(`SELECT COUNT(*) FROM "${t}"`);
                console.log(`  - [${t.padEnd(20)}]: ${countRes.rows[0].count} dòng`);
            } catch (e) {}
        }

        const usersCount = await poolInstance.query("SELECT COUNT(*) FROM users");
        console.log(`  - [users (Tài khoản)   ]: ${usersCount.rows[0].count} tài khoản quản trị`);
    } catch (e) {
        console.error("Lỗi kiểm tra:", e.message);
    }
}

async function main() {
    console.log("==================================================");
    console.log("🚀 BẮT ĐẦU QUY TRÌNH DỌN SẠCH HỆ THỐNG (CLEAN SLATE)");
    console.log("==================================================");

    // 1. Dọn dẹp Local PostgreSQL
    await cleanDatabase(localPool, "Local PostgreSQL");

    // 2. Dọn dẹp Cloud PostgreSQL
    try {
        await cleanDatabase(cloudPool, "Cloud PostgreSQL (Render)");
    } catch (e) {
        console.warn("⚠️ Không thể kết nối Cloud DB:", e.message);
    }

    // 3. Dọn dẹp file JSON
    cleanJSONFiles();

    // 4. Dọn dẹp file upload demo
    cleanUploadFiles();

    // 5. Khởi tạo lại cấu trúc & đồng bộ nhân sự mặc định
    try {
        await require('../config/initDb')();
    } catch(e) {
        console.warn("⚠️ Không thể tự động re-init sau khi clean:", e.message);
    }

    // 6. Kiểm tra kết quả Local
    await verifyDatabase(localPool, "Local PostgreSQL");

    // 7. Đóng kết nối
    await localPool.end();
    await cloudPool.end();

    console.log("\n==================================================");
    console.log("🎉 HỆ THỐNG ĐÃ ĐƯỢC DỌN SẠCH HOÀN TOÀN (100% SẠCH SẼ)!");
    console.log("==================================================");
}

main().catch(err => {
    console.error("Lỗi nghiêm trọng:", err);
    process.exit(1);
});
