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
    ],

    // Khối Khách vãng lai / Chưa đăng nhập (Chỉ tra cứu công cộng)
    'GUEST': [
        'GENERAL_CHAT', 'CHECK_WARRANTY', 'SEND_PRODUCT_DOCS'
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
    if (role === 'GUEST') {
        const guestAllowed = ['GENERAL_CHAT', 'CHECK_WARRANTY', 'SEND_PRODUCT_DOCS'];
        return guestAllowed.includes(intent);
    }
    // Các thao tác đối thoại xác nhận, cập nhật, hủy bản nháp hoặc cấu hình AI được cho phép toàn quyền trong phiên của nhân viên đã đăng nhập
    if (['CONFIRM_DRAFT_ORDER', 'UPDATE_DRAFT_ORDER', 'CANCEL_DRAFT_ORDER', 'RESUME_DRAFT_ORDER', 'SWITCH_TO_GOOGLE_AI', 'SWITCH_TO_CHATGPT', 'SET_OPENAI_KEY'].includes(intent)) {
        return true;
    }
    const perms = RBAC_PERMISSIONS[role] || [];
    if (perms.includes('*')) return true;
    return perms.includes(intent);
}

/**
 * Trình nhận diện Ý định (Intent Recognition Engine)
 */
function detectIntent(text, context) {
    const norm = removeVietnameseTones(text);

    // 0. Lệnh kết nối / chuyển đổi sang Google Gemini AI
    if (
        norm.includes('doi sang google') || norm.includes('chuyen sang google') ||
        norm.includes('dung google') || norm.includes('tro ly google') ||
        norm.includes('gemini') || norm.includes('google ai') || norm.includes('ve google') ||
        norm.includes('dua ve tro ly ai cua google') || norm.includes('dua ve google') ||
        norm.includes('chuyen ve google')
    ) {
        return 'SWITCH_TO_GOOGLE_AI';
    }

    // 0. Lệnh kết nối / chuyển đổi sang OpenAI ChatGPT
    if (
        norm.includes('doi sang chat gpt') || norm.includes('chuyen sang chat gpt') ||
        norm.includes('doi sang chatgpt') || norm.includes('chuyen qua chatgpt') ||
        norm.includes('dung chat gpt') || norm.includes('dung chatgpt') ||
        norm.includes('ket noi chatgpt') || norm.includes('chuyen sang openai') ||
        norm.includes('doi sang openai') || norm.includes('dung openai')
    ) {
        return 'SWITCH_TO_CHATGPT';
    }

    if (/(sk-[A-Za-z0-9_\-]{15,})/i.test(text)) {
        return 'SET_OPENAI_KEY';
    }

    // =========================================================================
    // 0. XỬ LÝ KHI ĐANG CÓ BẢN NHÁP ĐƠN HÀNG TRONG NGỮ CẢNH (DRAFT ORDER STATE)
    // =========================================================================
    if (context && context.draft_order) {
        // Hủy bỏ bản nháp đơn hàng
        if (norm.includes('huy') || norm.includes('khong tao nua') || norm.includes('bo qua') || norm.includes('xoa nhap') || norm.includes('dung lai') || norm.includes('thoi')) {
            return 'CANCEL_DRAFT_ORDER';
        }

        // Tiếp tục / phục hồi bản nháp đơn hàng (hoặc câu chào ngắt quãng)
        if (
            norm.includes('tiep tuc don') || norm.includes('tiep tuc ban nhap') || norm.includes('quay lai don') || 
            norm.includes('xem lai don nhap') || norm.includes('tiep tuc') ||
            /^(?:alo|chao|hi|hello|helo|oi|bot oi|em oi|ad oi)(?:\s+(?:em|bot|ad|nhe))?$/i.test(norm)
        ) {
            return 'RESUME_DRAFT_ORDER';
        }

        // Xác nhận tạo đơn chính thức
        if (
            norm.includes('tao don') || norm.includes('len don') || norm.includes('xac nhan') || norm.includes('dong y') ||
            norm.includes('ok') || norm.includes('luu don') || norm.includes('dung roi') || norm.includes('chuan roi') ||
            norm.includes('tien hanh') || norm.includes('bat dau lam') || norm.includes('lam di') || norm.includes('tao di')
        ) {
            return 'CONFIRM_DRAFT_ORDER';
        }

        // KIỂM TRA NGẮT QUÃNG (CONTEXT SWITCH & INTERRUPTION):
        // Nếu người dùng hỏi câu hỏi tra cứu khác (datasheet, tồn kho, doanh thu, bảo hành, v.v.):
        // Cho phép nhận diện đúng intent nghiệp vụ đó thay vì ép vào sửa đơn hàng!
        const isInterruption = 
            norm.includes('datasheet') || norm.includes('tai lieu') || norm.includes('catalog') || norm.includes('thong so') ||
            norm.includes('ton kho') || norm.includes('con bao nhieu') || norm.includes('sap het hang') ||
            norm.includes('doanh thu') || norm.includes('doanh so') || norm.includes('bao hanh') ||
            norm.includes('cong no') || norm.includes('nhan su') || norm.includes('suc khoe') ||
            norm.includes('hop dong') || norm.includes('bao gia') || norm.includes('gemini') || norm.includes('google');

        if (!isInterruption) {
            // Người dùng đang trả lời thông tin đối tác, số lượng hoặc chỉnh sửa bản nháp
            return 'UPDATE_DRAFT_ORDER';
        }
    }

    // =========================================================================
    // 4. LÊN ĐƠN ĐẶT MUA HÀNG NHANH / PHIẾU MUA HÀNG (PO - PURCHASE ORDER)
    // =========================================================================
    if (
        norm.includes('phieu mua hang') || norm.includes('phieu mua') || norm.includes('don mua hang') ||
        norm.includes('don mua') || norm.includes('don dat mua') || norm.includes('dat hang mua') ||
        norm.includes('dat mua hang') || norm.includes('mua hang') || norm.includes('nhap hang') ||
        norm.includes('nhap kho') || norm.includes('tao po') || norm.includes('len po') || norm.includes('don po') ||
        norm.includes('dat ncc') || norm.includes('nha cung cap') || norm.includes('ncc') ||
        (norm.includes('dat mua') && !norm.includes('khach'))
    ) {
        return 'CREATE_PURCHASE';
    }

    // =========================================================================
    // 1. TẠO ĐƠN HÀNG BÁN NHANH (SO - SALES ORDER)
    // =========================================================================
    if (
        (norm.includes('don hang ban') || norm.includes('don ban hang') || norm.includes('ban cho') || 
         norm.includes('ban hang') || norm.includes('khach mua') || norm.includes('len don ban') || 
         norm.includes('tao don ban') || norm.includes('lap don ban') || norm.includes('tao don hang') || 
         norm.includes('tao don') || norm.includes('len don') || norm.includes('lap don') ||
         norm.includes('ban')) &&
        !norm.includes('nha cung cap') && !norm.includes('phieu mua') && !norm.includes('don mua') && !norm.includes('nhap hang') && !norm.includes('po')
    ) {
        return 'CREATE_ORDER';
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

// =========================================================================
// CÁC HÀM TRỢ GIÚP CHO QUY TRÌNH ĐỐI THOẠI 2 CHIỀU & BẢN NHÁP ĐƠN HÀNG
// =========================================================================

const CUST_STOP_WORDS = new Set([
    'anh', 'chi', 'em', 'bac', 'chu', 'ong', 'ba', 'khach', 'hang', 'doi', 'tac', 
    'mua', 'ban', 'cho', 'tao', 'don', 'ngay', 'lap', 'phieu', 'va', 'la', 'voi', 
    'o', 'tai', 'tp', 'tinh', 'quan', 'huyen', 'so', 'luong', 'lay', 'tam', 'pin', 
    'bien', 'tan', 'inverter', 'bo', 'cai', 'chiec', 'thanh', 'sang', 'thay', 'sua',
    'nghe', 'nha', 'nhen', 'nhe', 'nhi', 'a', 'ha', 'ne', 'roi', 'di', 'dum', 'giup', 'ho',
    'nao', 'coi', 'nhung', 'ma', 'lai', 'thong', 'bao', 'chac', 'lac', 'oc', 'cho',
    'dit', 'me', 'dm', 'dcm', 'vcl', 'clgt'
]);

const PRODUCT_STOP_WORDS = new Set([
    'tam', 'bo', 'cai', 'chiec', 'cuon', 'thung', 'met', 'kg', 'kien',
    'mua', 'ban', 'cho', 'tao', 'don', 'hang', 'thiet', 'bi', 'loai', 'day', 'kho', 'them',
    'xuat', 'nhap', 'bao', 'hanh', 'bh', 'nam', 'thang', 'ngay', 'so', 'luong', 'gia', 'vnd', 'dong',
    'k', 'cu', 'trieu', 'ty', 'toi', 'voi', 'va', 'sang', 've',
    'anh', 'chi', 'em', 'bac', 'chu', 'ong', 'ba', 'co', 'thim',
    'khach', 'khach hang', 'doi', 'tac', 'ncc', 'nha', 'cung', 'cap', 'dia', 'chi', 'sdt',
    'lap', 'phieu', 'yeu', 'cau', 'gui', 'ngay', 'lien', 'he', 'giup', 'minh', 'lay', 'dat',
    'nghe', 'nha', 'nhen', 'nhe', 'nhi', 'a', 'ha', 'ne', 'roi', 'di', 'dum', 'giup', 'ho',
    'dit', 'me', 'dm', 'dcm', 'vcl', 'oc', 'cho', 'chac', 'lac',
    'cap', 'nhat', 'san', 'pham', 'ten', 'chu', 'khong', 'phai', 'doi', 'thay', 'sao', 'lai', 'ma', 'nua'
]);

const VN_PROVINCES = [
    'kien giang', 'tay ninh', 'dong thap', 'gia lai', 'dak lak', 'daklak', 'dak nong', 'daknong',
    'lam dong', 'bac lieu', 'ca mau', 'can tho', 'tien giang', 'long an', 'dong nai', 'binh duong',
    'binh phuoc', 'ba ria', 'vung tau', 'ho chi minh', 'hcm', 'sai gon', 'ha noi', 'da nang',
    'quang nam', 'quang ngai', 'khanh hoa', 'phu yen', 'binh dinh', 'hue', 'thua thien', 'quang tri', 'quang binh',
    'ha tinh', 'nghe an', 'thanh hoa', 'ninh binh', 'nam dinh', 'thai binh', 'hai phong', 'hai duong',
    'hung yen', 'bac ninh', 'bac giang', 'vinh phuc', 'phu tho', 'thai nguyen', 'tuyen quang', 'yen bai',
    'lao cai', 'son la', 'hoa binh', 'lang son', 'cao bang', 'ha giang', 'kon tum', 'an giang',
    'soc trang', 'tra vinh', 'hau giang', 'vinh long', 'ninh thuan', 'binh thuan'
];

/**
 * =========================================================================
 * TRỤ CỘT I: NLU, LÀM SẠCH VÀ CHUẨN HÓA DỮ LIỆU ĐẦU VÀO (50 PILLARS)
 * 1. Lọc chửi thề & bực dọc (Profanity Stripping)
 * 2. Âm vị học giọng nói (Voice STT Phonetic Matching & Typo Correction)
 * 3. Chuẩn hóa & quy đổi đơn vị đo lường (kW <-> W <-> kWp, Ah, kWh, kVA)
 * 4. Phục hồi dấu phẩy thập phân bị nuốt trong STT (66kw -> 6.6kW, 153kwh -> 15.3kWh)
 * 5. Loại bỏ từ đệm địa phương (nghe, nhen, nhé, nè, á, dùm...)
 * =========================================================================
 */
function normalizeSolarInput(text) {
    if (!text) return '';
    let str = String(text);

    // 1. Lọc từ cảm thán thô tục & chửi bậy (không dùng ASCII \b vì tiếng Việt có dấu)
    str = str.replace(/(?:địt mẹ|đụ má|đậu má|dcm|dm|vcl|clgt|óc chó|ngu như chó|mẹ kiếp|chó chết|bà mẹ|mả cha)/gi, ' ');

    // 2. BẢNG ÂM VỊ HỌC GIỌNG NÓI SOLAR (VOICE SPEECH-TO-TEXT PHONETICS) & LỖI CHÍNH TẢ TELEX
    const SOLAR_STT_PHONETICS = [
        // Lumentree phonetics
        [/(?:lung\s+linh\s+chi|lưu\s+minh\s+chi|luu\s+minh\s+chi|lemon\s+tree|lemon\s+tri|lumen\s+tri|lumen\s+tree|lumentri|lumen\s+tre)/gi, 'Lumentree'],
        // Deye phonetics
        [/(?:đầy\s+e|đê\s+e|đây\s+e|đề\s+e|de\s+ye|đê\s+dê)/gi, 'Deye'],
        // Solis phonetics
        [/(?:sô\s+lít|so\s+lit|xô\s+lít|xo\s+lit|sô\s+li)/gi, 'Solis'],
        // Luxpower phonetics
        [/(?:lúc\s+pao\s+quơ|lúc\s+pao|lắc\s+pao|luc\s+pao|lắc\s+pao\s+uơ)/gi, 'Luxpower'],
        // Growatt phonetics
        [/(?:gờ\s+rô\s+oat|gơ\s+rô\s+wat|gô\s+gát|gro\s+oat|gờ\s+rô\s+wat)/gi, 'Growatt'],
        // Huawei phonetics
        [/(?:hua\s+way|hoa\s+vĩ|hu\s+oa\s+oay|hua\s+oay)/gi, 'Huawei'],
        // Sungrow phonetics
        [/(?:sun\s+gâu|sun\s+gờ\s+rô|săn\s+gâu)/gi, 'Sungrow'],
        // Jinko phonetics
        [/(?:jin\s+cô|gin\s+cô|din\s+cô|jinkosolar)/gi, 'Jinko'],
        // Longi phonetics
        [/(?:lon\s+gi|long\s+gi|longji)/gi, 'Longi'],
        // Apess phonetics
        [/(?:a\s+pét|a\s+bét|a\s+pếch|apec|a\s+péc)/gi, 'Apess'],
        // Canadian phonetics
        [/(?:ca\s+na\s+đi\s+an|ca\s+na\s+đa|canadain)/gi, 'Canadian'],
        // Goodwe & Sofar
        [/(?:gút\s+we|gút\s+guê)/gi, 'Goodwe'],
        [/(?:sô\s+pha|so\s+fa)/gi, 'Sofar'],
        // Telex & Solar abbreviations
        [/\bdattasheet\b/gi, 'datasheet'],
        [/\bdata\s*sheet\b/gi, 'datasheet'],
        [/\bgrowat\b/gi, 'growatt'],
        [/\bapess\b/gi, 'apec'],
        [/\bsolare\b/gi, 'solar e'],
        [/\bhuwei\b/gi, 'huawei'],
        [/\bsungro\b/gi, 'sungrow'],
        [/\bbt\b/gi, 'biến tần'],
        [/\bbientan\b/gi, 'biến tần'],
        [/\blithum\b/gi, 'lithium'],
        [/\blifepo\b/gi, 'lifepo4']
    ];
    for (const [pattern, repl] of SOLAR_STT_PHONETICS) {
        str = str.replace(pattern, repl);
    }

    // 3. Chuẩn hóa & Quy đổi đơn vị đo lường
    // Đổi dấu phẩy số thập phân sang dấu chấm: 6,5 KW -> 6.5kW, 6,6 KW -> 6.6kW
    str = str.replace(/\b(\d+)[,](\d+)\s*(kw|kilo\s*watt|kwp|kwh|w|wp|kva|v|ah)\b/gi, (m, p1, p2, p3) => `${p1}.${p2}${p3}`);
    // 15000w / 15.000w -> 15kW, 5000w -> 5kW
    str = str.replace(/\b(\d+)\s*000\s*(?:w|watt|oat)\b/gi, (match, p1) => `${p1}kW`);
    // 15kw / 6.6kw -> 15kW / 6.6kW
    str = str.replace(/\b(\d+(?:\.\d+)?)\s*(?:kw|kilo\s*watt)\b/gi, '$1kW');
    // 15kwp -> 15kW
    str = str.replace(/\b(\d+(?:[.,]\d+)?)\s*(?:kwp|kilo\s*watt\s*peak)\b/gi, '$1kW');
    // 600wp -> 600W
    str = str.replace(/\b(\d+(?:[.,]\d+)?)\s*(?:wp|watt\s*peak)\b/gi, '$1W');
    // kva -> kVA
    str = str.replace(/\b(\d+(?:[.,]\d+)?)\s*(?:kva)\b/gi, '$1kVA');
    // kwh -> kWh
    str = str.replace(/\b(\d+(?:[.,]\d+)?)\s*(?:kwh)\b/gi, '$1kWh');
    // ah -> Ah
    str = str.replace(/\b(\d+(?:[.,]\d+)?)\s*(?:ah)\b/gi, '$1Ah');

    // 4. PHỤC HỒI DẤU PHẨY THẬP PHÂN BỊ NUỐT TRONG GIỌNG NÓI STT (VOICE SPEECH-TO-TEXT RECOVERY)
    // Ví dụ: Người dùng nói "sáu phẩy sáu kw" -> STT ghi "66 kw" hoặc "66kw" -> Phục hồi thành 6.6kW!
    str = str.replace(/\b66\s*(?:kw|kilo\s*watt)\b/gi, '6.6kW');
    str = str.replace(/\b65\s*(?:kw|kilo\s*watt)\b/gi, '6.5kW');
    str = str.replace(/\b62\s*(?:kw|kilo\s*watt)\b/gi, '6.2kW');
    str = str.replace(/\b55\s*(?:kw|kilo\s*watt)\b/gi, '5.5kW');
    str = str.replace(/\b153\s*(?:kwh)\b/gi, '15.3kWh');
    str = str.replace(/\b512\s*(?:kwh)\b/gi, '5.12kWh');
    str = str.replace(/\b143\s*(?:kwh)\b/gi, '14.3kWh');

    // 5. Loại bỏ từ đệm địa phương miền Nam
    str = str.replace(/(?:^|\s)(?:nghe nhen|nghe nhé|nhen nhen|nhen|nhe|nhi|nè|á|dùm|giùm|giúp em|hộ em|coi nào|với nhé|nhé sếp|nè sếp)(?:\s|$|[.,!?])/gi, ' ');

    return str.replace(/\s+/g, ' ').trim();
}

function extractSpecs(str, excludeNums = []) {
    if (!str) return [];
    const norm = str.toLowerCase().replace(/,/g, '.');
    const specs = [];

    // 1. Thông số có đơn vị rõ ràng: 15.3kwh, 15kw, 600w, 24v, 3pha...
    const m = norm.matchAll(/(\d+(?:\.\d+)?)\s*(kwh|kw|w|wp|kva|v|ah|hp|m3|pha)\b/g);
    for (const match of m) {
        specs.push({ val: parseFloat(match[1]), unit: match[2] });
    }

    // 2. Số đứng liền kề tên thiết bị hoặc công suất tấm pin (600, 550, 615...)
    const tokens = norm.split(/\s+/);
    const DEVICE_BRANDS = new Set(['deye', 'canadian', 'cana', 'jinko', 'longi', 'growatt', 'huawei', 'sungrow', 'apess', 'solis', 'lumentree', 'pin', 'bien', 'tan', 'inverter', 'hybrid']);

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        const numM = t.match(/^(\d+(?:\.\d+)?)$/);
        if (numM) {
            const val = parseFloat(numM[1]);
            // Bỏ qua số lượng đặt hàng hoặc năm bảo hành (ví dụ: 10 nam, 5 nam, 12 thang)
            if (excludeNums.includes(String(val)) || excludeNums.includes(val)) continue;

            const nextTok = (tokens[i + 1] || '').toLowerCase();
            if (/^(nam|thang|ngay|trieu|ty|k|bo|tam|cai|chiec)$/.test(nextTok)) continue;

            const prevTok = (tokens[i - 1] || '').toLowerCase();
            if (DEVICE_BRANDS.has(prevTok)) {
                const inferredUnit = val >= 100 ? 'w' : 'kw';
                specs.push({ val: val, unit: inferredUnit, inferred: true });
            } else if (val >= 300 && val <= 1000) {
                specs.push({ val: val, unit: 'w', inferred: true });
            }
        }
    }

    return specs;
}

function extractQuantity(text) {
    // 1. Từ khóa rõ ràng: số lượng X, sl X, lấy X, bán X, mua X, đặt X
    const explicitWithUnit = text.match(/(?:số lượng|sl|lấy|bán|mua|đặt)\s*[:=]?\s*(\d+)\s*(?:tấm|bộ|cái|chiếc|con|cuộn|thùng|hộp)\b/i);
    if (explicitWithUnit) return parseInt(explicitWithUnit[1], 10);

    const explicit = text.match(/(?:số lượng|sl)\s*[:=]?\s*(\d+)/i);
    if (explicit) return parseInt(explicit[1], 10);

    // 2. Số kèm đơn vị đếm thực tế: 5 tấm, 5 bộ, 5 cái, 5 chiếc, 5 con, 5 cuộn, 5 thùng, 5 hộp
    const unitMatch = text.match(/(\d+)\s*(?:tấm|bộ|cái|chiếc|con|cuộn|thùng|hộp)\b/i);
    if (unitMatch) return parseInt(unitMatch[1], 10);

    // 3. Động từ hành động theo sau là số lượng: bán 5..., mua 10..., đặt 20...
    const verbNum = text.match(/(?:bán|mua|lấy|đặt|tạo đơn|lên đơn)\s+(\d+)\s+(?!w|kw|kwh|v|ah|hp|m3|pha|mm|cm|m\b|triệu|k\b)/i);
    if (verbNum) return parseInt(verbNum[1], 10);

    // 4. Quét từng token để tìm số lượng, bỏ qua số đi kèm thông số kỹ thuật (12kw, 600w, 24v...) hoặc đứng sau tên hãng
    const tokens = text.split(/\s+/);
    const DEVICE_BRANDS = new Set(['deye', 'canadian', 'cana', 'jinko', 'longi', 'growatt', 'huawei', 'sungrow', 'apess', 'solis', 'lumentree', 'pin', 'bien', 'tan', 'inverter', 'hybrid', 'mcb', 'ma', 'mã', 'loai', 'loại']);

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        const numMatch = t.match(/^(\d+)$/);
        if (numMatch) {
            const num = parseInt(numMatch[1], 10);
            if (num > 1000) continue; // SĐT, mã SKU

            const nextTok = (tokens[i + 1] || '').toLowerCase();
            if (/^(w|kw|kwh|v|ah|hp|m3|pha|3pha|1pha|mm|cm|m|nam|thang|ngay|trieu|ty|k)$/.test(nextTok)) continue;

            const prevTok = (tokens[i - 1] || '').toLowerCase();
            if (DEVICE_BRANDS.has(prevTok)) continue; // e.g. "deye 12", "cana 600"
            if (prevTok === 'kh' || prevTok === 'ncc') continue;

            return num;
        }
    }

    return 1;
}

