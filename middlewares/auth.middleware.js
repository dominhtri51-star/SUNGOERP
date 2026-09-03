const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "SUNGO_ERP_JWT_SUPER_SECRET_KEY_2026_@#!$";

/**
 * Danh sách các đường dẫn công khai (Public Endpoints)
 * Cho phép khách hàng hoặc hệ thống bên ngoài gọi mà không cần JWT người dùng nội bộ
 */
const PUBLIC_PREFIXES = [
    "/api/users/login",
    "/api/warranties/lookup",
    "/api/warranties/public",
    "/api/contracts/public",
    "/api/orders/public-quote",
    "/api/quotations/public",
    "/api/backup/run",
    "/api/upload"
];

/**
 * Middleware xác thực token JWT
 */
function authMiddleware(req, res, next) {
    const reqPath = req.originalUrl.split("?")[0];

    // Lấy token từ Authorization header (Bearer <token>) hoặc cookie/query nếu có
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    let token = null;

    if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.slice(7).trim();
    } else if (req.query && req.query.token) {
        token = req.query.token;
    }

    // Giải mã token nếu có (kể cả trên public route) để phục vụ phân quyền
    if (token) {
        try {
            req.user = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            // Token không hợp lệ
        }
    }

    // Bỏ qua xác thực bắt buộc cho các route công khai
    for (const prefix of PUBLIC_PREFIXES) {
        if (reqPath.startsWith(prefix)) {
            return next();
        }
    }

    // Cho phép GET /api/products công khai (để tra cứu bảo hành, giá vốn đã được ẩn)
    if (req.method === "GET" && reqPath === "/api/products") {
        return next();
    }

    if (!token || !req.user) {
        return res.status(401).json({
            success: false,
            code: "UNAUTHORIZED",
            error: "Yêu cầu đăng nhập để truy cập tài nguyên này!"
        });
    }

    next();
}

/**
 * Middleware kiểm tra phân quyền vai trò (Role-Based Access Control)
 * @param {string[]} allowedRoles - Mảng các vai trò được phép (ví dụ: ["ADMIN", "SUPER_ADMIN"])
 */
function requireRole(allowedRoles = []) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, error: "Chưa xác thực người dùng!" });
        }

        const userRole = String(req.user.role || "").toUpperCase().trim();
        const upperRoles = allowedRoles.map(r => String(r).toUpperCase().trim());

        if (userRole === "ADMIN" || userRole === "SUPER_ADMIN" || upperRoles.includes(userRole)) {
            return next();
        }

        return res.status(403).json({
            success: false,
            code: "FORBIDDEN",
            error: "Bạn không có quyền thực hiện thao tác này!"
        });
    };
}

/**
 * Tạo token JWT khi đăng nhập thành công
 */
function generateToken(userPayload) {
    return jwt.sign(
        {
            id: userPayload.id,
            emp_id: userPayload.emp_id,
            username: userPayload.username,
            full_name: userPayload.full_name,
            role: userPayload.role
        },
        JWT_SECRET,
        { expiresIn: "7d" } // Có hiệu lực trong 7 ngày
    );
}

module.exports = {
    authMiddleware,
    requireRole,
    generateToken,
    JWT_SECRET
};
