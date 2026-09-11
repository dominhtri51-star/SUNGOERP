const pool = require('../config/database');

async function migrate() {
    console.log('Running FIFO and Purchase Fee migration...');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Add extra fee columns to purchases table
        await client.query(`
            ALTER TABLE purchases 
            ADD COLUMN IF NOT EXISTS items_amount NUMERIC DEFAULT 0,
            ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC DEFAULT 0,
            ADD COLUMN IF NOT EXISTS other_fee NUMERIC DEFAULT 0,
            ADD COLUMN IF NOT EXISTS fee_notes TEXT,
            ADD COLUMN IF NOT EXISTS total_cost NUMERIC DEFAULT 0;
        `);
        console.log('Added extra fee columns to purchases table');

        // 2. Create inventory_batches table
        await client.query(`
            CREATE TABLE IF NOT EXISTS inventory_batches (
                id SERIAL PRIMARY KEY,
                product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                po_id INT,
                po_code VARCHAR(100),
                supplier_id INT,
                initial_qty NUMERIC NOT NULL DEFAULT 0,
                remaining_qty NUMERIC NOT NULL DEFAULT 0,
                purchase_price NUMERIC NOT NULL DEFAULT 0,
                allotted_fee NUMERIC NOT NULL DEFAULT 0,
                unit_cost NUMERIC NOT NULL DEFAULT 0,
                receive_date TIMESTAMP DEFAULT NOW(),
                created_at TIMESTAMP DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_inv_batches_prod ON inventory_batches(product_id, remaining_qty, receive_date);
            CREATE INDEX IF NOT EXISTS idx_inv_batches_poid ON inventory_batches(po_id);
        `);
        console.log('Created inventory_batches table and indexes');

        // 3. Seed baseline batches for existing products with stock_qty > 0 if not exist
        const batchCountRes = await client.query('SELECT COUNT(*) FROM inventory_batches');
        const count = parseInt(batchCountRes.rows[0].count, 10);
        if (count === 0) {
            console.log('Seeding baseline batches from current product stocks...');
            const prodsRes = await client.query(`
                SELECT id, sku, product_name, stock_qty, import_price 
                FROM products 
                WHERE stock_qty > 0
            `);
            for (const p of prodsRes.rows) {
                const qty = parseFloat(p.stock_qty) || 0;
                const cost = parseFloat(p.import_price) || 0;
                await client.query(`
                    INSERT INTO inventory_batches (
                        product_id, po_id, po_code, supplier_id, initial_qty, remaining_qty, 
                        purchase_price, allotted_fee, unit_cost, receive_date, created_at
                    ) VALUES (
                        $1, NULL, 'TON-DAU-KY', NULL, $2, $2, $3, 0, $3, NOW() - interval '7 days', NOW()
                    )
                `, [p.id, qty, cost]);
            }
            console.log(`Seeded baseline batches for ${prodsRes.rows.length} products`);
        }

        // 4. Update existing purchases items_amount and total_cost if null or 0
        await client.query(`
            UPDATE purchases 
            SET 
                items_amount = COALESCE(NULLIF(items_amount, 0), total_amount, 0),
                total_cost = COALESCE(NULLIF(total_cost, 0), total_amount, 0)
            WHERE items_amount IS NULL OR items_amount = 0;
        `);
        console.log('Updated existing purchases items_amount');

        await client.query('COMMIT');
        console.log('Migration completed successfully!');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Migration failed:', err);
        throw err;
    } finally {
        client.release();
    }
}

migrate()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
