const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Nạp biến môi trường từ .env
try { dotenv.config(); } catch (e) {}

const KEY_FILE_PATH = process.env.GOOGLE_DRIVE_KEY_PATH || path.join(__dirname, '../config/google-service-account.json');
const ENV_FILE_PATH = path.join(__dirname, '../.env');

async function runSetupCheck() {
    console.log('\n======================================================');
    console.log('🔍 KIỂM TRA & KẾT NỐI TỰ ĐỘNG GOOGLE DRIVE API');
    console.log('======================================================\n');

    // 1. Kiểm tra file key JSON
    if (!fs.existsSync(KEY_FILE_PATH)) {
        console.log('❌ [BƯỚC 1 CHƯA XONG] Chưa tìm thấy file key:');
        console.log(`   👉 Đường dẫn cần đặt: ${KEY_FILE_PATH}\n`);
        console.log('📌 Việc bạn cần làm:');
        console.log('   1. Đăng nhập Google Cloud Console: https://console.cloud.google.com/');
        console.log('   2. Bật Google Drive API & Tạo Service Account.');
        console.log('   3. Tải file JSON về, đổi tên thành "google-service-account.json"');
        console.log('   4. Đặt vào thư mục "config/" của dự án.');
        console.log('\n======================================================\n');
        return;
    }

    let keyData = null;
    try {
        keyData = JSON.parse(fs.readFileSync(KEY_FILE_PATH, 'utf-8'));
    } catch (e) {
        console.log('❌ File key JSON bị lỗi định dạng:', e.message);
        return;
    }

    const clientEmail = keyData.client_email;
    console.log('✅ [BƯỚC 1 HOÀN TẤT] Đã nhận diện Service Account:');
    console.log(`   📧 Email Service Account: \x1b[32m${clientEmail}\x1b[0m\n`);

    // 2. Kiểm tra Folder ID
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId || folderId === 'your_google_drive_folder_id_here') {
        console.log('⚠️ [BƯỚC 2 CẦN LÀM] Chưa cấu hình GOOGLE_DRIVE_FOLDER_ID trong file .env');
        console.log('📌 Việc bạn cần làm:');
        console.log('   1. Đăng nhập Google Drive của bạn (https://drive.google.com).');
        console.log('   2. Tạo 1 thư mục mới (ví dụ: "SUNGOERP_UPLOADS").');
        console.log(`   3. Bấm "Chia sẻ" (Share) thư mục đó cho email:\n      👉 \x1b[33m${clientEmail}\x1b[0m (Quyền: Người chỉnh sửa / Editor)`);
        console.log('   4. Mở thư mục đó trên trình duyệt, copy ID ở cuối link URL:');
        console.log('      https://drive.google.com/drive/folders/\x1b[36m[COPY_PHẦN_ID_NÀY]\x1b[0m');
        console.log('   5. Điền ID đó vào file .env: GOOGLE_DRIVE_FOLDER_ID=...\n');
        console.log('======================================================\n');
        return;
    }

    console.log(`✅ [BƯỚC 2 HOÀN TẤT] Đã cấu hình Folder ID: \x1b[36m${folderId}\x1b[0m\n`);

    // 3. Tiến hành test upload thực tế lên Google Drive
    console.log('🚀 [BƯỚC 3] Đang thử nghiệm tải 1 file mẫu lên Google Drive của bạn...');
    try {
        const driveService = require('../services/googleDrive.service');
        const testBuffer = Buffer.from(`SUNGOERP - File kiểm tra kết nối Google Drive tự động.\nThời gian: ${new Date().toLocaleString('vi-VN')}`);
        
        const uploadRes = await driveService.uploadFile({
            buffer: testBuffer,
            originalname: 'sungoerp_test_connection.txt',
            mimetype: 'text/plain',
            subfolder: 'system_test'
        });

        if (uploadRes.storage === 'google_drive') {
            console.log('\n🎉🎉🎉 CHÚC MỪNG BẠN! KẾT NỐI GOOGLE DRIVE THÀNH CÔNG 100%! 🎉🎉🎉');
            console.log(`   - File ID: ${uploadRes.fileId}`);
            console.log(`   - Link xem trên Drive: ${uploadRes.webViewLink || uploadRes.url}`);
            console.log('\n👉 Kể từ bây giờ, tất cả ảnh, hợp đồng, chứng từ tải lên ERP sẽ tự động lưu vào Google Drive của bạn!\n');
        } else {
            console.log('⚠️ Upload bị rơi về Local Storage. Vui lòng kiểm tra lại quyền chia sẻ thư mục Drive cho email Service Account.');
        }
    } catch (err) {
        console.log('❌ Lỗi khi tải file thử nghiệm:', err.message);
    }
    console.log('======================================================\n');
}

runSetupCheck();
