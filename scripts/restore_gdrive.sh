#!/bin/bash

# ==============================================================================
# SUNGO ERP - HỆ THỐNG PHỤC HỒI DỮ LIỆU TỪ GOOGLE DRIVE
# Email: dominhtri51@gmail.com
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RCLONE_BIN="$PROJECT_DIR/bin/rclone"
BACKUP_DIR="$PROJECT_DIR/backups"
GDRIVE_REMOTE="gdrive:SUNGO_ERP_BACKUPS"

echo "=========================================================="
echo "🔄 KHÔI PHỤC DỮ LIỆU TỪ GOOGLE DRIVE"
echo "=========================================================="

if [ ! -f "$RCLONE_BIN" ]; then
    RCLONE_BIN="rclone"
fi

echo "📋 Danh sách các bản sao lưu có trên Google Drive:"
"$RCLONE_BIN" lsf "$GDRIVE_REMOTE"

TARGET_FILE="$1"

if [ -z "$TARGET_FILE" ]; then
    echo ""
    echo "💡 Lấy bản sao lưu mới nhất..."
    LATEST_BACKUP=$("$RCLONE_BIN" lsf "$GDRIVE_REMOTE" | sort -r | head -n 1)
    if [ -z "$LATEST_BACKUP" ]; then
        echo "❌ Không tìm thấy bản sao lưu nào trên Google Drive!"
        exit 1
    fi
    TARGET_FILE="$LATEST_BACKUP"
    echo "👉 Đã chọn bản mới nhất: $TARGET_FILE"
fi

mkdir -p "$BACKUP_DIR"

echo "⏳ Đang tải $TARGET_FILE từ Google Drive về máy..."
"$RCLONE_BIN" copy "$GDRIVE_REMOTE/$TARGET_FILE" "$BACKUP_DIR/"

if [ ! -f "$BACKUP_DIR/$TARGET_FILE" ]; then
    echo "❌ Lỗi tải file sao lưu về máy!"
    exit 1
fi

echo "⏳ Đang giải nén dữ liệu..."
TEMP_RESTORE="$BACKUP_DIR/restore_temp"
rm -rf "$TEMP_RESTORE"
mkdir -p "$TEMP_RESTORE"
tar -xzf "$BACKUP_DIR/$TARGET_FILE" -C "$TEMP_RESTORE"

EXTRACTED_FOLDER=$(ls -d "$TEMP_RESTORE"/SUNGO_BACKUP_* 2>/dev/null | head -n 1)

if [ -z "$EXTRACTED_FOLDER" ]; then
    EXTRACTED_FOLDER="$TEMP_RESTORE"
fi

# 1. Phục hồi Database
if [ -f "$EXTRACTED_FOLDER/database.sql" ]; then
    echo "⏳ Đang nạp lại CSDL vào PostgreSQL Docker (solar_postgres_mac)..."
    docker exec -i solar_postgres_mac psql -U solar_admin -d solar_rms_local < "$EXTRACTED_FOLDER/database.sql"
    echo "   ✅ Đã phục hồi CSDL PostgreSQL thành công!"
fi

# 2. Phục hồi thư mục uploads
if [ -d "$EXTRACTED_FOLDER/uploads" ]; then
    echo "⏳ Đang phục hồi tệp đính kèm uploads..."
    mkdir -p "$PROJECT_DIR/public/uploads"
    cp -r "$EXTRACTED_FOLDER/uploads/"* "$PROJECT_DIR/public/uploads/" 2>/dev/null || true
    echo "   ✅ Đã phục hồi thư mục uploads!"
fi

# 3. Phục hồi thư mục data
if [ -d "$EXTRACTED_FOLDER/data" ]; then
    echo "⏳ Đang phục hồi thư mục data..."
    mkdir -p "$PROJECT_DIR/data"
    cp -r "$EXTRACTED_FOLDER/data/"* "$PROJECT_DIR/data/" 2>/dev/null || true
    echo "   ✅ Đã phục hồi thư mục data!"
fi

rm -rf "$TEMP_RESTORE"
echo "=========================================================="
echo "🎉 HOÀN TẤT PHỤC HỒI DỮ LIỆU SUNGO ERP NGUYÊN VẸN!"
echo "=========================================================="
