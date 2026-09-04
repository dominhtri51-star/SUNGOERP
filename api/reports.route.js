const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Helper định dạng timeline theo chu kỳ
function formatTimelineData(period, rows, startDate = null, endDate = null) {
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

    if (period === 'custom' && startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffMs = end - start;
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1;

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

        if (diffDays <= 1) {
            for (let h = 6; h <= 22; h += 2) {
                const hourStr = String(h).padStart(2, '0') + ':00';
                labels.push(hourStr);
                let revSum = 0, profSum = 0;
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
        } else if (diffDays <= 31) {
            let curr = new Date(start);
            while (curr <= end) {
                const yyyy = curr.getFullYear();
                const mm = String(curr.getMonth() + 1).padStart(2, '0');
                const dd = String(curr.getDate()).padStart(2, '0');
                const key = `${yyyy}-${mm}-${dd}`;
                labels.push(`${dd}/${mm}`);
                const item = map[key] || { rev: 0, prof: 0 };
                revenue.push(item.rev);
                profit.push(item.prof);
                curr.setDate(curr.getDate() + 1);
            }
        } else {
            let curr = new Date(start.getFullYear(), start.getMonth(), 1);
            const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
            while (curr <= endMonth) {
                const yyyy = curr.getFullYear();
                const mm = String(curr.getMonth() + 1).padStart(2, '0');
                const key = `${yyyy}-${mm}`;
                labels.push(`T${mm}/${yyyy}`);
                const item = map[key] || { rev: 0, prof: 0 };
                revenue.push(item.rev);
                profit.push(item.prof);
                curr.setMonth(curr.getMonth() + 1);
            }
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
        const { period = 'day', startDate, endDate } = req.query; 
        let dateFilter = "1=1"; 
        let orderDateFilter = "1=1";
        const isValidDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
        
        let customStart = null;
        let customEnd = null;
        let diffDays = 1;

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
        } else if (period === 'custom') {
            if (isValidDate(startDate) && isValidDate(endDate)) {
                customStart = startDate;
                customEnd = endDate;
            } else if (isValidDate(startDate)) {
                customStart = startDate;
                customEnd = startDate;
            } else {
                const todayStr = new Date().toISOString().slice(0, 10);
                customStart = todayStr;
                customEnd = todayStr;
            }
            dateFilter = `DATE(o.created_at) >= '${customStart}' AND DATE(o.created_at) <= '${customEnd}'`;
            orderDateFilter = `DATE(created_at) >= '${customStart}' AND DATE(created_at) <= '${customEnd}'`;
            diffDays = Math.ceil((new Date(customEnd) - new Date(customStart)) / (1000 * 60 * 60 * 24)) + 1;
        }

        // 1. TỔNG QUAN DOANH THU & GIÁ VỐN
        const salesQuery = `
            SELECT 
                COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue,
                COALESCE(SUM(oi.quantity * COALESCE(p.import_price, 0)), 0) AS cogs,
                COUNT(DISTINCT o.id) AS completed_orders_count
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            LEFT JOIN products p ON oi.product_id = p.id
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
                    COALESCE(SUM(oi.quantity * (oi.price - COALESCE(p.import_price, 0))), 0) AS profit
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                LEFT JOIN products p ON oi.product_id = p.id
                WHERE o.status = 'COMPLETED' AND ${dateFilter}
                GROUP BY EXTRACT(MONTH FROM o.created_at)
                ORDER BY EXTRACT(MONTH FROM o.created_at) ASC
            `;
        } else if (period === 'month' || period === 'week') {
            timelineQuery = `
                SELECT 
                    TO_CHAR(o.created_at, 'YYYY-MM-DD') as time_key,
                    COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue,
                    COALESCE(SUM(oi.quantity * (oi.price - COALESCE(p.import_price, 0))), 0) AS profit
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                LEFT JOIN products p ON oi.product_id = p.id
                WHERE o.status = 'COMPLETED' AND ${dateFilter}
                GROUP BY TO_CHAR(o.created_at, 'YYYY-MM-DD')
                ORDER BY time_key ASC
            `;
        } else if (period === 'custom') {
            if (diffDays <= 1) {
                timelineQuery = `
                    SELECT 
                        TO_CHAR(o.created_at, 'HH24:00') as time_key,
                        COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue,
                        COALESCE(SUM(oi.quantity * (oi.price - COALESCE(p.import_price, 0))), 0) AS profit
                    FROM order_items oi
                    JOIN orders o ON oi.order_id = o.id
                    LEFT JOIN products p ON oi.product_id = p.id
                    WHERE o.status = 'COMPLETED' AND ${dateFilter}
                    GROUP BY TO_CHAR(o.created_at, 'HH24:00')
                    ORDER BY time_key ASC
                `;
            } else if (diffDays <= 31) {
                timelineQuery = `
                    SELECT 
                        TO_CHAR(o.created_at, 'YYYY-MM-DD') as time_key,
                        COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue,
                        COALESCE(SUM(oi.quantity * (oi.price - COALESCE(p.import_price, 0))), 0) AS profit
                    FROM order_items oi
                    JOIN orders o ON oi.order_id = o.id
                    LEFT JOIN products p ON oi.product_id = p.id
                    WHERE o.status = 'COMPLETED' AND ${dateFilter}
                    GROUP BY TO_CHAR(o.created_at, 'YYYY-MM-DD')
                    ORDER BY time_key ASC
                `;
            } else {
                timelineQuery = `
                    SELECT 
                        TO_CHAR(o.created_at, 'YYYY-MM') as time_key,
                        COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue,
                        COALESCE(SUM(oi.quantity * (oi.price - COALESCE(p.import_price, 0))), 0) AS profit
                    FROM order_items oi
                    JOIN orders o ON oi.order_id = o.id
                    LEFT JOIN products p ON oi.product_id = p.id
                    WHERE o.status = 'COMPLETED' AND ${dateFilter}
                    GROUP BY TO_CHAR(o.created_at, 'YYYY-MM')
                    ORDER BY time_key ASC
                `;
            }
        } else { // 'day'
            timelineQuery = `
                SELECT 
                    TO_CHAR(o.created_at, 'HH24:00') as time_key,
                    COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue,
                    COALESCE(SUM(oi.quantity * (oi.price - COALESCE(p.import_price, 0))), 0) AS profit
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                LEFT JOIN products p ON oi.product_id = p.id
                WHERE o.status = 'COMPLETED' AND ${dateFilter}
                GROUP BY TO_CHAR(o.created_at, 'HH24:00')
                ORDER BY time_key ASC
            `;
        }

        let timeline = { labels: [], revenue: [], profit: [] };
        try {
            const timelineRes = await pool.query(timelineQuery);
            timeline = formatTimelineData(period, timelineRes.rows, customStart, customEnd);
        } catch(e) {
            console.error("Lỗi timelineQuery:", e.message);
        }

        // 4. TRUY VẤN TOÀN BỘ SẢN PHẨM BÁN RA TRONG KỲ (KÈM GIÁ VỐN & LỢI NHUẬN TỪNG SẢN PHẨM)
        let topProducts = [];
        try {
            const topProdRes = await pool.query(`
                SELECT 
                    COALESCE(p.id, oi.product_id) AS id,
                    COALESCE(p.sku, oi.sku, '--') AS sku,
                    COALESCE(p.product_name, oi.product_name, 'Sản phẩm khác') AS product_name,
                    COALESCE(p.import_price, 0)::numeric AS unit_cost,
                    COALESCE(SUM(oi.quantity), 0)::numeric AS total_qty,
                    COALESCE(SUM(oi.quantity * oi.price), 0)::numeric AS total_revenue,
                    COALESCE(SUM(oi.quantity * COALESCE(p.import_price, 0)), 0)::numeric AS total_cost,
                    COALESCE(SUM(oi.quantity * (oi.price - COALESCE(p.import_price, 0))), 0)::numeric AS total_profit
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                LEFT JOIN products p ON oi.product_id = p.id
                WHERE o.status = 'COMPLETED' AND ${dateFilter}
                GROUP BY COALESCE(p.id, oi.product_id), p.sku, oi.sku, p.product_name, oi.product_name, p.import_price
                ORDER BY total_revenue DESC
                LIMIT 100
            `);
            topProducts = topProdRes.rows.map(r => {
                const total_qty = parseFloat(r.total_qty) || 0;
                const total_revenue = parseFloat(r.total_revenue) || 0;
                const unit_cost = parseFloat(r.unit_cost) || 0;
                const total_cost = parseFloat(r.total_cost) || 0;
                const total_profit = parseFloat(r.total_profit) || 0;
                const is_zero_cost = unit_cost <= 0;
                return {
                    id: r.id,
                    sku: r.sku,
                    product_name: r.product_name,
                    unit_cost,
                    total_qty,
                    total_revenue,
                    total_cost,
                    total_profit,
                    is_zero_cost,
                    margin_pct: total_revenue > 0 ? parseFloat(((total_profit / total_revenue) * 100).toFixed(1)) : 0
                };
            });
        } catch(e) {
            console.error("Lỗi topProdRes:", e.message);
        }

        let zeroCostProductsCount = 0;
        let zeroCostRevenue = 0;
        let zeroCostProfit = 0;

        topProducts.forEach(p => {
            if (p.is_zero_cost) {
                zeroCostProductsCount++;
                zeroCostRevenue += p.total_revenue;
                zeroCostProfit += p.total_profit;
            }
        });

        const realProfit = profit - zeroCostProfit;

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
                cogs,
                zeroCostProductsCount,
                zeroCostRevenue,
                zeroCostProfit,
                realProfit,
                inventoryValue, 
                inventoryQty, 
                thu, 
                chi, 
                completedOrdersCount,
                period,
                startDate: customStart,
                endDate: customEnd,
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