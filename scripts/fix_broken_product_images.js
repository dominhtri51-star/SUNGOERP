const db = require('../config/db');
const googleDriveService = require('../services/googleDrive.service');

const items = [
  { id: 647, sku: 'SP0155', name: 'Cergy_6kw.jpg', url: 'https://cdn.sobanhang.com/finan-prd/b1fd4be2-df5c-4e67-859a-9984bb2d0775/image/29077ac7-b18e-4325-9dd0-3a2bbd34961c.jpg' },
  { id: 763, sku: 'SP0509', name: 'Apess_IP65_16kw.jpg', url: 'https://cdn.sobanhang.com/finan-prd/b1fd4be2-df5c-4e67-859a-9984bb2d0775/image/5363fe89-1681-4bc6-8b0e-e327674b5bad.jpg' },
  { id: 764, sku: 'SP0519', name: 'Apess_IP65_20kw.jpg', url: 'https://cdn.sobanhang.com/finan-prd/b1fd4be2-df5c-4e67-859a-9984bb2d0775/image/5363fe89-1681-4bc6-8b0e-e327674b5bad.jpg' },
  { id: 762, sku: 'SP040', name: 'Apess_5kw_24v.jpeg', url: 'https://cdn.sobanhang.com/finan-prd/484ab604-447a-4043-aa4b-d87da1f2b3ed/image/c797f2cb-3c3c-4e86-a66a-fa1b6937652d.jpeg' },
  { id: 765, sku: 'SP0529', name: 'Cergy_12kw.jpg', url: 'https://cdn.sobanhang.com/finan-prd/b1fd4be2-df5c-4e67-859a-9984bb2d0775/image/29077ac7-b18e-4325-9dd0-3a2bbd34961c.jpg' },
  { id: 766, sku: 'SP0539', name: 'Cergy_20kw.jpg', url: 'https://cdn.sobanhang.com/finan-prd/b1fd4be2-df5c-4e67-859a-9984bb2d0775/image/29077ac7-b18e-4325-9dd0-3a2bbd34961c.jpg' },
  { id: 767, sku: 'SP0559', name: 'Apess_AIO_3kw.jpg', url: 'https://cdn.sobanhang.com/finan-prd/019560f9-b3ae-4997-bbc3-644f66b56d01/image/cafbc5de-9315-4b9f-9caf-591d783cdd5f.jpg' }
];

async function main() {
  console.log('🚀 Bắt đầu khôi phục và lưu vĩnh viễn 7 ảnh sản phẩm lên Google Cloud Storage...');
  for (const item of items) {
    try {
      console.log(`\n⏳ Đang tải ảnh cho [${item.sku}]...`);
      const resp = await fetch(item.url);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} khi tải ${item.url}`);
      }
      const arrayBuf = await resp.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const mime = resp.headers.get('content-type') || 'image/jpeg';

      const upRes = await googleDriveService.uploadFile({
        buffer,
        originalname: item.name,
        mimetype: mime,
        subfolder: 'products'
      });

      console.log(`✅ Đã lưu GCS: ${upRes.url}`);
      const dbRes = await db.query(
        'UPDATE products SET image_url = $1 WHERE id = $2 RETURNING id, sku, product_name, image_url',
        [upRes.url, item.id]
      );
      console.log(`✅ Đã cập nhật DB sản phẩm ID ${item.id} (${item.sku}):`, dbRes.rows[0].image_url);
    } catch (err) {
      console.error(`❌ Lỗi xử lý ${item.sku}:`, err.message);
    }
  }
  console.log('\n🎉 Đã hoàn tất toàn bộ 7 sản phẩm!');
  process.exit(0);
}

main();
