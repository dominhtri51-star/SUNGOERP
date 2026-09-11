const pool = require('../config/database');

/**
 * Dịch vụ Quản lý Giá Vốn Nhập Kho FIFO (First In, First Out)
 * & Phân Bổ Chi Phí Mua Hàng Phát Sinh (Phí Ship, Bốc Xếp, Chi Khác)
 */

/**
 * 1. Phân bổ chi phí phát sinh (phí ship, chi khác) vào từng sản phẩm trong đơn mua hàng
 * Nguyên tắc kế toán: Phân bổ theo tỷ trọng giá trị hàng hóa (hoặc số lượng nếu giá trị = 0)
 * 
 * @param {Array} items - Danh sách vật tư [{ product_id, name, unit, qty, price }]
 * @param {number} shippingFee - Phí ship/vận chuyển
 * @param {number} otherFee - Chi phí phát sinh khác
 * @param {string} feeNotes - Ghi chú chi phí
 */
function allotFeesToItems(items, shippingFee = 0, otherFee = 0, feeNotes = '') {
    if (!Array.isArray(items)) items = [];
    const ship = Math.max(0, parseFloat(shippingFee) || 0);
    const other = Math.max(0, parseFloat(otherFee) || 0);
    const totalExtraFee = ship + other;

    let itemsAmount = 0;
    let totalQty = 0;

    items.forEach(it => {
        const q = Math.max(0, parseFloat(it.qty) || 0);
        const p = Math.max(0, parseFloat(it.price) || 0);
        itemsAmount += (q * p);
        totalQty += q;
    });

    const allottedItems = items.map(it => {
        const q = Math.max(0, parseFloat(it.qty) || 0);
        const p = Math.max(0, parseFloat(it.price) || 0);
        const itemSubtotal = q * p;

        let allottedFee = 0;
        if (totalExtraFee > 0) {
            if (itemsAmount > 0) {
                allottedFee = Math.round(totalExtraFee * (itemSubtotal / itemsAmount));
            } else if (totalQty > 0) {
                allottedFee = Math.round(totalExtraFee * (q / totalQty));
            }
        }

        const unitFee = q > 0 ? (allottedFee / q) : 0;
        const unitCost = Math.round((p + unitFee) * 100) / 100;
        const totalCost = Math.round(unitCost * q);

        return {
            ...it,
            qty: q,
            price: p,
            subtotal: itemSubtotal,
            allotted_fee: allottedFee,
            unit_fee: unitFee,
            unit_cost: unitCost,
            total_cost: totalCost
        };
    });

    const totalCostAll = itemsAmount + totalExtraFee;

    return {
        items: allottedItems,
        items_amount: itemsAmount,
        shipping_fee: ship,
        other_fee: other,
        fee_notes: (feeNotes || '').trim(),
        total_cost: totalCostAll
    };
}

/**
 * 2. Ghi nhận các Lô Hàng FIFO (Inventory Batches) khi Đơn Mua Hàng hoàn tất nhập kho
 * 
 * @param {object} clientOrPool - PostgreSQL client hoặc pool
 * @param {object} po - Dữ liệu đơn mua hàng (purchases)
 */
