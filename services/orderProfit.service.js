const pool = require('../config/database');

/**
 * Tái tính toán giá vốn (COGS), Lợi nhuận gộp (Gross Profit) và Lợi nhuận ròng (Net Profit) cho một đơn hàng
 * Dựa trên giá vốn hiện hành của các sản phẩm trong bảng products
 */
async function recalculateOrderProfit(orderId, dbClient = null) {
    const client = dbClient || pool;
    try {
        const oRes = await client.query(`
            SELECT id, order_code, total_amount, cost_of_goods, gross_profit, net_profit,
                   COALESCE(NULLIF(shipping_fee, '')::numeric, 0) as ship_fee,
                   COALESCE(NULLIF(station_fee, '')::numeric, 0) as stn_fee,
                   COALESCE(NULLIF(packaging_fee, '')::numeric, 0) as pack_fee,
                   COALESCE(NULLIF(handling_fee, '')::numeric, 0) as hand_fee,
                   COALESCE(NULLIF(other_fee, '')::numeric, 0) as oth_fee
            FROM orders WHERE id = $1
        `, [orderId]);

        if (oRes.rows.length === 0) return null;
        const ord = oRes.rows[0];

        // Lấy toàn bộ items và giá vốn mới nhất của từng sản phẩm
        const itemsRes = await client.query(`
            SELECT oi.id, oi.quantity, oi.price, oi.product_id,
                   COALESCE(p.import_price, 0)::numeric as import_price
            FROM order_items oi
            LEFT JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = $1
        `, [orderId]);

        let newCogs = 0;
        let hasZeroCost = false;
        for (const item of itemsRes.rows) {
            const qty = parseFloat(item.quantity) || 1;
            const cost = parseFloat(item.import_price) || 0;
            if (cost <= 0) hasZeroCost = true;
            newCogs += qty * cost;
        }

        const totalAmount = parseFloat(ord.total_amount) || 0;
        const grossProfit = totalAmount - newCogs;
        const totalFees = parseFloat(ord.ship_fee) + parseFloat(ord.stn_fee) + parseFloat(ord.pack_fee) + parseFloat(ord.hand_fee) + parseFloat(ord.oth_fee);
        const netProfit = grossProfit - totalFees;

        // Cập nhật lại orders
        await client.query(`
            UPDATE orders 
            SET cost_of_goods = $1, gross_profit = $2, net_profit = $3
            WHERE id = $4
        `, [newCogs, grossProfit, netProfit, orderId]);

        // Đồng bộ lại bảng hoa hồng sales_commissions nếu đơn hàng này đã được ghi nhận hoa hồng
        try {
            await client.query(`
                UPDATE sales_commissions
                SET cogs_amount = $1,
                    gross_profit = $2,
                    commission_amount = ROUND($2 * (commission_rate / 100))
                WHERE ref_type IN ('ORDER', 'ORDER_MANAGER') 
                  AND ref_id = $3 
                  AND paid_status != 'PAID'
            `, [newCogs, grossProfit, String(orderId)]);
        } catch (commErr) {
            console.error("Lỗi đồng bộ sales_commissions khi tính lại lợi nhuận:", commErr.message);
        }

        return {
            orderId,
            orderCode: ord.order_code,
            oldCogs: parseFloat(ord.cost_of_goods) || 0,
            newCogs,
            oldNetProfit: parseFloat(ord.net_profit) || 0,
            newNetProfit: netProfit,
            hasZeroCost
        };
    } catch (err) {
        console.error(`Lỗi tính lại lợi nhuận đơn hàng ${orderId}:`, err.message);
        throw err;
    }
}

/**
 * Tìm tất cả các đơn hàng chứa sản phẩm cụ thể và tính lại lợi nhuận
 */
async function recalculateOrdersByProduct(productId, dbClient = null) {
    const client = dbClient || pool;
    try {
        const res = await client.query(`
            SELECT DISTINCT order_id 
            FROM order_items 
            WHERE product_id = $1
        `, [productId]);

        const results = [];
        for (const row of res.rows) {
            const r = await recalculateOrderProfit(row.order_id, client);
            if (r) results.push(r);
        }
        return results;
    } catch (err) {
        console.error(`Lỗi recalculateOrdersByProduct for product ${productId}:`, err.message);
        return [];
    }
}

/**
 * Quét toàn bộ hệ thống để tính toán lại lợi nhuận cho toàn bộ đơn hàng
 */
async function recalculateAllOrders(dbClient = null) {
    const client = dbClient || pool;
    try {
        const res = await client.query(`
            SELECT DISTINCT o.id 
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            WHERE o.status != 'CANCELLED'
            ORDER BY o.id DESC
        `);

        const results = [];
        for (const row of res.rows) {
            const r = await recalculateOrderProfit(row.id, client);
            if (r) results.push(r);
        }
        return results;
    } catch (err) {
        console.error("Lỗi recalculateAllOrders:", err.message);
        throw err;
    }
}

module.exports = {
    recalculateOrderProfit,
    recalculateOrdersByProduct,
    recalculateAllOrders
};
