const pool = require('../config/database');
const fs = require('fs');
const path = require('path');
const googleDrive = require('./googleDrive.service');

const BACKUP_DIR = path.join(__dirname, '../backups');

const ORDERED_TABLES = [
    'system_settings', 'users', 'categories', 'stores', 'projects', 'customers',
    'om_schedules', 'cash_transactions', 'cashbook', 'expenses', 'imports', 'tax_vault_locks',
    'products', 'contracts', 'quotations', 'orders', 'customer_gifts', 'customer_logs',
    'tax_vault_documents', 'project_handover', 'store_inventory', 'contract_payments',
    'quotation_items', 'order_items', 'order_docs', 'order_timeline', 'invoices',
    'return_orders', 'warranties', 'return_items', 'warranty_issues'
];

/**
 * Trích xuất toàn bộ dữ liệu CSDL PostgreSQL và tạo bản sao lưu
 */
async function generateDatabaseDump() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    let sqlDump = `-- ==========================================================\n`;
    sqlDump += `-- SUNGO ERP DATABASE BACKUP\n`;
    sqlDump += `-- Thời gian tạo: ${now.toLocaleString('vi-VN')} (${now.toISOString()})\n`;
    sqlDump += `-- Nguồn: Supabase PostgreSQL (Cloud Database)\n`;
    sqlDump += `-- ==========================================================\n\n`;
    sqlDump += `SET statement_timeout = 0;\nSET client_encoding = 'UTF8';\n\n`;

    const summary = {};
    let totalRows = 0;

    for (const table of ORDERED_TABLES) {
        try {
            const res = await pool.query(`SELECT * FROM "${table}"`);
            summary[table] = res.rows.length;
            totalRows += res.rows.length;

            if (res.rows.length > 0) {
                const cols = Object.keys(res.rows[0]);
                const colNames = cols.map(c => `"${c}"`).join(', ');

                sqlDump += `-- ----------------------------------------------------------\n`;
                sqlDump += `-- Phân hệ: ${table} (${res.rows.length} dòng dữ liệu)\n`;
                sqlDump += `-- ----------------------------------------------------------\n`;
                for (const row of res.rows) {
                    const values = cols.map(c => {
                        const val = row[c];
                        if (val === null || val === undefined) return 'NULL';
                        if (typeof val === 'number' || typeof val === 'boolean') return val;
                        if (val instanceof Date) return `'${val.toISOString()}'`;
                        if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
                        return `'${String(val).replace(/'/g, "''")}'`;
                    }).join(', ');

                    sqlDump += `INSERT INTO "${table}" (${colNames}) VALUES (${values}) ON CONFLICT DO NOTHING;\n`;
                }
                sqlDump += `\n`;
            }
        } catch (e) {
            // Bỏ qua nếu bảng chưa tồn tại
        }
    }

    const fileName = `SUNGO_BACKUP_${timestamp}.sql`;
    const filePath = path.join(BACKUP_DIR, fileName);
    fs.writeFileSync(filePath, sqlDump, 'utf8');

    // Thử nghiệm đẩy lên Google Drive nếu có cấu hình
    let driveResult = null;
    if (googleDrive.isConfigured()) {
        try {
            const buffer = Buffer.from(sqlDump, 'utf8');
            driveResult = await googleDrive.uploadFile({
                buffer,
                originalname: fileName,
                mimetype: 'application/sql',
                subfolder: 'backups'
            });
        } catch (err) {
            console.error('Lỗi upload Drive:', err.message);
        }
    }

    return {
        success: true,
        fileName,
        timestamp,
        totalRows,
        summary,
        fileSize: Buffer.byteLength(sqlDump),
        filePath,
        sqlDump,
        driveResult
    };
}

module.exports = {
    generateDatabaseDump,
    ORDERED_TABLES
};
