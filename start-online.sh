#!/bin/bash
echo "🚀 Đang kiểm tra hệ thống Solar RMS ERP..."

# Kiểm tra nếu server node chưa chạy thì bật
if ! lsof -i :3000 > /dev/null 2>&1; then
    echo "📦 Đang khởi động Node.js server trên cổng 3000..."
    node server.js &
    sleep 2
else
    echo "✅ Server Node.js đang chạy trên cổng 3000."
fi

echo "🌐 Đang kích hoạt đường truyền Online (HTTPS)..."
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:localhost:3000 nokey@localhost.run
