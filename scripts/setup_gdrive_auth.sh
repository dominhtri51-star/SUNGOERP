#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RCLONE_BIN="$PROJECT_DIR/bin/rclone"

echo "=========================================================="
echo "🔐 HƯỚNG DẪN KẾT NỐI GOOGLE DRIVE: dominhtri51@gmail.com"
echo "=========================================================="
echo ""
echo "Chuẩn bị mở trình duyệt đăng nhập Google..."
echo ""
echo "Các bước chọn nhanh trong giao diện:"
echo " 1. Nhập 'n' (Tạo kết nối mới)"
echo " 2. Đặt tên: gdrive"
echo " 3. Chọn số tương ứng với 'drive' (Google Drive)"
echo " 4. client_id & client_secret: Bấm Enter để bỏ qua"
echo " 5. scope: Nhập '1' (Full access)"
echo " 6. root_folder_id & service_account_file: Bấm Enter bỏ qua"
echo " 7. Edit advanced config?: Nhập 'n'"
echo " 8. Use auto config?: Nhập 'y' (Trình duyệt sẽ mở ra -> Đăng nhập tài khoản dominhtri51@gmail.com và Cho phép)"
echo " 9. Nhập 'y' xác nhận lưu -> Nhập 'q' để hoàn tất!"
echo ""
echo "Bấm Enter để bắt đầu..."
read -r

"$RCLONE_BIN" config
