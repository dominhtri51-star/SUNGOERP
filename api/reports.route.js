const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Helper định dạng timeline theo chu kỳ
function formatTimelineData(period, rows) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = now.getMonth(); // 0-indexed

    if (period === 'year') {
        const map = {};
        rows.forEach(r => {
            map[parseInt(r.time_key)] = {
                rev: parseFloat(r.revenue) || 0,
                prof: parseFloat(r.profit) || 0
            };
        });
        const labels = [];
        const revenue = [];
        const profit = [];
        for (let m = 1; m <= 12; m++) {
            labels.push(`Tháng ${m}`);
            revenue.push(map[m] ? map[m].rev : 0);
            profit.push(map[m] ? map[m].prof : 0);
        }
        return { labels, revenue, profit };
    }

    if (period === 'week') {
        // Thứ 2 đến Chủ Nhật của tuần hiện tại
        const currentDay = now.getDay(); // 0 is Sunday, 1 is Monday...
        const distanceToMonday = (currentDay + 6) % 7;
        const monday = new Date(now);
        monday.setDate(now.getDate() - distanceToMonday);

        const map = {};
        rows.forEach(r => {
            map[r.time_key] = {
                rev: parseFloat(r.revenue) || 0,
                prof: parseFloat(r.profit) || 0
            };
        });

        const dayNames = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
        const labels = [];
        const revenue = [];
        const profit = [];

        for (let i = 0; i < 7; i++) {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            const dY = d.getFullYear();
            const dM = String(d.getMonth() + 1).padStart(2, '0');
            const dD = String(d.getDate()).padStart(2, '0');
            const key = `${dY}-${dM}-${dD}`;
            labels.push(`${dayNames[i]} (${dD}/${dM})`);
            const item = map[key] || { rev: 0, prof: 0 };
            revenue.push(item.rev);
            profit.push(item.prof);
        }
        return { labels, revenue, profit };
    }

    if (period === 'month') {
        // Tất cả các ngày trong tháng hiện tại
        const daysInMonth = new Date(yyyy, mm + 1, 0).getDate();
        const map = {};
        rows.forEach(r => {
            map[r.time_key] = {
                rev: parseFloat(r.revenue) || 0,
                prof: parseFloat(r.profit) || 0
            };
        });

        const labels = [];
        const revenue = [];
        const profit = [];
        const monthStr = String(mm + 1).padStart(2, '0');

        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = String(d).padStart(2, '0');
            const key = `${yyyy}-${monthStr}-${dateStr}`;
            labels.push(`${dateStr}/${monthStr}`);
            const item = map[key] || { rev: 0, prof: 0 };
            revenue.push(item.rev);
            profit.push(item.prof);
        }
        return { labels, revenue, profit };
    }

    // Mặc định: 'day' - Chia theo các khung giờ (06:00 đến 22:00)
    const map = {};
    rows.forEach(r => {
        map[r.time_key] = {
            rev: parseFloat(r.revenue) || 0,
            prof: parseFloat(r.profit) || 0
        };
    });

    const labels = [];
    const revenue = [];
    const profit = [];

    for (let h = 6; h <= 22; h += 2) {
        const hourStr = String(h).padStart(2, '0') + ':00';
        labels.push(hourStr);
        let revSum = 0;
        let profSum = 0;
        for (let sub = h; sub < h + 2 && sub <= 23; sub++) {
            const subStr = String(sub).padStart(2, '0') + ':00';
            if (map[subStr]) {
                revSum += map[subStr].rev;
                profSum += map[subStr].prof;
            }
        }
        revenue.push(revSum);
        profit.push(profSum);
    }
    return { labels, revenue, profit };
}

