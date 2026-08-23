try { require('dotenv').config(); } catch (e) {}
const { Pool } = require('pg');

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
