const express = require('express');
const router = express.Router();
const pool = require('../config/database.js');

// Tự động kiểm tra và nâng cấp bảng categories & products
(async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                parent_id INTEGER DEFAULT NULL,
                sort_order INTEGER DEFAULT 0,
                icon VARCHAR(100) DEFAULT 'fa-folder',
                color VARCHAR(50) DEFAULT 'amber',
                description TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await pool.query(`
            ALTER TABLE categories ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
            ALTER TABLE categories ADD COLUMN IF NOT EXISTS icon VARCHAR(100) DEFAULT 'fa-folder';
            ALTER TABLE categories ADD COLUMN IF NOT EXISTS color VARCHAR(50) DEFAULT 'amber';
            ALTER TABLE categories ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
            ALTER TABLE products ADD COLUMN IF NOT EXISTS bin_location VARCHAR(100) DEFAULT '';
            ALTER TABLE products ADD COLUMN IF NOT EXISTS stocks JSONB DEFAULT '{}'::jsonb;
            ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id INTEGER DEFAULT NULL;
        `);
        console.log("✅ Đã nâng cấp cấu trúc bảng categories & products sẵn sàng cho Drag & Drop.");
    } catch (e) {
        console.error("⚠️ Cảnh báo khởi tạo categories:", e.message);
    }
})();

// Cấu trúc danh mục mẫu chuẩn ngành Năng Lượng Mặt Trời (Phục vụ Auto Sync)
const DEFAULT_TREE_DEFINITION = [
    {
        name: "Tấm Pin Năng Lượng Mặt Trời",
        icon: "fa-solar-panel",
        color: "amber",
        children: [
            { name: "Tấm Pin N-Type / Mono", icon: "fa-sun", color: "amber" },
            { name: "Tấm Pin 2 Mặt Kính (Bifacial)", icon: "fa-layer-group", color: "amber" },
            { name: "Phụ Kiện Tấm Pin", icon: "fa-border-all", color: "amber" }
        ]
    },
    {
        name: "Biến Tần - Inverter",
        icon: "fa-bolt",
        color: "blue",
        children: [
            { name: "Inverter Hybrid", icon: "fa-plug-circle-bolt", color: "blue" },
            { name: "Inverter Hòa Lưới", icon: "fa-network-wired", color: "blue" },
            { name: "Inverter Độc Lập (Off-Grid)", icon: "fa-house-signal", color: "blue" },
            { name: "Inverter Áp Cao (HV)", icon: "fa-gauge-high", color: "blue" },
            { name: "Biến Tần Bơm Năng Lượng", icon: "fa-water", color: "blue" },
            { name: "Biến Tần Khác & VFD", icon: "fa-microchip", color: "blue" }
        ]
    },
    {
        name: "Pin Lưu Trữ & Cell Pin",
        icon: "fa-car-battery",
        color: "emerald",
        children: [
            { name: "Pin Lưu Trữ Lithium (LiFePO4)", icon: "fa-battery-full", color: "emerald" },
            { name: "Pin Lưu Trữ Áp Cao (HV)", icon: "fa-tower-cell", color: "emerald" },
            { name: "Cell Pin & Phụ Kiện", icon: "fa-cubes", color: "emerald" },
            { name: "Mạch BMS & Cân Bằng", icon: "fa-shield-halved", color: "emerald" }
        ]
    },
    {
        name: "Hệ Thống Bơm Năng Lượng",
        icon: "fa-water",
        color: "cyan",
        children: [
            { name: "Bơm Năng Lượng DC", icon: "fa-faucet-drip", color: "cyan" },
            { name: "Bơm Hỏa Tiễn Năng Lượng", icon: "fa-arrows-down-to-line", color: "cyan" },
            { name: "Động Cơ & Thiết Bị Bơm", icon: "fa-gears", color: "cyan" }
        ]
    },
    {
        name: "Tủ Điện & Đóng Cắt",
        icon: "fa-boxes-stacked",
        color: "purple",
        children: [
            { name: "Tủ Điện Đấu Sẵn", icon: "fa-server", color: "purple" },
            { name: "Vỏ Tủ Điện & Hộp Điện", icon: "fa-box", color: "purple" },
            { name: "Aptomat & Cầu Dao (MCB/MCCB)", icon: "fa-toggle-on", color: "purple" },
            { name: "Bộ Chuyển Nguồn ATS", icon: "fa-arrow-right-arrow-left", color: "purple" },
            { name: "Thiết Bị Chống Sét SPD", icon: "fa-cloud-bolt", color: "purple" },
            { name: "Đồng Hồ Đo Meter & CT", icon: "fa-gauge", color: "purple" }
        ]
    },
    {
        name: "Phụ Kiện Lắp Đặt & Dây Cáp",
        icon: "fa-tools",
        color: "indigo",
        children: [
            { name: "Khung Ray & Mini Rail", icon: "fa-grip-lines", color: "indigo" },
            { name: "Kẹp Giữa, Kẹp Biên & Kẹp Thoát Nước", icon: "fa-paperclip", color: "indigo" },
            { name: "Bát Chữ Z & Chân L", icon: "fa-shapes", color: "indigo" },
            { name: "Đầu Nối Jack MC4 & Cọc Pin", icon: "fa-link", color: "indigo" },
            { name: "Cáp Nguồn DC Solar", icon: "fa-cable-car", color: "indigo" },
            { name: "Dây Điện AC & Tiếp Địa", icon: "fa-lines-leaning", color: "indigo" }
        ]
    },
    {
        name: "Vật Tư & Phụ Kiện Khác",
        icon: "fa-box-open",
        color: "slate",
        children: [
            { name: "Linh Kiện & Phụ Kiện Khác", icon: "fa-ellipsis", color: "slate" }
        ]
    }
];

