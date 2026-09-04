#!/bin/bash

# ==============================================================================
# SUNGO ERP - HỆ THỐNG TỰ ĐỘNG SAO LƯU DỮ LIỆU LÊN GOOGLE DRIVE
# Email: dominhtri51@gmail.com
# ==============================================================================

# Thiết lập đường dẫn thư mục gốc dự án
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RCLONE_BIN="$PROJECT_DIR/bin/rclone"
BACKUP_DIR="$PROJECT_DIR/backups"
LOG_FILE="$BACKUP_DIR/backup.log"

# Tên cấu hình remote trong rclone và thư mục lưu trên Google Drive
GDRIVE_REMOTE="gdrive:SUNGO_ERP_BACKUPS"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
PACKAGE_NAME="SUNGO_BACKUP_$TIMESTAMP"
TEMP_DIR="$BACKUP_DIR/$PACKAGE_NAME"

# Đảm bảo các thư mục cần thiết tồn tại
mkdir -p "$BACKUP_DIR"
mkdir -p "$TEMP_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=========================================================="
log "🚀 BẮT ĐẦU TIẾN TRÌNH SAO LƯU SUNGO ERP: $TIMESTAMP"
log "=========================================================="

# 0. Kiểm tra binary rclone
if [ ! -f "$RCLONE_BIN" ]; then
    if command -v rclone &> /dev/null; then
        RCLONE_BIN="rclone"
    else
        log "❌ Lỗi: Không tìm thấy công cụ rclone tại $RCLONE_BIN!"
        exit 1
    fi
fi

# Kiểm tra kết nối tới Google Drive
if ! "$RCLONE_BIN" listremotes | grep -q "^gdrive:"; then
    log "⚠️ Chưa kết nối tài khoản Google Drive 'dominhtri51@gmail.com'!"
    log "👉 Vui lòng chạy lệnh sau để xác thực tài khoản một lần duy nhất:"
    log "   ./scripts/setup_gdrive_auth.sh"
    exit 1
fi

# 1. Trích xuất Database PostgreSQL từ Supabase Cloud
log "⏳ [1/4] Đang trích xuất Cơ sở dữ liệu PostgreSQL (Supabase Cloud)..."
SUPA_HOST="aws-0-ap-northeast-1.pooler.supabase.com"
SUPA_USER="postgres.yxzumxqslbgxckxyiqxx"
SUPA_PASS="jurkeJ-hepta3-hozvut"

docker run --rm -e PGPASSWORD="$SUPA_PASS" postgres:17-alpine \
  pg_dump -h "$SUPA_HOST" -p 5432 -U "$SUPA_USER" -d postgres \
  --schema=public --no-owner --no-privileges > "$TEMP_DIR/database.sql" 2>/dev/null

if [ -s "$TEMP_DIR/database.sql" ]; then
    log "   ✅ Đã trích xuất CSDL Supabase thành công ($(du -h "$TEMP_DIR/database.sql" | cut -f1))"
elif docker ps | grep -q "solar_postgres_mac"; then
    log "   ⚠️ Không nối được Supabase, thử trích xuất từ Docker Local..."
    docker exec -t solar_postgres_mac pg_dump -U solar_admin solar_rms_local > "$TEMP_DIR/database.sql" 2>/dev/null
    log "   ✅ Đã trích xuất CSDL Local thành công ($(du -h "$TEMP_DIR/database.sql" | cut -f1))"
else
    log "   ❌ Lỗi: Không thể dump CSDL!"
    exit 1
fi

# 2. Thu thập tệp đính kèm, hình ảnh và cấu hình
log "⏳ [2/4] Đang sao chép thư mục uploads, file cấu hình..."
if [ -d "$PROJECT_DIR/public/uploads" ]; then
    cp -r "$PROJECT_DIR/public/uploads" "$TEMP_DIR/uploads" 2>/dev/null || true
fi
if [ -d "$PROJECT_DIR/data" ]; then
    cp -r "$PROJECT_DIR/data" "$TEMP_DIR/data" 2>/dev/null || true
fi
if [ -f "$PROJECT_DIR/.env" ]; then
    cp "$PROJECT_DIR/.env" "$TEMP_DIR/.env.backup" 2>/dev/null || true
fi

# 3. Đóng gói và nén
log "⏳ [3/4] Đang nén toàn bộ thành tệp $PACKAGE_NAME.tar.gz..."
ARCHIVE_PATH="$BACKUP_DIR/$PACKAGE_NAME.tar.gz"
tar -czf "$ARCHIVE_PATH" -C "$BACKUP_DIR" "$PACKAGE_NAME"
rm -rf "$TEMP_DIR"

ARCHIVE_SIZE=$(du -h "$ARCHIVE_PATH" | cut -f1)
log "   ✅ Đã đóng gói thành công ($ARCHIVE_SIZE)"

# 4. Tải lên Google Drive
log "⏳ [4/4] Đang đồng bộ lên Google Drive (Thư mục: SUNGO_ERP_BACKUPS)..."
"$RCLONE_BIN" copy "$ARCHIVE_PATH" "$GDRIVE_REMOTE"

if [ $? -eq 0 ]; then
    log "   ✅ ĐỒNG BỘ GOOGLE DRIVE THÀNH CÔNG!"
    log "   📍 File trên Drive: SUNGO_ERP_BACKUPS/$PACKAGE_NAME.tar.gz"
else
    log "   ❌ Lỗi đồng bộ lên Google Drive!"
    exit 1
fi

# 5. Dọn dẹp bản sao lưu cũ
log "🧹 Đang dọn dẹp các bản sao lưu cũ..."
# Xóa bản backup local cũ hơn 7 ngày
find "$BACKUP_DIR" -name "SUNGO_BACKUP_*.tar.gz" -type f -mtime +7 -delete 2>/dev/null || true

# Xóa bản backup trên Google Drive cũ hơn 30 ngày (tự động giải phóng dung lượng)
"$RCLONE_BIN" delete --min-age 30d "$GDRIVE_REMOTE" 2>/dev/null || true

log "🎉 HOÀN TẤT SAO LƯU DỮ LIỆU AN TOÀN!"
log "=========================================================="