function getTrigrams(str) {
    const s = '  ' + str + '  ';
    const trigrams = new Set();
    for (let i = 0; i < s.length - 2; i++) {
        trigrams.add(s.slice(i, i + 3));
    }
    return trigrams;
}

function stringSimilarity(s1, s2) {
    if (!s1 || !s2) return 0;
    const n1 = removeVietnameseTones(s1).replace(/[^a-z0-9]/g, '');
    const n2 = removeVietnameseTones(s2).replace(/[^a-z0-9]/g, '');
    if (n1 === n2) return 1.0;
    if (n1.length >= 4 && n2.length >= 4 && (n1.includes(n2) || n2.includes(n1))) return 0.85;

    const t1 = getTrigrams(n1);
    const t2 = getTrigrams(n2);
    let intersection = 0;
    for (const t of t1) {
        if (t2.has(t)) intersection++;
    }
    const union = t1.size + t2.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

// 1. TÌM KIẾM & TỰ ĐOÁN SẢN PHẨM THÔNG MINH (STRICT SPECS & CATEGORY ALIGNMENT)
async function findMatchingProduct(text, norm, context, excludeTokens = []) {
    try {
        const cleanNorm = (norm || removeVietnameseTones(text)).replace(/\b(?:dit me|dcm|dm|vcl|clgt|oc cho|ngu|me kiep|chac lac)\b/g, '').trim();
        const pRes = await pool.query('SELECT id, sku, product_name, category, retail_price, import_price, stock_qty, unit FROM products');
        
        // 1. Khớp trực tiếp SKU chính xác
        for (const p of pRes.rows) {
            const skuNorm = removeVietnameseTones(p.sku || '');
            if (skuNorm && skuNorm.length >= 2 && cleanNorm.includes(skuNorm)) {
                return { matched: true, product: p, autoGuessed: false };
            }
        }

        // Trích xuất thông số kỹ thuật được yêu cầu (kW, kWh, W, V, Ah, Phase)
        const reqSpecs = extractSpecs(text, excludeTokens);

        // 2. Tách và làm sạch các token tìm kiếm
        const rawTokens = cleanNorm.split(/[^a-z0-9]+/i).filter(Boolean);
        const ignore = new Set([...PRODUCT_STOP_WORDS, ...excludeTokens]);
        const sTokens = rawTokens.filter(t => !ignore.has(t) && t.length >= 2);

        if (sTokens.length === 0 && reqSpecs.length === 0) {
            if (context && context.active_product && (cleanNorm.includes('san pham nay') || cleanNorm.includes('thiet bi nay') || cleanNorm.includes('hang nay'))) {
                return { matched: true, product: context.active_product, autoGuessed: false };
            }
            return { matched: false, missing: true };
        }

        const isBatteryQuery = /pin|luu tru|lithium|lifepo4|kwh/i.test(cleanNorm);
        const isInverterQuery = /bien tan|inverter|hybrid|hoa luoi|doc lap|pumping/i.test(cleanNorm);
        const isPanelQuery = /tam pin|panel|canadian|jinko|longi|rapd/i.test(cleanNorm);

        // 3. Tự đoán & Chấm điểm theo trọng số + độ tương đồng (Fuzzy Matching & Strict Specs)
        const scored = pRes.rows.map(p => {
            const pNameNorm = removeVietnameseTones(p.product_name || '');
            const pCatNorm = removeVietnameseTones(p.category || '');
            const nameWords = new Set(pNameNorm.split(/[^a-z0-9]+/i).filter(Boolean));
            const catWords = new Set(pCatNorm.split(/[^a-z0-9]+/i).filter(Boolean));

            let score = 0;
            let matchedCount = 0;

            // Kiểm tra phân loại thiết bị
            const isProdBattery = /pin luu tru|lithium|lifepo4|kwh|pin xe dien/i.test(pNameNorm) || /pin luu tru/i.test(pCatNorm);
            const isProdInverter = /bien tan|inverter|hybrid/i.test(pNameNorm) || /bien tan|inverter/i.test(pCatNorm);
            const isProdPanel = /tam pin/i.test(pNameNorm) || /tam pin/i.test(pCatNorm);

            if (isBatteryQuery) {
                if (isProdBattery) score += 120;
                else if (isProdInverter || isProdPanel) score -= 1000; // Phạt nặng nếu hỏi pin lưu trữ mà ra biến tần hay tấm pin
            }
            if (isInverterQuery) {
                if (isProdInverter) score += 120;
                else if (isProdBattery) score -= 1000;
            }
            if (isPanelQuery) {
                if (isProdPanel) score += 120;
                else if (isProdBattery) score -= 1000;
            }

            // PHÂN TÁCH DANH MỤC CHẶT CHẼ: THÀNH PHẨM NGUYÊN BỘ vs LINH KIỆN ĐƠN LẺ
            // Tách bạch rõ giữa thành phẩm nguyên bộ (pin pack, inverter, tấm pin) với linh kiện (cell pin 32140, MC4, kẹp...)
            const isProdComponent = /cell pin|32140|jack mc4|mc4|kep giua|kep bien|bat z|chan l|mini rail|cap nguon dc|day dc|day dien|cau chi/i.test(pNameNorm) ||
                                    /cell pin|phu kien|dau noi|kep|khung ray|cap nguon/i.test(pCatNorm);
            const userExplicitlyWantsComponent = /cell|32140|jack|mc4|kep|bat z|chan l|mini rail|day dc|phu kien|linh kien/i.test(cleanNorm);

            if (isProdComponent && !userExplicitlyWantsComponent) {
                score -= 3000; // Tuyệt đối không chọn linh kiện / cell pin khi người dùng tìm thiết bị / pin
            }

            // SO KHỚP CHẶT CHẼ THÔNG SỐ KỸ THUẬT (RATING / SPECS)
            if (reqSpecs.length > 0) {
                const pSpecs = extractSpecs(p.product_name);
                for (const req of reqSpecs) {
                    let hasNearSpec = false;
                    let hasConflictSpec = false;

                    for (const ps of pSpecs) {
                        if (req.unit === 'v' && ps.unit === 'v') {
                            if (req.val === ps.val) { hasNearSpec = true; score += 400; }
                            else { hasConflictSpec = true; }
                        } else if (req.unit !== 'v' && ps.unit !== 'v' && ps.unit !== 'ah') {
                            const ratio = ps.val / req.val;
                            // Gần bằng: ví dụ 15kw gần với 15.3kwh hoặc 16kwh
                            if (ratio >= 0.85 && ratio <= 1.15) {
                                hasNearSpec = true;
                                score += 500;
                            } else if (Math.abs(ps.val - req.val) > 2) {
                                hasConflictSpec = true;
                            }
                        }
                    }

                    if (!hasNearSpec && hasConflictSpec) {
                        score -= 1500; // Phạt cực nặng nếu lệch hoàn toàn thông số (ví dụ 15kW vs 5.12kW)
                    }
                }
            }

            // NẾU NGƯỜI DÙNG CÓ NÓI TÊN THƯƠNG HIỆU HÃNG (Deye, Canadian, Apess, Jinko, Solis, Longi, Lumentree, Luxpower...)
            const BRANDS = ['deye', 'canadian', 'apess', 'jinko', 'longi', 'growatt', 'huawei', 'sungrow', 'solis', 'lumentree', 'luxpower', 'goodwe', 'sofar', 'xpower', 'voltique', 'solpump', 'anern'];
            const mentionedBrands = BRANDS.filter(b => cleanNorm.includes(b) || (b === 'canadian' && cleanNorm.includes('cana')) || (b === 'apess' && cleanNorm.includes('apec')));
            if (mentionedBrands.length > 0) {
                const prodHasBrand = mentionedBrands.some(b => pNameNorm.includes(b) || (b === 'canadian' && pNameNorm.includes('cana')) || (b === 'apess' && pNameNorm.includes('apec')));
                if (prodHasBrand) {
                    score += 350;
                } else {
                    score -= 1000; // Phạt nặng nếu sản phẩm không đúng hãng người dùng đã chỉ định
                }
            }

            // Khớp nguyên văn tên sản phẩm
            if (pNameNorm.length >= 5 && cleanNorm.includes(pNameNorm)) {
                score += 300;
                matchedCount += 3;
            }

            for (const tok of sTokens) {
                let tokMatched = false;
                // Mở rộng từ đồng nghĩa: bien tan <-> inverter
                const isInvWord = tok === 'inverter' || tok === 'bien' || tok === 'tan';
                const prodHasInv = pNameNorm.includes('inverter') || pNameNorm.includes('bien tan');
                if (isInvWord && prodHasInv) {
                    tokMatched = true;
                    score += 40;
                }
                // Khớp chính xác từ
                if (nameWords.has(tok)) {
                    tokMatched = true;
                    if (/^\d+(w|kw|kwh|v|ah|hp|m3)$/.test(tok)) score += 60;
                    else if (['canadian', 'deye', 'jinko', 'longi', 'growatt', 'huawei', 'sungrow', 'apess', 'solis', 'lumentree', 'anern', 'xpower', 'voltique', 'solpump'].includes(tok)) score += 80;
                    else score += 35;
                } else {
                    // Tự đoán tiền tố / viết tắt (ví dụ: "cana" -> "canadian", "600" -> "600w", "12" -> "12kw")
                    for (const nw of nameWords) {
                        if (nw.startsWith(tok) || (tok.length >= 3 && nw.includes(tok))) {
                            tokMatched = true;
                            if (/^\d+$/.test(tok) && /^\d+(w|kw|kwh|v|ah|hp)$/.test(nw)) score += 55;
                            else score += 30;
                            break;
                        }
                    }
                }

                if (!tokMatched && catWords.has(tok)) {
                    tokMatched = true;
                    score += 15;
                }

                if (tokMatched) matchedCount++;
            }

            if (matchedCount === 0 && score <= 0) return { ...p, score: 0 };
            if (sTokens.length >= 2 && matchedCount < 2) score -= 25;

            // Độ tương đồng chuỗi Trigram
            const sim = stringSimilarity(sTokens.join(' '), pNameNorm);
            score += sim * 40;

            return { ...p, score };
        }).filter(p => p.score > 0).sort((a, b) => b.score - a.score);

        if (scored.length > 0 && scored[0].score >= 35) {
            // Kiểm tra mơ hồ (Disambiguation) nếu người dùng nói chung chung mà kho có 2 dòng tương đương
            if (scored.length >= 2 && scored[1].score >= 120 && (scored[0].score - scored[1].score) <= 25 && scored[0].id !== scored[1].id) {
                return {
                    matched: false,
                    ambiguous: true,
                    candidates: [scored[0], scored[1]],
                    suggestions: scored.slice(0, 3)
                };
            }

            return {
                matched: true,
                product: scored[0],
                autoGuessed: true,
                suggestions: scored.slice(0, 3)
            };
        }

        // BẮT LỖI SAI LỆCH THÔNG SỐ (ZERO-TOLERANCE MISMATCH):
        // Nếu người dùng yêu cầu công suất cụ thể (ví dụ 15kW) mà kho không có dòng khớp, nhưng có dòng khác công suất (ví dụ 45kW)
        if (reqSpecs.length > 0) {
            const req = reqSpecs[0];
            const conflictCandidates = pRes.rows.filter(p => {
                const pNameNorm = removeVietnameseTones(p.product_name || '');
                const hasDevice = (isBatteryQuery && /pin|luu tru|lithium|kwh/i.test(pNameNorm)) ||
                                  (isInverterQuery && /bien tan|inverter/i.test(pNameNorm)) ||
                                  (isPanelQuery && /tam pin/i.test(pNameNorm)) ||
                                  sTokens.some(tok => pNameNorm.includes(tok));
                if (!hasDevice) return false;
                const pSpecs = extractSpecs(p.product_name);
                return pSpecs.some(ps => ps.unit === req.unit && Math.abs(ps.val - req.val) > 2);
            });

            if (conflictCandidates.length > 0) {
                const confProd = conflictCandidates[0];
                const confSpecs = extractSpecs(confProd.product_name);
                return {
                    matched: false,
                    outOfStockCapacity: true,
                    requestedSpec: req.val + req.unit,
                    suggestedSpec: confSpecs.length > 0 ? (confSpecs[0].val + confSpecs[0].unit) : '',
                    suggestedProduct: confProd,
                    reason: 'OUT_OF_STOCK_CAPACITY',
                    queryProduct: sTokens.join(' ') || text
                };
            }
        }

        return {
            matched: false,
            notFoundInCatalog: true,
            queryProduct: sTokens.join(' ') || text,
            suggestions: scored.slice(0, 3)
        };
    } catch (e) {
        console.warn('findMatchingProduct error:', e.message);
        return { matched: false, missing: true };
    }
}

// 2. TÌM KIẾM & TỰ ĐOÁN KHÁCH HÀNG CRM THÔNG MINH (MULTI-ATTRIBUTE & LOCATION-AWARE)
async function extractCustomer(text, norm, context) {
    try {
        const cleanNorm = (norm || removeVietnameseTones(text)).replace(/\b(?:dit me|dcm|dm|vcl|clgt|oc cho|ngu|me kiep|chac lac)\b/g, '').trim();

        // 1. Khớp SĐT
        const phoneMatch = text.match(/(0[3|5|7|8|9][0-9]{8})/);
        const phone = phoneMatch ? phoneMatch[1] : '';
        if (phone) {
            const pRes = await pool.query(
                "SELECT id, customer_code, full_name, name, nickname, phone, address, company_name, vat_company FROM customers WHERE phone LIKE $1 LIMIT 1",
                ['%' + phone + '%']
            );
            if (pRes.rows.length > 0) {
                const c = pRes.rows[0];
                return { found: true, customerId: c.id, customerName: c.name || c.full_name, customerCode: c.customer_code, phone: c.phone || phone, nickname: c.nickname, company: c.company_name || c.vat_company, autoGuessed: false };
            }
        }

        // 2. Khớp mã KH
        const codeMatch = cleanNorm.match(/kh\s*[-_]?\s*(\d+)/i);
        if (codeMatch) {
            const cRes = await pool.query(
                "SELECT id, customer_code, full_name, name, nickname, phone, address, company_name, vat_company FROM customers WHERE LOWER(customer_code) LIKE $1 LIMIT 1",
                ['%kh%' + codeMatch[1] + '%']
            );
            if (cRes.rows.length > 0) {
                const c = cRes.rows[0];
                return { found: true, customerId: c.id, customerName: c.name || c.full_name, customerCode: c.customer_code, phone: c.phone || '', nickname: c.nickname, company: c.company_name || c.vat_company, autoGuessed: false };
            }
        }

        // 3. Trích xuất tên khách hàng ứng viên & địa điểm (tỉnh/thành phố)
        let candidateQuery = '';
        const explicitMatch = text.match(/(?:cho khách|khách hàng|khách|đối tác|cho anh|cho chị|cho bác|cho chú)\s+([A-ZÀ-Ỹa-zà-ỹ0-9\s]+?)(?:(?:\s+\d+|\s+tấm|\s+bộ|\s+biến\s*tần|\s+inverter|\s+pin|\s+sđt|\s+sdt|\s+số|\s+điện|\s+đt|\s+phone|\s+mua|\s+lấy|\s+đặt|\s+gồm|\s+với|$))/i);
        if (explicitMatch && explicitMatch[1].trim().length > 1) {
            candidateQuery = explicitMatch[1].trim();
        }

        const queryNorm = removeVietnameseTones(candidateQuery || cleanNorm);

        // Phát hiện địa danh / tỉnh thành (ví dụ: "kiên giang", "tây ninh", "đồng tháp", "gia lai")
        let detectedLoc = '';
        for (const p of VN_PROVINCES) {
            if (queryNorm.includes(p)) {
                detectedLoc = p;
                break;
            }
        }

        // Phát hiện danh xưng cá nhân ("anh", "chị", "bác", "chú", "ông", "bà")
        const isPersonalTitle = /\b(?:anh|chi|em|bac|chu|ong|ba)\b/i.test(candidateQuery || cleanNorm);

        const rawTokens = queryNorm.split(/[^a-z0-9]+/i).filter(Boolean);
        const qTokens = rawTokens.filter(t => !CUST_STOP_WORDS.has(t) && t.length >= 2);

        if (qTokens.length === 0 && !detectedLoc) {
            if (context && context.active_customer && (cleanNorm.includes('khach nay') || cleanNorm.includes('anh nay') || cleanNorm.includes('chi ay'))) {
                const ac = context.active_customer;
                return { found: true, customerId: ac.id, customerName: ac.name || ac.full_name, customerCode: ac.customer_code, phone: ac.phone || '', autoGuessed: false };
            }
            return { found: false, missing: true };
        }

        // 4. Lấy danh sách khách hàng để tự đoán thông minh
        const cRes = await pool.query('SELECT id, customer_code, full_name, name, nickname, phone, address, company_name, vat_company FROM customers');
        const qStr = qTokens.join(' ');

        const scored = cRes.rows.map(c => {
            const cName = removeVietnameseTones(c.name || '');
            const cFull = removeVietnameseTones(c.full_name || '');
            const cNick = removeVietnameseTones(c.nickname || '');
            const cComp = removeVietnameseTones(c.company_name || c.vat_company || '');
            const cAddr = removeVietnameseTones(c.address || '');
            const haystack = [cName, cFull, cNick, cComp, cAddr].join(' ');

            let score = 0;
            let matchedCount = 0;

            for (const t of qTokens) {
                if (haystack.includes(t)) {
                    matchedCount++;
                    score += 35;
                }
            }

            // Khớp chính xác cụm tên trong tên đầy đủ hoặc tên gọi
            let includesName = false;
            if (qStr && (cName.includes(qStr) || cFull.includes(qStr))) {
                score += 120;
                includesName = true;
            }

            // Nếu toàn bộ token tìm kiếm đều khớp trong tên khách hàng (ví dụ: "võ" và "toàn" trong "Võ Anh Toàn")
            if (qTokens.length >= 2 && matchedCount >= qTokens.length) {
                score += 80;
            }

            // SO KHỚP ĐỊA DANH / TỈNH THÀNH (ví dụ: "Kiên Giang", "Tây Ninh", "Đồng Tháp")
            if (detectedLoc) {
                if (cAddr.includes(detectedLoc) || cName.includes(detectedLoc) || cFull.includes(detectedLoc)) {
                    score += 500; // BOOST CỰC MẠNH KHI ĐÚNG TỈNH THÀNH
                } else {
                    score -= 150; // Phạt khi lệch tỉnh thành
                }
            }

            // PHÂN BIỆT KHÁCH CÁ NHÂN ("ANH NAM") VỚI CÔNG TY TỔ CHỨC ("CÔNG TY MIỀN NAM ENERGY")
            const isCorporate = (c.company_name && c.company_name.length > 5) || /cong ty|tnhh|energy|nang luong|cp|corp/i.test(cName + ' ' + cFull);
            if (isPersonalTitle && isCorporate) {
                score -= 400; // Người dùng gọi "anh Nam", không được nhầm sang Công ty Miền Nam Energy!
            }

            // Tương đồng Trigram & dồn chuỗi
            const simName = stringSimilarity(qStr, cName);
            const simFull = stringSimilarity(qStr, cFull);
            const simNick = stringSimilarity(qStr, cNick);
            const maxSim = Math.max(simName, simFull, simNick);

            score += maxSim * 50;

            if (cNick && cleanNorm.includes(cNick) && cNick.length >= 3) score += 60;

            if (qTokens.length >= 2 && matchedCount < 2) score -= 50;

            return { ...c, score, maxSim, matchedCount, includesName };
        }).filter(c => c.score > 0).sort((a, b) => b.score - a.score);

        if (scored.length > 0) {
            const best = scored[0];
            const hasSufficientConfidence = (best.score >= 100 && (best.maxSim >= 0.45 || best.matchedCount >= 2 || best.includesName)) ||
                                           (best.exactName || best.exactFullName || best.exactPhone);
            if (hasSufficientConfidence) {
                return {
                    found: true,
                    customerId: best.id,
                    customerName: best.name || best.full_name,
                    customerCode: best.customer_code,
                    phone: best.phone || '',
                    nickname: best.nickname,
                    company: best.company_name || best.vat_company,
                    autoGuessed: true,
                    suggestions: scored.slice(0, 3)
                };
            }
        }

        return {
            found: false,
            notFoundInCRM: true,
            queryCustomer: candidateQuery || qTokens.join(' ') || text,
            suggestions: scored.slice(0, 3)
        };
    } catch (e) {
        console.warn('extractCustomer error:', e.message);
        return { found: false, missing: true };
    }
}

// 3. TÌM KIẾM NHÀ CUNG CẤP: BẮT BUỘC TRONG BẢNG SUPPLIERS
async function extractSupplier(text, norm, context) {
    try {
        const sRes = await pool.query('SELECT id, supplier_code, name, phone, address FROM suppliers');
        
        const cleanText = text.trim();
        const normCheck = norm || removeVietnameseTones(cleanText);
        const compacted = normCheck.replace(/[^a-z0-9]/g, '');

        // 1. Dò tìm trực tiếp theo từ khóa / tên viết tắt / viết liền của 5 NCC
        for (const s of sRes.rows) {
            const sNorm = removeVietnameseTones(s.name);
            const sCode = (s.supplier_code || '').toLowerCase();

            if (sCode && (normCheck.includes(sCode) || compacted.includes(sCode))) {
                return { found: true, supplierId: s.id, supplierName: s.name, supplierCode: s.supplier_code };
            }

            // 1. Công ty Solar E: "solar e", "solare", "solar-e"
            if (sNorm.includes('solar e')) {
                if (normCheck.includes('solar e') || compacted.includes('solare') || compacted.includes('solarenergy')) {
                    return { found: true, supplierId: s.id, supplierName: s.name, supplierCode: s.supplier_code };
                }
            }
            // 2. Công ty Cergy: "cergy", "sergy", "cerny"
            if (sNorm.includes('cergy')) {
                if (normCheck.includes('cergy') || compacted.includes('cergy') || compacted.includes('sergy') || compacted.includes('cerny')) {
                    return { found: true, supplierId: s.id, supplierName: s.name, supplierCode: s.supplier_code };
                }
            }
            // 3. Công ty Tín Trung: "tin trung", "tintrung"
            if (sNorm.includes('tin trung')) {
                if (normCheck.includes('tin trung') || compacted.includes('tintrung')) {
                    return { found: true, supplierId: s.id, supplierName: s.name, supplierCode: s.supplier_code };
                }
            }
            // 4. H Hùng Việt Hào: "hung viet hao", "hungviethao", "viet hao", "viethao"
            if (sNorm.includes('hung viet hao')) {
                if (normCheck.includes('hung viet hao') || compacted.includes('hungviethao') || normCheck.includes('viet hao') || compacted.includes('viethao')) {
                    return { found: true, supplierId: s.id, supplierName: s.name, supplierCode: s.supplier_code };
                }
            }
            // 5. Công ty HeroPower: "heropower", "hero power"
            if (sNorm.includes('heropower')) {
                if (normCheck.includes('heropower') || normCheck.includes('hero power') || compacted.includes('heropower')) {
                    return { found: true, supplierId: s.id, supplierName: s.name, supplierCode: s.supplier_code };
                }
            }
        }

        // 2. Trích xuất tên NCC mà người dùng nhập nếu không khớp 5 NCC trên
        let candidateSup = '';
        const supMatch = cleanText.match(/(?:nhà cung cấp|ncc|từ ncc|từ|bên|cty|công ty)\s+([A-ZÀ-Ỹa-zà-ỹ0-9\s\-]+?)(?:(?:\s+sản phẩm|\s+vật tư|\s+số lượng|\s+gồm|\s+đặt|\s+mua|\s+nhập|$))/i);
        if (supMatch && supMatch[1].trim().length > 1) {
            candidateSup = supMatch[1].trim();
        }

        if (candidateSup) {
            // Lược bỏ các từ nối tiếng Việt như "là", "thành", "sang", "thay", "cho"
            candidateSup = candidateSup.replace(/^(?:là|thành|sang|thay|bằng|cho|từ|qua|vào|của)\s+/i, '').trim();
            const candNorm = removeVietnameseTones(candidateSup);
            const candCompacted = candNorm.replace(/[^a-z0-9]/g, '');

            // Thử kiểm tra lại tên đã làm sạch
            if (candNorm.includes('solar e') || candCompacted.includes('solare')) {
                const s = sRes.rows.find(r => removeVietnameseTones(r.name).includes('solar e'));
                if (s) return { found: true, supplierId: s.id, supplierName: s.name, supplierCode: s.supplier_code };
            }
            if (candNorm.includes('cergy') || candCompacted.includes('cergy') || candCompacted.includes('sergy')) {
                const s = sRes.rows.find(r => removeVietnameseTones(r.name).includes('cergy'));
                if (s) return { found: true, supplierId: s.id, supplierName: s.name, supplierCode: s.supplier_code };
            }
            if (candNorm.includes('tin trung') || candCompacted.includes('tintrung')) {
                const s = sRes.rows.find(r => removeVietnameseTones(r.name).includes('tin trung'));
                if (s) return { found: true, supplierId: s.id, supplierName: s.name, supplierCode: s.supplier_code };
            }
            if (candNorm.includes('hung viet hao') || candCompacted.includes('hungviethao') || candCompacted.includes('viethao')) {
                const s = sRes.rows.find(r => removeVietnameseTones(r.name).includes('hung viet hao'));
                if (s) return { found: true, supplierId: s.id, supplierName: s.name, supplierCode: s.supplier_code };
            }
            if (candNorm.includes('heropower') || candCompacted.includes('heropower')) {
                const s = sRes.rows.find(r => removeVietnameseTones(r.name).includes('heropower'));
                if (s) return { found: true, supplierId: s.id, supplierName: s.name, supplierCode: s.supplier_code };
            }

            if (candidateSup.length > 1) {
                return { found: false, notFoundInList: true, querySupplier: candidateSup };
            }
        }

        if (normCheck.includes('ncc') || normCheck.includes('nha cung cap')) {
            const words = normCheck.replace(/nha cung cap|ncc|tu|mua|dat|hang|sua lai|sua|doi|sang|thanh|la/g, '').trim();
            if (words.length > 2) {
                return { found: false, notFoundInList: true, querySupplier: words };
            }
        }

        return { found: false, missing: true };
    } catch (e) {
        console.warn('extractSupplier error:', e.message);
        return { found: false, missing: true };
    }
}

/**
 * =========================================================================
 * 4 STANDARDIZED AGENTIC TOOLS (SUNGO ERP AI COPILOT)
 * =========================================================================
 */

async function getActiveBusinessRules() {
    try {
        const res = await pool.query("SELECT rule_code, rule_name, rule_condition, rule_action FROM ai_business_rules WHERE is_active = TRUE ORDER BY id ASC");
        return res.rows;
    } catch (e) {
        return [];
    }
}

// TOOL 1: match_customer (Tìm kiếm khách hàng trong CRM sale-crm)
async function tool_match_customer(searchTerm, region = null) {
    let cleanTerm = (searchTerm || '').trim();
    cleanTerm = cleanTerm.replace(/^(?:cho\s+khách\s+hàng|cho\s+khách|khách\s+hàng|khách|đối\s+tác|cho\s+anh|cho\s+chị|cho\s+bác|cho\s+chú|anh|chị|bác|chú|em)\s+/i, '');
    cleanTerm = cleanTerm.replace(/\s+(?:nghe|nhen|nhé|nè|dùm|hộ|với|ạ)$/i, '').trim();

    if (region && !cleanTerm.toLowerCase().includes(region.toLowerCase())) {
        cleanTerm = `${cleanTerm} ${region}`;
    }

    const norm = removeVietnameseTones(cleanTerm);
    const custRes = await extractCustomer(cleanTerm, norm, null);
    if (custRes.found) {
        return {
            found: true,
            customer: {
                id: custRes.customerId,
                code: custRes.customerCode,
                name: custRes.customerName,
                phone: custRes.phone || '',
                company_name: custRes.company || ''
            },
            reason: 'MATCHED'
        };
    }
    return {
        found: false,
        customer: null,
        reason: custRes.notFoundInCRM ? 'NOT_FOUND_IN_CRM' : 'MISSING',
        suggestions: custRes.suggestions || []
    };
}

// TOOL 2: search_inventory_item (Tìm sản phẩm & Tra cứu tồn kho)
async function tool_search_inventory_item(query, category = null, capacityKw = null) {
    let cleanQuery = (query || '').trim();
    if (capacityKw && !cleanQuery.toLowerCase().includes(String(capacityKw).toLowerCase())) {
        cleanQuery = `${cleanQuery} ${capacityKw}kw`;
    }
    const norm = removeVietnameseTones(cleanQuery);

    const isPanel = /tam pin|panel|pv/i.test(norm) || category === 'PV_PANEL';
    const isBattery = /pin luu tru|pack pin|lithium|battery/i.test(norm) || category === 'BATTERY_PACK';

    const pRes = await findMatchingProduct(cleanQuery, norm, null);
    if (pRes.matched && pRes.product) {
        const prod = pRes.product;
        const pNameNorm = removeVietnameseTones(prod.product_name);

        // Chống gán nhầm linh kiện Cell 32140
        if ((isPanel || isBattery) && /cell pin|32140/i.test(pNameNorm)) {
            return {
                found: false,
                product: null,
                reason: 'CATEGORY_MISMATCH_FORBIDDEN_CELL',
                message: 'Không tìm thấy sản phẩm trọn bộ phù hợp (nghiêm cấm gán sang linh kiện Cell Pin 32140).'
            };
        }

        return {
            found: true,
            product: {
                id: prod.id,
                sku: prod.sku,
                product_name: prod.product_name,
                category: prod.category,
                stock_qty: parseInt(prod.stock_qty || 0, 10),
                retail_price: parseFloat(prod.retail_price || 0),
                import_price: parseFloat(prod.import_price || 0),
                unit: prod.unit || 'Bộ'
            },
            reason: 'MATCHED'
        };
    }

    if (pRes.outOfStockCapacity) {
        return {
            found: false,
            product: null,
            suggested: pRes.suggestedSpec,
            suggestedProduct: pRes.suggestedProduct,
            reason: 'OUT_OF_STOCK_CAPACITY',
            message: `Kho không có dòng ${pRes.requestedSpec}. Đề xuất dòng ${pRes.suggestedSpec} (${pRes.suggestedProduct.product_name}).`
        };
    }

    return {
        found: false,
        product: null,
        reason: 'NOT_FOUND',
        suggestions: pRes.suggestions || []
    };
}

// TOOL 3: mutate_sales_order_draft (Thao tác trên bản nháp đơn hàng)
async function tool_mutate_sales_order_draft(action, draftId = null, itemSku = null, quantity = null, customer = null, notes = null, context = {}) {
    const draft = context.active_so_draft || context.draft_order || {
        draft_id: draftId || ('SO_DRAFT_' + Date.now()),
        type: 'SALE',
        customer: null,
        items: [],
        total_value: 0,
        awaiting_slot: null
    };

    switch (action) {
        case 'UPDATE_QUANTITY': {
            if (!quantity || isNaN(quantity) || quantity <= 0) {
                draft.awaiting_slot = 'QUANTITY';
                context.current_flow = 'EDITING_SO';
                context.active_so_draft = draft;
                context.draft_order = draft;
                const targetProd = (draft.items && draft.items[0]) ? (draft.items[0].product_name || draft.items[0].name) : 'sản phẩm';
                const unit = (draft.items && draft.items[0]) ? (draft.items[0].unit || 'Bộ') : 'Bộ';
                return {
                    success: true,
                    awaiting_slot: 'QUANTITY',
                    message: `Dạ anh/chị muốn đổi số lượng của **${targetProd}** thành bao nhiêu ${unit} ạ?`,
                    quick_replies: ['1 bộ', '2 bộ', '5 bộ', '10 bộ', '20 bộ', 'Hủy đơn'],
                    active_so_draft: draft
                };
            }

            if (draft.items && draft.items.length > 0) {
                const targetItem = itemSku ? draft.items.find(it => it.sku === itemSku) : draft.items[0];
                if (targetItem) {
                    targetItem.quantity = Number(quantity);
                    targetItem.qty = Number(quantity);
                    targetItem.total_amount = targetItem.quantity * (targetItem.unit_price || targetItem.price || 0);
                    targetItem.total = targetItem.total_amount;
                    if ((targetItem.stock_qty || 0) < targetItem.quantity) {
                        targetItem.stock_warning = `Kho chỉ còn ${targetItem.stock_qty || 0} ${targetItem.unit || 'Bộ'} (đặt ${targetItem.quantity}, thiếu ${targetItem.quantity - (targetItem.stock_qty || 0)})`;
                    } else {
                        targetItem.stock_warning = null;
                    }
                }
            }
            draft.qty = Number(quantity);
            draft.total_value = (draft.items || []).reduce((sum, it) => sum + (it.total_amount || it.total || 0), 0);
            draft.totalAmount = draft.total_value;
            draft.awaiting_slot = 'CONFIRMATION';
            context.current_flow = 'EDITING_SO';
            context.active_so_draft = draft;
            context.draft_order = draft;

            return {
                success: true,
                message: `Đã cập nhật số lượng thành **${quantity}**. Tổng tiền đơn hàng: **${formatVND(draft.total_value)}**.`,
                active_so_draft: draft
            };
        }

        case 'UPDATE_CUSTOMER': {
            if (customer) {
                draft.customer = customer;
                draft.partner_name = customer.name;
                draft.partner_phone = customer.phone || '';
                draft.customer_id = customer.id;
                draft.customer_code = customer.code;
                draft.awaiting_slot = 'CONFIRMATION';
            }
            context.current_flow = 'EDITING_SO';
            context.active_so_draft = draft;
            context.draft_order = draft;
            return { success: true, active_so_draft: draft };
        }

        case 'CLEAR_DRAFT': {
            context.active_so_draft = null;
            context.draft_order = null;
            context.current_flow = 'IDLE';
            return {
                success: true,
                message: 'Dạ đã hủy bản nháp đơn hàng.',
                active_so_draft: null
            };
        }

        default:
            return { success: false, message: `Hành động ${action} chưa hỗ trợ.` };
    }
}

// TOOL 4: fetch_technical_datasheet (Tra cứu tài liệu kỹ thuật chuẩn)
async function tool_fetch_technical_datasheet(query, category = null) {
    const cleanQuery = (query || '').trim();
    const norm = removeVietnameseTones(cleanQuery);

    const pRes = await pool.query(`
        SELECT id, sku, product_name, category, description, retail_price, 
               image_url, doc_datasheet, doc_catalog, doc_cocq, doc_manual, unit
        FROM products 
        ORDER BY id DESC
    `);

    let matched = null;
    for (const p of pRes.rows) {
        const pNorm = removeVietnameseTones(p.product_name + ' ' + p.sku);
        if (norm.includes(pNorm) || (p.sku && norm.includes(removeVietnameseTones(p.sku)))) {
            matched = p;
            break;
        }
    }

    const isPanelReq = /tam pin|panel|pv\b/i.test(norm);
    const isInverterReq = /bien tan|inverter|hybrid/i.test(norm);
    const isBatteryReq = /pin luu tru|pack pin|lithium|battery/i.test(norm);

    if (!matched) {
        const brands = ['canadian', 'deye', 'growatt', 'jinko', 'gigabox', 'sungrow', 'longi', 'luxpower', 'apess', 'solis', 'xpower', 'voltique'];
        for (const b of brands) {
            if (norm.includes(b)) {
                matched = pRes.rows.find(p => {
                    const pNorm = removeVietnameseTones(p.product_name + ' ' + p.sku);
                    if (!pNorm.includes(b)) return false;
                    if (isPanelReq && (/bien tan|inverter|cell pin|32140/i.test(pNorm))) return false;
                    if (isInverterReq && (/tam pin|mat kinh|cell pin|32140/i.test(pNorm))) return false;
                    if (isBatteryReq && (/cell pin|32140|bien tan|inverter/i.test(pNorm))) return false;
                    return true;
                });
                if (matched) break;
            }
        }
    }

    // Nếu không tìm thấy: BẮT BUỘC BÁO KHÔNG CÓ, CẤM NÉM BỪA SẢN PHẨM KHÁC
    if (!matched) {
        return {
            found: false,
            message: `Dạ hiện tại kho dữ liệu chưa có Datasheet/Catalog của thiết bị "${cleanQuery}".\n\n📌 Hiện SUNGO có sẵn hồ sơ kỹ thuật của các dòng chính: **Canadian Solar, Jinko Solar, Longi, Deye, Apess, Solis**.\nAnh/Chị có muốn xem tài liệu của các dòng này không?`,
            reason: 'NOT_FOUND_OR_LOW_CONFIDENCE'
        };
    }

    // Nghiêm cấm trả về Cell 32140 khi tìm tấm pin hoặc inverter
    const isPanelOrInverter = /tam pin|panel|bien tan|inverter/i.test(norm);
    if (isPanelOrInverter && /cell pin|32140/i.test(matched.product_name)) {
        return {
            found: false,
            message: `Không tìm thấy tài liệu phù hợp cho thiết bị yêu cầu (nghiêm cấm trả về tài liệu của Cell Pin 32140).`,
            reason: 'CATEGORY_MISMATCH'
        };
    }

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
        found: true,
        product: matched,
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
        quick_replies: ['Kiểm tra tồn kho sản phẩm này', 'Tạo báo giá cho khách']
    };
}

