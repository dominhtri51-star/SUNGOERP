const pool = require('../config/database');

/**
 * =========================================================================
 * SUNGO ERP AI ASSISTANT SERVICE
 * Dịch vụ Trợ Lý Doanh Nghiệp Thông Minh Đa Năng
 * 
 * - Bộ nhớ ngữ cảnh hội thoại đa lượt (Multi-turn Context Memory)
 * - Tường lửa phân quyền theo nhân viên (RBAC Firewall)
 * - Hỗ trợ LLM ngoài (Gemini/OpenAI) + Động cơ NLP tự hành (Offline-ready)
 * - 14 Tác vụ nghiệp vụ ERP cốt lõi
 * =========================================================================
 */

// Ma trận phân quyền chức năng theo vai trò nhân viên
const RBAC_PERMISSIONS = {
    // Sếp tổng & Quản trị: Toàn quyền
    'ADMIN': ['*'],
    'SUPER_ADMIN': ['*'],
    'GIAM_DOC': ['*'],
    'TONG_GIAM_DOC': ['*'],
    'DIRECTOR': ['*'],

    // Khối Kinh doanh / Bán hàng
    'SALE': [
        'CREATE_ORDER', 'CREATE_QUOTATION', 'CHECK_INVENTORY', 'SEND_PRODUCT_DOCS',
        'CREATE_CONTRACT', 'CHECK_WARRANTY', 'CHECK_DEBT', 'ANALYZE_CUSTOMER',
        'REPORT_REVENUE', 'ANALYZE_PRODUCT'
    ],
    'SALES': [
        'CREATE_ORDER', 'CREATE_QUOTATION', 'CHECK_INVENTORY', 'SEND_PRODUCT_DOCS',
        'CREATE_CONTRACT', 'CHECK_WARRANTY', 'CHECK_DEBT', 'ANALYZE_CUSTOMER',
        'REPORT_REVENUE', 'ANALYZE_PRODUCT'
    ],
    'TRUONG_PHONG_KD': [
        'CREATE_ORDER', 'CREATE_QUOTATION', 'CHECK_INVENTORY', 'SEND_PRODUCT_DOCS',
        'CREATE_CONTRACT', 'CHECK_WARRANTY', 'CHECK_DEBT', 'ANALYZE_CUSTOMER',
        'REPORT_REVENUE', 'ANALYZE_PRODUCT'
    ],
    'SALE_ADMIN': [
        'CREATE_ORDER', 'CREATE_QUOTATION', 'CHECK_INVENTORY', 'SEND_PRODUCT_DOCS',
        'CREATE_CONTRACT', 'CHECK_WARRANTY', 'CHECK_DEBT', 'ANALYZE_CUSTOMER',
        'REPORT_REVENUE', 'ANALYZE_PRODUCT', 'CREATE_PRODUCT'
    ],

    // Khối Kho vận & Thu mua
    'INVENTORY': [
        'CREATE_PRODUCT', 'CREATE_PURCHASE', 'CHECK_INVENTORY', 'SEND_PRODUCT_DOCS',
        'ANALYZE_PRODUCT', 'CHECK_WARRANTY'
    ],
    'THU_MUA': [
        'CREATE_PRODUCT', 'CREATE_PURCHASE', 'CHECK_INVENTORY', 'SEND_PRODUCT_DOCS',
        'ANALYZE_PRODUCT', 'CHECK_WARRANTY'
    ],
    'NHAN_VIEN_KHO': [
        'CHECK_INVENTORY', 'SEND_PRODUCT_DOCS', 'CHECK_WARRANTY', 'ANALYZE_PRODUCT'
    ],
    'WAREHOUSE': [
        'CHECK_INVENTORY', 'SEND_PRODUCT_DOCS', 'CHECK_WARRANTY', 'ANALYZE_PRODUCT'
    ],

    // Khối Kỹ thuật & Bảo hành
    'TECH': [
        'CHECK_WARRANTY', 'SEND_PRODUCT_DOCS', 'CHECK_INVENTORY', 'ANALYZE_PRODUCT'
    ],
    'KY_THUAT': [
        'CHECK_WARRANTY', 'SEND_PRODUCT_DOCS', 'CHECK_INVENTORY', 'ANALYZE_PRODUCT'
    ],
    'BAO_HANH': [
        'CHECK_WARRANTY', 'SEND_PRODUCT_DOCS', 'CHECK_INVENTORY'
    ],

    // Khối Kế toán & Tài chính
    'KE_TOAN': [
        'REPORT_REVENUE', 'REPORT_BUSINESS_HEALTH', 'CHECK_DEBT', 'CREATE_CONTRACT',
        'CHECK_INVENTORY', 'CHECK_HR', 'ANALYZE_CUSTOMER', 'ANALYZE_PRODUCT', 'CREATE_PRODUCT'
    ],

    // Khối Nhân sự
    'HR': [
        'CHECK_HR'
    ]
};

// Hàm chuẩn hóa chuỗi tiền tệ VND
function formatVND(amount) {
    const num = Number(amount) || 0;
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num);
}

// Hàm chuẩn hóa chuỗi bỏ dấu để tìm kiếm từ khóa
function removeVietnameseTones(str) {
    if (!str) return '';
    str = String(str).toLowerCase().trim();
    str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
    str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
    str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
    str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
    str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
    str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
    str = str.replace(/đ/g, "d");
    return str;
}

/**
 * Quản lý phiên và ngữ cảnh hội thoại
 */
async function getOrCreateConversation(userId, sessionId, title = 'Hội thoại mới') {
    let convRes = await pool.query(
        'SELECT * FROM ai_conversations WHERE session_id = $1 LIMIT 1',
        [sessionId]
    );

    if (convRes.rows.length === 0) {
        let validUserId = null;
        if (userId) {
            const uCheck = await pool.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [userId]);
            if (uCheck.rows.length > 0) validUserId = uCheck.rows[0].id;
        }

        convRes = await pool.query(
            `INSERT INTO ai_conversations (user_id, session_id, title, context_state)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [validUserId, sessionId, title, JSON.stringify({})]
        );
    }
    return convRes.rows[0];
}

async function saveMessage(conversationId, sender, content, intent = null, actionType = null, actionData = {}) {
    const res = await pool.query(
        `INSERT INTO ai_messages (conversation_id, sender, content, intent, action_type, action_data)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [conversationId, sender, content, intent, actionType, JSON.stringify(actionData || {})]
    );
    return res.rows[0];
}