router.get('/quick', async (req, res) => {
    try {
        const { period = 'month' } = req.query; 
        let dateFilter = "1=1"; 
        let orderDateFilter = "1=1";
        
        if (period === 'day') {
            dateFilter = "DATE(o.created_at) = CURRENT_DATE";
            orderDateFilter = "DATE(created_at) = CURRENT_DATE";
        } else if (period === 'week') {
            dateFilter = "o.created_at >= date_trunc('week', CURRENT_DATE)";
            orderDateFilter = "created_at >= date_trunc('week', CURRENT_DATE)";
        } else if (period === 'month') {
            dateFilter = "o.created_at >= date_trunc('month', CURRENT_DATE)";
            orderDateFilter = "created_at >= date_trunc('month', CURRENT_DATE)";
        } else if (period === 'year') {
            dateFilter = "o.created_at >= date_trunc('year', CURRENT_DATE)";
            orderDateFilter = "created_at >= date_trunc('year', CURRENT_DATE)";
        }

        // 1. TỔNG QUAN DOANH THU & GIÁ VỐN
        const salesQuery = `
            SELECT 
                COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue,
                COALESCE(SUM(oi.quantity * p.import_price), 0) AS cogs,
                COUNT(DISTINCT o.id) AS completed_orders_count
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            JOIN products p ON oi.product_id = p.id
            WHERE o.status = 'COMPLETED' AND ${dateFilter}
        `;
        
        // 2. TỒN KHO THỰC TẾ
        const invQuery = "SELECT COALESCE(SUM(stock_qty * import_price), 0) AS total_inv_value, COALESCE(SUM(stock_qty), 0) AS total_qty FROM products WHERE stock_qty > 0";
        
        let revenue = 0, cogs = 0, inventoryValue = 0, inventoryQty = 0, completedOrdersCount = 0;
        
        try {
            const salesRes = await pool.query(salesQuery);
            if (salesRes.rows.length > 0) {
                revenue = parseFloat(salesRes.rows[0].revenue) || 0;
                cogs = parseFloat(salesRes.rows[0].cogs) || 0;
                completedOrdersCount = parseInt(salesRes.rows[0].completed_orders_count) || 0;
            }
        } catch(e) {
            console.error("Lỗi salesQuery:", e.message);
        }

        try {
            const invRes = await pool.query(invQuery);
            if (invRes.rows.length > 0) {
                inventoryValue = parseFloat(invRes.rows[0].total_inv_value) || 0;
                inventoryQty = parseInt(invRes.rows[0].total_qty) || 0;
            }
        } catch(e) { console.log("Lỗi truy vấn kho:", e.message); }

        const profit = revenue - cogs;
        const thu = revenue;
        const chi = cogs;

        // 3. TRUY VẤN TIMELINE CHO BIỂU ĐỒ (Line/Bar Chart)
        let timelineQuery = '';
        if (period === 'year') {
            timelineQuery = `
                SELECT 
                    EXTRACT(MONTH FROM o.created_at)::text as time_key,
                    COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue,
                    COALESCE(SUM(oi.quantity * (oi.price - p.import_price)), 0) AS profit
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                JOIN products p ON oi.product_id = p.id
                WHERE o.status = 'COMPLETED' AND ${dateFilter}
                GROUP BY EXTRACT(MONTH FROM o.created_at)
                ORDER BY EXTRACT(MONTH FROM o.created_at) ASC
            `;
        } else if (period === 'month' || period === 'week') {
            timelineQuery = `
                SELECT 
                    TO_CHAR(o.created_at, 'YYYY-MM-DD') as time_key,
                    COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue,
                    COALESCE(SUM(oi.quantity * (oi.price - p.import_price)), 0) AS profit
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                JOIN products p ON oi.product_id = p.id
                WHERE o.status = 'COMPLETED' AND ${dateFilter}
                GROUP BY TO_CHAR(o.created_at, 'YYYY-MM-DD')
                ORDER BY time_key ASC
            `;
        } else { // 'day'
            timelineQuery = `
                SELECT 
                    TO_CHAR(o.created_at, 'HH24:00') as time_key,
                    COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue,
                    COALESCE(SUM(oi.quantity * (oi.price - p.import_price)), 0) AS profit
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                JOIN products p ON oi.product_id = p.id
                WHERE o.status = 'COMPLETED' AND ${dateFilter}
                GROUP BY TO_CHAR(o.created_at, 'HH24:00')
                ORDER BY time_key ASC
            `;
        }

        let timeline = { labels: [], revenue: [], profit: [] };
        try {
            const timelineRes = await pool.query(timelineQuery);
            timeline = formatTimelineData(period, timelineRes.rows);
        } catch(e) {
            console.error("Lỗi timelineQuery:", e.message);
        }

        // 4. TRUY VẤN TOP 5 SẢN PHẨM BÁN CHẠY (Doughnut Chart & List)
        let topProducts = [];
        try {
            const topProdRes = await pool.query(`
                SELECT 
                    p.id,
                    p.product_name,
                    COALESCE(SUM(oi.quantity), 0)::numeric AS total_qty,
                    COALESCE(SUM(oi.quantity * oi.price), 0)::numeric AS total_revenue
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                JOIN products p ON oi.product_id = p.id
                WHERE o.status = 'COMPLETED' AND ${dateFilter}
                GROUP BY p.id, p.product_name
                ORDER BY total_revenue DESC
                LIMIT 5
            `);
            topProducts = topProdRes.rows.map(r => ({
                id: r.id,
                product_name: r.product_name,
                total_qty: parseFloat(r.total_qty) || 0,
                total_revenue: parseFloat(r.total_revenue) || 0
            }));
        } catch(e) {
            console.error("Lỗi topProdRes:", e.message);
        }

        // 5. TRUY VẤN TRẠNG THÁI ĐƠN HÀNG TRONG KỲ
        let orderStatuses = [];
        try {
            const statusRes = await pool.query(`
                SELECT 
                    status,
                    COUNT(id)::int as count,
                    COALESCE(SUM(total_amount), 0)::numeric as total_amount
                FROM orders
                WHERE ${orderDateFilter}
                GROUP BY status
            `);
            orderStatuses = statusRes.rows;
        } catch(e) {
            console.error("Lỗi statusRes:", e.message);
        }

        res.json({
            success: true,
            data: { 
                revenue, 
                profit, 
                inventoryValue, 
                inventoryQty, 
                thu, 
                chi, 
                completedOrdersCount,
                period,
                timeline,
                topProducts,
                orderStatuses
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;