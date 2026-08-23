try { require('dotenv').config(); } catch (e) {}
const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express(); // Biến app được khởi tạo ở đây

// ==========================================
// MỞ KHÓA DUNG LƯỢNG 50MB (QUAN TRỌNG NHẤT)
// ==========================================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public')); // Cổng mở giao diện

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
// Đã dán router O&M xuống dưới này, an toàn 100%
try { app.use('/api/om-schedules', require('./api/om.route')); } catch(e) {}
try { app.use('/api/crm', require('./api/customers.route')); } catch(e){}
try { app.use('/api/vault', require('./api/imports.route')); } catch(e){}

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