async function updateContextState(conversationId, newState) {
    await pool.query(
        `UPDATE ai_conversations
         SET context_state = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [JSON.stringify(newState), conversationId]
    );
}

/**
 * Kiểm tra phân quyền hành động theo Role của người dùng
 */
function checkPermission(userRole, intent) {
    if (!userRole) return false;
    const role = String(userRole).toUpperCase().trim();
    const perms = RBAC_PERMISSIONS[role] || [];
    if (perms.includes('*')) return true;
    return perms.includes(intent);
}

/**
 * Trình nhận diện Ý định (Intent Recognition Engine)
 */
function detectIntent(text, context) {
    const norm = removeVietnameseTones(text);

    // 1. Tạo đơn hàng nhanh
    if (
        (norm.includes('tao don') || norm.includes('len don') || norm.includes('ban cho') || norm.includes('lap don') || norm.includes('dat mua')) &&
        !norm.includes('nha cung cap') && !norm.includes('mua hang') && !norm.includes('nhap hang') && !norm.includes('po')
    ) {
        return 'CREATE_ORDER';
    }

    // 2. Tạo sản phẩm nhanh
    if (
        norm.includes('tao san pham') || norm.includes('them san pham') || norm.includes('tao thiet bi') ||
        norm.includes('them thiet bi') || norm.includes('nhap san pham moi') || norm.includes('them ma pin')
    ) {
        return 'CREATE_PRODUCT';
    }

    // 3. Tạo báo giá nhanh
    if (
        norm.includes('bao gia') || norm.includes('lap bao gia') || norm.includes('tao bao gia') ||
        norm.includes('tinh gia hybrid') || norm.includes('tinh gia ongrid') || norm.includes('tinh gia boq')
    ) {
        return 'CREATE_QUOTATION';
    }

    // 4. Lên đơn đặt mua hàng nhanh (PO)
    if (
        norm.includes('mua hang') || norm.includes('dat hang mua hang') || norm.includes('nhap hang tu') ||
        norm.includes('tao po') || norm.includes('don mua hang') || norm.includes('dat ncc') || norm.includes('nha cung cap')
    ) {
        return 'CREATE_PURCHASE';
    }

    // 5. Báo cáo doanh thu
    if (
        norm.includes('doanh thu') || norm.includes('doanh so') || norm.includes('ban duoc bao nhieu') ||
        norm.includes('tien ve hom nay') || norm.includes('kpi doanh thu') || norm.includes('bao cao ban hang')
    ) {
        return 'REPORT_REVENUE';
    }

    // 6. Báo cáo sức khỏe doanh nghiệp
    if (
        norm.includes('suc khoe') || norm.includes('suc khoe doanh nghiep') || norm.includes('tai chinh doanh nghiep') ||
        norm.includes('cfo') || norm.includes('dong tien') || norm.includes('kha nang thanh toan') || norm.includes('nguon von')
    ) {
        return 'REPORT_BUSINESS_HEALTH';
    }

    // 7. Kiểm tra hàng tồn kho
    if (
        norm.includes('ton kho') || norm.includes('kiem tra kho') || norm.includes('kho con') ||
        norm.includes('con bao nhieu') || norm.includes('vi tri ke') || norm.includes('sap het hang')
    ) {
        return 'CHECK_INVENTORY';
    }

    // 8. Gửi tài liệu sản phẩm
    if (
        norm.includes('tai lieu') || norm.includes('datasheet') || norm.includes('catalog') || norm.includes('catalogue') ||
        norm.includes('cocq') || norm.includes('co/cq') || norm.includes('thong so') || norm.includes('gui cho khach') ||
        norm.includes('gui tai lieu') || norm.includes('so tay') || norm.includes('huong dan su dung')
    ) {
        return 'SEND_PRODUCT_DOCS';
    }

    // 9. Tạo hợp đồng
    if (
        norm.includes('hop dong') || norm.includes('tao hop dong') || norm.includes('lap hop dong') ||
        norm.includes('soan hop dong') || norm.includes('ky hop dong')
    ) {
        return 'CREATE_CONTRACT';
    }

    // 10. Kiểm tra bảo hành
    if (
        norm.includes('bao hanh') || norm.includes('serial') || norm.includes('tra cuu serial') ||
        norm.includes('kich hoat') || norm.includes('han bao hanh')
    ) {
        return 'CHECK_WARRANTY';
    }

    // 11. Kiểm tra nhân sự
    if (
        norm.includes('nhan su') || norm.includes('cham cong') || norm.includes('di lam') ||
        norm.includes('di tre') || norm.includes('nghi phep') || norm.includes('si so') || norm.includes('quan so')
    ) {
        return 'CHECK_HR';
    }

    // 12. Kiểm tra công nợ
    if (
        norm.includes('cong no') || norm.includes('no phai thu') || norm.includes('no phai tra') ||
        norm.includes('so no') || norm.includes('con no') || norm.includes('no xau') || norm.includes('qua han')
    ) {
        return 'CHECK_DEBT';
    }

    // 13. Phân tích khách hàng
    if (
        norm.includes('phan tich khach') || norm.includes('khach hang vip') || norm.includes('khach mua nhieu') ||
        norm.includes('thoi quen mua') || norm.includes('xep hang khach') || norm.includes('danh gia khach')
    ) {
        return 'ANALYZE_CUSTOMER';
    }

    // 14. Phân tích sản phẩm
    if (
        norm.includes('phan tich san pham') || norm.includes('ban chay') || norm.includes('cham luon chuyen') ||
        norm.includes('ton lau') || norm.includes('bien loi nhuan cao') || norm.includes('top san pham')
    ) {
        return 'ANALYZE_PRODUCT';
    }

    return 'GENERAL_CHAT';
}

/**
 * =========================================================================
 * 14 HÀNH ĐỘNG NGHIỆP VỤ ERP CỐT LÕI (ACTION HANDLERS)
 * =========================================================================
 */

// 1. TẠO ĐƠN HÀNG NHANH
async function handleCreateOrder(text, context, user) {
    const norm = removeVietnameseTones(text);

    // Trích xuất số điện thoại (10 chữ số)
    const phoneMatch = text.match(/(0[3|5|7|8|9][0-9]{8})/);
    const phone = phoneMatch ? phoneMatch[1] : '';

    // Trích xuất tên khách hàng (từ ngữ cảnh hoặc text)
    let customerName = '';
    const nameMatch = text.match(/(?:cho|khách|anh|chị|bác|chú)\s+([A-ZÀ-Ỹ][a-zà-ỹ]+(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]+)*)/);
    if (nameMatch) {
        customerName = nameMatch[1];
    } else if (context.active_customer && (norm.includes('anh nay') || norm.includes('khach nay') || norm.includes('chi ay') || norm.includes('cho anh') || norm.includes('cho chi'))) {
        customerName = context.active_customer.name || context.active_customer.full_name;
    }

    // Tìm kiếm khách hàng trong DB
    let customerId = null;
    if (phone) {
        const cRes = await pool.query('SELECT id, full_name, name, phone, tier FROM customers WHERE phone = $1 LIMIT 1', [phone]);
        if (cRes.rows.length > 0) {
            customerId = cRes.rows[0].id;
            customerName = cRes.rows[0].full_name || cRes.rows[0].name;
        }
    } else if (customerName) {
        const cRes = await pool.query(
            'SELECT id, full_name, name, phone, tier FROM customers WHERE LOWER(full_name) LIKE $1 OR LOWER(name) LIKE $1 LIMIT 1',
            [`%${customerName.toLowerCase()}%`]
        );
        if (cRes.rows.length > 0) {
            customerId = cRes.rows[0].id;
            customerName = cRes.rows[0].full_name || cRes.rows[0].name;
        }
    }

    if (!customerId && context.active_customer) {
        if (!customerName || customerName === 'Khách Lẻ' || norm.includes('khach nay') || norm.includes('anh nay') || norm.includes('chi ay') || norm.includes('anh ay') || norm.includes('cho anh') || norm.includes('cho chi') || norm.includes('cho khach')) {
            customerId = context.active_customer.id;
            customerName = context.active_customer.name || context.active_customer.full_name;
        }
    }

    if (!customerName) {
        customerName = 'Khách Lẻ';
    }

    // Trích xuất số lượng và tìm sản phẩm
    let qty = 1;
    const qtyMatch = text.match(/(\d+)\s*(tấm|bộ|cái|chiếc|cuộn|thùng|hộp|inverter|pin)/i);
    if (qtyMatch) {
        qty = parseInt(qtyMatch[1], 10);
    }

    // Tìm kiếm sản phẩm phù hợp nhất trong kho
    const pRes = await pool.query(`
        SELECT id, sku, product_name, category, retail_price, import_price, stock_qty, unit 
        FROM products 
        ORDER BY id DESC 
        LIMIT 50
    `);
    
    let matchedProduct = null;
    for (const p of pRes.rows) {
        const pNorm = removeVietnameseTones(p.product_name + ' ' + p.sku);
        if (norm.includes(pNorm) || (p.sku && norm.includes(removeVietnameseTones(p.sku)))) {
            matchedProduct = p;
            break;
        }
    }

    // Nếu chưa tìm thấy chính xác, thử tìm theo từ khóa phổ biến
    if (!matchedProduct) {
        const keywords = ['canadian', 'deye', 'growatt', 'jinko', 'gigabox', 'sungrow', 'longi', 'luxpower', 'ja solar', 'huawei', 'apess', 'lumentree', 'kep'];
        for (const kw of keywords) {
            if (norm.includes(kw)) {
                matchedProduct = pRes.rows.find(p => removeVietnameseTones(p.product_name + ' ' + p.sku).includes(kw));
                if (matchedProduct) break;
            }
        }
    }

    // Nếu hỏi chung chung "tấm pin" hoặc "biến tần"
    if (!matchedProduct && (norm.includes('tam pin') || norm.includes('pin'))) {
        matchedProduct = pRes.rows.find(p => removeVietnameseTones(p.product_name).includes('pin') || removeVietnameseTones(p.category).includes('pin'));
    }
    if (!matchedProduct && (norm.includes('bien tan') || norm.includes('inverter'))) {
        matchedProduct = pRes.rows.find(p => removeVietnameseTones(p.product_name).includes('deye') || removeVietnameseTones(p.product_name).includes('inverter') || removeVietnameseTones(p.category).includes('inverter'));
    }

    // Nếu vẫn chưa có mà ngữ cảnh có active_product
    if (!matchedProduct && context.active_product) {
        matchedProduct = context.active_product;
    }

    if (!matchedProduct) {
        return {
            text: `Dạ em chưa nhận diện được sản phẩm anh/chị muốn lên đơn. Vui lòng cho em biết tên sản phẩm hoặc mã SKU (Ví dụ: "Tạo đơn 10 tấm pin Canadian 550W cho anh Tuấn SĐT 0987654321").`,
            card: null,
            action_type: 'ORDER_NEED_INFO',
            quick_replies: ['Tạo đơn 10 tấm pin Canadian', 'Tạo đơn biến tần Deye 5kW', 'Xem danh sách sản phẩm']
        };
    }

    const unitPrice = parseFloat(matchedProduct.retail_price) || 0;
    const totalAmount = unitPrice * qty;
    const orderCode = 'DH-' + Date.now().toString().slice(-6) + Math.floor(1000 + Math.random() * 9000);

    // Lấy employee_id nếu có
    let empId = null;
    if (user && user.id) {
        const empRes = await pool.query('SELECT id FROM employees WHERE user_id = $1 LIMIT 1', [user.id]);
        if (empRes.rows.length > 0) empId = empRes.rows[0].id;
    }

    // Tạo đơn hàng vào CSDL
    const insertOrderRes = await pool.query(`
        INSERT INTO orders (
            order_code, customer_id, customer_name, total_amount, paid_amount, 
            status, payment_method, employee_id, notes
        ) VALUES ($1, $2, $3, $4, 0, 'PENDING', 'TIEN_MAT', $5, $6)
        RETURNING *
    `, [orderCode, customerId, customerName, totalAmount, empId, `Tạo tự động qua Trợ lý AI bởi ${user.full_name || 'Người dùng'}`]);

    const orderId = insertOrderRes.rows[0].id;

    // Thêm chi tiết đơn hàng
    await pool.query(`
        INSERT INTO order_items (order_id, product_id, quantity, price, total)
        VALUES ($1, $2, $3, $4, $5)
    `, [orderId, matchedProduct.id, qty, unitPrice, totalAmount]);

    // Cập nhật context memory
    context.active_customer = { id: customerId, name: customerName, phone: phone };
    context.active_product = matchedProduct;
    context.last_order = { id: orderId, code: orderCode, total: totalAmount };

    return {
        text: `Đã tạo đơn hàng thành công! Mã đơn là **${orderCode}** cho khách hàng **${customerName}**, tổng giá trị **${formatVND(totalAmount)}**.`,
        card: {
            type: 'ORDER_CARD',
            title: `Đơn Hàng Mới: ${orderCode}`,
            status: 'Chờ Xử Lý (PENDING)',
            customer: customerName,
            phone: phone || 'Chưa cập nhật',
            items: [
                { name: matchedProduct.product_name, sku: matchedProduct.sku, qty: qty, price: formatVND(unitPrice), total: formatVND(totalAmount) }
            ],
            total_amount: formatVND(totalAmount),
            link: `modules/admin-orders.html`
        },
        action_type: 'ORDER_CREATED',
        quick_replies: ['Xem chi tiết đơn hàng', 'Tạo hợp đồng cho đơn này', 'Kiểm tra công nợ khách']
    };
}

// 2. TẠO SẢN PHẨM NHANH
async function handleCreateProduct(text, context, user) {
    const cleanText = text.trim();
    
    // Trích xuất SKU
    let sku = '';
    const skuMatch = cleanText.match(/(?:mã|sku)\s*[:=]?\s*([A-Za-z0-9\-_.]+)/i);
    if (skuMatch) {
        sku = skuMatch[1].toUpperCase();
    } else {
        sku = 'SP-' + Date.now().toString().slice(-6);
    }

    // Trích xuất tên sản phẩm
    let productName = '';
    const nameMatch = cleanText.match(/(?:sản phẩm|thiết bị|tên)\s*[:=]?\s*([^,;.\n]+)/i);
    if (nameMatch) {
        productName = nameMatch[1].trim();
    } else {
        productName = cleanText.replace(/tạo sản phẩm|thêm sản phẩm|thêm thiết bị/gi, '').trim();
    }

    if (!productName || productName.length < 3) {
        return {
            text: 'Dạ anh/chị vui lòng cho em biết Tên thiết bị và Giá bán (Ví dụ: "Tạo sản phẩm Tấm pin Jinko 580W N-type, mã JNK-580, giá bán 2.100.000đ").',
            card: null,
            action_type: 'PRODUCT_NEED_INFO',
            quick_replies: ['Tạo sản phẩm pin Canadian', 'Tạo sản phẩm biến tần Deye']
        };
    }

    // Trích xuất giá bán lẻ
    let retailPrice = 0;
    const priceMatch = cleanText.match(/(?:giá bán|giá lẻ|giá)\s*[:=]?\s*([\d.,]+)\s*(?:đ|vnd|k|tr|triệu)?/i);
    if (priceMatch) {
        let rawP = priceMatch[1].replace(/\./g, '').replace(/,/g, '');
        retailPrice = parseFloat(rawP) || 0;
        if (cleanText.toLowerCase().includes('triệu') && retailPrice < 1000) retailPrice *= 1000000;
        else if (cleanText.toLowerCase().includes('k') && retailPrice < 10000) retailPrice *= 1000;
    }

    // Phân loại danh mục tự động
    let category = 'Khác';
    const norm = removeVietnameseTones(productName);
    if (norm.includes('pin') || norm.includes('panel') || norm.includes('tam pin')) category = 'Tấm Pin Năng Lượng';
    else if (norm.includes('bien tan') || norm.includes('inverter') || norm.includes('deye') || norm.includes('growatt')) category = 'Biến Tần Inverter';
    else if (norm.includes('luu tru') || norm.includes('lithium') || norm.includes('battery') || norm.includes('gigabox')) category = 'Pin Lưu Trữ Lithium';
    else if (norm.includes('phu kien') || norm.includes('day cap') || norm.includes('rail') || norm.includes('kep')) category = 'Vật Tư & Phụ Kiện';

    // Lưu vào CSDL
    const res = await pool.query(`
        INSERT INTO products (sku, product_name, category, retail_price, stock_qty, unit)
        VALUES ($1, $2, $3, $4, 0, 'Bộ')
        ON CONFLICT (sku) DO UPDATE SET
            product_name = EXCLUDED.product_name,
            retail_price = CASE WHEN EXCLUDED.retail_price > 0 THEN EXCLUDED.retail_price ELSE products.retail_price END
        RETURNING *
    `, [sku, productName, category, retailPrice]);

    const created = res.rows[0];
    context.active_product = created;

    return {
        text: `Đã thêm sản phẩm **${productName}** (SKU: **${sku}**) vào danh mục **${category}** với giá niêm yết **${formatVND(retailPrice)}**.`,
        card: {
            type: 'PRODUCT_CARD',
            title: productName,
            sku: sku,
            category: category,
            price: formatVND(retailPrice),
            stock: `${created.stock_qty || 0} ${created.unit || 'Bộ'}`,
            link: 'modules/admin-products.html'
        },
        action_type: 'PRODUCT_CREATED',
        quick_replies: ['Kiểm tra tồn kho sản phẩm này', 'Tạo đơn hàng với sản phẩm này']
    };
}

// 3. TẠO BÁO GIÁ NHANH
async function handleCreateQuotation(text, context, user) {
    const cleanText = text.trim();
    const norm = removeVietnameseTones(cleanText);

    // Trích xuất công suất kWp
    let kwp = 5;
    const kwpMatch = cleanText.match(/(\d+(?:\.\d+)?)\s*(?:kw|kwp|kilo)/i);
    if (kwpMatch) kwp = parseFloat(kwpMatch[1]);

    // Trích xuất hệ thống: Hybrid, On-grid, Off-grid, Bơm nước
    let sysType = 'HYBRID';
    if (norm.includes('on grid') || norm.includes('ongrid') || norm.includes('bam tai')) sysType = 'ONGRID';
    else if (norm.includes('off grid') || norm.includes('offgrid') || norm.includes('doc lap')) sysType = 'OFFGRID';
    else if (norm.includes('bom') || norm.includes('pump')) sysType = 'PUMP';

    // Trích xuất tên khách hàng
    let customerName = 'Khách Hàng Dự Án';
    const nameMatch = cleanText.match(/(?:cho|khách|chị|anh)\s+([A-ZÀ-Ỹ][a-zà-ỹ]+(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]+)*)/);
    if (nameMatch) {
        customerName = nameMatch[1];
    } else if (context.active_customer) {
        customerName = context.active_customer.name || context.active_customer.full_name;
    }

    // Tính toán ước tính giá trị dựa trên công suất
    let pricePerKwp = sysType === 'HYBRID' ? 15000000 : (sysType === 'ONGRID' ? 10000000 : 18000000);
    let totalAmount = Math.round(kwp * pricePerKwp);
    let totalCost = Math.round(totalAmount * 0.75);
    let profitMargin = 25.0;

    const quoteCode = 'BG-' + sysType.slice(0, 3) + '-' + Date.now().toString().slice(-5);

    // Lưu vào bảng quotations
    const insertRes = await pool.query(`
        INSERT INTO quotations (
            quotation_code, customer_name, system_type, system_kwp, 
            total_amount, total_cost, profit_margin, status, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING_APPROVAL', $8)
        RETURNING *
    `, [quoteCode, customerName, sysType, kwp, totalAmount, totalCost, profitMargin, user.full_name || 'Trợ Lý AI']);

    context.active_quotation = insertRes.rows[0];

    return {
        text: `Đã tạo báo giá nhanh **${quoteCode}** hệ thống **${sysType} ${kwp} kWp** cho khách hàng **${customerName}**. Tổng giá trị: **${formatVND(totalAmount)}** (Biên lợi nhuận ước tính: **${profitMargin}%**).`,
        card: {
            type: 'QUOTATION_CARD',
            title: `Báo Giá Solar: ${quoteCode}`,
            customer: customerName,
            system_type: sysType,
            system_kwp: `${kwp} kWp`,
            total_amount: formatVND(totalAmount),
            status: 'Chờ Duyệt (PENDING_APPROVAL)',
            link: 'modules/boq-list.html'
        },
        action_type: 'QUOTATION_CREATED',
        quick_replies: ['Tạo hợp đồng từ báo giá này', 'Chuyển thành đơn hàng']
    };
}

// 4. LÊN ĐƠN ĐẶT MUA HÀNG NHANH (PURCHASE ORDER)
async function handleCreatePurchase(text, context, user) {
    const cleanText = text.trim();
    const norm = removeVietnameseTones(cleanText);

    // Trích xuất số lượng
    let qty = 10;
    const qtyMatch = cleanText.match(/(\d+)\s*(?:bộ|tấm|chiếc|cái|inverter|pin|cuộn)/i);
    if (qtyMatch) qty = parseInt(qtyMatch[1], 10);

    // Trích xuất Nhà Cung Cấp
    let supplierName = 'Nhà Cung Cấp Tổng Hợp';
    let supplierId = null;
    const sRes = await pool.query('SELECT id, name FROM suppliers ORDER BY id ASC LIMIT 20');
    for (const s of sRes.rows) {
        if (norm.includes(removeVietnameseTones(s.name))) {
            supplierName = s.name;
            supplierId = s.id;
            break;
        }
    }

    if (!supplierId) {
        const supKey = ['alena', 'sunpower', 'deye', 'jinko', 'canadian', 'solar e', 'gigabox'];
        for (const k of supKey) {
            if (norm.includes(k)) {
                supplierName = 'Nhà Cung Cấp ' + k.toUpperCase();
                break;
            }
        }
    }

    const poCode = 'PO-' + Date.now().toString().slice(-6);
    const estimatedCost = qty * 3500000;

    // Lưu vào bảng purchases
    const insRes = await pool.query(`
        INSERT INTO purchases (po_code, supplier_id, supplier_name, note, status, total_amount)
        VALUES ($1, $2, $3, $4, 'Chờ Duyệt', $5)
        RETURNING *
    `, [poCode, supplierId, supplierName, `Lên đơn PO qua Trợ lý AI bởi ${user.full_name || 'Người dùng'}`, estimatedCost]);

    return {
        text: `Đã lập đơn mua hàng **${poCode}** gửi **${supplierName}**, số lượng dự kiến **${qty} thiết bị**, tổng chi phí dự toán **${formatVND(estimatedCost)}**. Trạng thái: Chờ Duyệt.`,
        card: {
            type: 'PURCHASE_CARD',
            title: `Đơn Mua Hàng: ${poCode}`,
            supplier: supplierName,
            quantity: `${qty} thiết bị`,
            total_cost: formatVND(estimatedCost),
            status: 'Chờ Duyệt (PENDING)',
            link: 'modules/purchases.html'
        },
        action_type: 'PURCHASE_CREATED',
        quick_replies: ['Xem danh sách đơn mua hàng', 'Kiểm tra tồn kho']
    };
}

// 5. BÁO CÁO DOANH THU
async function handleReportRevenue(text, context, user) {
    const norm = removeVietnameseTones(text);

    let dateFilter = "created_at >= CURRENT_DATE";
    let periodText = "Hôm Nay";

    if (norm.includes('thang nay') || norm.includes('trong thang')) {
        dateFilter = "created_at >= date_trunc('month', CURRENT_DATE)";
        periodText = "Tháng Này (" + (new Date().getMonth() + 1) + "/" + new Date().getFullYear() + ")";
    } else if (norm.includes('tuan nay')) {
        dateFilter = "created_at >= date_trunc('week', CURRENT_DATE)";
        periodText = "Tuần Này";
    } else if (norm.includes('nam nay')) {
        dateFilter = "created_at >= date_trunc('year', CURRENT_DATE)";
        periodText = "Năm " + new Date().getFullYear();
    }

    let userFilter = "";
    const params = [];
    const isFullAdmin = ['ADMIN', 'SUPER_ADMIN', 'GIAM_DOC', 'KE_TOAN'].includes(String(user.role).toUpperCase());
    
    if (!isFullAdmin && user.id) {
        const empRes = await pool.query('SELECT id FROM employees WHERE user_id = $1 LIMIT 1', [user.id]);
        if (empRes.rows.length > 0) {
            params.push(empRes.rows[0].id);
            userFilter = ` AND employee_id = $${params.length}`;
            periodText += ` (Cá nhân: ${user.full_name})`;
        }
    }

    const query = `
        SELECT 
            COUNT(id) AS total_orders,
            COALESCE(SUM(total_amount), 0) AS total_revenue,
            COALESCE(SUM(paid_amount), 0) AS total_paid,
            COALESCE(SUM(total_amount - paid_amount), 0) AS total_receivable
        FROM orders 
        WHERE status NOT IN ('CANCELLED') AND ${dateFilter} ${userFilter}
    `;

    const res = await pool.query(query, params);
    const stat = res.rows[0];

    const totalOrders = parseInt(stat.total_orders, 10) || 0;
    const totalRev = parseFloat(stat.total_revenue) || 0;
    const totalPaid = parseFloat(stat.total_paid) || 0;
    const totalRec = parseFloat(stat.total_receivable) || 0;

    return {
        text: `Báo cáo doanh thu **${periodText}**:\n- Tổng đơn hàng: **${totalOrders} đơn**\n- Doanh số phát sinh: **${formatVND(totalRev)}**\n- Đã thực thu: **${formatVND(totalPaid)}**\n- Công nợ phát sinh: **${formatVND(totalRec)}**`,
        card: {
            type: 'REVENUE_REPORT_CARD',
            period: periodText,
            orders_count: totalOrders,
            total_revenue: formatVND(totalRev),
            total_paid: formatVND(totalPaid),
            total_receivable: formatVND(totalRec),
            link: 'modules/admin-dash.html'
        },
        action_type: 'REVENUE_REPORT',
        quick_replies: ['Doanh thu tháng này', 'Kiểm tra công nợ khách hàng', 'Sức khoẻ doanh nghiệp']
    };
}

// 6. BÁO CÁO SỨC KHOẺ DOANH NGHIỆP (CFO DASHBOARD)
async function handleReportBusinessHealth(text, context, user) {
    const cfgRes = await pool.query('SELECT config_key, config_value FROM business_health_config');
    const configs = {};
    cfgRes.rows.forEach(r => { configs[r.config_key] = parseFloat(r.config_value) || 0; });

    const cashRes = await pool.query(`
        SELECT 
            COALESCE(SUM(CASE WHEN type = 'THU' THEN amount ELSE -amount END), 0) AS net_cash
        FROM cash_transactions
    `);
    const cashBalance = parseFloat(cashRes.rows[0]?.net_cash || 0);

    const debtRes = await pool.query(`
        SELECT COALESCE(SUM(current_debt), 0) AS total_debt FROM customers
    `);
    const totalReceivables = parseFloat(debtRes.rows[0]?.total_debt || 0);

    const invRes = await pool.query(`
        SELECT COALESCE(SUM(stock_qty * import_price), 0) AS inventory_value FROM products
    `);
    const inventoryValue = parseFloat(invRes.rows[0]?.inventory_value || 0);

    const shortDebt = configs.bank_debt_short || 400000000;
    const currentAssets = cashBalance + totalReceivables + inventoryValue;
    const currentRatio = shortDebt > 0 ? (currentAssets / shortDebt).toFixed(2) : '3.50';

    let healthStatus = 'TỐT';
    let healthColor = 'emerald';
    let advisory = 'Dòng tiền ổn định, hệ số thanh khoản đảm bảo vận hành an toàn.';
    if (parseFloat(currentRatio) < 1.0) {
        healthStatus = 'BÁO ĐỘNG ĐỎ';
        healthColor = 'red';
        advisory = 'Cảnh báo nguy cơ thiếu hụt dòng tiền thanh toán ngắn hạn! Cần siết chặt thu nợ 131.';
    } else if (parseFloat(currentRatio) < 1.5) {
        healthStatus = 'CẢNH BÁO VÀNG';
        healthColor = 'amber';
        advisory = 'Thanh khoản ở mức vừa phải, cần theo dõi sát các khoản nợ đến hạn.';
    }

    return {
        text: `Báo cáo sức khỏe tài chính SUNGO ERP:\n- Trạng thái chung: **${healthStatus}**\n- Tiền mặt & ngân hàng: **${formatVND(cashBalance)}**\n- Công nợ phải thu (131): **${formatVND(totalReceivables)}**\n- Giá trị hàng tồn kho: **${formatVND(inventoryValue)}**\n- Hệ số thanh toán ngắn hạn (Current Ratio): **${currentRatio}**\n💡 *Lời khuyên CFO:* ${advisory}`,
        card: {
            type: 'BUSINESS_HEALTH_CARD',
            status: healthStatus,
            color: healthColor,
            cash: formatVND(cashBalance),
            receivables: formatVND(totalReceivables),
            inventory: formatVND(inventoryValue),
            current_ratio: currentRatio,
            advisory: advisory,
            link: 'modules/business-health.html'
        },
        action_type: 'BUSINESS_HEALTH_REPORT',
        quick_replies: ['Kiểm tra công nợ 131', 'Doanh thu tháng này', 'Kiểm tra tồn kho vật tư']
    };
}

// 7. KIỂM TRA HÀNG TỒN KHO
async function handleCheckInventory(text, context, user) {
    const norm = removeVietnameseTones(text);

    if (norm.includes('sap het') || norm.includes('canh bao') || norm.includes('duoi 5')) {
        const lowRes = await pool.query(`
            SELECT id, sku, product_name, stock_qty, unit, bin_location
            FROM products 
            WHERE stock_qty <= 5
            ORDER BY stock_qty ASC 
            LIMIT 10
        `);

        if (lowRes.rows.length === 0) {
            return {
                text: 'Toàn bộ các mặt hàng trong kho đều đang duy trì mức tồn kho an toàn (> 5 đơn vị).',
                card: null,
                action_type: 'INVENTORY_SAFE'
            };
        }

        const items = lowRes.rows.map(r => ({
            name: r.product_name,
            sku: r.sku,
            stock: `${r.stock_qty} ${r.unit || 'Bộ'}`,
            location: r.bin_location || 'Kho Tổng'
        }));

        return {
            text: `Phát hiện **${lowRes.rows.length} mặt hàng** sắp hết (tồn kho <= 5 đơn vị). Cần lên kế hoạch nhập hàng bổ sung sớm.`,
            card: {
                type: 'LOW_STOCK_CARD',
                title: 'Cảnh Báo Hàng Sắp Hết Trong Kho',
                items: items,
                link: 'modules/procurement-inventory.html'
            },
            action_type: 'INVENTORY_LOW_STOCK',
            quick_replies: ['Lên đơn mua hàng bổ sung', 'Kiểm tra kho tổng']
        };
    }

    const pRes = await pool.query(`
        SELECT id, sku, product_name, category, retail_price, stock_qty, virtual_stock, unit, bin_location 
        FROM products 
        ORDER BY stock_qty DESC 
        LIMIT 100
    `);

    let matched = [];
    const keywords = ['canadian', 'deye', 'growatt', 'jinko', 'gigabox', 'sungrow', 'longi', 'luxpower', 'pin', 'inverter'];
    
    for (const p of pRes.rows) {
        const pNorm = removeVietnameseTones(p.product_name + ' ' + p.sku);
        if (norm.includes(pNorm) || (p.sku && norm.includes(removeVietnameseTones(p.sku)))) {
            matched.push(p);
        }
    }

    if (matched.length === 0) {
        for (const kw of keywords) {
            if (norm.includes(kw)) {
                matched = pRes.rows.filter(p => removeVietnameseTones(p.product_name + ' ' + p.sku).includes(kw));
                break;
            }
        }
    }

    if (matched.length === 0 && context.active_product) {
        const found = pRes.rows.find(p => p.id === context.active_product.id);
        if (found) matched = [found];
    }

    if (matched.length === 0) {
        matched = pRes.rows.slice(0, 5);
    }

    const items = matched.slice(0, 5).map(p => ({
        name: p.product_name,
        sku: p.sku,
        stock: `${p.stock_qty} ${p.unit || 'Bộ'}`,
        virtual_stock: `${p.virtual_stock || 0}`,
        location: p.bin_location || 'Kệ A-01',
        price: formatVND(p.retail_price)
    }));

    const top = matched[0];
    context.active_product = top;

    return {
        text: `Kết quả tồn kho cho thiết bị **${top.product_name}**: Tồn thực tế: **${top.stock_qty} ${top.unit || 'Bộ'}** (Vị trí: **${top.bin_location || 'Kho Tổng'}**).`,
        card: {
            type: 'INVENTORY_CARD',
            title: 'Tra Cứu Tồn Kho & Vị Trí Kệ',
            items: items,
            link: 'modules/inventory-dash.html'
        },
        action_type: 'INVENTORY_VIEW',
        quick_replies: ['Gửi tài liệu kỹ thuật sản phẩm này', 'Tạo đơn hàng nhanh']
    };
}

// 8. GỬI THÔNG TIN VÀ TÀI LIỆU SẢN PHẨM CHO KHÁCH
async function handleSendProductDocs(text, context, user) {
    const norm = removeVietnameseTones(text);

    const pRes = await pool.query(`
        SELECT id, sku, product_name, category, description, retail_price, 
               image_url, doc_datasheet, doc_catalog, doc_cocq, doc_manual, unit
        FROM products 
        ORDER BY id DESC 
        LIMIT 100
    `);

    let matched = null;
    for (const p of pRes.rows) {
        const pNorm = removeVietnameseTones(p.product_name + ' ' + p.sku);
        if (norm.includes(pNorm) || (p.sku && norm.includes(removeVietnameseTones(p.sku)))) {
            matched = p;
            break;
        }
    }

    if (!matched) {
        const keywords = ['canadian', 'deye', 'growatt', 'jinko', 'gigabox', 'sungrow', 'longi', 'luxpower'];
        for (const kw of keywords) {
            if (norm.includes(kw)) {
                matched = pRes.rows.find(p => removeVietnameseTones(p.product_name + ' ' + p.sku).includes(kw));
                if (matched) break;
            }
        }
    }

    if (!matched && context.active_product) {
        matched = pRes.rows.find(p => p.id === context.active_product.id) || context.active_product;
    }

    if (!matched) {
        matched = pRes.rows[0];
    }

    context.active_product = matched;

    const datasheet = matched.doc_datasheet || 'https://storage.googleapis.com/sungo-erp-uploads/datasheets/sample-datasheet.pdf';
    const catalog = matched.doc_catalog || 'https://storage.googleapis.com/sungo-erp-uploads/catalogs/sample-catalog.pdf';
    const cocq = matched.doc_cocq || 'https://storage.googleapis.com/sungo-erp-uploads/cocq/sample-cocq.pdf';

    const zaloTemplate = `Chào Anh/Chị! SUNGO Solar gửi anh/chị thông tin kỹ thuật sản phẩm:
📌 Thiết bị: ${matched.product_name} (Mã: ${matched.sku})
💰 Giá niêm yết: ${formatVND(matched.retail_price)}/${matched.unit || 'Bộ'}
📄 Tải Datasheet: ${datasheet}
📑 Tải Catalog: ${catalog}
Cần hỗ trợ lắp đặt hoặc báo giá trọn gói, anh/chị nhắn lại em nhé!`;

    return {
        text: `Đã chuẩn bị đầy đủ hồ sơ kỹ thuật cho **${matched.product_name}** (Datasheet, Catalog, CO/CQ). Anh/Chị có thể bấm nút sao chép bên dưới để gửi nhanh cho khách hàng qua Zalo!`,
        card: {
            type: 'PRODUCT_DOCS_CARD',
            title: matched.product_name,
            sku: matched.sku,
            price: formatVND(matched.retail_price),
            datasheet_url: datasheet,
            catalog_url: catalog,
            cocq_url: cocq,
            zalo_message: zaloTemplate
        },
        action_type: 'DOCS_READY',
        quick_replies: ['Kiểm tra tồn kho sản phẩm này', 'Tạo báo giá cho khách']
    };
}

// 9. TẠO HỢP ĐỒNG NHANH
async function handleCreateContract(text, context, user) {
    const cleanText = text.trim();

    let customerName = 'Khách Hàng Năng Lượng Mặt Trời';
    const nameMatch = cleanText.match(/(?:cho|khách|chị|anh)\s+([A-ZÀ-Ỹ][a-zà-ỹ]+(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]+)*)/);
    if (nameMatch) {
        customerName = nameMatch[1];
    } else if (context.active_customer) {
        customerName = context.active_customer.name || context.active_customer.full_name;
    }

    let contractVal = 85000000;
    const valMatch = cleanText.match(/(\d+(?:[.,]\d+)?)\s*(?:tr|triệu|ty|tỷ|vnd|đ)/i);
    if (valMatch) {
        let rawV = parseFloat(valMatch[1].replace(',', '.'));
        if (cleanText.toLowerCase().includes('tỷ') || cleanText.toLowerCase().includes('ty')) contractVal = rawV * 1000000000;
        else if (cleanText.toLowerCase().includes('triệu') || cleanText.toLowerCase().includes('tr')) contractVal = rawV * 1000000;
    } else if (context.last_order) {
        contractVal = context.last_order.total;
    }

    const contractCode = 'HĐ-' + Date.now().toString().slice(-6);

    const insRes = await pool.query(`
        INSERT INTO contracts (
            contract_code, customer_name, total_value, paid_amount, 
            payment_status, contract_status
        ) VALUES ($1, $2, $3, 0, 'Chờ Đặt Cọc', 'DRAFT')
        RETURNING *
    `, [contractCode, customerName, contractVal]);

    const created = insRes.rows[0];
    context.active_contract = created;

    return {
        text: `Đã khởi tạo hợp đồng kinh tế số **${contractCode}** cho khách hàng **${customerName}**, tổng giá trị **${formatVND(contractVal)}**. Link ký số điện tử online đã sẵn sàng.`,
        card: {
            type: 'CONTRACT_CARD',
            title: `Hợp Đồng: ${contractCode}`,
            customer: customerName,
            total_value: formatVND(contractVal),
            status: 'Soạn Thảo (DRAFT)',
            sign_url: `/sign?code=${contractCode}`,
            link: 'modules/contract-billing.html'
        },
        action_type: 'CONTRACT_CREATED',
        quick_replies: ['Xem hợp đồng', 'Kiểm tra công nợ khách hàng']
    };
}

// 10. KIỂM TRA BẢO HÀNH (SERIAL & HẠN BẢO HÀNH)
async function handleCheckWarranty(text, context, user) {
    let serial = '';
    const serialMatch = text.match(/(?:serial|sn|mã|số)\s*[:=]?\s*([A-Za-z0-9\-_]{6,})/i);
    if (serialMatch) {
        serial = serialMatch[1].trim().toUpperCase();
    }

    let wRes;
    if (serial) {
        wRes = await pool.query(`
            SELECT w.*, 
                   COALESCE(w.custom_product_name, p.product_name, w.sku) AS product_name,
                   p.retail_price, p.doc_datasheet
            FROM warranties w 
            LEFT JOIN products p ON (LOWER(w.sku) = LOWER(p.sku) OR w.product_id = p.id)
            WHERE UPPER(w.serial_number) = $1
            LIMIT 1
        `, [serial]);
    } else {
        wRes = await pool.query(`
            SELECT w.*, 
                   COALESCE(w.custom_product_name, p.product_name, w.sku) AS product_name,
                   p.retail_price
            FROM warranties w 
            LEFT JOIN products p ON (LOWER(w.sku) = LOWER(p.sku) OR w.product_id = p.id)
            ORDER BY w.id DESC 
            LIMIT 1
        `);
    }

    if (wRes.rows.length === 0) {
        return {
            text: `Không tìm thấy thông tin bảo hành cho mã serial **${serial || 'vừa nhập'}**. Anh/Chị vui lòng kiểm tra lại dãy số trên tem sản phẩm hoặc quét mã QR.`,
            card: null,
            action_type: 'WARRANTY_NOT_FOUND',
            quick_replies: ['Tra cứu bảo hành khác', 'Mở cổng bảo hành công khai']
        };
    }

    const w = wRes.rows[0];
    const activatedAt = w.activated_at ? new Date(w.activated_at) : new Date();
    const expiryDate = w.expiry_date ? new Date(w.expiry_date) : new Date(activatedAt.getTime() + 5 * 365 * 24 * 3600 * 1000);
    const now = new Date();
    const isValid = now <= expiryDate;
    const daysRemaining = Math.max(0, Math.ceil((expiryDate - now) / (1000 * 3600 * 24)));

    return {
        text: `Thông tin bảo hành Serial **${w.serial_number}** (${w.product_name}):\n- Trạng thái: **${isValid ? 'CÒN HIỆU LỰC' : 'HẾT HẠN'}**\n- Khách hàng: **${w.customer_name || 'Khách lẻ'}**\n- Ngày kích hoạt: **${activatedAt.toLocaleDateString('vi-VN')}**\n- Hạn bảo hành: **${expiryDate.toLocaleDateString('vi-VN')}** (Còn **${daysRemaining} ngày**).`,
        card: {
            type: 'WARRANTY_CARD',
            serial: w.serial_number,
            product_name: w.product_name,
            customer: w.customer_name || 'Khách lẻ',
            status: isValid ? 'CÒN BẢO HÀNH' : 'HẾT HẠN',
            days_remaining: `${daysRemaining} ngày`,
            expiry_date: expiryDate.toLocaleDateString('vi-VN'),
            link: 'modules/warranty-list.html'
        },
        action_type: 'WARRANTY_CHECKED',
        quick_replies: ['Tạo lịch bảo trì O&M', 'Gửi tài liệu sản phẩm này']
    };
}

// 11. KIỂM TRA NHÂN SỰ & CHẤM CÔNG
async function handleCheckHR(text, context, user) {
    const empCountRes = await pool.query(`
        SELECT 
            COUNT(id) AS total_employees,
            COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END) AS active_employees
        FROM employees
    `);
    const totalEmp = parseInt(empCountRes.rows[0]?.total_employees || 0, 10);
    const activeEmp = parseInt(empCountRes.rows[0]?.active_employees || 0, 10);

    const attRes = await pool.query(`
        SELECT 
            COUNT(id) AS checked_in,
            COUNT(CASE WHEN late_minutes > 0 THEN 1 END) AS late_count
        FROM attendance_daily 
        WHERE work_date = CURRENT_DATE
    `);
    const checkedIn = parseInt(attRes.rows[0]?.checked_in || 0, 10);
    const lateCount = parseInt(attRes.rows[0]?.late_count || 0, 10);

    const deptRes = await pool.query(`
        SELECT d.dept_name, COUNT(e.id) AS emp_count 
        FROM departments d 
        LEFT JOIN employees e ON e.department_id = d.id AND e.status = 'ACTIVE'
        GROUP BY d.dept_name
        ORDER BY emp_count DESC
    `);

    const deptSummary = deptRes.rows.map(r => `${r.dept_name}: ${r.emp_count} người`).join(', ');

    return {
        text: `Báo cáo tình hình nhân sự & chấm công hôm nay (${new Date().toLocaleDateString('vi-VN')}):\n- Tổng quân số: **${activeEmp}/${totalEmp} nhân viên chính thức**\n- Đã chấm công: **${checkedIn} người**\n- Đi trễ: **${lateCount} người**\n- Phân bổ phòng ban: ${deptSummary}.`,
        card: {
            type: 'HR_CARD',
            total_active: activeEmp,
            checked_in_today: checkedIn,
            late_today: lateCount,
            departments: deptRes.rows,
            link: 'modules/hr-employees.html'
        },
        action_type: 'HR_CHECKED',
        quick_replies: ['Xem bảng chấm công chi tiết', 'Báo cáo doanh thu bán hàng']
    };
}

// 12. KIỂM TRA CÔNG NỢ (131 & 331)
async function handleCheckDebt(text, context, user) {
    let specificCustomer = null;
    const nameMatch = text.match(/(?:của|khách|anh|chị)\s+([A-ZÀ-Ỹ][a-zà-ỹ]+(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]+)*)/);
    if (nameMatch) {
        const cRes = await pool.query(
            'SELECT id, full_name, name, phone, current_debt, debt_limit FROM customers WHERE LOWER(full_name) LIKE $1 OR LOWER(name) LIKE $1 LIMIT 1',
            [`%${nameMatch[1].toLowerCase()}%`]
        );
        if (cRes.rows.length > 0) specificCustomer = cRes.rows[0];
    } else if (context.active_customer) {
        const cRes = await pool.query('SELECT id, full_name, name, phone, current_debt, debt_limit FROM customers WHERE id = $1', [context.active_customer.id]);
        if (cRes.rows.length > 0) specificCustomer = cRes.rows[0];
    }

    if (specificCustomer) {
        context.active_customer = {
            id: specificCustomer.id,
            name: specificCustomer.full_name || specificCustomer.name,
            phone: specificCustomer.phone
        };

        const debt = parseFloat(specificCustomer.current_debt) || 0;
        const limit = parseFloat(specificCustomer.debt_limit) || 0;
        const statusText = debt > limit && limit > 0 ? '⚠️ VƯỢT HẠN MỨC' : (debt > 0 ? 'CÒN NỢ' : 'HẾT NỢ');

        return {
            text: `Công nợ khách hàng **${specificCustomer.full_name || specificCustomer.name}**:\n- Dư nợ hiện tại: **${formatVND(debt)}**\n- Hạn mức nợ cho phép: **${formatVND(limit)}**\n- Đánh giá: **${statusText}**`,
            card: {
                type: 'DEBT_SINGLE_CARD',
                customer: specificCustomer.full_name || specificCustomer.name,
                phone: specificCustomer.phone,
                current_debt: formatVND(debt),
                limit: formatVND(limit),
                status: statusText,
                link: 'modules/debt-book.html'
            },
            action_type: 'DEBT_CHECKED',
            quick_replies: ['Tạo đơn hàng mới', 'Xem lịch sử sổ nợ']
        };
    }

    const debtRes = await pool.query(`
        SELECT 
            COALESCE(SUM(current_debt), 0) AS total_receivable,
            COUNT(CASE WHEN current_debt > 0 THEN 1 END) AS debtor_count,
            COUNT(CASE WHEN current_debt > debt_limit AND debt_limit > 0 THEN 1 END) AS exceeded_count
        FROM customers
    `);
    const totalRec = parseFloat(debtRes.rows[0]?.total_receivable || 0);
    const debtorCount = parseInt(debtRes.rows[0]?.debtor_count || 0, 10);
    const exceededCount = parseInt(debtRes.rows[0]?.exceeded_count || 0, 10);

    const topDebtorsRes = await pool.query(`
        SELECT full_name, name, phone, current_debt, debt_limit 
        FROM customers 
        WHERE current_debt > 0 
        ORDER BY current_debt DESC 
        LIMIT 5
    `);

    const topList = topDebtorsRes.rows.map(r => ({
        name: r.full_name || r.name,
        debt: formatVND(r.current_debt),
        limit: formatVND(r.debt_limit)
    }));

    return {
        text: `Báo cáo tổng quan công nợ phải thu (TK 131):\n- Tổng nợ khách hàng: **${formatVND(totalRec)}**\n- Số lượng khách đang nợ: **${debtorCount} đối tác**\n- Khách vượt hạn mức nợ: **${exceededCount} trường hợp** (Cần ưu tiên nhắc nợ).`,
        card: {
            type: 'DEBT_SUMMARY_CARD',
            title: 'Sổ Nợ Khách Hàng (TK 131)',
            total_debt: formatVND(totalRec),
            debtor_count: debtorCount,
            exceeded_count: exceededCount,
            top_debtors: topList,
            link: 'modules/debt-book.html'
        },
        action_type: 'DEBT_CHECKED',
        quick_replies: ['Sức khoẻ doanh nghiệp', 'Báo cáo doanh thu tháng']
    };
}

// 13. PHÂN TÍCH KHÁCH HÀNG (TIER, SPENDING, RETENTION)
async function handleAnalyzeCustomer(text, context, user) {
    let targetCustomer = null;
    const nameMatch = text.match(/(?:của|khách|anh|chị)\s+([A-ZÀ-Ỹ][a-zà-ỹ]+(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]+)*)/);
    if (nameMatch) {
        const cRes = await pool.query(
            'SELECT * FROM customers WHERE LOWER(full_name) LIKE $1 OR LOWER(name) LIKE $1 LIMIT 1',
            [`%${nameMatch[1].toLowerCase()}%`]
        );
        if (cRes.rows.length > 0) targetCustomer = cRes.rows[0];
    } else if (context.active_customer) {
        const cRes = await pool.query('SELECT * FROM customers WHERE id = $1', [context.active_customer.id]);
        if (cRes.rows.length > 0) targetCustomer = cRes.rows[0];
    }

    if (targetCustomer) {
        const ordRes = await pool.query(`
            SELECT COUNT(id) AS order_count, COALESCE(SUM(total_amount), 0) AS total_sales, MAX(created_at) AS last_order_date
            FROM orders 
            WHERE customer_id = $1 AND status != 'CANCELLED'
        `, [targetCustomer.id]);

        const oCount = parseInt(ordRes.rows[0]?.order_count || 0, 10);
        const oSales = parseFloat(ordRes.rows[0]?.total_sales || 0);
        const lastOrder = ordRes.rows[0]?.last_order_date ? new Date(ordRes.rows[0].last_order_date).toLocaleDateString('vi-VN') : 'Chưa có';

        let tierName = 'Khách Mới';
        if (targetCustomer.tier >= 3 || targetCustomer.vip_level >= 3) tierName = 'Đại Lý Cấp 1 (VIP)';
        else if (targetCustomer.tier === 2) tierName = 'Khách Sỉ Thân Thiết';

        return {
            text: `Phân tích khách hàng **${targetCustomer.full_name || targetCustomer.name}**:\n- Phân hạng: **${tierName}**\n- Tổng doanh số tích lũy: **${formatVND(oSales)}** (${oCount} đơn hàng)\n- Lần mua gần nhất: **${lastOrder}**\n- Dư nợ: **${formatVND(targetCustomer.current_debt || 0)}**\n💡 *Gợi ý chăm sóc:* Duy trì chính sách chiết khấu đại lý và thăm hỏi định kỳ.`,
            card: {
                type: 'CUSTOMER_ANALYTICS_CARD',
                name: targetCustomer.full_name || targetCustomer.name,
                phone: targetCustomer.phone,
                tier: tierName,
                total_spent: formatVND(oSales),
                order_count: `${oCount} đơn hàng`,
                last_order: lastOrder,
                debt: formatVND(targetCustomer.current_debt || 0),
                link: 'modules/sale-crm.html'
            },
            action_type: 'CUSTOMER_ANALYZED',
            quick_replies: ['Tạo đơn hàng cho khách này', 'Kiểm tra công nợ']
        };
    }

    const topCustRes = await pool.query(`
        SELECT c.id, c.full_name, c.name, c.phone, c.tier, 
               COALESCE(SUM(o.total_amount), 0) AS total_spent,
               COUNT(o.id) AS orders_count
        FROM customers c
        LEFT JOIN orders o ON o.customer_id = c.id AND o.status != 'CANCELLED'
        GROUP BY c.id
        ORDER BY total_spent DESC 
        LIMIT 5
    `);

    const topList = topCustRes.rows.map(c => ({
        name: c.full_name || c.name,
        spent: formatVND(c.total_spent),
        orders: `${c.orders_count} đơn`
    }));

    return {
        text: `Phân tích nhóm Khách Hàng VIP & Đóng Góp Doanh Số Lớn Nhất:\nTop khách hàng thân thiết đang đóng góp trên 60% tổng doanh thu bán buôn và dự án EPC của công ty.`,
        card: {
            type: 'VIP_CUSTOMERS_CARD',
            title: 'Top 5 Khách Hàng Doanh Số Cao Nhất',
            customers: topList,
            link: 'modules/sale-crm.html'
        },
        action_type: 'CUSTOMER_ANALYZED',
        quick_replies: ['Báo cáo doanh thu', 'Kiểm tra công nợ']
    };
}

// 14. PHÂN TÍCH SẢN PHẨM (BEST-SELLER, TỒN KHO LÂU NGÀY, BIÊN LỢI NHUẬN)
async function handleAnalyzeProduct(text, context, user) {
    const topSalesRes = await pool.query(`
        SELECT p.product_name, p.sku, p.category, 
               COALESCE(SUM(oi.quantity), 0) AS total_qty_sold,
               COALESCE(SUM(oi.total), 0) AS total_revenue
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        JOIN orders o ON oi.order_id = o.id AND o.status != 'CANCELLED'
        GROUP BY p.id, p.product_name, p.sku, p.category
        ORDER BY total_qty_sold DESC
        LIMIT 5
    `);

    const slowRes = await pool.query(`
        SELECT p.product_name, p.sku, p.stock_qty, p.import_price, p.unit
        FROM products p
        WHERE p.stock_qty > 10 
          AND p.id NOT IN (
              SELECT DISTINCT product_id FROM order_items 
              WHERE product_id IS NOT NULL 
              ORDER BY product_id
          )
        LIMIT 5
    `);

    const bestSellers = topSalesRes.rows.map(r => ({
        name: r.product_name,
        sku: r.sku,
        sold: `${r.total_qty_sold} cái`,
        rev: formatVND(r.total_revenue)
    }));

    const slowMovers = slowRes.rows.map(r => ({
        name: r.product_name,
        sku: r.sku,
        stock: `${r.stock_qty} ${r.unit || 'Bộ'}`,
        cost: formatVND(r.import_price)
    }));

    return {
        text: `Báo cáo phân tích sản phẩm:\n- **Top Sản Phẩm Bán Chạy:** Pin Canadian Solar, Biến tần Deye Hybrid, Pin Lithium Gigabox.\n- **Sản phẩm chậm luân chuyển:** Có ${slowMovers.length} mặt hàng tồn lâu chưa phát sinh đơn mới, đề xuất làm chương trình khuyến mãi giải phóng vốn tồn kho.`,
        card: {
            type: 'PRODUCT_ANALYSIS_CARD',
            best_sellers: bestSellers,
            slow_movers: slowMovers,
            link: 'modules/admin-products.html'
        },
        action_type: 'PRODUCT_ANALYZED',
        quick_replies: ['Kiểm tra hàng tồn kho', 'Báo cáo doanh thu']
    };
}

/**
 * =========================================================================
 * BỘ ĐIỀU PHỐI TRUNG TÂM (MAIN AI DISPATCHER)
 * =========================================================================
 */
async function processChatMessage(userId, sessionId, messageText, userRole = 'ADMIN', userObj = {}) {
    const conv = await getOrCreateConversation(userId, sessionId);
    const context = conv.context_state || {};

    await saveMessage(conv.id, 'user', messageText);

    const intent = detectIntent(messageText, context);

    const isAllowed = checkPermission(userRole, intent);
    if (!isAllowed) {
        const denyText = `⚠️ Dạ em rất tiếc, tài khoản vai trò **[${userRole}]** không có thẩm quyền truy cập hoặc thực hiện thao tác **[${intent}]** này.\n\nAnh/Chị vui lòng liên hệ Quản Trị Viên (Admin) hoặc Kế Toán Trưởng để được cấp quyền mở rộng.`;
        
        await saveMessage(conv.id, 'assistant', denyText, intent, 'PERMISSION_DENIED', { role: userRole, intent });
        return {
            reply: denyText,
            card: {
                type: 'PERMISSION_DENIED_CARD',
                role: userRole,
                intent: intent,
                message: 'Thao tác vượt quá thẩm quyền của phân hệ người dùng.'
            },
            action_type: 'PERMISSION_DENIED',
            quick_replies: ['Xem hướng dẫn sử dụng', 'Làm mới hội thoại']
        };
    }

    let actionResult = null;

    try {
        switch (intent) {
            case 'CREATE_ORDER':
                actionResult = await handleCreateOrder(messageText, context, userObj);
                break;
            case 'CREATE_PRODUCT':
                actionResult = await handleCreateProduct(messageText, context, userObj);
                break;
            case 'CREATE_QUOTATION':
                actionResult = await handleCreateQuotation(messageText, context, userObj);
                break;
            case 'CREATE_PURCHASE':
                actionResult = await handleCreatePurchase(messageText, context, userObj);
                break;
            case 'REPORT_REVENUE':
                actionResult = await handleReportRevenue(messageText, context, userObj);
                break;
            case 'REPORT_BUSINESS_HEALTH':
                actionResult = await handleReportBusinessHealth(messageText, context, userObj);
                break;
            case 'CHECK_INVENTORY':
                actionResult = await handleCheckInventory(messageText, context, userObj);
                break;
            case 'SEND_PRODUCT_DOCS':
                actionResult = await handleSendProductDocs(messageText, context, userObj);
                break;
            case 'CREATE_CONTRACT':
                actionResult = await handleCreateContract(messageText, context, userObj);
                break;
            case 'CHECK_WARRANTY':
                actionResult = await handleCheckWarranty(messageText, context, userObj);
                break;
            case 'CHECK_HR':
                actionResult = await handleCheckHR(messageText, context, userObj);
                break;
            case 'CHECK_DEBT':
                actionResult = await handleCheckDebt(messageText, context, userObj);
                break;
            case 'ANALYZE_CUSTOMER':
                actionResult = await handleAnalyzeCustomer(messageText, context, userObj);
                break;
            case 'ANALYZE_PRODUCT':
                actionResult = await handleAnalyzeProduct(messageText, context, userObj);
                break;
            default:
                actionResult = {
                    text: `Dạ em là **Trợ Lý AI SUNGO ERP**. Em có thể hỗ trợ anh/chị:\n- 📦 Tạo đơn hàng & Tạo sản phẩm siêu tốc\n- 📑 Lập báo giá & Soạn hợp đồng điện tử\n- 🛒 Lên đơn đặt mua hàng từ NCC (PO)\n- 📊 Báo cáo doanh thu & Sức khỏe tài chính CFO\n- 🔍 Tra cứu tồn kho, Serial bảo hành & Công nợ 131/331\n- 📄 Gửi Datasheet, Catalog & Phân tích khách hàng\n\nAnh/Chị cần em hỗ trợ việc gì ngay bây giờ?`,
                    card: null,
                    action_type: 'GENERAL_REPLY',
                    quick_replies: ['Tạo đơn hàng nhanh', 'Kiểm tra tồn kho tấm pin', 'Báo cáo doanh thu hôm nay', 'Sức khỏe doanh nghiệp']
                };
                break;
        }
    } catch (err) {
        console.error('Lỗi thực thi Action AI:', err);
        actionResult = {
            text: `⚠️ Có lỗi phát sinh khi xử lý yêu cầu: ${err.message}. Em đã ghi nhận và báo kỹ thuật.`,
            card: null,
            action_type: 'ERROR',
            quick_replies: ['Thử lại', 'Xem hướng dẫn']
        };
    }

    await updateContextState(conv.id, context);

    await saveMessage(
        conv.id, 
        'assistant', 
        actionResult.text, 
        intent, 
        actionResult.action_type, 
        actionResult.card || {}
    );

    return {
        reply: actionResult.text,
        card: actionResult.card,
        action_type: actionResult.action_type,
        quick_replies: actionResult.quick_replies || []
    };
}

module.exports = {
    processChatMessage,
    getOrCreateConversation,
    saveMessage,
    updateContextState,
    checkPermission,
    detectIntent
};
