try { require('dotenv').config(); } catch (e) {}
const express = require('express');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('./middlewares/auth.middleware');

const app = express();

// Tự động khởi tạo cấu trúc CSDL và tài khoản admin mặc định
try { require('./config/initDb')(); } catch (e) { console.error('InitDB Error:', e); }

// ==========================================
// THIẾT LẬP BẢO MẬT HTTP HEADERS (HELMET)
// ==========================================
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    frameguard: { action: 'sameorigin' }
}));

// ==========================================
// GIỚI HẠN TẦN SUẤT ĐĂNG NHẬP (RATE LIMITING)
// ==========================================
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { success: false, error: '⚠️ Bạn đã thử đăng nhập quá nhiều lần! Vui lòng thử lại sau 15 phút.' },
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/api/users/login', loginLimiter);

// ==========================================
// MỞ KHÓA DUNG LƯỢNG VÀ TÀI NGUYÊN TĨNH
// ==========================================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public', {
    etag: false,
    setHeaders: (res, filePath) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
}));

// Fallback cho /uploads/*: nếu không có trên container disk, chuyển hướng sang GCS
app.get('/uploads/*', (req, res) => {
    const relPath = req.params[0];
    const localPath = path.join(__dirname, 'public/uploads', relPath);
    if (fs.existsSync(localPath)) {
        return res.sendFile(localPath);
    }
    return res.redirect(`https://storage.googleapis.com/sungo-erp-uploads/${relPath}`);
});

// ==========================================
// BẢO MẬT XÁC THỰC TRUNG TÂM (JWT AUTH)
// ==========================================
app.use('/api', authMiddleware);

// ==========================================
// CƠ CHẾ AUTO-ROUTER (TỰ ĐỘNG NẠP API)
// ==========================================
const apiDir = path.join(__dirname, 'api');
if (fs.existsSync(apiDir)) {
    fs.readdirSync(apiDir).forEach(file => {
        if (file.endsWith('.route.js')) {
            const moduleName = file.split('.')[0]; 
            app.use(`/api/${moduleName}`, require(`./api/${file}`));
            console.log(`🔌 Đã kết nối phân hệ API (Auto): /api/${moduleName}`);
        }
    });
}

// ==========================================
// KẾT NỐI API THỦ CÔNG (Nếu không dùng Auto)
// ==========================================
try { app.use('/api/attendance', require('./api/attendance.route')); } catch(e) {}
try { app.use('/api/om-schedules', require('./api/om.route')); } catch(e) {}
try { app.use('/api/crm', require('./api/customers.route')); } catch(e){}
try { app.use('/api/imports', require('./api/imports.route')); } catch(e){}
try { app.use('/api/vault', require('./api/vault.route')); } catch(e){}
try { app.use('/api/warehouse-kpi', require('./api/warehouse-kpi.route')); } catch(e){}

// ==========================================
// CỔNG DỊCH VỤ CÔNG KHAI (BẢO HÀNH & KÝ HĐ)
// ==========================================
app.get(['/warranty', '/baohanh', '/tra-cuu-bao-hanh', '/bao-hanh', '/warranty-portal'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'warranty.html'));
});
app.get(['/sign', '/ky-hop-dong'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'sign-contract.html'));
});

// ==========================================
// CHỐNG SẬP GIAO DIỆN & TRÁNH LỖI LỒNG TRANG
// ==========================================
app.get('*', (req, res) => {
    if (req.originalUrl.startsWith('/modules/') || req.originalUrl.startsWith('/api/')) {
        return res.status(404).send('<div class="p-10 text-center text-red-500 font-bold text-xl bg-red-50 rounded-xl border-2 border-red-200 mt-10"><i class="fas fa-bug text-5xl mb-4"></i><br>LỖI 404: MODULE NÀY ĐÃ ĐƯỢC TÁCH RA THEO CHUẨN MỚI!<br><span class="text-sm text-slate-600 mt-2 block">Sếp đang bấm vào Nút Menu cũ do kẹt Cache trình duyệt.<br>Hãy bấm <b>Shift + F5</b> (hoặc Cmd + Shift + R) để tải Menu mới nhất!</span></div>');
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('====================================');
    console.log(`🚀 HỆ THỐNG ERP LÕI ĐÃ KHỞI ĐỘNG (CỔNG ${PORT})`);
    console.log('====================================');
});