// Hàm xác định danh mục chuẩn từ tên sản phẩm và category cũ
function matchProductToCategory(p) {
    const text = `${p.product_name || ''} ${p.category || ''} ${p.sku || ''} ${p.description || ''}`.toLowerCase();

    // 1. Tấm Pin
    if (text.includes('jinko') || text.includes('rapid') || text.includes('tấm pin') || text.includes('pin mặt trời') || text.includes('615wp') || text.includes('620wp') || text.includes('650wp') || text.includes('580w')) {
        if (text.includes('2 mặt kính') || text.includes('bifacial')) return "Tấm Pin 2 Mặt Kính (Bifacial)";
        return "Tấm Pin N-Type / Mono";
    }

    // 2. Inverter
    if (text.includes('biến tần bơm') || text.includes('solpump') || text.includes('solpum') || text.includes('voltique') || text.includes('pumping') || text.includes('invt')) {
        return "Biến Tần Bơm Năng Lượng";
    }
    if (text.includes('hybrid') || text.includes('lumentree') || text.includes('zeno') || text.includes('se 6k eco') || text.includes('senergy eco')) {
        if (text.includes('áp cao') || text.includes('cao áp')) return "Inverter Áp Cao (HV)";
        return "Inverter Hybrid";
    }
    if (text.includes('hoà lưới') || text.includes('hòa lưới') || text.includes('bám tải') || text.includes('sunways') || text.includes('on-grid') || text.includes('ongrid')) {
        return "Inverter Hòa Lưới";
    }
    if (text.includes('độc lập') || text.includes('off-grid') || text.includes('offgrid') || text.includes('anern')) {
        return "Inverter Độc Lập (Off-Grid)";
    }
    if (text.includes('biến tần') || text.includes('inverter') || text.includes('vfd')) {
        if (text.includes('áp cao') || text.includes('cao áp')) return "Inverter Áp Cao (HV)";
        return "Biến Tần Khác & VFD";
    }

    // 3. Pin lưu trữ & BMS
    if (text.includes('bms') || text.includes('mạch daly') || text.includes('jbd') || text.includes('cân bằng chủ động') || text.includes('xe điện')) {
        return "Mạch BMS & Cân Bằng";
    }
    if (text.includes('cell pin') || text.includes('32140') || text.includes('tấm phít') || text.includes('phít cách điện')) {
        return "Cell Pin & Phụ Kiện";
    }
    if (text.includes('pin lưu trữ') || text.includes('lithium') || text.includes('lifepo4') || text.includes('apess') || text.includes('seplos') || text.includes('jaixi') || text.includes('ebox') || text.includes('gg power') || text.includes('xinpz') || text.includes('lưu trữ')) {
        if (text.includes('áp cao') || text.includes('cao áp') || text.includes('tower-x') || text.includes('hv-tower')) return "Pin Lưu Trữ Áp Cao (HV)";
        return "Pin Lưu Trữ Lithium (LiFePO4)";
    }

    // 4. Bơm
    if (text.includes('hỏa tiễn') || text.includes('everrun') || text.includes('everun')) {
        return "Bơm Hỏa Tiễn Năng Lượng";
    }
    if (text.includes('bơm dc') || (text.includes('bơm') && !text.includes('biến tần'))) {
        if (text.includes('thân bơm') || text.includes('cánh quạt') || text.includes('motor') || text.includes('điều khiển')) return "Động Cơ & Thiết Bị Bơm";
        return "Bơm Năng Lượng DC";
    }

    // 5. Tủ điện & Đóng cắt
    if (text.includes('ats') || text.includes('contracter') || text.includes('contractor')) {
        return "Bộ Chuyển Nguồn ATS";
    }
    if (text.includes('thoát sét') || text.includes('chống sét') || text.includes('spd')) {
        return "Thiết Bị Chống Sét SPD";
    }
    if (text.includes('meter') || text.includes('merter') || text.includes('eastron') || text.includes('easton') || text.includes('ct 100a')) {
        return "Đồng Hồ Đo Meter & CT";
    }
    if (text.includes('mcb') || text.includes('mccb') || text.includes('cb ') || text.includes('cầu dao') || text.includes('quá dòng quá áp')) {
        return "Aptomat & Cầu Dao (MCB/MCCB)";
    }
    if (text.includes('vỏ tủ') || text.includes('15 way') || text.includes('24 way') || text.includes('hộp 6 phân')) {
        return "Vỏ Tủ Điện & Hộp Điện";
    }
    if (text.includes('tủ điện') || text.includes('tụ điện') || text.includes('bộ tủ')) {
        return "Tủ Điện Đấu Sẵn";
    }

    // 6. Phụ kiện lắp đặt & dây cáp
    if (text.includes('mini rail') || text.includes('ray nhôm') || text.includes('nối rail') || text.includes('ốc rail')) {
        return "Khung Ray & Mini Rail";
    }
    if (text.includes('kẹp giữa') || text.includes('kẹp biên') || text.includes('kẹp thoát nước') || text.includes('kẹp dây')) {
        return "Kẹp Giữa, Kẹp Biên & Kẹp Thoát Nước";
    }
    if (text.includes('bát') || text.includes('chữ z') || text.includes('chân l') || text.includes('ốc siết ray')) {
        return "Bát Chữ Z & Chân L";
    }
    if (text.includes('mc4') || text.includes('jack') || text.includes('cọc pin') || text.includes('anderson') || text.includes('cọc bình') || text.includes('đầu cuối chữ i')) {
        return "Đầu Nối Jack MC4 & Cọc Pin";
    }
    if (text.includes('dây dc') || text.includes('cáp dc') || text.includes('cáp leader') || text.includes('cáp 25mm')) {
        return "Cáp Nguồn DC Solar";
    }
    if (text.includes('dây ac') || text.includes('cadivi') || text.includes('tiếp địa') || text.includes('dây te') || text.includes('cáp nguồn') || text.includes('ruột gà') || text.includes('dây điện')) {
        return "Dây Điện AC & Tiếp Địa";
    }

    return "Linh Kiện & Phụ Kiện Khác";
}

