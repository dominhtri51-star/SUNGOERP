/**
 * Tiện ích chuẩn hóa và định dạng ngày giờ theo múi giờ chuẩn Việt Nam (Asia/Ho_Chi_Minh - GMT+7)
 * Tuân thủ 100% Nguyên Tắc Vàng: An toàn dữ liệu, không can thiệp CSDL.
 */

function normalizeIsoUtc(val) {
    if (!val) return val;
    if (val instanceof Date) return val.toISOString();
    let s = String(val).trim();
    if (!s) return s;
    if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
    if (!s.endsWith('Z') && !/[+-]\d{2}(:?\d{2})?$/.test(s)) s += 'Z';
    return s;
}

function parseVietnamDate(val) {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    const iso = normalizeIsoUtc(val);
    const d = new Date(iso);
    return isNaN(d.getTime()) ? new Date(val) : d;
}

function formatVietnamDateTime(val) {
    if (!val) return '';
    const d = parseVietnamDate(val);
    if (isNaN(d.getTime())) return String(val);
    return new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).format(d);
}

function formatVietnamDate(val) {
    if (!val) return '';
    const d = parseVietnamDate(val);
    if (isNaN(d.getTime())) return String(val);
    return new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(d);
}

function formatVietnamTime(val) {
    if (!val) return '';
    const d = parseVietnamDate(val);
    if (isNaN(d.getTime())) return String(val);
    return new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(d);
}

module.exports = {
    normalizeIsoUtc,
    parseVietnamDate,
    formatVietnamDateTime,
    formatVietnamDate,
    formatVietnamTime
};
