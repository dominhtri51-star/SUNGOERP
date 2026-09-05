const db = require('../config/db');
const googleDriveService = require('../services/googleDrive.service');

async function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function fetchWithRetry(url, maxRetries = 2) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
                }
            });
            clearTimeout(timeoutId);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const arrayBuf = await res.arrayBuffer();
            const buffer = Buffer.from(arrayBuf);
            const mime = res.headers.get('content-type') || 'image/jpeg';
            return { buffer, mime };
        } catch (err) {
            if (attempt === maxRetries) throw err;
            await delay(1000);
        }
    }
}

async function main() {
    console.log('🚀 Bắt đầu quét toàn bộ ảnh từ sobanhang.com và di chuyển về Google Cloud Storage...');
    
    const queryRes = await db.query(`
        SELECT id, sku, product_name, image_url 
        FROM products 
        WHERE image_url LIKE '%sobanhang.com%'
        ORDER BY id ASC
    `);

    const products = queryRes.rows;
    const total = products.length;
    console.log(`📦 Tìm thấy ${total} sản phẩm có link ảnh từ sobanhang.com.`);

    if (total === 0) {
        console.log('✅ Tất cả sản phẩm đã được lưu trữ trên hệ thống của SUNGO!');
        process.exit(0);
    }

    const urlCache = new Map(); // origUrl -> gcsUrl
    let successCount = 0;
    let reusedCount = 0;
    let errorCount = 0;
    const errors = [];

    const CONCURRENCY = 4;
    let currentIndex = 0;

    async function worker(workerId) {
        while (currentIndex < total) {
            const idx = currentIndex++;
            const p = products[idx];
            const origUrl = p.image_url.trim();

            try {
                let gcsUrl = urlCache.get(origUrl);

                if (gcsUrl) {
                    // Tái sử dụng link GCS đã upload trước đó
                    await db.query('UPDATE products SET image_url = $1 WHERE id = $2', [gcsUrl, p.id]);
                    reusedCount++;
                    successCount++;
                    console.log(`[${idx + 1}/${total}] 🔄 [Worker ${workerId}] SKU ${p.sku} (ID: ${p.id}) dùng lại GCS: ${gcsUrl}`);
                } else {
                    // Tải ảnh từ Sổ Bán Hàng CDN
                    const { buffer, mime } = await fetchWithRetry(origUrl);

                    let ext = '.jpg';
                    if (mime.includes('png')) ext = '.png';
                    else if (mime.includes('webp')) ext = '.webp';
                    else if (mime.includes('jpeg') || mime.includes('jpg')) ext = '.jpg';

                    const cleanSku = (p.sku || 'prod').replace(/[^a-zA-Z0-9_-]/g, '_');
                    const fileName = `${cleanSku}_${Date.now()}${ext}`;

                    const upRes = await googleDriveService.uploadFile({
                        buffer,
                        originalname: fileName,
                        mimetype: mime,
                        subfolder: 'products'
                    });

                    if (!upRes || !upRes.url) {
                        throw new Error('Upload lên GCS không trả về URL');
                    }

                    gcsUrl = upRes.url;
                    urlCache.set(origUrl, gcsUrl);

                    await db.query('UPDATE products SET image_url = $1 WHERE id = $2', [gcsUrl, p.id]);
                    successCount++;
                    console.log(`[${idx + 1}/${total}] ✅ [Worker ${workerId}] SKU ${p.sku} (ID: ${p.id}) -> GCS: ${gcsUrl}`);
                }
            } catch (err) {
                errorCount++;
                errors.push({ id: p.id, sku: p.sku, url: origUrl, error: err.message });
                console.error(`[${idx + 1}/${total}] ❌ [Worker ${workerId}] LỖI SKU ${p.sku} (ID: ${p.id}):`, err.message);
            }
        }
    }

    const workers = [];
    for (let i = 1; i <= CONCURRENCY; i++) {
        workers.push(worker(i));
    }

    await Promise.all(workers);

    console.log('\n==========================================');
    console.log('🎉 TỔNG KẾT QUÁ TRÌNH DI CHUYỂN ẢNH:');
    console.log(`- Tổng sản phẩm cần xử lý: ${total}`);
    console.log(`- Thành công: ${successCount}`);
    console.log(`  + Tải mới và đẩy lên GCS: ${urlCache.size}`);
    console.log(`  + Dùng lại ảnh trùng lặp: ${reusedCount}`);
    console.log(`- Lỗi: ${errorCount}`);
    if (errors.length > 0) {
        console.log('Chi tiết các sản phẩm lỗi:', errors);
    }
    console.log('==========================================');

    process.exit(errorCount > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
