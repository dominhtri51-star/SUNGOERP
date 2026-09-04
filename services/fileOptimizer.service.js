const sharp = require('sharp');
const path = require('path');

/**
 * FILE OPTIMIZER SERVICE
 * Tự động tối ưu dung lượng hình ảnh (giảm 85% - 95% dung lượng gốc)
 * Giúp ổ cứng của máy chủ không bao giờ bị quá tải kể cả khi nhân viên tải ảnh dung lượng lớn (5-15MB).
 */
class FileOptimizerService {
    /**
     * Tối ưu hóa buffer ảnh (resize, nén WebP/JPEG chất lượng cao)
     * @param {Buffer} buffer
     * @param {string} mimetype
     * @param {Object} options
     * @returns {Promise<{buffer: Buffer, mimetype: string, originalSize: number, optimizedSize: number, savedPercent: number}>}
     */
    async optimizeImage(buffer, mimetype = 'image/jpeg', options = {}) {
        if (!buffer || !Buffer.isBuffer(buffer)) {
            return { buffer, mimetype, originalSize: 0, optimizedSize: 0, savedPercent: 0 };
        }

        const originalSize = buffer.length;

        // Nếu không phải file ảnh hoặc file quá nhỏ (< 50KB), giữ nguyên
        if (!mimetype || !mimetype.startsWith('image/') || originalSize < 50 * 1024) {
            return {
                buffer,
                mimetype,
                originalSize,
                optimizedSize: originalSize,
                savedPercent: 0
            };
        }

        try {
            const maxWidth = options.maxWidth || 1920;
            const maxHeight = options.maxHeight || 1920;
            const quality = options.quality || 80;

            // Xử lý nén ảnh thông minh bằng sharp
            let pipeline = sharp(buffer, { failOnError: false })
                .rotate() // Tự động xoay đúng chiều theo EXIF metadata của smartphone
                .resize({
                    width: maxWidth,
                    height: maxHeight,
                    fit: sharp.fit.inside,
                    withoutEnlargement: true
                });

            let optimizedBuffer;
            let outputMime = mimetype;

            if (mimetype === 'image/png') {
                optimizedBuffer = await pipeline.png({ quality: quality, compressionLevel: 8 }).toBuffer();
            } else if (mimetype === 'image/webp') {
                optimizedBuffer = await pipeline.webp({ quality: quality }).toBuffer();
            } else {
                // Mặc định JPEG/JPG
                optimizedBuffer = await pipeline.jpeg({ quality: quality, mozjpeg: true }).toBuffer();
                outputMime = 'image/jpeg';
            }

            // Nếu sau khi nén dung lượng nhỏ hơn bản gốc thì dùng bản nén
            if (optimizedBuffer && optimizedBuffer.length < originalSize) {
                const optimizedSize = optimizedBuffer.length;
                const savedPercent = Math.round(((originalSize - optimizedSize) / originalSize) * 100);
                return {
                    buffer: optimizedBuffer,
                    mimetype: outputMime,
                    originalSize,
                    optimizedSize,
                    savedPercent
                };
            }

            return { buffer, mimetype, originalSize, optimizedSize: originalSize, savedPercent: 0 };
        } catch (error) {
            console.warn('⚠️ [Optimizer] Không thể nén ảnh, sử dụng buffer gốc:', error.message);
            return { buffer, mimetype, originalSize, optimizedSize: originalSize, savedPercent: 0 };
        }
    }
}

module.exports = new FileOptimizerService();