async function recordPurchaseBatches(clientOrPool, po) {
    if (!po || !po.id || !Array.isArray(po.items)) return;
    const db = clientOrPool || pool;

    const poId = parseInt(po.id, 10);
    const poCode = po.po_code || `PO-${poId}`;
    const supplierId = po.supplier_id ? parseInt(po.supplier_id, 10) : null;
    const receiveDate = po.receive_date ? new Date(po.receive_date) : new Date();

    // 1. Xóa các lô cũ của PO này (nếu có cập nhật lại để tránh trùng lặp)
    await db.query("DELETE FROM inventory_batches WHERE po_id = $1", [poId]);

    // 2. Phân bổ chi phí phát sinh nếu chưa có sẵn trong po.items
    const alloted = allotFeesToItems(po.items, po.shipping_fee, po.other_fee, po.fee_notes);

    // 3. Tạo lô hàng FIFO mới cho từng sản phẩm
    for (const it of alloted.items) {
        const prodId = parseInt(it.product_id, 10);
        if (!prodId || isNaN(prodId)) continue;

        const initialQty = parseFloat(it.actual_qty !== undefined ? it.actual_qty : it.qty) || 0;
        if (initialQty <= 0) continue;

        const purchasePrice = parseFloat(it.price) || 0;
        const allottedFee = parseFloat(it.unit_fee || 0);
        const unitCost = parseFloat(it.unit_cost || (purchasePrice + allottedFee));

        await db.query(`
            INSERT INTO inventory_batches (
                product_id, po_id, po_code, supplier_id, initial_qty, remaining_qty,
                purchase_price, allotted_fee, unit_cost, receive_date, created_at
            ) VALUES (
                $1, $2, $3, $4, $5, $5, $6, $7, $8, $9, NOW()
            )
        `, [prodId, poId, poCode, supplierId, initialQty, purchasePrice, allottedFee, unitCost, receiveDate]);

        // 4. Tính toán và cập nhật lại Giá Vốn FIFO trong danh mục sản phẩm
        await recalculateProductFifoCost(db, prodId);
    }
}

/**
 * 3. Trừ tồn kho các Lô Hàng theo đúng thứ tự FIFO (Nhập trước Xuất trước) khi Bán Hàng
 * 
 * @param {object} clientOrPool - PostgreSQL client hoặc pool
 * @param {number} productId - ID sản phẩm
 * @param {number} quantitySold - Số lượng bán cần trừ
 */
async function consumeInventoryFifo(clientOrPool, productId, quantitySold) {
    const db = clientOrPool || pool;
    const prodId = parseInt(productId, 10);
    let qtyToDeduct = Math.max(0, parseFloat(quantitySold) || 0);
    if (!prodId || qtyToDeduct <= 0) return;

    // Lấy danh sách các lô hàng còn tồn theo thứ tự nhập trước xuất trước (FIFO)
    const batchesRes = await db.query(`
        SELECT id, remaining_qty, unit_cost, receive_date 
        FROM inventory_batches 
        WHERE product_id = $1 AND remaining_qty > 0 
        ORDER BY receive_date ASC, id ASC
        FOR UPDATE
    `, [prodId]);

    for (const batch of batchesRes.rows) {
        if (qtyToDeduct <= 0) break;
        const currentBatchQty = parseFloat(batch.remaining_qty) || 0;

        if (currentBatchQty <= qtyToDeduct) {
            // Tiêu thụ hết sạch lô này
            await db.query("UPDATE inventory_batches SET remaining_qty = 0 WHERE id = $1", [batch.id]);
            qtyToDeduct -= currentBatchQty;
        } else {
            // Trừ một phần của lô này, lô này vẫn còn hàng tồn
            const newRemaining = currentBatchQty - qtyToDeduct;
            await db.query("UPDATE inventory_batches SET remaining_qty = $1 WHERE id = $2", [newRemaining, batch.id]);
            qtyToDeduct = 0;
            break;
        }
    }

    // Sau khi trừ lô, cập nhật lại Giá Vốn hiện hành của sản phẩm theo lô cũ nhất còn tồn
    await recalculateProductFifoCost(db, prodId);
}

/**
 * 4. Hoàn lại tồn kho vào Lô Hàng khi Hủy Đơn / Đổi Trả Hàng (Return)
 * 
 * @param {object} clientOrPool - PostgreSQL client hoặc pool
 * @param {number} productId - ID sản phẩm
 * @param {number} quantityReturned - Số lượng hoàn trả
 */
