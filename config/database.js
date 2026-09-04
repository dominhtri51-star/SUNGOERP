try { require('dotenv').config(); } catch (e) {}
const { Pool, types } = require('pg');

// 1. Parse DATE (oid 1082) thành chuỗi 'YYYY-MM-DD' nguyên gốc
// Tránh việc node-pg tự ép sang Date object gây lệch múi giờ lùi 1 ngày khi serialize JSON
types.setTypeParser(1082, (val) => val);

// 2. Parse TIMESTAMP WITHOUT TIME ZONE (oid 1114) thành chuỗi 'YYYY-MM-DD HH:mm:ss' nguyên gốc
// Tránh việc node-pg gắn đuôi UTC 'Z' vào giờ máy chấm công (giờ Việt Nam GMT+7), khiến trình duyệt cộng thêm 7 tiếng
types.setTypeParser(1114, (val) => val);

let pool;

if (process.env.DATABASE_URL) {
    const isLocalhost = process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1');
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: isLocalhost || process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
    });
} else {
    pool = new Pool({
        user: process.env.DB_USER || 'solar_admin',
        host: process.env.DB_HOST || 'localhost',
        database: process.env.DB_NAME || 'solar_rms_local',
        password: process.env.DB_PASSWORD || 'SolarPass123!',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    });
}

pool.on('error', (err) => {
    console.error('Unexpected error on idle database client:', err.message);
});

module.exports = pool;
