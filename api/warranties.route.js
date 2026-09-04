const express = require('express');
const router = express.Router();
const pool = require('../config/database.js');

// Helper function để tính toán thông tin bảo hành (ngày hết hạn, số ngày còn lại, % đã dùng)
function calculateWarrantyMetrics(warranty) {
    const activatedAt = new Date(warranty.activated_at || Date.now());
    const months = parseInt(warranty.warranty_months, 10) || 60;
    
    let expiryDate;
    if (warranty.expiry_date) {
        expiryDate = new Date(warranty.expiry_date);
    } else {
        expiryDate = new Date(activatedAt);
        expiryDate.setMonth(expiryDate.getMonth() + months);
    }

    const now = new Date();
    const isValid = now <= expiryDate;
    const diffTime = expiryDate.getTime() - now.getTime();
    const daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    
    const totalDuration = expiryDate.getTime() - activatedAt.getTime();
    const usedDuration = Math.max(0, now.getTime() - activatedAt.getTime());
    let percentUsed = totalDuration > 0 ? Math.min(100, Math.max(0, Math.round((usedDuration / totalDuration) * 100))) : 100;
    if (!isValid) percentUsed = 100;

    return {
        activated_at: activatedAt,
        expiry_date: expiryDate,
        warranty_months: months,
        is_valid: isValid,
        days_remaining: daysRemaining,
        percent_used: percentUsed,
        status_text: isValid ? 'CÒN HIỆU LỰC' : 'HẾT HẠN BẢO HÀNH'
    };
}