// 1. GET /api/categories - Lấy toàn bộ danh mục kèm số lượng sản phẩm
router.get('/', async (req, res) => {
    try {
        const catResult = await pool.query('SELECT * FROM categories ORDER BY sort_order ASC, id ASC');
        const prodResult = await pool.query('SELECT id, category, category_id FROM products');
        
        const categories = catResult.rows;
        const products = prodResult.rows;

        // Tính toán số lượng sản phẩm cho từng danh mục
        const counts = {};
        categories.forEach(c => { counts[c.id] = 0; });

        products.forEach(p => {
            // 1. Khớp chính xác category_id
            let matched = null;
            if (p.category_id) {
                matched = categories.find(c => c.id === parseInt(p.category_id, 10));
            }
            // 2. Khớp chuỗi category
            if (!matched) {
                const catName = (p.category || '').trim().toLowerCase();
                if (catName) {
                    matched = categories.find(c => c.name.trim().toLowerCase() === catName);
                    if (!matched) {
                        matched = categories.find(c => {
                            const clean = c.name.replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();
                            return clean && (clean === catName || catName === clean);
                        });
                    }
                    if (!matched) {
                        matched = categories.find(c => {
                            const clean = c.name.replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();
                            return (clean.length > 3 && catName.includes(clean)) || (c.name.length > 3 && catName.includes(c.name.trim().toLowerCase()));
                        });
                    }
                }
            }
            if (matched) {
                counts[matched.id] = (counts[matched.id] || 0) + 1;
            }
        });

        // Hàm tính tổng sản phẩm đệ quy (gồm cả con)
        const getRecursiveCount = (catId) => {
            let total = counts[catId] || 0;
            const children = categories.filter(c => c.parent_id === catId);
            children.forEach(ch => {
                total += getRecursiveCount(ch.id);
            });
            return total;
        };

        const enriched = categories.map(c => ({
            ...c,
            direct_count: counts[c.id] || 0,
            product_count: getRecursiveCount(c.id)
        }));

        res.json({ success: true, data: enriched, total_products: products.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. POST /api/categories - Tạo mới danh mục
router.post('/', async (req, res) => {
    try {
        const { name, parent_id, sort_order, icon, color, description } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ success: false, error: "Tên danh mục không được để trống!" });

        // Tự động gán sort_order cuối cùng nếu không có
        let order = parseInt(sort_order);
        if (isNaN(order)) {
            const maxRes = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM categories WHERE parent_id IS NOT DISTINCT FROM $1', [parent_id || null]);
            order = maxRes.rows[0].next_order || 1;
        }

        const result = await pool.query(
            `INSERT INTO categories (name, parent_id, sort_order, icon, color, description) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [
                name.trim(), 
                parent_id || null, 
                order, 
                icon || (parent_id ? 'fa-tag' : 'fa-folder'), 
                color || (parent_id ? 'blue' : 'amber'), 
                description || ''
            ]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. PUT /api/categories/:id - Cập nhật danh mục
router.put('/:id', async (req, res) => {
    try {
        const { name, parent_id, sort_order, icon, color, description } = req.body;
        const catId = parseInt(req.params.id);

        const currentRes = await pool.query('SELECT * FROM categories WHERE id = $1', [catId]);
        if (currentRes.rows.length === 0) return res.status(404).json({ success: false, error: "Không tìm thấy danh mục" });

        const curr = currentRes.rows[0];
        const result = await pool.query(
            `UPDATE categories 
             SET name = $1, parent_id = $2, sort_order = $3, icon = $4, color = $5, description = $6 
             WHERE id = $7 RETURNING *`,
            [
                name !== undefined ? name.trim() : curr.name,
                parent_id !== undefined ? (parent_id || null) : curr.parent_id,
                sort_order !== undefined ? parseInt(sort_order) : curr.sort_order,
                icon !== undefined ? icon : curr.icon,
                color !== undefined ? color : curr.color,
                description !== undefined ? description : curr.description,
                catId
            ]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. POST /api/categories/reorder - Cập nhật hàng loạt vị trí kéo thả (Drag & Drop)
router.post('/reorder', async (req, res) => {
    const client = await pool.connect();
    try {
        const { items } = req.body; // Array: [{ id, parent_id, sort_order }, ...]
        if (!Array.isArray(items)) return res.status(400).json({ success: false, error: "Dữ liệu items phải là mảng!" });

        await client.query('BEGIN');
        for (const item of items) {
            await client.query(
                `UPDATE categories SET parent_id = $1, sort_order = $2 WHERE id = $3`,
                [item.parent_id || null, item.sort_order || 0, item.id]
            );
        }
        await client.query('COMMIT');
        res.json({ success: true, message: `Đã cập nhật vị trí cho ${items.length} danh mục!` });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// 5. POST /api/categories/sync-from-products - Tự động tạo cây danh mục chuẩn và phân loại 397 sản phẩm
router.post('/sync-from-products', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Lấy danh mục hiện tại
        const existingCatsRes = await client.query('SELECT * FROM categories');
        const existingCats = existingCatsRes.rows;

        const catMap = {}; // name.toLowerCase() -> id
        existingCats.forEach(c => { catMap[c.name.trim().toLowerCase()] = c.id; });

        // Tạo cây chuẩn nếu chưa có
        let rootOrder = 1;
        for (const root of DEFAULT_TREE_DEFINITION) {
            let rootId = catMap[root.name.toLowerCase()];
            if (!rootId) {
                const insRes = await client.query(
                    `INSERT INTO categories (name, parent_id, sort_order, icon, color) 
                     VALUES ($1, NULL, $2, $3, $4) RETURNING id`,
                    [root.name, rootOrder++, root.icon, root.color]
                );
                rootId = insRes.rows[0].id;
                catMap[root.name.toLowerCase()] = rootId;
            }

            let childOrder = 1;
            for (const child of root.children) {
                let childId = catMap[child.name.toLowerCase()];
                if (!childId) {
                    const chRes = await client.query(
                        `INSERT INTO categories (name, parent_id, sort_order, icon, color) 
                         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                        [child.name, rootId, childOrder++, child.icon, child.color]
                    );
                    childId = chRes.rows[0].id;
                    catMap[child.name.toLowerCase()] = childId;
                } else {
                    // Đảm bảo gắn đúng parent_id
                    await client.query('UPDATE categories SET parent_id = $1 WHERE id = $2 AND parent_id IS NULL', [rootId, childId]);
                }
            }
        }

        // Quét toàn bộ sản phẩm và phân loại thông minh
        const prodsRes = await client.query('SELECT id, sku, product_name, category, description FROM products');
        let updatedCount = 0;

        for (const prod of prodsRes.rows) {
            const matchedCategoryName = matchProductToCategory(prod);
            const targetCatId = catMap[matchedCategoryName.toLowerCase()];
            
            // Cập nhật sản phẩm
            await client.query(
                `UPDATE products SET category = $1, category_id = $2 WHERE id = $3`,
                [matchedCategoryName, targetCatId || null, prod.id]
            );
            updatedCount++;
        }

        await client.query('COMMIT');
        res.json({ 
            success: true, 
            message: `✅ Đã đồng bộ và phân loại thành công ${updatedCount} sản phẩm vào cây danh mục chuẩn!`,
            updated_count: updatedCount
        });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// 6. DELETE /api/categories/:id - Xóa danh mục an toàn
router.delete('/:id', async (req, res) => {
    try {
        const catId = parseInt(req.params.id);
        // Chuyển các mục con thành cấp cha của mục bị xóa (hoặc NULL)
        const parentRes = await pool.query('SELECT parent_id FROM categories WHERE id = $1', [catId]);
        const currentParent = parentRes.rows[0] ? parentRes.rows[0].parent_id : null;

        await pool.query('UPDATE categories SET parent_id = $1 WHERE parent_id = $2', [currentParent, catId]);
        await pool.query('DELETE FROM categories WHERE id = $1', [catId]);

        res.json({ success: true, message: "Đã xóa danh mục thành công!" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;