function extractDeliveryNotes(text) {
    const m = text.match(/(?:giao trước|giao vào|giao ngay|giao hỏa tốc|ghi chú|lưu ý|hẹn giao|giao hàng trước|giao truoc|giao vao|giao hoa toc|ghi chu|luu y|hen giao)\s+([^,.;]+)/i);
    if (m) {
        return {
            notes: m[0].trim(),
            cleanText: text.replace(m[0], ' ').trim()
        };
    }
    return { notes: '', cleanText: text };
}

async function parseOrderItems(text, context, custTokens = [], isPurchase = false) {
    let preprocessed = text.replace(/\bapec\b/gi, 'apess');
    const rawSegments = preprocessed.split(/\s+(?:với|và|kèm theo|kèm|cộng|\+|voi|va|kem|cong)\s+|,\s*(?=\d+\s*(?:tấm|bộ|cái|chiếc|biến tần|inverter|pin|pack|cục|thùng))/i);
    const parsedItems = [];

    for (const seg of rawSegments) {
        const segTrim = seg.trim().replace(/^[,.\s]+|[,.\s]+$/g, '');
        if (!segTrim || segTrim.length < 2) continue;
        const qty = extractQuantity(segTrim);
        const segExclude = [...custTokens];
        if (qty > 1) segExclude.push(String(qty));

        const pRes = await findMatchingProduct(segTrim, removeVietnameseTones(segTrim), context, segExclude);
        let p = null;
        let disambigNotice = null;

        if (pRes && pRes.outOfStockCapacity) {
            return {
                items: [],
                disambiguations: [],
                outOfStockCapacity: true,
                requestedSpec: pRes.requestedSpec,
                suggestedSpec: pRes.suggestedSpec,
                suggestedProduct: pRes.suggestedProduct
            };
        }

        if (pRes && pRes.ambiguous) {
            p = pRes.candidates[0];
            disambigNotice = `Nhiều dòng phù hợp: Tạm chọn ${pRes.candidates[0].product_name} (hoặc ${pRes.candidates[1].product_name})`;
        } else if (pRes && pRes.matched && pRes.product) {
            p = pRes.product;
        }

        if (p) {
            const unitPrice = isPurchase 
                ? (parseFloat(p.import_price || p.cost_price || p.retail_price * 0.8) || 0) 
                : (parseFloat(p.retail_price) || 0);
            const total = unitPrice * qty;

            let stockWarning = null;
            if (!isPurchase && qty > (parseFloat(p.stock_qty) || 0)) {
                stockWarning = `Kho chỉ còn ${p.stock_qty || 0} ${p.unit || 'Bộ'} (đặt ${qty}, thiếu ${qty - (parseFloat(p.stock_qty) || 0)})`;
            }

            let priceWarning = null;
            if (!isPurchase && p.cost_price && unitPrice < parseFloat(p.cost_price)) {
                priceWarning = `Giá bán ${formatVND(unitPrice)} thấp hơn giá vốn (${formatVND(p.cost_price)})`;
            }

            parsedItems.push({
                product: p,
                id: p.id,
                name: p.product_name,
                sku: p.sku || '',
                qty: qty,
                unit: (p.unit && !/^\d+$/.test(p.unit)) ? p.unit : 'Bộ',
                price: unitPrice,
                total: total,
                stock_warning: stockWarning,
                price_warning: priceWarning,
                disambig_notice: disambigNotice
            });
        }
    }

    return { items: parsedItems, disambiguations: [] };
}