// ==========================================
// 1. PUBLIC API: TRA CỨU MÃ SERIAL & TÌNH TRẠNG
// ==========================================
router.get('/public/check/:serial', async (req, res) => {
    try {
        const rawSerial = (req.params.serial || '').trim();
        if (!rawSerial) {
            return res.status(400).json({ success: false, error: 'Vui lòng cung cấp mã Serial!' });
        }

        // 1.1 Tìm trong bảng warranties (chính xác hoặc không phân biệt hoa thường)
        const wResult = await pool.query(`
            SELECT w.*, 
                   COALESCE(w.custom_product_name, p.product_name, w.sku, 'Thiết Bị Năng Lượng Mặt Trời') AS product_name,
                   p.category, p.image_url, p.doc_datasheet, p.doc_cocq, p.doc_catalog, p.doc_manual,
                   p.retail_price, p.unit
            FROM warranties w 
            LEFT JOIN products p ON (LOWER(w.sku) = LOWER(p.sku) OR w.product_id = p.id)
            WHERE LOWER(TRIM(w.serial_number)) = LOWER(TRIM($1))
            LIMIT 1
        `, [rawSerial]);

        if (wResult.rows.length > 0) {
            const w = wResult.rows[0];
            const metrics = calculateWarrantyMetrics(w);

            // Lấy danh sách lịch sử lỗi / yêu cầu bảo hành
            const issuesResult = await pool.query(`
                SELECT id, request_code, serial_number, customer_name, customer_phone, 
                       detail, issue_type, error_code, images, priority, service_type, 
                       status, technician_notes, created_at, updated_at
                FROM warranty_issues 
                WHERE LOWER(TRIM(serial_number)) = LOWER(TRIM($1))
                ORDER BY created_at DESC
            `, [w.serial_number]);

            return res.json({
                success: true,
                found: true,
                is_activated: true,
                data: {
                    ...w,
                    ...metrics,
                    issues: issuesResult.rows
                }
            });
        }

        // 1.2 Nếu chưa kích hoạt, kiểm tra xem Serial có trong Đơn Hàng / Kho không
        const orderItemResult = await pool.query(`
            SELECT oi.serial_number, p.sku, p.product_name, p.category, p.image_url,
                   p.doc_datasheet, p.doc_cocq, p.doc_catalog, p.doc_manual,
                   o.customer_name, o.created_at AS order_date
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            LEFT JOIN orders o ON oi.order_id = o.id
            WHERE LOWER(TRIM(oi.serial_number)) = LOWER(TRIM($1))
            LIMIT 1
        `, [rawSerial]);

        if (orderItemResult.rows.length > 0) {
            const item = orderItemResult.rows[0];
            return res.json({
                success: true,
                found: true,
                is_activated: false,
                message: 'Thiết bị chính hãng SUNGO hợp lệ! Thiết bị chưa kích hoạt bảo hành điện tử.',
                product: item
            });
        }

        // 1.3 Không tìm thấy
        return res.json({
            success: true,
            found: false,
            message: 'Không tìm thấy thông tin trên hệ thống cho mã Serial này.'
        });

    } catch (err) {
        console.error('Lỗi kiểm tra bảo hành:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 2. PUBLIC API: TRA CỨU THEO SỐ ĐIỆN THOẠI
// ==========================================
router.get('/public/by-phone/:phone', async (req, res) => {
    try {
        const rawPhone = (req.params.phone || '').trim().replace(/[\s\.\-]/g, '');
        if (!rawPhone || rawPhone.length < 8) {
            return res.status(400).json({ success: false, error: 'Vui lòng nhập số điện thoại hợp lệ (tối thiểu 8 số)!' });
        }

        const result = await pool.query(`
            SELECT w.*, 
                   COALESCE(w.custom_product_name, p.product_name, w.sku, 'Thiết Bị Năng Lượng Mặt Trời') AS product_name,
                   p.category, p.image_url,
                   (SELECT COUNT(*) FROM warranty_issues i WHERE LOWER(TRIM(i.serial_number)) = LOWER(TRIM(w.serial_number))) AS issue_count
            FROM warranties w 
            LEFT JOIN products p ON (LOWER(w.sku) = LOWER(p.sku) OR w.product_id = p.id)
            WHERE REPLACE(REPLACE(REPLACE(COALESCE(w.customer_phone, ''), ' ', ''), '.', ''), '-', '') LIKE '%' || $1 || '%'
            ORDER BY w.activated_at DESC
        `, [rawPhone]);

        const list = result.rows.map(w => ({
            ...w,
            ...calculateWarrantyMetrics(w)
        }));

        res.json({
            success: true,
            count: list.length,
            data: list
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 3. PUBLIC API: KÍCH HOẠT BẢO HÀNH ĐIỆN TỬ
// ==========================================
router.post('/public/activate', async (req, res) => {
    try {
        const {
            serial_number,
            product_name,
            sku,
            product_id,
            customer_name,
            customer_phone,
            customer_address,
            customer_email,
            purchase_date,
            installation_date,
            proof_image,
            notes
        } = req.body;

        const cleanSerial = (serial_number || '').trim().toUpperCase();
        const cleanName = (customer_name || '').trim();
        const cleanPhone = (customer_phone || '').trim();
        const cleanProductName = (product_name || '').trim();

        if (!cleanSerial) return res.status(400).json({ success: false, error: 'Vui lòng nhập mã Serial thiết bị!' });
        if (!cleanName) return res.status(400).json({ success: false, error: 'Vui lòng nhập họ và tên khách hàng!' });
        if (!cleanPhone) return res.status(400).json({ success: false, error: 'Vui lòng nhập số điện thoại khách hàng!' });

        // Kiểm tra xem Serial đã được kích hoạt chưa
        const checkExisting = await pool.query(
            'SELECT serial_number, activated_at, customer_name FROM warranties WHERE LOWER(TRIM(serial_number)) = LOWER(TRIM($1))',
            [cleanSerial]
        );

        if (checkExisting.rows.length > 0) {
            const existed = checkExisting.rows[0];
            const actDate = new Date(existed.activated_at).toLocaleDateString('vi-VN');
            return res.status(400).json({
                success: false,
                error: `Mã Serial ${cleanSerial} đã được kích hoạt bảo hành vào ngày ${actDate} (Chủ sở hữu: ${existed.customer_name}).`
            });
        }

        // Xác định số tháng bảo hành dựa theo sản phẩm hoặc tên thiết bị
        let warrantyMonths = 60; // 5 năm mặc định
        let finalSku = sku || '';
        let finalProductId = product_id || null;

        if (finalSku || finalProductId || cleanProductName) {
            const pQuery = finalProductId 
                ? await pool.query('SELECT id, sku, product_name, category FROM products WHERE id = $1', [finalProductId])
                : finalSku 
                    ? await pool.query('SELECT id, sku, product_name, category FROM products WHERE LOWER(sku) = LOWER($1)', [finalSku])
                    : await pool.query('SELECT id, sku, product_name, category FROM products WHERE LOWER(product_name) = LOWER($1) OR LOWER(product_name) LIKE $2 LIMIT 1', [cleanProductName, '%' + cleanProductName.toLowerCase() + '%']);
            
            if (pQuery.rows.length > 0) {
                const p = pQuery.rows[0];
                if (!finalSku) finalSku = p.sku;
                if (!finalProductId) finalProductId = p.id;
                const cat = (p.category || '').toLowerCase();
                const name = (p.product_name || '').toLowerCase();
                if (cat.includes('pin') || name.includes('pin') || cat.includes('panel')) {
                    warrantyMonths = 120; // 10-12 năm cho pin
                } else if (cat.includes('bơm') || name.includes('bơm') || name.includes('pump')) {
                    warrantyMonths = 36; // 3 năm cho bơm
                }
            } else if (cleanProductName) {
                const lowerName = cleanProductName.toLowerCase();
                if (lowerName.includes('pin') || lowerName.includes('panel')) {
                    warrantyMonths = 120;
                } else if (lowerName.includes('bơm') || lowerName.includes('pump')) {
                    warrantyMonths = 36;
                }
            }
        }

        // Tính ngày hết hạn
        const now = new Date();
        const expiryDate = new Date(now);
        expiryDate.setMonth(expiryDate.getMonth() + warrantyMonths);

        const insertRes = await pool.query(`
            INSERT INTO warranties (
                serial_number, sku, product_id, custom_product_name, customer_name, customer_phone, customer_address, customer_email,
                purchase_date, installation_date, proof_image, notes, warranty_months,
                activated_at, expiry_date, status
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10, $11, $12, $13,
                CURRENT_TIMESTAMP, $14, 'ACTIVE'
            ) RETURNING *
        `, [
            cleanSerial,
            finalSku,
            finalProductId,
            cleanProductName || null,
            cleanName,
            cleanPhone,
            customer_address || '',
            customer_email || '',
            purchase_date ? new Date(purchase_date) : now,
            installation_date ? new Date(installation_date) : now,
            proof_image || '',
            notes || 'Kích hoạt trực tuyến qua Cổng Bảo Hành',
            warrantyMonths,
            expiryDate
        ]);

        const newWarranty = insertRes.rows[0];

        // Lấy lại kèm tên sản phẩm
        const detailRes = await pool.query(`
            SELECT w.*, COALESCE(w.custom_product_name, p.product_name, w.sku, 'Thiết Bị Năng Lượng Mặt Trời') AS product_name, p.category, p.image_url
            FROM warranties w
            LEFT JOIN products p ON (w.sku = p.sku OR w.product_id = p.id)
            WHERE w.serial_number = $1
        `, [cleanSerial]);

        const fullWarranty = detailRes.rows[0] || newWarranty;

        res.json({
            success: true,
            message: '🎉 Kích hoạt bảo hành điện tử thành công!',
            warranty: {
                ...fullWarranty,
                ...calculateWarrantyMetrics(fullWarranty)
            }
        });

    } catch (err) {
        console.error('Lỗi kích hoạt bảo hành:', err);
        if (err.code === '23505') {
            return res.status(400).json({ success: false, error: 'Mã Serial này đã tồn tại trên hệ thống!' });
        }
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 4. PUBLIC API: TẠO YÊU CẦU BẢO HÀNH / BÁO SỰ CỐ
// ==========================================
router.post('/public/claim', async (req, res) => {
    try {
        const {
            serial_number,
            customer_name,
            customer_phone,
            customer_address,
            detail,
            error_code,
            issue_type,
            priority,
            service_type,
            images
        } = req.body;

        const cleanSerial = (serial_number || '').trim().toUpperCase();
        const cleanName = (customer_name || '').trim();
        const cleanPhone = (customer_phone || '').trim();
        const cleanDetail = (detail || '').trim();

        if (!cleanSerial) return res.status(400).json({ success: false, error: 'Vui lòng nhập mã Serial thiết bị!' });
        if (!cleanName) return res.status(400).json({ success: false, error: 'Vui lòng nhập họ và tên người liên hệ!' });
        if (!cleanPhone) return res.status(400).json({ success: false, error: 'Vui lòng nhập số điện thoại liên hệ!' });
        if (!cleanDetail) return res.status(400).json({ success: false, error: 'Vui lòng mô tả chi tiết sự cố gặp phải!' });

        // Tạo mã Ticket Request Code duy nhất
        const randomNum = Math.floor(100000 + Math.random() * 900000);
        const currentYear = new Date().getFullYear();
        const requestCode = `BH-${currentYear}-${randomNum}`;

        const imageJson = Array.isArray(images) ? JSON.stringify(images) : JSON.stringify(images ? [images] : []);

        const result = await pool.query(`
            INSERT INTO warranty_issues (
                serial_number, request_code, customer_name, customer_phone, customer_address,
                detail, error_code, issue_type, priority, service_type, images,
                status, technician_notes, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10, $11::jsonb,
                'Đang tiếp nhận', 'Hệ thống đã ghi nhận yêu cầu bảo hành từ khách hàng',
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            ) RETURNING *
        `, [
            cleanSerial,
            requestCode,
            cleanName,
            cleanPhone,
            customer_address || '',
            cleanDetail,
            error_code || '',
            issue_type || 'Sự cố thiết bị',
            priority || 'BINH_THUONG',
            service_type || 'GUI_TRUNG_TAM',
            imageJson
        ]);

        res.json({
            success: true,
            request_code: requestCode,
            issue: result.rows[0],
            message: '✅ Gửi yêu cầu bảo hành thành công! Kỹ thuật viên SUNGO sẽ liên hệ sớm nhất.'
        });

    } catch (err) {
        console.error('Lỗi tạo yêu cầu bảo hành:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 5. PUBLIC API: TRA CỨU TIẾN ĐỘ TICKET YÊU CẦU
// ==========================================
router.get('/public/claim/:code', async (req, res) => {
    try {
        const code = (req.params.code || '').trim();
        if (!code) return res.status(400).json({ success: false, error: 'Vui lòng cung cấp mã yêu cầu!' });

        const result = await pool.query(`
            SELECT i.*, 
                   w.customer_name AS original_owner, w.activated_at, w.warranty_months,
                   p.product_name, p.sku, p.category, p.image_url
            FROM warranty_issues i
            LEFT JOIN warranties w ON LOWER(TRIM(i.serial_number)) = LOWER(TRIM(w.serial_number))
            LEFT JOIN products p ON (w.sku = p.sku OR w.product_id = p.id)
            WHERE LOWER(TRIM(i.request_code)) = LOWER(TRIM($1)) OR i.id::text = $1
            LIMIT 1
        `, [code]);

        if (result.rows.length === 0) {
            return res.json({ success: true, found: false, message: 'Không tìm thấy phiếu yêu cầu bảo hành với mã này.' });
        }

        res.json({
            success: true,
            found: true,
            data: result.rows[0]
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 6. ADMIN API: TẤT CẢ PHIẾU YÊU CẦU BẢO HÀNH (CLAIMS / TICKETS)
// ==========================================
router.get('/claims/all', async (req, res) => {
    try {
        const { status, priority, search } = req.query;
        let conditions = [];
        let params = [];

        if (status && status !== 'all') {
            params.push(status);
            conditions.push(`i.status = $${params.length}`);
        }

        if (priority && priority !== 'all') {
            params.push(priority);
            conditions.push(`i.priority = $${params.length}`);
        }

        if (search) {
            params.push(`%${search.trim().toLowerCase()}%`);
            conditions.push(`(
                LOWER(i.request_code) LIKE $${params.length} OR 
                LOWER(i.serial_number) LIKE $${params.length} OR 
                LOWER(COALESCE(i.customer_name, '')) LIKE $${params.length} OR 
                LOWER(COALESCE(i.customer_phone, '')) LIKE $${params.length}
            )`);
        }

        const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const result = await pool.query(`
            SELECT i.*, 
                   COALESCE(p.product_name, 'Thiết Bị Năng Lượng') AS product_name,
                   p.sku, p.image_url,
                   w.activated_at, w.warranty_months
            FROM warranty_issues i
            LEFT JOIN warranties w ON LOWER(TRIM(i.serial_number)) = LOWER(TRIM(w.serial_number))
            LEFT JOIN products p ON (w.sku = p.sku OR w.product_id = p.id)
            ${whereSql}
            ORDER BY i.created_at DESC
        `, params);

        res.json({ success: true, count: result.rows.length, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 7. ADMIN API: CẬP NHẬT TRẠNG THÁI & PHẢN HỒI PHIẾU YÊU CẦU
// ==========================================
router.put('/claims/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, technician_notes, priority, service_type, detail } = req.body;

        const updateRes = await pool.query(`
            UPDATE warranty_issues 
            SET status = COALESCE($1, status),
                technician_notes = COALESCE($2, technician_notes),
                priority = COALESCE($3, priority),
                service_type = COALESCE($4, service_type),
                detail = COALESCE($5, detail),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $6
            RETURNING *
        `, [status, technician_notes, priority, service_type, detail, id]);

        if (updateRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy phiếu yêu cầu!' });
        }

        res.json({ success: true, message: 'Cập nhật phiếu yêu cầu thành công!', data: updateRes.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 8. ADMIN API: LẤY DANH SÁCH TOÀN BỘ BẢO HÀNH
// ==========================================
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT w.*, 
                   COALESCE(w.custom_product_name, p.product_name, w.sku, 'Thiết Bị Năng Lượng Mặt Trời') AS product_name,
                   p.category, p.image_url,
                   COALESCE(
                       (SELECT json_agg(
                           json_build_object(
                               'id', i.id, 
                               'request_code', i.request_code,
                               'detail', i.detail, 
                               'status', i.status,
                               'technician_notes', i.technician_notes,
                               'created_at', i.created_at
                           ) ORDER BY i.created_at ASC
                       ) 
                       FROM warranty_issues i 
                       WHERE LOWER(TRIM(i.serial_number)) = LOWER(TRIM(w.serial_number))), 
                       '[]'::json
                   ) AS issues
            FROM warranties w 
            LEFT JOIN products p ON (w.sku = p.sku OR w.product_id = p.id)
            ORDER BY w.activated_at DESC
        `);

        const formatted = result.rows.map(w => ({
            ...w,
            ...calculateWarrantyMetrics(w)
        }));

        res.json({ success: true, data: formatted });
    } catch (err) { 
        res.status(500).json({ success: false, error: err.message }); 
    }
});

// ==========================================
// 9. ADMIN API: TÌM KIẾM 1 THIẾT BỊ THEO SERIAL
// ==========================================
router.get('/:serial', async (req, res) => {
    try {
        const result = await pool.query(`
             SELECT w.*, 
                    COALESCE(w.custom_product_name, p.product_name, w.sku, 'Thiết Bị Năng Lượng Mặt Trời') AS product_name,
                    p.category, p.image_url,
                    COALESCE(
                        (SELECT json_agg(
                            json_build_object(
                                'id', i.id, 
                                'request_code', i.request_code,
                                'detail', i.detail, 
                                'status', i.status,
                                'technician_notes', i.technician_notes,
                                'created_at', i.created_at
                            ) ORDER BY i.created_at ASC
                        ) 
                        FROM warranty_issues i 
                        WHERE LOWER(TRIM(i.serial_number)) = LOWER(TRIM(w.serial_number))), 
                        '[]'::json
                    ) AS issues
             FROM warranties w 
             LEFT JOIN products p ON (w.sku = p.sku OR w.product_id = p.id)
             WHERE LOWER(TRIM(w.serial_number)) = LOWER(TRIM($1))
            `,
            [req.params.serial]
        );
        if (result.rows.length === 0) {
            return res.json({ success: true, found: false });
        }
        const w = result.rows[0];
        res.json({ success: true, found: true, data: { ...w, ...calculateWarrantyMetrics(w) } });
    } catch (err) { 
        res.status(500).json({ success: false, error: err.message }); 
    }
});

// ==========================================
// 10. ADMIN API: THÊM CHI TIẾT LỖI MỚI (NỘI BỘ)
// ==========================================
router.post('/:serial/issues', async (req, res) => {
    try {
        const { detail, status, technician_notes } = req.body;
        const serial = req.params.serial;
        const randomNum = Math.floor(100000 + Math.random() * 900000);
        const requestCode = `BH-${new Date().getFullYear()}-${randomNum}`;
        
        await pool.query(
            `INSERT INTO warranty_issues (serial_number, request_code, detail, status, technician_notes, created_at, updated_at) 
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [serial, requestCode, detail, status || 'Đang tiếp nhận', technician_notes || '']
        );
        res.json({ success: true, request_code: requestCode });
    } catch (err) { 
        res.status(500).json({ success: false, error: err.message }); 
    }
});

// ==========================================
// 11. ADMIN API: CẬP NHẬT THÔNG TIN LỖI ĐÃ CÓ
// ==========================================
router.put('/issues/:id', async (req, res) => {
    try {
        const { detail, status, technician_notes } = req.body;
        const id = req.params.id;
        
        await pool.query(
            `UPDATE warranty_issues 
             SET detail = COALESCE($1, detail), 
                 status = COALESCE($2, status),
                 technician_notes = COALESCE($3, technician_notes),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $4`,
            [detail, status, technician_notes, id]
        );
        res.json({ success: true });
    } catch (err) { 
        res.status(500).json({ success: false, error: err.message }); 
    }
});

// ==========================================
// 12. ADMIN API: KÍCH HOẠT BẢO HÀNH (NỘI BỘ ERP)
// ==========================================
router.post('/', async (req, res) => {
    try {
        const { serial_number, sku, customer_name, customer_phone, customer_address, warranty_months } = req.body;
        const months = parseInt(warranty_months, 10) || 60;
        
        const result = await pool.query(
            `INSERT INTO warranties (
                serial_number, sku, customer_name, customer_phone, customer_address, 
                warranty_months, activated_at, expiry_date, status
             ) VALUES (
                $1, $2, $3, $4, $5, 
                $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + ($6 || ' months')::interval, 'ACTIVE'
             ) RETURNING *`,
            [serial_number.trim().toUpperCase(), sku, customer_name || 'Khách lẻ', customer_phone || '', customer_address || '', months]
        );
        res.json({ success: true, warranty: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ success: false, error: 'Mã Serial này đã được kích hoạt!' });
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;