async function restoreInventoryFifo(clientOrPool, productId, quantityReturned) {
    const db = clientOrPool || pool;
    const prodId = parseInt(productId, 10);
    const qtyToRestore = Math.max(0, parseFloat(quantityReturned) || 0);
    if (!prodId || qtyToRestore <= 0) return;

    // Tìm lô hàng gần nhất để hoàn lại số lượng hoặc lô có initial_qty > remaining_qty
    const batchRes = await db.query(`
        SELECT id, initial_qty, remaining_qty 
        FROM inventory_batches 
        WHERE product_id = $1 
        ORDER BY receive_date DESC, id DESC 
        LIMIT 1
    `, [prodId]);

    if (batchRes.rows.length > 0) {
        const batch = batchRes.rows[0];
        await db.query("UPDATE inventory_batches SET remaining_qty = remaining_qty + $1 WHERE id = $2", [qtyToRestore, batch.id]);
    } else {
        // Nếu chưa có lô, tạo lô hoàn trả
        const prodRes = await db.query("SELECT import_price FROM products WHERE id = $1", [prodId]);
        const cost = parseFloat(prodRes.rows[0]?.import_price) || 0;
        await db.query(`
            INSERT INTO inventory_batches (
                product_id, po_id, po_code, supplier_id, initial_qty, remaining_qty,
                purchase_price, allotted_fee, unit_cost, receive_date, created_at
            ) VALUES ($1, NULL, 'HOAN-TRA-BAN-HANG', NULL, $2, $2, $3, 0, $3, NOW(), NOW())
        `, [prodId, qtyToRestore, cost]);
    }

    await recalculateProductFifoCost(db, prodId);
}

/**
 * 5. Tự động tính lại Giá Vốn FIFO trong danh mục sản phẩm (products.import_price)
 * Nguyên tắc FIFO: Giá vốn hiển thị và áp dụng xuất kho là Giá vốn của Lô Hàng Cũ Nhất CÒN TỒN (remaining_qty > 0).
 * Khi lô cũ bán hết sạch -> Tự động chuyển sang Giá vốn của lô tiếp theo!
 * 
 * @param {object} clientOrPool - PostgreSQL client hoặc pool
 * @param {number} productId - ID sản phẩm
 */
async function recalculateProductFifoCost(clientOrPool, productId) {
    const db = clientOrPool || pool;
    const prodId = parseInt(productId, 10);
    if (!prodId) return 0;

    // 1. Tìm lô cũ nhất còn tồn kho
    const activeBatchRes = await db.query(`
        SELECT unit_cost, remaining_qty, po_code, receive_date 
        FROM inventory_batches 
        WHERE product_id = $1 AND remaining_qty > 0 
        ORDER BY receive_date ASC, id ASC 
        LIMIT 1
    `, [prodId]);

    let effectiveCost = 0;

    if (activeBatchRes.rows.length > 0) {
        // Lô cũ nhất còn tồn kho -> Đây chính là giá vốn FIFO hiện hành!
        effectiveCost = parseFloat(activeBatchRes.rows[0].unit_cost) || 0;
    } else {
        // Nếu không còn lô nào có remaining_qty > 0 (tồn kho = 0):
        // Lấy giá vốn của lô nhập gần đây nhất để làm giá tham chiếu
        const latestBatchRes = await db.query(`
            SELECT unit_cost 
            FROM inventory_batches 
            WHERE product_id = $1 
            ORDER BY receive_date DESC, id DESC 
            LIMIT 1
        `, [prodId]);

        if (latestBatchRes.rows.length > 0) {
            effectiveCost = parseFloat(latestBatchRes.rows[0].unit_cost) || 0;
        }
    }

    // 2. Cập nhật vào bảng products nếu giá vốn hợp lệ (> 0)
    if (effectiveCost > 0) {
        await db.query("UPDATE products SET import_price = $1 WHERE id = $2", [effectiveCost, prodId]);
    }

    return effectiveCost;
}

/**
 * 6. Lấy danh sách các Lô Hàng FIFO của một sản phẩm (để đối soát, kiểm toán kho)
 */
async function getProductBatches(clientOrPool, productId) {
    const db = clientOrPool || pool;
    const prodId = parseInt(productId, 10);
    if (!prodId) return [];

    const res = await db.query(`
        SELECT b.*, s.name as supplier_name
        FROM inventory_batches b
        LEFT JOIN suppliers s ON b.supplier_id = s.id
        WHERE b.product_id = $1
        ORDER BY b.receive_date ASC, b.id ASC
    `, [prodId]);

    return res.rows;
}

module.exports = {
    allotFeesToItems,
    recordPurchaseBatches,
    consumeInventoryFifo,
    restoreInventoryFifo,
    recalculateProductFifoCost,
    getProductBatches
};