// TẠO BẢN XEM TRƯỚC BẢN NHÁP (NGẮN GỌN, SÚC TÍCH, ĐA SẢN PHẨM & CẢNH BÁO NGHIỆP VỤ)
function buildDraftPreviewResponse(draft) {
    const isSale = draft.type === 'SALE';
    const partnerLabel = isSale ? 'Khách hàng' : 'Nhà cung cấp';

    let items = draft.items || [];
    if (items.length === 0 && draft.product) {
        items = [{
            product: draft.product,
            id: draft.product.id,
            name: draft.product.product_name,
            sku: draft.product.sku || '',
            qty: draft.qty,
            unit: (draft.product.unit && !/^\d+$/.test(draft.product.unit)) ? draft.product.unit : 'Bộ',
            price: draft.unitPrice,
            total: draft.totalAmount,
            stock_warning: draft.stock_warning,
            price_warning: draft.price_warning
        }];
        draft.items = items;
    }

    const partnerDisplay = isSale
        ? `**${draft.partner_name}** (${draft.customer_code ? '`' + draft.customer_code + '` - CRM' : 'CRM'}${draft.partner_phone ? ' | SĐT: ' + draft.partner_phone : ''})`
        : `**${draft.partner_name}** (${draft.supplier_code ? '`' + draft.supplier_code + '`' : 'NCC'})`;

    let itemsSummaryText = '';
    let warnings = [];

    items.forEach((it, idx) => {
        const u = it.unit || (it.product && it.product.unit) || 'Bộ';
        const pName = it.name || (it.product && it.product.product_name) || 'Thiết bị';
        const pSku = it.sku || (it.product && it.product.sku) || '';
        itemsSummaryText += `• Hàng ${items.length > 1 ? (idx + 1) + ': ' : ''}**${pName}** (\`${pSku}\`)\n  SL: **${it.qty} ${u}** x **${formatVND(it.price)}** = **${formatVND(it.total)}**\n`;

        if (it.stock_warning) warnings.push(`⚠️ ${it.stock_warning}`);
        if (it.price_warning) warnings.push(`⚠️ ${it.price_warning}`);
    });

    if (draft.compat_warning) {
        warnings.push(draft.compat_warning);
    }

    const warningsText = warnings.length > 0 ? `\n${warnings.join('\n')}\n` : '';
    const notesText = draft.notes ? `\n• Ghi chú: ${draft.notes}\n` : '';

    const cardItems = items.map(it => ({
        name: it.name || (it.product && it.product.product_name) || 'Thiết bị',
        sku: it.sku || (it.product && it.product.sku) || '',
        qty: it.qty || 1,
        unit: it.unit || (it.product && it.product.unit) || 'Bộ',
        price: formatVND(it.price || (it.product && it.product.retail_price) || 0),
        total: formatVND(it.total || ((it.qty || 1) * (it.price || 0))),
        stock_warning: it.stock_warning,
        price_warning: it.price_warning
    }));

    return {
        text: `📋 **Xác nhận ${isSale ? 'Đơn Bán (SO)' : 'Phiếu Mua (PO)'}:**\n• ${partnerLabel}: ${partnerDisplay}\n${itemsSummaryText}• **Tổng cộng đơn hàng:** **${formatVND(draft.totalAmount)}**${notesText}${warningsText}👉 Đúng thông tin chưa anh/chị? Cần sửa gì hay **Tạo đơn ngay**?`,
        card: {
            type: 'DRAFT_ORDER_CARD',
            order_type: draft.type,
            title: `Bản Nháp ${isSale ? 'Đơn Bán' : 'Phiếu Mua'}`,
            partner_name: draft.partner_name,
            customer_code: draft.customer_code,
            items: cardItems,
            total_amount: formatVND(draft.totalAmount),
            notes: draft.notes || '',
            warnings: warnings,
            compat_warning: draft.compat_warning
        },
        action_type: 'DRAFT_ORDER_PREVIEW',
        quick_replies: ['Tạo đơn ngay', 'Sửa số lượng', 'Đổi khách hàng', 'Hủy đơn']
    };
}

