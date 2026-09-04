const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const dotenv = require('dotenv');

try { dotenv.config(); } catch (e) {}

const ENV_PATH = path.join(__dirname, '../.env');
const PORT = 3456;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

async function main() {
    console.log('\n======================================================');
    console.log('🔑 CẤU HÌNH OAUTH2 CHO GOOGLE DRIVE CÁ NHÂN (@GMAIL.COM)');
    console.log('======================================================\n');

    let clientId = process.env.GOOGLE_CLIENT_ID;
    let clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    // Kiểm tra nếu có file oauth-credentials.json
    const oauthJsonPath = path.join(__dirname, '../config/oauth-credentials.json');
    if (fs.existsSync(oauthJsonPath)) {
        try {
            const raw = JSON.parse(fs.readFileSync(oauthJsonPath, 'utf8'));
            const creds = raw.installed || raw.web || raw;
            clientId = creds.client_id || clientId;
            clientSecret = creds.client_secret || clientSecret;
        } catch (e) {}
    }

    if (!clientId || !clientSecret) {
        console.log('📌 HƯỚNG DẪN LẤY OAUTH CLIENT ID (Chỉ 1 phút):');
        console.log('1. Vào Google Cloud Console: https://console.cloud.google.com/apis/credentials');
        console.log('2. Bấm "Create Credentials" (Tạo thông tin xác thực) > Chọn "OAuth client ID".');
        console.log('   - Nếu chưa cấu hình "OAuth consent screen" (Màn hình đồng ý):');
        console.log('     + Chọn User Type: "External" (Bên ngoài) > Điền tên App (ví dụ: SUNGOERP) > Bấm Save.');
        console.log('   - Tại trang tạo OAuth Client ID:');
        console.log('     + Application type: Chọn "Desktop app" (Ứng dụng cho máy tính để bàn) hoặc "Web application".');
        console.log(`     + Nếu chọn Web application, thêm Authorized redirect URI: ${REDIRECT_URI}`);
        console.log('3. Copy Client ID và Client Secret, sau đó:');
        console.log('   - Thêm vào file .env:');
        console.log('     GOOGLE_CLIENT_ID=your_client_id_here');
        console.log('     GOOGLE_CLIENT_SECRET=your_client_secret_here\n');
        console.log('======================================================\n');
        return;
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/drive']
    });

    console.log('👉 VUI LÒNG MỞ ĐƯỜNG LINK DƯỚI ĐÂY TRÊN TRÌNH DUYỆT ĐỂ ĐĂNG NHẬP:');
    console.log('------------------------------------------------------');
    console.log(`\x1b[36m${authUrl}\x1b[0m`);
    console.log('------------------------------------------------------');
    console.log('⏳ Đang chờ bạn đăng nhập và bấm "Cho phép" trên trình duyệt...\n');

    // Khởi tạo HTTP Server tạm để nhận callback
    const server = http.createServer(async (req, res) => {
        try {
            if (req.url.startsWith('/oauth2callback')) {
                const qs = new url.URL(req.url, `http://localhost:${PORT}`).searchParams;
                const code = qs.get('code');

                if (code) {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end('<h1>✅ ĐĂNG NHẬP GOOGLE DRIVE THÀNH CÔNG!</h1><p>Bạn có thể đóng tab này và quay lại cửa sổ Terminal.</p>');

                    console.log('📥 Đã nhận mã xác thực từ Google. Đang lấy Refresh Token...');
                    const { tokens } = await oauth2Client.getToken(code);
                    const refreshToken = tokens.refresh_token;

                    if (refreshToken) {
                        console.log('✅ Đã nhận Refresh Token vĩnh viễn!');
                        
                        // Cập nhật file .env
                        let envContent = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
                        
                        const updateEnvKey = (key, val) => {
                            const regex = new RegExp(`^${key}=.*$`, 'm');
                            if (regex.test(envContent)) {
                                envContent = envContent.replace(regex, `${key}=${val}`);
                            } else {
                                envContent += `\n${key}=${val}`;
                            }
                        };

                        updateEnvKey('GOOGLE_CLIENT_ID', clientId);
                        updateEnvKey('GOOGLE_CLIENT_SECRET', clientSecret);
                        updateEnvKey('GOOGLE_REFRESH_TOKEN', refreshToken);

                        fs.writeFileSync(ENV_PATH, envContent.trim() + '\n');
                        console.log('💾 Đã lưu cấu hình vào file .env thành công!\n');

                        // Test upload ngay
                        console.log('🚀 Đang kiểm tra tải file mẫu lên Google Drive của bạn...');
                        oauth2Client.setCredentials(tokens);
                        const drive = google.drive({ version: 'v3', auth: oauth2Client });
                        
                        const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
                        const stream = require('stream');
                        const bufferStream = new stream.PassThrough();
                        bufferStream.end(Buffer.from(`SUNGOERP - Test Upload Google Drive Personal\nThời gian: ${new Date().toLocaleString('vi-VN')}`));

                        const uploadTest = await drive.files.create({
                            requestBody: {
                                name: `sungoerp_test_${Date.now()}.txt`,
                                parents: folderId ? [folderId] : undefined
                            },
                            media: {
                                mimeType: 'text/plain',
                                body: bufferStream
                            },
                            fields: 'id, name, webViewLink'
                        });

                        console.log('\n🎉🎉🎉 KẾT NỐI GOOGLE DRIVE THÀNH CÔNG 100%! 🎉🎉🎉');
                        console.log(`📁 File đã tải lên thư mục Drive: ${uploadTest.data.name}`);
                        console.log(`🔗 Link xem file: ${uploadTest.data.webViewLink}\n`);
                    } else {
                        console.log('⚠️ Không nhận được refresh_token mới (có thể do tài khoản đã cấp quyền trước đó).');
                    }

                    server.close();
                    process.exit(0);
                }
            }
        } catch (err) {
            console.error('❌ Lỗi khi xử lý OAuth callback:', err.message);
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<h1>Lỗi: ${err.message}</h1>`);
            server.close();
            process.exit(1);
        }
    }).listen(PORT);
}

main();