// KIỂM TRA TƯƠNG THÍCH KỸ THUẬT SOLAR: INVERTER <-> BATTERY <-> PV PANELS (PILLAR V)
function checkTechnicalCompatibility(items) {
    let compatWarning = null;
    let techTip = null;
    let accessoryTip = null;
    if (!items || items.length === 0) return { compatWarning, techTip, accessoryTip };

    const invItems = items.filter(it => /bien tan|inverter|hybrid/i.test(removeVietnameseTones(it.name || (it.product && it.product.product_name) || '')));
    const batItems = items.filter(it => /pin|apess|lithium|kwh|lifepo4/i.test(removeVietnameseTones(it.name || (it.product && it.product.product_name) || '')));
    const panelItems = items.filter(it => /tam pin|panel|canadian|jinko|longi/i.test(removeVietnameseTones(it.name || (it.product && it.product.product_name) || '')));

    // 1. Tương thích Inverter <-> Pin lưu trữ (Điện áp LV vs HV, C-rate, Phụ kiện)
    if (invItems.length > 0 && batItems.length > 0) {
        const inv = invItems[0];
        const bat = batItems[0];
        const invName = (inv.name || (inv.product && inv.product.product_name) || '');
        const batName = (bat.name || (bat.product && bat.product.product_name) || '');
        const invNorm = removeVietnameseTones(invName).toLowerCase();
        const batNorm = removeVietnameseTones(batName).toLowerCase();

        // 1.1 Cấp điện áp Biến tần 24V vs Pin 48V
        if (/24v/i.test(invNorm) && /48v|51\.2v|15\.3kwh|16kwh|14\.3kwh/i.test(batNorm)) {
            compatWarning = `⚠️ Cảnh báo tương thích: Biến tần hệ 24V không đồng bộ trực tiếp với Pack pin hệ 48V/15kWh.`;
        }
        // 1.2 Biến tần 3 pha High-Voltage (HV) vs Pin điện áp thấp LV (48V/51.2V)
        else if ((/hv\b|high\s*voltage|cao ap|3\s*pha|3phase/i.test(invNorm) && !/lv|low voltage/i.test(invNorm)) &&
                 /48v|51\.2v|5[.,]12|15[.,]3|14[.,]3|treo tuong|wall mounted/i.test(batNorm)) {
            compatWarning = `⚠️ CẢNH BÁO TƯƠNG THÍCH ĐIỆN ÁP: Biến tần High-Voltage (HV 3 pha) không kết nối trực tiếp với Pack pin điện áp thấp LV (48V/51.2V)! Cần sử dụng pin lưu trữ Cao Áp (HV Battery Tower 160V-600V).`;
        }

        // 1.3 Khuyến nghị tỷ lệ dung lượng xả C-rate
        const invSpecs = extractSpecs(invNorm);
        const invKW = (invSpecs.find(s => s.unit === 'kw') || {}).val || 12;
        const batSpecs = extractSpecs(batNorm);
        const batKWh = (batSpecs.find(s => s.unit === 'kwh') || {}).val || ((batSpecs.find(s => s.unit === 'kw') || {}).val || 5.12);
        const totalBatKWh = batKWh * (bat.qty || 1);

        if (invKW >= 8 && totalBatKWh < 10) {
            techTip = `💡 Khuyến nghị dung lượng: Biến tần ${invKW}kW nên kết hợp pack pin tối thiểu 10kWh - 15kWh để đảm bảo công suất xả liên tục an toàn cho BMS khi mất điện lưới.`;
        }

        // 1.4 Gợi ý phụ kiện kết nối
        accessoryTip = `💡 Phụ kiện đi kèm: Đơn có Biến tần & Pin lưu trữ — kiểm tra bổ sung Cáp nguồn DC (25-35mm²), Cầu chì DC/Aptomat DC 125A-200A và Jack MC4 nếu công trình chưa có sẵn.`;
    }

    // 2. Tương thích Tấm pin PV <-> Biến tần (Tỷ lệ DC/AC)
    if (panelItems.length > 0 && invItems.length > 0) {
        let totalPanelW = 0;
        for (const pit of panelItems) {
            const pSpec = extractSpecs(pit.name || (pit.product && pit.product.product_name) || '');
            const pWatt = (pSpec.find(s => s.unit === 'w') || {}).val || (pSpec.find(s => s.unit === 'kw') ? pSpec.find(s => s.unit === 'kw').val * 1000 : 600);
            totalPanelW += pWatt * (pit.qty || 1);
        }
        let totalInvKW = 0;
        for (const iit of invItems) {
            const iSpec = extractSpecs(iit.name || (iit.product && iit.product.product_name) || '');
            const iKW = (iSpec.find(s => s.unit === 'kw') || {}).val || 6;
            totalInvKW += iKW * (iit.qty || 1);
        }
        if (totalInvKW > 0 && totalPanelW > 0) {
            const dcAcRatio = (totalPanelW / (totalInvKW * 1000)).toFixed(2);
            if (dcAcRatio < 0.9) {
                techTip = `💡 Lưu ý kỹ thuật: Tổng công suất pin (${(totalPanelW/1000).toFixed(1)}kWp) khá thấp so với biến tần (${totalInvKW}kW) - Tỷ lệ DC/AC: ${dcAcRatio} (Khuyến nghị chuẩn: 1.15 - 1.35).`;
            } else if (dcAcRatio > 1.45) {
                techTip = `💡 Lưu ý kỹ thuật: Tỷ lệ quá tải DC/AC là ${dcAcRatio} (${(totalPanelW/1000).toFixed(1)}kWp / ${totalInvKW}kW) - Cần kiểm tra dải MPPT của biến tần.`;
            }
        }
    }

    return { compatWarning, techTip, accessoryTip };
}

// 1. TẠO ĐƠN HÀNG BÁN NHANH (SO - SALES ORDER)
async function handleCreateOrder(text, context, user) {
    const cleanText = text.trim();
    const norm = removeVietnameseTones(cleanText);

    // 0. Bóc tách ghi chú giao hàng nếu có (ví dụ: giao trước thứ 6)
    const deliveryInfo = extractDeliveryNotes(cleanText);
    const textForProcessing = deliveryInfo.cleanText;

    // 1. Trích xuất khách hàng CRM (BẮT BUỘC TRONG CRM SALE-CRM) TRƯỚC
    const custRes = await extractCustomer(textForProcessing, norm, context);
    if (custRes.notFoundInCRM) {
        return {
            text: `Em tìm trong CRM (sale-crm) chưa thấy khách hàng "${custRes.queryCustomer}". Anh/Chị cho em xin Số điện thoại để em tạo hồ sơ khách hàng mới ngay nhé!`,
            card: null,
            action_type: 'CUSTOMER_NOT_FOUND_CRM',
            quick_replies: ['Nhập SĐT khách', 'Khách Hoàng Gia', 'Khách Võ Anh Phong', 'Hủy đơn']
        };
    }

    // Lấy các token của khách hàng để loại trừ khỏi tìm kiếm sản phẩm (tránh từ như "anh", "phong", "vo" gây sai lệch)
    let custTokens = [];
    if (custRes.found) {
        const cStr = `${custRes.customerName || ''} ${custRes.nickname || ''} ${custRes.company || ''}`;
        custTokens = removeVietnameseTones(cStr).split(/[^a-z0-9]+/i).filter(Boolean);
    } else if (custRes.queryCustomer) {
        custTokens = removeVietnameseTones(custRes.queryCustomer).split(/[^a-z0-9]+/i).filter(Boolean);
    }

    // Loại bỏ tên khách hàng khỏi câu lệnh tìm sản phẩm
    let textForItems = textForProcessing;
    if (custRes.found && custRes.customerName) {
        const custWords = custRes.customerName.toLowerCase().split(/\s+/);
        for (const w of custWords) {
            if (w.length >= 2) {
                textForItems = textForItems.replace(new RegExp(`\\b${w}\\b`, 'gi'), ' ');
            }
        }
    }
    textForItems = textForItems.replace(/(?:cho khách|khách hàng|khách|đối tác|cho anh|cho chị|cho bác|cho chú|tạo đơn bán cho|tạo đơn cho|tạo đơn bán|lên đơn bán|tạo đơn|lên đơn|bán cho)\s*/gi, ' ').trim();

    // 2. Phân tích đa sản phẩm (Multi-entity extraction)
    const parseRes = await parseOrderItems(textForItems, context, custTokens, false);

    // BẮT LỖI SAI LỆCH THÔNG SỐ (ZERO-TOLERANCE MISMATCH)
    if (parseRes.outOfStockCapacity) {
        return {
            text: `⚠️ Kho hiện không có sản phẩm công suất **${parseRes.requestedSpec}** theo yêu cầu.\n\n💡 Gợi ý dòng máy hiện có sẵn trong kho: **${parseRes.suggestedProduct.product_name}** (công suất ${parseRes.suggestedSpec}, mã \`${parseRes.suggestedProduct.sku}\`).\n\n👉 Anh/Chị có muốn đổi sang dòng này không hay kiểm tra sản phẩm khác?`,
            card: null,
            action_type: 'ORDER_OUT_OF_STOCK_CAPACITY',
            quick_replies: [`Lấy ${parseRes.suggestedProduct.product_name}`, 'Kiểm tra tồn kho', 'Hủy đơn']
        };
    }

    const { items, disambiguations } = parseRes;

    if (disambiguations.length > 0 && items.length === 0) {
        const cands = disambiguations[0].candidates;
        return {
            text: `Dạ bên mình có các dòng: **${cands[0].product_name}** (\`${cands[0].sku}\`) và **${cands[1].product_name}** (\`${cands[1].sku}\`). Anh/Chị muốn lấy loại nào ạ?`,
            card: null,
            action_type: 'ORDER_NEED_DISAMBIGUATION',
            quick_replies: [cands[0].product_name, cands[1].product_name, 'Hủy đơn']
        };
    }

    if (items.length === 0) {
        return {
            text: `⚠️ Chưa rõ sản phẩm cần bán. Cho em xin tên hoặc mã SKU sản phẩm có trong kho nhé!`,
            card: null,
            action_type: 'ORDER_NEED_INFO',
            quick_replies: ['10 tấm pin Canadian 600W', '1 biến tần Deye 12kW', 'Hủy đơn']
        };
    }

    const totalAmount = items.reduce((acc, it) => acc + it.total, 0);

    // 1. Kiểm tra tương thích kỹ thuật Solar (Inverter <-> Pin <-> Tấm PV, LV vs HV, C-rate, Phụ kiện)
    const { compatWarning, techTip, accessoryTip } = checkTechnicalCompatibility(items);

    // 2. Cảnh báo vi phạm giá sàn (Floor Price Guardrail - Pillar V)
    let floorPriceWarning = null;
    for (const it of items) {
        const p = it.product;
        if (p && p.import_price && it.price < Number(p.import_price)) {
            floorPriceWarning = `⚠️ CẢNH BÁO GIÁ SÀN: "${it.name}" giá bán ${formatVND(it.price)} thấp hơn giá vốn (${formatVND(p.import_price)})!`;
            it.price_warning = `Giá bán < Giá vốn (${formatVND(p.import_price)})`;
            break;
        }
    }

    // 3. Kiểm tra hạn mức công nợ khách hàng (Debt Ceiling Check - Pillar V)
    let debtWarning = null;
    if (custRes.customerId) {
        try {
            const cDebtRes = await pool.query('SELECT current_debt, debt_limit FROM customers WHERE id = $1', [custRes.customerId]);
            if (cDebtRes.rows.length > 0) {
                const curDebt = Number(cDebtRes.rows[0].current_debt) || 0;
                const dLimit = Number(cDebtRes.rows[0].debt_limit) || 0;
                if (curDebt > 0 && dLimit > 0 && (curDebt + totalAmount > dLimit)) {
                    debtWarning = `⚠️ CẢNH BÁO CÔNG NỢ 131: Khách đang nợ ${formatVND(curDebt)}. Đơn mới (${formatVND(totalAmount)}) vượt hạn mức nợ (${formatVND(dLimit)})!`;
                } else if (curDebt > 0) {
                    debtWarning = `📌 Lưu ý công nợ 131: Khách hàng hiện đang có dư nợ ${formatVND(curDebt)}.`;
                }
            }
        } catch (e) {}
    }

    // 4. Kiểm tra tồn kho khả dụng (Available-to-Promise ATP - Pillar IV)
    let atpWarning = null;
    for (const it of items) {
        if (it.product && it.product.id) {
            try {
                const reservedRes = await pool.query(
                    `SELECT COALESCE(SUM(oi.quantity), 0) as reserved
                     FROM order_items oi
                     JOIN orders o ON oi.order_id = o.id
                     WHERE oi.product_id = $1 AND o.status IN ('PENDING', 'PROCESSING', 'CHO_XAC_NHAN')`,
                    [it.product.id]
                );
                const reserved = Number(reservedRes.rows[0].reserved) || 0;
                const stock = Number(it.product.stock_qty) || 0;
                const atp = Math.max(0, stock - reserved);
                it.atp = atp;
                it.reserved = reserved;
                if (it.qty > atp) {
                    atpWarning = `⚠️ TỒN KHO KHẢ DỤNG (ATP): "${it.name}" đặt ${it.qty}, khả dụng: ${atp} (tồn thực tế: ${stock}, đã giữ chỗ: ${reserved}).`;
                    it.stock_warning = `Khả dụng: ${atp}/${stock} (đã giữ ${reserved})`;
                }
            } catch (e) {}
        }
    }

    const allDraftWarnings = [compatWarning, floorPriceWarning, debtWarning, atpWarning, techTip, accessoryTip].filter(Boolean);

    if (custRes.missing || !custRes.customerId) {
        let lastCustMsg = '';
        let qr = ['Khách Võ Anh Phong', 'Khách Hoàng Gia', 'Khách Anh Nam Kiên Giang', 'Hủy đơn'];
        if (context.active_customer || context.last_customer) {
            const lc = context.active_customer || context.last_customer;
            lastCustMsg = `\n\n💡 *Lần gần nhất anh/chị tạo đơn cho **${lc.name || lc.customer}**. Anh/chị có muốn lên đơn cho khách này không?*`;
            qr = [`Khách ${lc.name || lc.customer}`, ...qr];
        }

        context.draft_order = {
            type: 'SALE',
            status: 'NEED_CUSTOMER',
            partner_name: null,
            partner_phone: '',
            customer_id: null,
            customer_code: null,
            items: items,
            product: items[0].product,
            qty: items[0].qty,
            unitPrice: items[0].price,
            totalAmount: totalAmount,
            notes: deliveryInfo.notes || '',
            warnings: allDraftWarnings,
            compat_warning: compatWarning
        };
        return {
            text: `Đã chọn: **${items.map(it => `${it.qty} ${it.name}`).join(' + ')}** (${formatVND(totalAmount)}).\n\n⚠️ Cho em xin Tên khách hàng, Tên gợi nhớ hoặc SĐT có trên CRM để lên đơn nhé!${lastCustMsg}`,
            card: null,
            action_type: 'ORDER_NEED_CUSTOMER',
            quick_replies: qr
        };
    }

    // ĐÃ ĐỦ CẢ KHÁCH HÀNG CRM VÀ SẢN PHẨM TRONG KHO -> TẠO BẢN XEM TRƯỚC
    context.draft_order = {
        type: 'SALE',
        status: 'AWAITING_CONFIRMATION',
        partner_name: custRes.customerName,
        partner_phone: custRes.phone || '',
        customer_id: custRes.customerId,
        customer_code: custRes.customerCode,
        items: items,
        product: items[0].product,
        qty: items[0].qty,
        unitPrice: items[0].price,
        totalAmount: totalAmount,
        notes: deliveryInfo.notes || '',
        warnings: allDraftWarnings,
        compat_warning: compatWarning,
        floor_price_warning: floorPriceWarning,
        debt_warning: debtWarning,
        atp_warning: atpWarning,
        tech_tip: techTip
    };

    return buildDraftPreviewResponse(context.draft_order);
}

// XÁC NHẬN TẠO ĐƠN CHÍNH THỨC (CONFIRM DRAFT ORDER)
async function handleConfirmDraftOrder(text, context, user) {
    const draft = context.draft_order;
    if (!draft) {
        return {
            text: `Dạ không có bản nháp nào đang chờ xử lý. Anh/Chị muốn tạo đơn bán hay lập phiếu mua hàng ạ?`,
            card: null,
            action_type: 'NO_ACTIVE_DRAFT',
            quick_replies: ['Tạo đơn hàng bán', 'Lập phiếu mua từ NCC']
        };
    }

    const items = (draft.items && draft.items.length > 0) ? draft.items : (draft.product ? [{ product: draft.product, qty: draft.qty, price: draft.unitPrice, total: draft.totalAmount }] : []);

    if (items.length === 0) {
        return {
            text: `⚠️ Bản nháp chưa có sản phẩm. Cho em biết tên thiết bị và số lượng nhé!`,
            card: null,
            action_type: 'DRAFT_MISSING_INFO',
            quick_replies: ['10 tấm pin Canadian 600W', 'Hủy đơn']
        };
    }

    if (!draft.partner_name) {
        const pLabel = draft.type === 'SALE' ? 'Khách hàng CRM' : 'Nhà cung cấp';
        return {
            text: `⚠️ Bản nháp chưa có thông tin ${pLabel}. Cho em xin tên ${pLabel} trước khi tạo nhé!`,
            card: null,
            action_type: 'DRAFT_MISSING_INFO',
            quick_replies: draft.type === 'SALE' ? ['Khách Võ Anh Phong', 'Khách Bin Bụng Bự'] : ['Công ty Solar E', 'Công ty Cergy']
        };
    }

    // KHÓA THAO TÁC TRÙNG LẶP (IDEMPOTENCY KEY - TRỤ CỘT III - 17)
    const idempotencyKey = `idemp_${draft.type}_${draft.customer_id || draft.partner_name}_${items.map(i => ((i.product && i.product.id) || i.id || '') + ':' + (i.qty || 1)).sort().join('_')}`;
    if (context.last_confirmed_idempotency_key === idempotencyKey && context.last_confirmed_order && (Date.now() - (context.last_confirmed_time || 0)) < 45000) {
        return {
            text: `⚡ Đơn hàng đã được tạo thành công trước đó (bảo vệ chống bấm đúp tạo 2 đơn). Mã đơn: **[${context.last_confirmed_order.code}]**.`,
            card: context.last_confirmed_order.card,
            action_type: 'ORDER_ALREADY_CONFIRMED',
            quick_replies: ['Xem chi tiết đơn', 'In báo giá / Hợp đồng', 'Tạo đơn mới']
        };
    }

    // GHI VÀO CSDL KHI ĐƯỢC XÁC NHẬN (SINGLE SOURCE OF TRUTH - TRỤ CỘT III - 13)
    if (draft.type === 'SALE') {
        const orderCode = 'DH-' + Date.now().toString().slice(-6) + Math.floor(1000 + Math.random() * 9000);
        let empId = null;
        if (user && user.id) {
            try {
                const empRes = await pool.query('SELECT id FROM employees WHERE user_id = $1 LIMIT 1', [user.id]);
                if (empRes.rows.length > 0) empId = empRes.rows[0].id;
            } catch (e) {}
        }

        let costOfGoods = 0;
        for (const it of items) {
            const p = it.product || draft.product;
            const imp = Number(p && p.import_price) || 0;
            costOfGoods += imp * (it.qty || draft.qty || 1);
        }
        const grossProfit = Math.max(0, draft.totalAmount - costOfGoods);

        const insertOrderRes = await pool.query(`
            INSERT INTO orders (
                order_code, customer_id, customer_name, customer_phone, total_amount, paid_amount, 
                status, payment_method, employee_id, notes, cost_of_goods, gross_profit
            ) VALUES ($1, $2, $3, $4, $5, 0, 'PENDING', 'TIEN_MAT', $6, $7, $8, $9)
            RETURNING *
        `, [orderCode, draft.customer_id, draft.partner_name, draft.partner_phone || '', draft.totalAmount, empId, draft.notes || `Tạo qua Trợ lý Google AI bởi ${user.full_name || 'Người dùng'}`, costOfGoods, grossProfit]);

        const orderId = insertOrderRes.rows[0].id;

        for (const it of items) {
            const p = it.product || draft.product;
            const q = it.qty || draft.qty;
            const pr = it.price || draft.unitPrice;
            const tot = it.total || draft.totalAmount;
            await pool.query(`
                INSERT INTO order_items (order_id, product_id, quantity, price, total, sku, product_name)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [orderId, p.id, q, pr, tot, p.sku || '', p.product_name]);
        }

        context.active_customer = { id: draft.customer_id, name: draft.partner_name, phone: draft.partner_phone, customer_code: draft.customer_code };
        context.last_customer = context.active_customer;
        context.active_product = items[0].product;
        context.last_order = { id: orderId, code: orderCode, total: draft.totalAmount, customer: draft.partner_name };
        context.draft_order = null;

        const cardItems = items.map(it => ({
            name: it.name || it.product.product_name,
            sku: it.sku || it.product.sku,
            qty: it.qty,
            price: formatVND(it.price),
            total: formatVND(it.total)
        }));

        const orderCard = {
            type: 'ORDER_CARD',
            title: `Đơn Bán: ${orderCode}`,
            status: 'Chờ Xử Lý (PENDING)',
            customer: draft.partner_name,
            phone: draft.partner_phone || 'Chưa cập nhật',
            items: cardItems,
            total_amount: formatVND(draft.totalAmount),
            link: 'modules/order-history.html'
        };

        context.last_confirmed_idempotency_key = idempotencyKey;
        context.last_confirmed_time = Date.now();
        context.last_confirmed_order = { code: orderCode, card: orderCard };

        return {
            text: `🎉 **ĐÃ TẠO ĐƠN BÁN [${orderCode}]!**\nKhách: **${draft.partner_name}** (${draft.customer_code ? '`' + draft.customer_code + '` - CRM' : 'CRM'})\nTổng tiền: **${formatVND(draft.totalAmount)}** | Trạng thái: **Chờ Xử Lý**.`,
            card: orderCard,
            action_type: 'ORDER_CREATED',
            quick_replies: ['Xem chi tiết đơn', 'In báo giá / Hợp đồng', 'Gửi Zalo cho khách', 'Tạo đơn mới']
        };
    } else {
        const poCode = 'PO-' + Date.now().toString().slice(-6);
        const poItems = items.map(it => {
            const p = it.product || draft.product;
            return {
                id: p.id,
                name: p.product_name,
                sku: p.sku || '',
                quantity: it.qty || draft.qty,
                price: it.price || draft.unitPrice,
                amount: it.total || draft.totalAmount,
                unit: it.unit || p.unit || 'Bộ'
            };
        });

        const insRes = await pool.query(`
            INSERT INTO purchases (po_code, supplier_id, supplier_name, note, status, items, total_amount)
            VALUES ($1, $2, $3, $4, 'Chờ Duyệt', $5, $6)
            RETURNING *
        `, [poCode, draft.supplier_id, draft.partner_name, draft.notes || `Lập qua Trợ lý Google AI bởi ${user.full_name || 'Người dùng'}`, JSON.stringify(poItems), draft.totalAmount]);

        context.last_purchase = { id: insRes.rows[0].id, code: poCode, total: draft.totalAmount, supplier: draft.partner_name };
        context.active_product = items[0].product;
        context.draft_order = null;

        return {
            text: `🎉 **ĐÃ LẬP PHIẾU MUA [${poCode}]!**\nNCC: **${draft.partner_name}** (${draft.supplier_code ? '`' + draft.supplier_code + '`' : 'NCC'})\nTổng tiền: **${formatVND(draft.totalAmount)}** | Trạng thái: **Chờ Duyệt**.`,
            card: {
                type: 'PURCHASE_CARD',
                title: `Phiếu Mua: ${poCode}`,
                supplier: draft.partner_name,
                quantity: items.map(it => `${it.qty} ${it.unit}`).join(', '),
                total_cost: formatVND(draft.totalAmount),
                status: 'Chờ Duyệt (PENDING)',
                link: 'modules/purchases.html'
            },
            action_type: 'PURCHASE_CREATED',
            quick_replies: ['Xem danh sách đơn mua', 'Kiểm tra tồn kho', 'Lập phiếu mua mới']
        };
    }
}

// HỦY BỎ BẢN NHÁP (CANCEL DRAFT ORDER)
function handleCancelDraftOrder(text, context, user) {
    const hadDraft = !!context.draft_order;
    context.draft_order = null;
    return {
        text: hadDraft ? `Dạ đã hủy bản nháp đơn hàng.` : `Hiện không có bản nháp nào đang mở.`,
        card: null,
        action_type: 'DRAFT_ORDER_CANCELLED',
        quick_replies: ['Tạo đơn hàng bán', 'Lập phiếu mua hàng', 'Kiểm tra tồn kho']
    };
}

// CHỈNH SỬA / BỔ SUNG BẢN NHÁP (UPDATE DRAFT ORDER)
async function handleUpdateDraftOrder(text, context, user) {
    const draft = context.draft_order;
    if (!draft) {
        return handleCreateOrder(text, context, user);
    }
    const cleanText = text.trim();
    const norm = removeVietnameseTones(cleanText).replace(/\b(?:dit me|dcm|dm|vcl|clgt|oc cho|ngu|me kiep|chac lac)\b/g, '').trim();

    // 0. BẢO VỆ PHẢN HỒI KHIẾU NẠI / CHỈ TRÍCH NHẦM LẪN (META-CORRECTION DEFENSE)
    // Khi người dùng bực dọc phản ánh bot sửa nhầm khách hàng thay vì sản phẩm
    const isMetaComplaint = /(?:cap\s+nhat|sua|doi)\s+san\s+pham\s+chu(?:\s+cap\s+nhat|\s+khong\s+phai|\s+chu|\s+khong|\s+sao|\s+lai)?\s+(?:ten\s+)?(?:khach|khach\s+hang)/i.test(norm) ||
                           /(?:khong\s+phai|sao\s+lai|nham|lon)\s+(?:khach|khach\s+hang|ten)/i.test(norm);
    if (isMetaComplaint) {
        return {
            text: `Dạ em xin lỗi anh/chị vì đã hiểu nhầm sang tên khách hàng! 🙏\n\nKhách hàng hiện tại vẫn giữ nguyên là **${draft.partner_name || 'Chưa chọn'}**.\n\nAnh/Chị muốn đổi sang thiết bị nào ạ? (Ví dụ: **Biến tần Lumentree 6.6kW**, **Deye 12kW**, **Pin Apess 15.3kWh**...)`,
            card: draft.partner_name ? buildDraftPreviewResponse(draft).card : null,
            action_type: 'ORDER_NEED_INFO',
            quick_replies: ['Biến tần Hybrid Lumentree 6.6kw ULTRA', 'Biến tần Deye 12kw 3pha', 'Pin lưu trữ Apess 15.3kwh', 'Hủy đơn']
        };
    }

    // 0. XỬ LÝ KHI NGƯỜI DÙNG BẢO ĐỔI SỐ LƯỢNG MÀ CHƯA NÓI RÕ CON SỐ (VÍ DỤ: "đổi số lượng nghe")
    const isChangeQtyOnly = /^(?:sua so luong|doi so luong|chinh so luong|thay so luong|sua sl|doi sl)(?:\s+(?:nghe|nha|nhe|di|dum|giup|ho|nao|coi|a))?$/i.test(norm) ||
        (/doi so luong|sua so luong|chinh so luong|doi sl|sua sl/i.test(norm) && !/\d+/.test(norm));
    if (isChangeQtyOnly) {
        return {
            text: `Dạ anh/chị muốn đổi số lượng của đơn hàng thành bao nhiêu ${draft.product ? (draft.product.unit || 'Bộ') : 'Bộ'} ạ?`,
            card: null,
            action_type: 'ORDER_NEED_QTY',
            quick_replies: ['1 bộ', '2 bộ', '5 bộ', '10 bộ', '20 bộ', 'Hủy đơn']
        };
    }

    // 0. XỬ LÝ KHI NGƯỜI DÙNG BẢO ĐỔI KHÁCH HÀNG / NCC MÀ CHƯA NÓI TÊN CỤ THỂ
    const isChangePartnerOnly = /^(?:doi khach|sua khach|chon lai khach|doi khach hang|sua khach hang|doi ncc|sua ncc|doi nha cung cap|sua nha cung cap)(?:\s+(?:nghe|nha|nhe|di|dum|giup|ho|nao|coi|a))?$/i.test(norm);
    if (isChangePartnerOnly) {
        if (draft.type === 'SALE') {
            return {
                text: `Dạ anh/chị muốn đổi sang Khách hàng nào trên hệ thống CRM (sale-crm) ạ?`,
                card: null,
                action_type: 'ORDER_NEED_CUSTOMER',
                quick_replies: ['Khách Võ Anh Phong', 'Khách Hoàng Gia', 'Khách Anh Nam Kiên Giang', 'Khách Binbon', 'Hủy đơn']
            };
        } else {
            return {
                text: `Dạ anh/chị muốn đổi sang Nhà Cung Cấp nào ạ?`,
                card: null,
                action_type: 'PURCHASE_NEED_SUPPLIER',
                quick_replies: ['Công ty Solar E', 'Công ty Cergy', 'Công ty Tín Trung', 'H Hùng Việt Hào', 'Công ty HeroPower', 'Hủy đơn']
            };
        }
    }

    if (!draft.product && draft.items && draft.items.length > 0) {
        draft.product = draft.items[0].product || draft.items[0];
    }

    let updatedFields = [];

    // 1. Cập nhật số lượng (hỗ trợ cả tuyệt đối: "5 bộ" và tương đối: "+1", "-1", "tăng 2", "giảm 1")
    let deltaQty = null;
    const deltaMatch = cleanText.match(/^([+-]\s*\d+)$/) || cleanText.match(/(?:tăng|thêm)\s*(\d+)/i) || cleanText.match(/(?:giảm|bớt)\s*(\d+)/i);
    if (deltaMatch) {
        if (cleanText.startsWith('-') || /giảm|bớt/i.test(cleanText)) {
            const val = parseInt(deltaMatch[1].replace(/[^0-9]/g, ''), 10);
            deltaQty = -val;
        } else {
            const val = parseInt(deltaMatch[1].replace(/[^0-9]/g, ''), 10);
            deltaQty = val;
        }
    }

    const qtyMatch = cleanText.match(/(?:đổi thành|thành|sửa thành|số lượng|lấy|mua|bán)\s*(\d+)/i) || cleanText.match(/^(\d+)\s*(?:tấm|bộ|chiếc|cái|inverter|pin)?$/i);
    
    if (deltaQty !== null) {
        const currentQty = draft.qty || (draft.items && draft.items[0] && draft.items[0].qty) || 1;
        const newQty = Math.max(1, currentQty + deltaQty);
        draft.qty = newQty;
        if (draft.items && draft.items.length > 0) {
            draft.items[0].qty = newQty;
            draft.items[0].total = newQty * (draft.items[0].price || draft.unitPrice || 0);
            draft.totalAmount = draft.items.reduce((acc, it) => acc + (it.total || 0), 0);
        } else if (draft.unitPrice) {
            draft.totalAmount = newQty * draft.unitPrice;
        }
        updatedFields.push(`số lượng ${deltaQty > 0 ? 'tăng' : 'giảm'} thành **${newQty}**`);
    } else if (qtyMatch) {
        const newQty = parseInt(qtyMatch[1], 10);
        if (newQty > 0) {
            draft.qty = newQty;
            if (draft.items && draft.items.length > 0) {
                draft.items[0].qty = newQty;
                draft.items[0].total = newQty * (draft.items[0].price || draft.unitPrice || 0);
                draft.totalAmount = draft.items.reduce((acc, it) => acc + (it.total || 0), 0);
            } else if (draft.unitPrice) {
                draft.totalAmount = draft.qty * draft.unitPrice;
            }
            updatedFields.push(`số lượng thành **${newQty}**`);
        }
    }

    // 2. Cập nhật đơn giá
    const priceMatch = cleanText.match(/(?:giá|đơn giá|sửa giá)\s*[:=]?\s*([\d.,]+)\s*(?:đ|vnd|k|tr|triệu)?/i);
    if (priceMatch) {
        let rawP = priceMatch[1].replace(/\./g, '').replace(/,/g, '');
        let newPrice = parseFloat(rawP) || 0;
        if (cleanText.toLowerCase().includes('triệu') && newPrice < 1000) newPrice *= 1000000;
        else if (cleanText.toLowerCase().includes('k') && newPrice < 10000) newPrice *= 1000;
        if (newPrice > 0) {
            draft.unitPrice = newPrice;
            draft.totalAmount = draft.qty * newPrice;
            updatedFields.push(`đơn giá thành **${formatVND(newPrice)}**`);
        }
    }

    // Kiểm tra ý định đổi sản phẩm / thiết bị
    const wantsChangeProduct = /doi san pham|sua san pham|thay san pham|chon lai san pham|lay san pham|doi sang|thay bang|thay vi|khong lay|sai san pham|san pham khac|doi lai|sang bien tan|sang pin|sang tam/i.test(norm);
    const hasProductIndicator = wantsChangeProduct || 
        /tam pin|bien tan|inverter|hybrid|deye|canadian|jinko|apess|pin luu|pin\s*\d+|tu dien|kep|bat\b|lumentree|solis|luxpower|growatt|huawei|sungrow|longi|goodwe|sofar/i.test(norm) ||
        /\d+(?:\.\d+)?\s*(?:kw|kwh|w|wp|v|ah)\b/i.test(norm);
    const mentionsProduct = !deltaMatch && !qtyMatch && !priceMatch && (hasProductIndicator || (!draft.product && (!draft.items || draft.items.length === 0)));

    // 3. Cập nhật Đối tác (Khách CRM hoặc NCC)
    // KHÓA CỨNG: TUYỆT ĐỐI KHÔNG BAO GIỜ NHẬN SANG KHÁCH HÀNG KHI ĐANG NÓI VỀ SẢN PHẨM HOẶC CÓ TỪ KHÓA THIẾT BỊ!
    let mentionsCustomer = false;
    if (!hasProductIndicator && !wantsChangeProduct) {
        const explicitCustomer = /\b(?:khach|khach hang|doi tac|doi sang khach|cho khach|doi khach|sdt|kh\s*\d+)\b/i.test(norm) ||
                                 /\b(?:cho\s+anh|cho\s+chi|cho\s+bac|cho\s+chu|cho\s+ong|cho\s+ba)\s+[a-zà-ỹ]+/i.test(norm);
        const needCustomerFallback = (!qtyMatch && !priceMatch && !mentionsProduct && !draft.partner_name);
        mentionsCustomer = (explicitCustomer && !/so luong|sl|gia|don gia/i.test(norm)) || needCustomerFallback;
    }

    if (draft.type === 'SALE' && mentionsCustomer) {
        const custRes = await extractCustomer(cleanText, norm, context);
        if (custRes.notFoundInCRM) {
            const topSugg = (custRes.suggestions || []).filter(s => s.score >= 10).slice(0, 3);
            let suggText = '';
            let qr = [];
            if (topSugg.length > 0) {
                suggText = `\n\n💡 **Gợi ý khách hàng CRM tương tự:**\n` + topSugg.map((s, idx) => `${idx + 1}. **${s.name || s.full_name}** ${s.nickname ? `(${s.nickname})` : ''} (\`${s.customer_code}\`)`).join('\n');
                qr = topSugg.map(s => `Khách ${s.name || s.full_name}`);
            } else {
                qr = ['Khách Võ Anh Phong', 'Khách Hoàng Gia', 'Khách Binbon'];
            }
            qr.push('Hủy đơn');
            return {
                text: `⚠️ Không tìm thấy khách hàng "${custRes.queryCustomer}" trong CRM (sale-crm).${suggText}\n\n👉 Bắt buộc chọn khách hàng đã có hồ sơ CRM! Anh/Chị chọn trong gợi ý hoặc kiểm tra lại nhé!`,
                card: null,
                action_type: 'CUSTOMER_NOT_FOUND_CRM',
                quick_replies: qr
            };
        }
        if (custRes.found) {
            draft.partner_name = custRes.customerName;
            draft.customer_id = custRes.customerId;
            draft.customer_code = custRes.customerCode;
            if (custRes.phone) draft.partner_phone = custRes.phone;
            updatedFields.push(`khách hàng là **${custRes.customerName}** (\`${custRes.customerCode}\`)`);
        }
    }

    const mentionsSupplier = !hasProductIndicator && !wantsChangeProduct && (/ncc|nha cung cap|cty|cong ty|solar|cergy|tin trung|hung viet hao|heropower|tu nha cung cap/i.test(norm) || (!qtyMatch && !priceMatch && !mentionsProduct && !draft.partner_name));
    if (draft.type === 'PURCHASE' && mentionsSupplier) {
        const supRes = await extractSupplier(cleanText, norm, context);
        if (supRes.notFoundInList) {
            return {
                text: `⚠️ Nhà cung cấp "${supRes.querySupplier}" không có trong danh mục NCC của hệ thống!\n\n📋 Danh sách NCC: Solar E, Cergy, Tín Trung, Hùng Việt Hào, HeroPower.`,
                card: null,
                action_type: 'SUPPLIER_NOT_FOUND',
                quick_replies: ['Công ty Solar E', 'Công ty Cergy', 'Công ty Tín Trung', 'H Hùng Việt Hào', 'Công ty HeroPower']
            };
        }
        if (supRes.found) {
            draft.partner_name = supRes.supplierName;
            draft.supplier_id = supRes.supplierId;
            draft.supplier_code = supRes.supplierCode;
            updatedFields.push(`Nhà cung cấp là **${supRes.supplierName}**`);
        }
    }

    // 4. CẬP NHẬT HOẶC ĐỔI SẢN PHẨM KHÁC
    if (mentionsProduct) {
        if ((norm.includes('san pham khac') || norm.includes('doi san pham') || norm.includes('sai san pham')) && !/deye|canadian|jinko|longi|apess|pin|bien tan|inverter|tu dien|solis|lumentree|kwh|kw|w\b/i.test(norm)) {
            draft.product = null;
            draft.status = 'NEED_PRODUCT';
            return {
                text: `Dạ em đã hủy chọn sản phẩm trước đó. Cho em xin Tên sản phẩm hoặc thiết bị trong kho mà anh/chị muốn đổi sang nhé!`,
                card: null,
                action_type: 'ORDER_NEED_INFO',
                quick_replies: ['Tấm pin Canadian 600W', 'Deye hybrid 12kw 3 pha', 'Pin lưu trữ Apess 15.3kwh', 'Hủy đơn']
            };
        }

        const prodRes = await findMatchingProduct(cleanText, norm, context);
        if (prodRes.matched) {
            draft.product = prodRes.product;
            const newPrice = draft.type === 'SALE' ? (parseFloat(prodRes.product.retail_price) || 0) : (parseFloat(prodRes.product.import_price) || 2500000);
            draft.unitPrice = newPrice;
            draft.totalAmount = (draft.qty || 1) * newPrice;

            // ĐỒNG BỘ CẢ DRAFT.ITEMS[0] ĐỂ CARD XEM TRƯỚC RENDER ĐÚNG SẢN PHẨM MỚI!
            const unit = (prodRes.product.unit && !/^\d+$/.test(prodRes.product.unit)) ? prodRes.product.unit : 'Bộ';
            const newItem = {
                product: prodRes.product,
                id: prodRes.product.id,
                name: prodRes.product.product_name,
                sku: prodRes.product.sku || '',
                qty: draft.qty || 1,
                unit: unit,
                price: newPrice,
                total: (draft.qty || 1) * newPrice
            };
            if (draft.items && draft.items.length > 0) {
                draft.items[0] = newItem;
            } else {
                draft.items = [newItem];
            }

            // Cập nhật cảnh báo tương thích kỹ thuật cho sản phẩm mới
            const comp = checkTechnicalCompatibility(draft.items);
            draft.compat_warning = comp.compatWarning || comp.techTip || comp.accessoryTip;

            updatedFields.push(`sản phẩm thành **${prodRes.product.product_name}**`);
        } else if (prodRes.notFoundInCatalog) {
            const topSugg = (prodRes.suggestions || []).filter(p => p.score >= 10).slice(0, 3);
            let suggText = '';
            let qr = [];
            if (topSugg.length > 0) {
                suggText = `\n\n💡 **Gợi ý thiết bị trong kho:**\n` + topSugg.map((p, idx) => `${idx + 1}. **${p.product_name}** (\`${p.product_code || p.sku}\`)`).join('\n');
                qr = topSugg.map(p => p.product_name);
            } else {
                qr = ['Tấm pin Canadian 600W Bi-facial', 'Deye hybrid 12kw 3pha BH 5 năm', 'Pin lưu trữ Apess 15.3kwh'];
            }
            qr.push('Hủy đơn');
            return {
                text: `⚠️ Không tìm thấy sản phẩm "${prodRes.queryProduct}" trong kho hàng!${suggText}\n👉 Anh/Chị chọn thiết bị có sẵn trong danh mục nhé!`,
                card: null,
                action_type: 'PRODUCT_NOT_FOUND',
                quick_replies: qr
            };
        }
    }

    // 5. Cập nhật ghi chú
    const noteMatch = cleanText.match(/(?:ghi chú|note|lưu ý)\s*[:=]?\s*(.+)/i);
    if (noteMatch) {
        draft.notes = noteMatch[1].trim();
        updatedFields.push(`ghi chú: "${draft.notes}"`);
    }

    // Kiểm tra thông tin bắt buộc
    const isSale = draft.type === 'SALE';
    if (!draft.product) {
        draft.status = 'NEED_PRODUCT';
        return {
            text: `Đã cập nhật ${updatedFields.join(', ')}. Cho em xin Tên sản phẩm và Số lượng nhé!`,
            card: null,
            action_type: 'ORDER_NEED_INFO',
            quick_replies: ['10 tấm pin Canadian 600W', '1 biến tần Deye 12kW', 'Hủy đơn']
        };
    }

    if (!draft.partner_name) {
        draft.status = isSale ? 'NEED_CUSTOMER' : 'NEED_SUPPLIER';
        const pLabel = isSale ? 'Khách hàng CRM' : 'Nhà cung cấp';
        return {
            text: `Đã cập nhật ${updatedFields.join(', ')}. Cho em xin tên ${pLabel} nhé!`,
            card: null,
            action_type: isSale ? 'ORDER_NEED_CUSTOMER' : 'PURCHASE_NEED_SUPPLIER',
            quick_replies: isSale ? ['Khách Võ Anh Phong', 'Khách Bin Bụng Bự'] : ['Công ty Solar E', 'Công ty Cergy']
        };
    }

    draft.status = 'AWAITING_CONFIRMATION';
    const res = buildDraftPreviewResponse(draft);
    if (updatedFields.length > 0) {
        res.text = `Dạ đã cập nhật: ${updatedFields.join(', ')}.\n\n` + res.text;
    }
    return res;
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

// 4. LÊN ĐƠN ĐẶT MUA HÀNG NHANH / PHIẾU MUA HÀNG (PO - PURCHASE ORDER)
async function handleCreatePurchase(text, context, user) {
    const cleanText = text.trim();
    const norm = removeVietnameseTones(cleanText);

    // 1. Trích xuất Nhà Cung Cấp (BẮT BUỘC TRONG BẢNG SUPPLIERS) TRƯỚC
    const supRes = await extractSupplier(cleanText, norm, context);
    if (supRes.notFoundInList) {
        return {
            text: `⚠️ Nhà cung cấp "${supRes.querySupplier}" không có trong danh mục NCC của hệ thống.\n\n📋 Danh sách NCC hiện có:\n• Công ty Solar E (\`NCC4949\`)\n• Công ty Cergy (\`NCC8906\`)\n• Công ty Tín Trung (\`NCC1835\`)\n• H Hùng Việt Hào (\`NCC7035\`)\n• Công ty HeroPower (\`NCC8569\`)\n\n👉 Anh/Chị chọn NCC trong danh sách trên nhé!`,
            card: null,
            action_type: 'SUPPLIER_NOT_FOUND',
            quick_replies: ['Công ty Solar E', 'Công ty Cergy', 'Công ty Tín Trung', 'H Hùng Việt Hào', 'Công ty HeroPower']
        };
    }

    // Lấy token của NCC để tránh gây nhầm lẫn khi tìm kiếm sản phẩm (ví dụ "solar", "cong", "ty")
    let supTokens = [];
    if (supRes.found) {
        supTokens = removeVietnameseTones(supRes.supplierName || '').split(/[^a-z0-9]+/i).filter(Boolean);
    } else if (supRes.querySupplier) {
        supTokens = removeVietnameseTones(supRes.querySupplier).split(/[^a-z0-9]+/i).filter(Boolean);
    }

    // 2. Trích xuất số lượng & sản phẩm (Bắt buộc trong danh mục products)
    let qty = extractQuantity(cleanText);
    const excludeList = [...supTokens];
    if (qty > 1) excludeList.push(String(qty));
    const prodRes = await findMatchingProduct(cleanText, norm, context, excludeList);

    if (!prodRes || prodRes.missing) {
        return {
            text: `⚠️ Cho em xin Tên thiết bị và Số lượng cần lập phiếu mua hàng nhé!`,
            card: null,
            action_type: 'PURCHASE_NEED_INFO',
            quick_replies: ['20 tấm pin Canadian 600W', '5 biến tần Deye 12kW', 'Hủy đơn']
        };
    }
    if (prodRes.notFoundInCatalog) {
        const topSugg = (prodRes.suggestions || []).filter(p => p.score >= 10).slice(0, 3);
        let suggText = '';
        let qr = [];
        if (topSugg.length > 0) {
            suggText = `\n\n💡 **Gợi ý thiết bị trong kho:**\n` + topSugg.map((p, idx) => `${idx + 1}. **${p.product_name}** (\`${p.product_code || p.sku}\`)`).join('\n');
            qr = topSugg.map(p => p.product_name);
        } else {
            qr = ['Tấm pin Canadian 600W Bi-facial', 'Deye hybrid 12kw 3pha BH 5 năm', 'Kẹp giữa'];
        }
        qr.push('Hủy đơn');
        return {
            text: `⚠️ Không tìm thấy sản phẩm "${prodRes.queryProduct}" trong danh mục kho.${suggText}\n👉 Anh/Chị chọn thiết bị có sẵn trong danh mục nhé!`,
            card: null,
            action_type: 'PRODUCT_NOT_FOUND',
            quick_replies: qr
        };
    }
    const matchedProduct = prodRes.product;

    let unitPrice = parseFloat(matchedProduct.import_price) || 0;
    if (unitPrice === 0) {
        const retail = parseFloat(matchedProduct.retail_price) || 0;
        unitPrice = retail > 0 ? Math.round(retail * 0.8) : 2500000;
    }
    const totalAmount = unitPrice * qty;
    if (supRes.missing || !supRes.supplierId) {
        context.draft_order = {
            type: 'PURCHASE',
            status: 'NEED_SUPPLIER',
            partner_name: null,
            supplier_id: null,
            supplier_code: null,
            product: matchedProduct,
            qty: qty,
            unitPrice: unitPrice,
            totalAmount: totalAmount,
            notes: ''
        };
        return {
            text: `Đã chọn mua: **${qty} ${matchedProduct.product_name}** (Dự toán: ${formatVND(totalAmount)}).\n\n⚠️ Cho em xin Tên Nhà Cung Cấp (Solar E, Cergy, Tín Trung, Hùng Việt Hào, HeroPower) để hoàn tất phiếu nhé!`,
            card: null,
            action_type: 'PURCHASE_NEED_SUPPLIER',
            quick_replies: ['Công ty Solar E', 'Công ty Cergy', 'Công ty Tín Trung', 'Hùng Việt Hào', 'Hủy đơn']
        };
    }

    // ĐÃ ĐỦ CẢ NHÀ CUNG CẤP VÀ SẢN PHẨM -> TẠO BẢN XEM TRƯỚC
    context.draft_order = {
        type: 'PURCHASE',
        status: 'AWAITING_CONFIRMATION',
        partner_name: supRes.supplierName,
        supplier_id: supRes.supplierId,
        supplier_code: supRes.supplierCode,
        product: matchedProduct,
        qty: qty,
        unitPrice: unitPrice,
        totalAmount: totalAmount,
        notes: ''
    };

    return buildDraftPreviewResponse(context.draft_order);
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
    const res = await tool_fetch_technical_datasheet(text, null);
    if (!res.found) {
        return {
            text: res.message,
            card: null,
            action_type: 'DOCS_NOT_FOUND',
            quick_replies: ['Datasheet pin Canadian', 'Datasheet biến tần Deye', 'Datasheet pin Apess', 'Hủy']
        };
    }

    context.active_product = res.product;

    return {
        text: res.text,
        card: res.card,
        action_type: 'DOCS_READY',
        quick_replies: res.quick_replies
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

// =========================================================================
// MODULE TÍCH HỢP OPENAI CHATGPT (GPT-4o / GPT-4o-mini)
// =========================================================================

async function getOpenAIKey() {
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith('sk-')) {
        return process.env.OPENAI_API_KEY;
    }
    try {
        const r = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'openai_api_key' LIMIT 1");
        if (r.rows.length > 0 && r.rows[0].setting_value && r.rows[0].setting_value.startsWith('sk-')) {
            process.env.OPENAI_API_KEY = r.rows[0].setting_value;
            return r.rows[0].setting_value;
        }
    } catch (e) {
        console.warn('getOpenAIKey error:', e.message);
    }
    return null;
}

async function saveOpenAIKey(key) {
    try {
        process.env.OPENAI_API_KEY = key;
        await pool.query(`
            INSERT INTO system_settings (setting_key, setting_value)
            VALUES ('openai_api_key', $1)
            ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value
        `, [key]);
        return true;
    } catch (e) {
        console.warn('saveOpenAIKey error:', e.message);
        return false;
    }
}

async function handleSwitchToGoogleAI(text, context, user) {
    try {
        await pool.query(`
            INSERT INTO system_settings (setting_key, setting_value)
            VALUES ('ai_provider', 'gemini')
            ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value
        `);
    } catch (e) {
        console.warn('handleSwitchToGoogleAI error:', e.message);
    }
    return {
        text: `🤖 **ĐÃ KÍCH HOẠT TRỢ LÝ SUNGO GOOGLE AI (GEMINI ENTERPRISE)!**\n\nTrợ lý AI SUNGO đang chạy trực tiếp trên nền tảng **Google Generative AI (Gemini Engine)**.\n\nSẵn sàng phục vụ đầy đủ 6 trụ cột nghiệp vụ:\n1. 🧠 **Quản lý ngữ cảnh liên tục**: Nhớ bản nháp, xử lý ngắt quãng (datasheet/tồn kho) và phục hồi tự động.\n2. 🔍 **NLU sâu & Chống nhiễu**: Lọc bỏ từ đệm, chuẩn hóa $kW \\leftrightarrow W$, bóc tách đơn hàng gộp đa sản phẩm.\n3. 🛡️ **Guardrails nghiệp vụ**: Cảnh báo tồn kho thiếu, cảnh báo bán dưới giá vốn, kiểm tra tương thích kỹ thuật.\n4. 📦 **Tìm kiếm ngữ nghĩa**: Phân tách triệt để thành phẩm (pin pack, inverter) với linh kiện đơn lẻ (cell pin, MC4, kẹp).\n5. ⚡ **Kết nối Backend Function Calling**: Đồng bộ CRM, kho hàng, tạo đơn và tài liệu chuẩn xác.\n6. 📱 **Adaptive UI**: Thẻ xem trước trực quan kèm link tải Datasheet PDF trực tiếp.`,
        card: null,
        action_type: 'GOOGLE_AI_ACTIVE',
        quick_replies: ['Tạo đơn cho anh Nam Kiên Giang 2 biến tần 15kW với 10 cục pin Apec', 'Datasheet tấm pin Jinko', 'Kiểm tra tồn kho Deye 12']
    };
}

async function handleResumeDraftOrder(text, context, user) {
    const draft = context.draft_order;
    if (!draft) {
        return {
            text: `Dạ hiện tại không có bản nháp đơn hàng nào đang mở. Anh/chị có muốn tạo đơn hàng mới không ạ?`,
            card: null,
            action_type: 'NO_DRAFT_ORDER',
            quick_replies: ['Tạo đơn bán hàng', 'Lập phiếu mua hàng', 'Kiểm tra tồn kho']
        };
    }
    const res = buildDraftPreviewResponse(draft);
    res.action_type = 'DRAFT_RESUMED_PROMPT';
    res.text = `Dạ em vẫn đang giữ bản nháp đơn hàng cho **${draft.partner_name || 'đối tác'}**:\n\n` + res.text;
    return res;
}

async function handleSwitchToChatGPT(text, context, user) {
    const activeKey = await getOpenAIKey();
    if (activeKey) {
        return {
            text: `🤖 **HỆ THỐNG ĐÃ KÍCH HOẠT OPENAI CHATGPT (GPT-4o)!**\n\nTrợ lý AI SUNGO đang chạy trực tiếp trên động cơ trí tuệ nhân tạo của OpenAI. Anh/Chị có thể ra lệnh bằng ngôn ngữ tự nhiên thoải mái nhé!`,
            card: null,
            action_type: 'OPENAI_ACTIVE',
            quick_replies: ['Tạo đơn bán 10 tấm pin Canadian', 'Lập phiếu mua từ Solar E', 'Kiểm tra hàng tồn kho']
        };
    } else {
        return {
            text: `🤖 **KẾT NỐI OPENAI CHATGPT (GPT-4o / GPT-4o-mini)**\n\nEm đã tích hợp sẵn module OpenAI ChatGPT trực tiếp vào hệ thống SUNGO ERP!\n\n👉 Để kích hoạt ngay, Anh/Chị chỉ cần gửi mã API Key vào đây (Ví dụ gõ: \`API key là sk-...\`).\n\n*(Đồng thời, em đã nâng cấp bộ não suy luận: Đã sửa nhận diện "solare" -> **Công ty Solar E** và hỗ trợ đổi sản phẩm linh hoạt 100%!)*`,
            card: null,
            action_type: 'OPENAI_KEY_REQUIRED',
            quick_replies: ['API key là sk-...', 'Lập phiếu mua từ Solar E', 'Hủy đơn']
        };
    }
}

async function handleSetOpenAIKey(text, context, user) {
    const keyMatch = text.match(/(sk-[A-Za-z0-9_\-]{15,})/i);
    if (keyMatch) {
        const newKey = keyMatch[1];
        await saveOpenAIKey(newKey);
        return {
            text: `🎉 **ĐÃ KÍCH HOẠT THÀNH CÔNG OPENAI CHATGPT!**\n\nHệ thống đã lưu API Key và kết nối trực tiếp với mô hình trí tuệ nhân tạo GPT-4o của OpenAI.\nTừ bây giờ, Trợ lý AI SUNGO sẽ sử dụng động cơ ChatGPT để thấu hiểu ngôn ngữ tự nhiên, suy luận ngữ cảnh và lên đơn hàng thông minh nhất!`,
            card: null,
            action_type: 'OPENAI_KEY_SAVED',
            quick_replies: ['Tạo đơn bán 10 tấm pin Canadian', 'Lập phiếu mua từ Solar E', 'Kiểm tra tồn kho']
        };
    }
    return {
        text: `⚠️ Định dạng API Key không hợp lệ. API Key của OpenAI thường bắt đầu bằng \`sk-...\`. Anh/Chị kiểm tra lại nhé!`,
        card: null,
        action_type: 'INVALID_API_KEY',
        quick_replies: ['API key là sk-...']
    };
}

/**
 * =========================================================================
 * BỘ ĐIỀU PHỐI TRUNG TÂM (MAIN AI DISPATCHER)
 * =========================================================================
 */
async function processChatMessage(userId, sessionId, messageText, userRole = 'ADMIN', userObj = {}) {
    const startTime = Date.now();
    const conv = await getOrCreateConversation(userId, sessionId);
    const context = conv.context_state || {};

    // Đồng bộ 2 chiều giữa active_so_draft và draft_order
    if (context.active_so_draft && !context.draft_order) {
        context.draft_order = context.active_so_draft;
    } else if (context.draft_order && !context.active_so_draft) {
        context.active_so_draft = context.draft_order;
    }

    await saveMessage(conv.id, 'user', messageText);

    // =========================================================================
    // NHỊP 1: HIỂU & LÀM SẠCH (NLU & NOISE STRIPPING - TRỤ CỘT I)
    // Loại bỏ chửi thề, trợ từ địa phương, chuẩn hóa đơn vị đo lường và sửa lỗi gõ Telex Solar
    // =========================================================================
    const nluStartTime = Date.now();
    const cleanPrompt = normalizeSolarInput(messageText);
    const nluMs = Math.max(1, Date.now() - nluStartTime);

    const intent = detectIntent(cleanPrompt, context);

    const isAllowed = checkPermission(userRole, intent);
    if (!isAllowed) {
        let denyText = '';
        const roleUpper = String(userRole || 'GUEST').toUpperCase().trim();
        if (roleUpper === 'GUEST') {
            denyText = `🔒 **Yêu cầu đăng nhập SUNGO ERP**\n\nBạn hiện đang truy cập với tư cách **Khách (Chưa đăng nhập)** nên không có quyền truy cập dữ liệu kinh doanh, doanh thu, công nợ, kho bãi hoặc thao tác tạo đơn hàng.\n\n👉 Vui lòng **đăng nhập tài khoản nhân viên hoặc quản trị viên** trên hệ thống để thực hiện các chức năng này.`;
        } else {
            denyText = `⚠️ Dạ em rất tiếc, tài khoản vai trò **[${userRole}]** không có thẩm quyền truy cập hoặc thực hiện thao tác **[${intent}]** này.\n\nAnh/Chị vui lòng liên hệ Quản Trị Viên (Admin) hoặc Kế Toán Trưởng để được cấp quyền mở rộng.`;
        }
        
        await saveMessage(conv.id, 'assistant', denyText, intent, 'PERMISSION_DENIED', { role: userRole, intent });
        return {
            reply: denyText,
            card: {
                type: 'PERMISSION_DENIED_CARD',
                role: userRole,
                intent: intent,
                message: roleUpper === 'GUEST' ? 'Vui lòng đăng nhập tài khoản để sử dụng tính năng nội bộ ERP.' : 'Thao tác vượt quá thẩm quyền của phân hệ người dùng.'
            },
            action_type: 'PERMISSION_DENIED',
            quick_replies: roleUpper === 'GUEST' ? ['Đăng nhập hệ thống', 'Tra cứu bảo hành', 'Xem tài liệu sản phẩm'] : ['Xem hướng dẫn sử dụng', 'Làm mới hội thoại']
        };
    }

    // =========================================================================
    // NHỊP 2: GỌI TOOL & THỰC THI CHUYÊN TRÁCH (TOOL CALLING & ACTION ENGINE)
    // =========================================================================
    let actionResult = null;

    try {
        switch (intent) {
            case 'SWITCH_TO_GOOGLE_AI':
                actionResult = await handleSwitchToGoogleAI(cleanPrompt, context, userObj);
                break;
            case 'RESUME_DRAFT_ORDER':
                actionResult = await handleResumeDraftOrder(cleanPrompt, context, userObj);
                break;
            case 'SWITCH_TO_CHATGPT':
                actionResult = await handleSwitchToChatGPT(cleanPrompt, context, userObj);
                break;
            case 'SET_OPENAI_KEY':
                actionResult = await handleSetOpenAIKey(cleanPrompt, context, userObj);
                break;
            case 'CONFIRM_DRAFT_ORDER':
                actionResult = await handleConfirmDraftOrder(cleanPrompt, context, userObj);
                break;
            case 'CANCEL_DRAFT_ORDER':
                actionResult = await handleCancelDraftOrder(cleanPrompt, context, userObj);
                break;
            case 'UPDATE_DRAFT_ORDER':
                actionResult = await handleUpdateDraftOrder(cleanPrompt, context, userObj);
                break;
            case 'CREATE_ORDER':
                actionResult = await handleCreateOrder(cleanPrompt, context, userObj);
                break;
            case 'CREATE_PRODUCT':
                actionResult = await handleCreateProduct(cleanPrompt, context, userObj);
                break;
            case 'CREATE_QUOTATION':
                actionResult = await handleCreateQuotation(cleanPrompt, context, userObj);
                break;
            case 'CREATE_PURCHASE':
                actionResult = await handleCreatePurchase(cleanPrompt, context, userObj);
                break;
            case 'REPORT_REVENUE':
                actionResult = await handleReportRevenue(cleanPrompt, context, userObj);
                break;
            case 'REPORT_BUSINESS_HEALTH':
                actionResult = await handleReportBusinessHealth(cleanPrompt, context, userObj);
                break;
            case 'CHECK_INVENTORY':
                actionResult = await handleCheckInventory(cleanPrompt, context, userObj);
                break;
            case 'SEND_PRODUCT_DOCS':
                actionResult = await handleSendProductDocs(cleanPrompt, context, userObj);
                break;
            case 'CREATE_CONTRACT':
                actionResult = await handleCreateContract(cleanPrompt, context, userObj);
                break;
            case 'CHECK_WARRANTY':
                actionResult = await handleCheckWarranty(cleanPrompt, context, userObj);
                break;
            case 'CHECK_HR':
                actionResult = await handleCheckHR(cleanPrompt, context, userObj);
                break;
            case 'CHECK_DEBT':
                actionResult = await handleCheckDebt(cleanPrompt, context, userObj);
                break;
            case 'ANALYZE_CUSTOMER':
                actionResult = await handleAnalyzeCustomer(cleanPrompt, context, userObj);
                break;
            case 'ANALYZE_PRODUCT':
                actionResult = await handleAnalyzeProduct(cleanPrompt, context, userObj);
                break;
            default:
                // ANTI-RESET GUARDRAIL: Nếu đang có active_so_draft/draft_order thì TUYỆT ĐỐI KHÔNG rơi vào menu chào!
                if (context.active_so_draft || context.draft_order) {
                    const draft = context.active_so_draft || context.draft_order;
                    const partnerName = draft.partner_name || (draft.type === 'SALE' ? 'khách hàng' : 'nhà cung cấp');
                    const itemsDesc = (draft.items || []).map(it => `${it.qty || it.quantity} ${it.name || it.product_name}`).join(', ');
                    actionResult = {
                        text: `Dạ em vẫn đang giữ bản nháp đơn hàng cho **${partnerName}** (${itemsDesc || 'chưa chọn sản phẩm'}).\n\n👉 Anh/Chị muốn cập nhật số lượng, thêm bớt hàng hay bấm **Tạo đơn ngay** ạ?`,
                        card: draft.card || null,
                        action_type: 'DRAFT_RESUMED_PROMPT',
                        quick_replies: ['Tạo đơn ngay', 'Sửa số lượng', 'Đổi khách hàng', 'Hủy đơn']
                    };
                } else if (String(userRole || '').toUpperCase() === 'GUEST') {
                    actionResult = {
                        text: `Chào Quý khách! Em là **Trợ Lý AI SUNGO**.\n\n🔒 Bạn hiện đang truy cập với tư cách **Khách (Chưa đăng nhập)**.\n- Để tạo đơn hàng, tra cứu doanh thu, công nợ, kho bãi và nhân sự: Vui lòng **đăng nhập tài khoản**.\n- Bạn có thể tra cứu **Bảo hành thiết bị** (theo số Serial) hoặc xem **Tài liệu kỹ thuật / Datasheet** sản phẩm.\n\nQuý khách cần em hỗ trợ thông tin gì ạ?`,
                        card: null,
                        action_type: 'GENERAL_REPLY',
                        quick_replies: ['Đăng nhập hệ thống', 'Tra cứu bảo hành', 'Xem tài liệu sản phẩm']
                    };
                } else {
                    actionResult = {
                        text: `Dạ em là **Trợ Lý Google Gemini AI (SUNGO Enterprise AI)**. Em có thể hỗ trợ anh/chị:\n- 📦 Tạo đơn hàng gộp đa thiết bị & Tạo sản phẩm siêu tốc\n- 📑 Lập báo giá & Soạn hợp đồng điện tử\n- 🛒 Lên đơn đặt mua hàng từ NCC (PO)\n- 📊 Báo cáo doanh thu & Sức khỏe tài chính CFO\n- 🔍 Tra cứu tồn kho, Serial bảo hành & Công nợ 131/331\n- 📄 Gửi Datasheet, Catalog & Phân tích khách hàng\n\nAnh/Chị cần em hỗ trợ việc gì ngay bây giờ?`,
                        card: null,
                        action_type: 'GENERAL_REPLY',
                        quick_replies: ['Tạo đơn cho anh Nam Kiên Giang 2 biến tần 15kW với 10 cục pin Apec', 'Kiểm tra tồn kho tấm pin', 'Báo cáo doanh thu hôm nay', 'Sức khỏe doanh nghiệp']
                    };
                }
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

    // =========================================================================
    // NHỊP 3: SO KHỚP LOGIC & KIỂM DUYỆT (VALIDATOR NODE & RECOVERY)
    // =========================================================================
    // NẾU ĐANG CÓ BẢN NHÁP ĐƠN HÀNG MÀ NGƯỜI DÙNG THỰC HIỆN CÂU HỎI NGẮT QUÃNG (CONTEXT SWITCH & RECOVERY)
    if ((context.draft_order || context.active_so_draft) && !['CONFIRM_DRAFT_ORDER', 'CANCEL_DRAFT_ORDER', 'UPDATE_DRAFT_ORDER', 'RESUME_DRAFT_ORDER', 'CREATE_ORDER', 'CREATE_PURCHASE', 'SWITCH_TO_GOOGLE_AI'].includes(intent)) {
        const draft = context.active_so_draft || context.draft_order;
        const partnerName = draft.partner_name || (draft.type === 'SALE' ? 'khách hàng' : 'nhà cung cấp');
        actionResult.text = (actionResult.text || '') + `\n\n👉 *Anh/chị có muốn tiếp tục bản nháp đơn hàng cho **${partnerName}** không?*`;
        actionResult.quick_replies = ['Tiếp tục đơn hàng', 'Tạo đơn ngay', 'Hủy đơn', ...(actionResult.quick_replies || [])];
    }

    // Đồng bộ lại trạng thái phiên hai chiều
    if (context.draft_order) context.active_so_draft = context.draft_order;
    if (context.active_so_draft) context.draft_order = context.active_so_draft;
    await updateContextState(conv.id, context);

    const latencyMs = Date.now() - startTime;
    const executionMs = Math.max(1, latencyMs - nluMs);
    const thoughtTrace = {
        thought: `Đã hiểu câu lệnh và phân tích intent [${intent}]. Trạng thái phiên: [${context.current_flow || 'IDLE'}]. Hoàn thành 3 nhịp suy luận. Độ trễ: ${latencyMs}ms.`,
        action: intent,
        latency_ms: latencyMs,
        latency_breakdown: {
            nlu_ms: nluMs,
            execution_ms: executionMs,
            total_ms: latencyMs
        }
    };

    await saveMessage(
        conv.id, 
        'assistant', 
        actionResult.text, 
        intent, 
        actionResult.action_type, 
        { ...(actionResult.card || {}), thought: thoughtTrace }
    );

    return {
        reply: actionResult.text,
        card: actionResult.card,
        action_type: actionResult.action_type,
        quick_replies: actionResult.quick_replies || [],
        thought: thoughtTrace,
        flow: context.current_flow || 'IDLE'
    };
}

module.exports = {
    processChatMessage,
    getOrCreateConversation,
    saveMessage,
    updateContextState,
    checkPermission,
    detectIntent,
    normalizeSolarInput,
    // 4 Standardized Tools for Antigravity Agentic Workflow
    tool_match_customer,
    tool_search_inventory_item,
    tool_mutate_sales_order_draft,
    tool_fetch_technical_datasheet,
    match_customer: tool_match_customer,
    search_inventory_item: tool_search_inventory_item,
    mutate_sales_order_draft: tool_mutate_sales_order_draft,
    fetch_technical_datasheet: tool_fetch_technical_datasheet,
    getActiveBusinessRules
};
