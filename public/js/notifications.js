/**
 * =========================================================================
 * SUNGO ERP - UNIVERSAL REAL-TIME NOTIFICATIONS SYSTEM
 * Hỗ trợ: Tin nhắn mới (💬), Đơn hàng mới (📦), Báo giá mới (📑)
 * Nền tảng: Desktop & Mobile, Web Audio Chime, Toast Banner, Khay thông báo, Browser Push
 * =========================================================================
 */

window.modNotifications = {
    notifications: [],
    unreadCount: 0,
    isMuted: false,
    activeFilter: 'ALL',
    eventSource: null,
    pollingTimer: null,
    isPanelOpen: false,
    audioCtx: null,
    audioEl: null,
    isAudioUnlocked: false,

    // 1. Khởi tạo hệ thống thông báo
    init: async function() {
        if (window.__notifInitialized) return;
        window.__notifInitialized = true;

        // Đọc cài đặt âm thanh từ LocalStorage
        try {
            this.isMuted = localStorage.getItem('sungo_notif_muted') === 'true';
        } catch(e) {
            this.isMuted = false;
        }

        // Tạo đối tượng HTML5 Audio cho âm chuông thông báo chất lượng cao
        try {
            this.audioEl = new Audio('/audio/chime.wav');
            this.audioEl.preload = 'auto';
        } catch(e) {
            console.warn('[Notifications] Không thể tạo HTML5 Audio element:', e);
        }

        // Cập nhật trạng thái nút loa trên UI nếu có
        this.updateSoundToggleUI();

        // Kết nối SSE Real-time
        this.connectSSE();

        // Tải dữ liệu ban đầu
        await this.fetchNotifications();

        // Thiết lập Fallback Polling (15 giây) để đảm bảo không bỏ sót bất kỳ thông báo nào
        this.startPolling();

        // Mở khóa âm thanh (Bypass Browser Autoplay Policy) trên mọi tương tác của người dùng
        const unlockAudio = async () => {
            // 1. Mở khóa Web Audio Context
            try {
                const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
                if (AudioCtxClass) {
                    if (!this.audioCtx) this.audioCtx = new AudioCtxClass();
                    if (this.audioCtx.state === 'suspended') {
                        await this.audioCtx.resume();
                    }
                    if (this.audioCtx.state === 'running') {
                        this.isAudioUnlocked = true;
                    }
                }
            } catch(e) {}

            // 2. Mở khóa HTML5 Audio (phát nhẹ mức âm lượng siêu nhỏ để trình duyệt cấp phép vĩnh viễn cho phiên)
            try {
                if (this.audioEl && !this.isAudioUnlocked) {
                    this.audioEl.volume = 0.001;
                    const p = this.audioEl.play();
                    if (p && typeof p.then === 'function') {
                        p.then(() => {
                            this.audioEl.pause();
                            this.audioEl.currentTime = 0;
                            this.audioEl.volume = 1.0;
                            this.isAudioUnlocked = true;
                        }).catch(() => {});
                    }
                }
            } catch(e) {}
        };

        // Lắng nghe trên mọi sự kiện chạm, nhấp, gõ phím của người dùng
        ['click', 'touchstart', 'touchend', 'pointerdown', 'keydown'].forEach(evt => {
            window.addEventListener(evt, unlockAudio, { passive: true });
        });

        // Tự động khôi phục Audio Context khi người dùng quay lại tab
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this.audioCtx && this.audioCtx.state === 'suspended') {
                try { this.audioCtx.resume(); } catch(e) {}
            }
        });

        console.log('🔔 [Notifications] Hệ thống thông báo toàn ứng dụng đã sẵn sàng!');
    },

    // 2. Kết nối Server-Sent Events (SSE)
    connectSSE: function() {
        if (this.eventSource) {
            try { this.eventSource.close(); } catch(e) {}
            this.eventSource = null;
        }

        let token = localStorage.getItem('sungo_token');
        if (!token) {
            try {
                const u = JSON.parse(localStorage.getItem('sungo_user') || '{}');
                token = u.token || '';
            } catch(e) {}
        }

        if (!token) return;

        const sseUrl = '/api/notifications/stream?token=' + encodeURIComponent(token);
        try {
            this.eventSource = new EventSource(sseUrl);

            this.eventSource.addEventListener('notification', (e) => {
                try {
                    const notif = JSON.parse(e.data);
                    this.onNotificationReceived(notif);
                } catch(parseErr) {
                    console.error('[Notifications] Lỗi parse SSE:', parseErr);
                }
            });

            this.eventSource.onerror = () => {
                // Tự động kết nối lại sau 5s khi ngắt kết nối
                if (this.eventSource) {
                    try { this.eventSource.close(); } catch(e) {}
                    this.eventSource = null;
                }
                setTimeout(() => {
                    if (document.visibilityState === 'visible') {
                        this.connectSSE();
                    }
                }, 5000);
            };
        } catch(e) {
            console.warn('[Notifications] Trình duyệt không hỗ trợ SSE, chuyển sang Polling thuần:', e.message);
        }
    },

    // 3. Fallback Polling (15s)
    startPolling: function() {
        if (this.pollingTimer) clearInterval(this.pollingTimer);
        this.pollingTimer = setInterval(() => {
            if (document.visibilityState === 'visible') {
                this.fetchUnreadCount();
            }
        }, 15000);
    },

    // 4. Xử lý khi nhận được thông báo mới (cả real-time SSE hoặc Polling)
    onNotificationReceived: function(notif) {
        if (!notif || !notif.id) return;

        // Tránh trùng lặp nếu đã có trong danh sách
        const exists = this.notifications.some(n => n.id === notif.id);
        if (!exists) {
            this.notifications.unshift(notif);
            this.unreadCount = (this.unreadCount || 0) + 1;
            this.updateBadgeUI();
            this.renderNotificationList();
        }

        // Phát âm thanh chuông
        this.playChime();

        // Hiển thị Toast Banner nổi trên màn hình
        this.showToast(notif);

        // Hiển thị Web Notification nếu tab đang chạy ngầm / thu nhỏ
        this.showBrowserNotification(notif);
    },

    // 5. Tải danh sách thông báo từ Server
    fetchNotifications: async function() {
        try {
            const res = await fetch('/api/notifications?limit=50&t=' + Date.now());
            const json = await res.json();
            if (json.success && Array.isArray(json.data)) {
                this.notifications = json.data;
                this.unreadCount = typeof json.unread_count === 'number' ? json.unread_count : 0;
                this.updateBadgeUI();
                this.renderNotificationList();
            }
        } catch(e) {
            console.warn('[Notifications] Không thể tải danh sách thông báo:', e.message);
        }
    },

    // 6. Lấy nhanh số lượng chưa đọc
    fetchUnreadCount: async function() {
        try {
            const res = await fetch('/api/notifications/unread-count?t=' + Date.now());
            const json = await res.json();
            if (json.success && typeof json.unread_count === 'number') {
                const oldCount = this.unreadCount;
                this.unreadCount = json.unread_count;
                this.updateBadgeUI();
                // Nếu số lượng tăng lên so với trước, nạp lại danh sách mới nhất
                if (json.unread_count > oldCount) {
                    this.fetchNotifications();
                }
            }
        } catch(e) {}
    },

    // 7. Phát âm thanh chuông thông báo (Dual-Engine: HTML5 Audio + Web Audio Bell Synth + Vibration)
    playChime: async function() {
        if (this.isMuted) return false;

        // A. Rung thiết bị di động (Mobile Haptic Feedback)
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try { navigator.vibrate([160, 80, 160]); } catch(e) {}
        }

        let audioPlayed = false;

        // B. Động cơ 1: Phát qua thẻ HTML5 Audio (/audio/chime.wav)
        if (this.audioEl) {
            try {
                this.audioEl.currentTime = 0;
                this.audioEl.volume = 1.0;
                const p = this.audioEl.play();
                if (p && typeof p.then === 'function') {
                    await p;
                    audioPlayed = true;
                } else {
                    audioPlayed = true;
                }
            } catch(e) {
                // Trình duyệt chặn do chưa có tương tác hoặc lỗi codec
                audioPlayed = false;
            }
        }

        // C. Động cơ 2: Tổng hợp chuông ngân pha lê qua Web Audio API (Chime Synth)
        // Luôn kích hoạt bổ trợ để tạo âm thanh chuông 3 nốt ngân vang rõ ràng
        try {
            const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
            if (AudioCtxClass) {
                if (!this.audioCtx) this.audioCtx = new AudioCtxClass();
                if (this.audioCtx.state === 'suspended') {
                    await this.audioCtx.resume();
                }
                if (this.audioCtx.state === 'running') {
                    this.synthesizeBellChime(this.audioCtx);
                    audioPlayed = true;
                }
            }
        } catch(e) {
            console.warn('[Notifications] Không thể phát chuông Web Audio:', e.message);
        }

        return audioPlayed;
    },

    // Tổng hợp âm chuông 3 nốt ngân vang (F#5 -> B5 -> E6) âm lượng chuẩn, rõ ràng
    synthesizeBellChime: function(ctx) {
        if (!ctx) return;
        const now = ctx.currentTime;

        const playTone = (freq, startTime, duration, peakGain) => {
            try {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();

                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, startTime);

                gain.gain.setValueAtTime(0.001, startTime);
                gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start(startTime);
                osc.stop(startTime + duration);
            } catch(err) {}
        };

        // 3 nốt ngân vang tăng dần: F#5 (740 Hz) -> B5 (988 Hz) -> E6 (1318 Hz)
        playTone(739.99, now, 0.45, 0.45);
        playTone(987.77, now + 0.12, 0.55, 0.60);
        playTone(1318.51, now + 0.24, 0.70, 0.70);
    },

    // 8. Bấm thử chuông thông báo (người dùng bấm để nghe thử và mở khóa âm thanh ngay lập tức)
    testSound: async function() {
        if (this.isMuted) {
            this.toggleMute();
        }
        const played = await this.playChime();
        if (window.showToast) {
            window.showToast('success', '🔔 Đang phát thử chuông thông báo! Nếu không nghe thấy, sếp vui lòng kiểm tra âm lượng loa máy tính/điện thoại.');
        } else {
            alert('🔔 Đang phát thử chuông thông báo!');
        }
    },

    // 9. Bật / Tắt âm thanh thông báo
    toggleMute: function() {
        this.isMuted = !this.isMuted;
        try {
            localStorage.setItem('sungo_notif_muted', String(this.isMuted));
        } catch(e) {}
        this.updateSoundToggleUI();
        if (!this.isMuted) {
            this.playChime();
        }
    },

    updateSoundToggleUI: function() {
        const btn = document.getElementById('btn-toggle-notif-sound');
        if (btn) {
            if (this.isMuted) {
                btn.innerHTML = '<i class="fas fa-volume-mute text-red-400"></i> <span class="hidden sm:inline">Âm: Tắt</span>';
                btn.title = 'Đang tắt chuông thông báo (Bấm để Bật)';
                btn.classList.add('bg-red-500/10', 'text-red-400', 'border', 'border-red-500/30');
                btn.classList.remove('bg-slate-800', 'text-slate-300');
            } else {
                btn.innerHTML = '<i class="fas fa-volume-up text-emerald-400"></i> <span class="hidden sm:inline">Âm: Bật</span>';
                btn.title = 'Đang bật chuông thông báo (Bấm để Tắt)';
                btn.classList.remove('bg-red-500/10', 'text-red-400', 'border', 'border-red-500/30');
                btn.classList.add('bg-slate-800', 'text-slate-300');
            }
        }
    },

    // 9. Yêu cầu quyền thông báo đẩy trình duyệt (HTML5 Web Notifications)
    requestBrowserPermission: async function() {
        if (!('Notification' in window)) {
            alert('Trình duyệt của sếp không hỗ trợ thông báo đẩy ngoài màn hình!');
            return;
        }

        try {
            const perm = await Notification.requestPermission();
            this.updateBrowserPermUI();
            if (perm === 'granted') {
                new Notification('🔔 SUNGO ERP', {
                    body: 'Đã kích hoạt thông báo đẩy trình duyệt thành công!',
                    icon: '/icons/icon-192.png'
                });
            }
        } catch(e) {
            console.warn('[Notifications] Lỗi requestPermission:', e);
        }
    },

    updateBrowserPermUI: function() {
        const btn = document.getElementById('btn-notif-push-perm');
        if (!btn) return;

        if (!('Notification' in window)) {
            btn.classList.add('hidden');
            return;
        }

        if (Notification.permission === 'granted') {
            btn.classList.add('hidden');
        } else {
            btn.classList.remove('hidden');
        }
    },

    // 10. Bắn thông báo ra ngoài màn hình OS (khi tab ẩn hoặc thu nhỏ)
    showBrowserNotification: function(notif) {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        if (!document.hidden) return; // Nếu đang nhìn vào tab thì Toast đã hiển thị

        try {
            const sysNotif = new Notification(notif.title || 'Thông báo mới từ SUNGO ERP', {
                body: notif.body || '',
                icon: '/icons/icon-192.png',
                badge: '/icons/icon-192.png',
                silent: false,
                tag: 'sungo-notif-' + notif.id
            });

            sysNotif.onclick = () => {
                window.focus();
                sysNotif.close();
                if (notif.link) {
                    this.navigate(notif.id, notif.link);
                }
            };
        } catch(e) {}
    },

    // 11. Hiển thị biểu ngữ nổi (Interactive Toast Banner)
    showToast: function(notif) {
        const container = document.getElementById('notif-toast-container');
        if (!container) return;

        // Cấu hình icon và màu sắc theo loại
        let iconBg = 'bg-blue-500 text-white';
        let iconClass = 'fa-comments';
        let badgeText = 'Tin Nhắn';

        if (notif.type === 'ORDER') {
            iconBg = 'bg-emerald-500 text-white';
            iconClass = 'fa-boxes-packing';
            badgeText = 'Đơn Hàng Mới';
        } else if (notif.type === 'QUOTATION') {
            iconBg = 'bg-amber-500 text-slate-900';
            iconClass = 'fa-file-invoice-dollar';
            badgeText = 'Báo Giá Mới';
        } else if (notif.type === 'SYSTEM') {
            iconBg = 'bg-purple-500 text-white';
            iconClass = 'fa-bell';
            badgeText = 'Hệ Thống';
        }

        const toastId = 'toast-' + notif.id + '-' + Date.now();
        const toastEl = document.createElement('div');
        toastEl.id = toastId;
        toastEl.className = 'w-full max-w-sm sm:max-w-md bg-slate-900/95 backdrop-blur-md text-white rounded-2xl p-3.5 sm:p-4 shadow-2xl border border-slate-700/80 flex items-start gap-3.5 transform transition-all duration-300 ease-out translate-y-[-20px] opacity-0 pointer-events-auto cursor-pointer group hover:border-amber-400/50';

        const safeTitle = window.escapeHtml ? window.escapeHtml(notif.title) : notif.title;
        const safeBody = window.escapeHtml ? window.escapeHtml(notif.body) : notif.body;
        const linkTarget = notif.link || '';

        toastEl.innerHTML = `
            <div class="w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center shrink-0 shadow-md">
                <i class="fas ${iconClass} text-sm"></i>
            </div>
            <div class="flex-1 min-w-0" onclick="window.modNotifications.navigate(${notif.id}, '${linkTarget}'); window.modNotifications.dismissToast('${toastId}')">
                <div class="flex items-center gap-2 mb-0.5">
                    <span class="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-slate-800 text-amber-400 border border-slate-700">${badgeText}</span>
                    <span class="text-[10px] text-slate-400 font-medium">Vừa xong</span>
                </div>
                <h4 class="text-xs sm:text-sm font-bold text-white tracking-tight leading-snug group-hover:text-amber-400 transition truncate">${safeTitle}</h4>
                <p class="text-[11px] sm:text-xs text-slate-300 mt-0.5 line-clamp-2 leading-relaxed">${safeBody}</p>
                <div class="mt-2 flex items-center gap-2">
                    <span class="text-[11px] font-bold text-amber-400 flex items-center gap-1 group-hover:translate-x-0.5 transition">
                        <span>Xem ngay</span> <i class="fas fa-arrow-right text-[10px]"></i>
                    </span>
                </div>
            </div>
            <button onclick="event.stopPropagation(); window.modNotifications.dismissToast('${toastId}')" class="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition shrink-0" title="Đóng">
                <i class="fas fa-times text-xs"></i>
            </button>
        `;

        container.appendChild(toastEl);

        // Hiệu ứng trượt vào mượt mà
        requestAnimationFrame(() => {
            toastEl.classList.remove('translate-y-[-20px]', 'opacity-0');
            toastEl.classList.add('translate-y-0', 'opacity-100');
        });

        // Tự động tắt sau 6.5 giây
        setTimeout(() => {
            this.dismissToast(toastId);
        }, 6500);
    },

    // 12. Tắt toast
    dismissToast: function(toastId) {
        const el = document.getElementById(toastId);
        if (!el) return;
        el.classList.add('opacity-0', 'scale-95');
        setTimeout(() => {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, 300);
    },

    // 13. Cập nhật số đếm chưa đọc trên chuông Desktop & Mobile
    updateBadgeUI: function() {
        const deskBadge = document.getElementById('notif-badge-desktop');
        const mobBadge = document.getElementById('notif-badge-mobile');
        const countText = this.unreadCount > 99 ? '99+' : (this.unreadCount || '');

        [deskBadge, mobBadge].forEach(b => {
            if (!b) return;
            if (this.unreadCount > 0) {
                b.innerText = countText;
                b.classList.remove('hidden');
            } else {
                b.classList.add('hidden');
            }
        });
    },

    // 14. Bật / Tắt Khay Thông Báo (Notification Drawer / Panel)
    togglePanel: function(forceState) {
        const panel = document.getElementById('notif-drawer');
        const backdrop = document.getElementById('notif-backdrop');
        if (!panel) return;

        if (typeof forceState === 'boolean') {
            this.isPanelOpen = forceState;
        } else {
            this.isPanelOpen = !this.isPanelOpen;
        }

        if (this.isPanelOpen) {
            // Dọn sạch các toast nổi khi mở toàn bộ khay thông báo
            const toastContainer = document.getElementById('notif-toast-container');
            if (toastContainer) toastContainer.innerHTML = '';

            panel.classList.remove('translate-x-full');
            panel.classList.add('translate-x-0');
            if (backdrop) {
                backdrop.classList.remove('hidden');
                setTimeout(() => backdrop.classList.remove('opacity-0'), 10);
            }
            this.updateBrowserPermUI();
            this.renderNotificationList();
        } else {
            panel.classList.add('translate-x-full');
            panel.classList.remove('translate-x-0');
            if (backdrop) {
                backdrop.classList.add('opacity-0');
                setTimeout(() => backdrop.classList.add('hidden'), 300);
            }
        }
    },

    // 15. Lọc danh sách thông báo (Tất cả, Tin nhắn, Đơn hàng, Báo giá)
    setFilter: function(filter) {
        this.activeFilter = filter || 'ALL';

        // Cập nhật giao diện tab chip lọc
        const tabs = ['ALL', 'MESSAGE', 'ORDER', 'QUOTATION'];
        tabs.forEach(t => {
            const btn = document.getElementById(`notif-filter-${t.toLowerCase()}`);
            if (!btn) return;
            if (t === this.activeFilter) {
                btn.className = 'px-3 py-1.5 rounded-xl bg-amber-500 text-slate-900 font-bold text-xs shadow-xs transition';
            } else {
                btn.className = 'px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs transition';
            }
        });

        this.renderNotificationList();
    },

    // 16. Render danh sách thông báo ra Panel
    renderNotificationList: function() {
        const listEl = document.getElementById('notif-items-list');
        const emptyEl = document.getElementById('notif-empty-state');
        if (!listEl) return;

        let filtered = this.notifications || [];
        if (this.activeFilter !== 'ALL') {
            filtered = filtered.filter(n => n.type === this.activeFilter);
        }

        if (filtered.length === 0) {
            listEl.innerHTML = '';
            if (emptyEl) emptyEl.classList.remove('hidden');
            return;
        }

        if (emptyEl) emptyEl.classList.add('hidden');

        let html = '';
        filtered.forEach(notif => {
            const isRead = Boolean(notif.is_read);
            let iconBg = 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
            let iconClass = 'fa-comments';
            let typeLabel = 'Tin Nhắn';

            if (notif.type === 'ORDER') {
                iconBg = 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
                iconClass = 'fa-boxes-packing';
                typeLabel = 'Đơn Hàng Mới';
            } else if (notif.type === 'QUOTATION') {
                iconBg = 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
                iconClass = 'fa-file-invoice-dollar';
                typeLabel = 'Báo Giá Mới';
            } else if (notif.type === 'SYSTEM') {
                iconBg = 'bg-purple-500/20 text-purple-400 border border-purple-500/30';
                iconClass = 'fa-bell';
                typeLabel = 'Hệ Thống';
            }

            const timeStr = this.formatRelativeTime(notif.created_at);
            const safeTitle = window.escapeHtml ? window.escapeHtml(notif.title) : notif.title;
            const safeBody = window.escapeHtml ? window.escapeHtml(notif.body) : notif.body;
            const linkTarget = notif.link || '';

            html += `
                <div onclick="window.modNotifications.navigate(${notif.id}, '${linkTarget}')" class="p-3.5 sm:p-4 rounded-2xl transition cursor-pointer flex items-start gap-3.5 border ${isRead ? 'bg-slate-900/40 hover:bg-slate-800/60 border-slate-800/80 text-slate-400' : 'bg-slate-800 hover:bg-slate-750 border-slate-700 text-white shadow-xs group'}">
                    <div class="w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center shrink-0">
                        <i class="fas ${iconClass} text-sm"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center justify-between gap-2 mb-1">
                            <span class="text-[10px] font-black uppercase tracking-wider ${isRead ? 'text-slate-500' : 'text-amber-400'}">${typeLabel}</span>
                            <span class="text-[10px] text-slate-500">${timeStr}</span>
                        </div>
                        <h4 class="text-xs sm:text-sm font-bold ${isRead ? 'text-slate-300' : 'text-white group-hover:text-amber-400'} transition leading-snug line-clamp-1">${safeTitle}</h4>
                        <p class="text-[11px] sm:text-xs text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">${safeBody}</p>
                    </div>
                    ${!isRead ? '<span class="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0 mt-1 shadow-xs animate-pulse"></span>' : ''}
                </div>
            `;
        });

        listEl.innerHTML = html;
    },

    // 17. Đánh dấu tất cả đã đọc
    markAllAsRead: async function() {
        try {
            this.notifications.forEach(n => n.is_read = true);
            this.unreadCount = 0;
            this.updateBadgeUI();
            this.renderNotificationList();

            await fetch('/api/notifications/read-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
        } catch(e) {
            console.warn('[Notifications] Lỗi markAllAsRead:', e.message);
        }
    },

    // 18. Đánh dấu 1 thông báo đã đọc & Điều hướng màn hình
    navigate: async function(id, link) {
        // Đánh dấu đã đọc trong bộ nhớ
        const found = this.notifications.find(n => n.id === id);
        if (found && !found.is_read) {
            found.is_read = true;
            this.unreadCount = Math.max(0, (this.unreadCount || 1) - 1);
            this.updateBadgeUI();
            this.renderNotificationList();

            // Gửi API đánh dấu đọc
            fetch(`/api/notifications/${id}/read`, { method: 'POST' }).catch(() => {});
        }

        // Đóng khay thông báo
        this.togglePanel(false);

        if (!link) return;

        // Phân giải link điều hướng
        try {
            // Trường hợp: #workplace?channel_id=1 hoặc #order-history?order_id=123
            const parts = link.replace(/^#/, '').split('?');
            const moduleId = parts[0];
            const queryString = parts[1] || '';

            // Nếu hệ thống có hàm loadModule chuẩn
            if (typeof window.loadModule === 'function' && moduleId) {
                // Tự động gán search param vào hash để module con đọc được
                window.location.hash = link;
                await window.loadModule(moduleId);
            } else {
                window.location.hash = link;
            }
        } catch(e) {
            window.location.hash = link;
        }
    },

    // 19. Định dạng thời gian tương đối tiếng Việt
    formatRelativeTime: function(dateStr) {
        if (!dateStr) return '';
        try {
            const d = new Date(dateStr);
            const diff = Math.floor((Date.now() - d.getTime()) / 1000);
            if (diff < 30) return 'Vừa xong';
            if (diff < 60) return `${diff} giây trước`;
            if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
            if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
            if (diff < 604800) return `${Math.floor(diff / 86400)} ngày trước`;
            return d.toLocaleDateString('vi-VN');
        } catch(e) {
            return '';
        }
    },

    // 20. Bắn thông báo thử nghiệm nhanh
    sendTest: async function(type = 'ORDER') {
        try {
            let title = '📦 Đơn hàng thử nghiệm: DH-' + Math.floor(1000 + Math.random() * 9000);
            let body = 'Khách hàng: Công Ty Năng Lượng Xanh • Tổng: 45.000.000 đ';
            let link = '#order-history';

            if (type === 'MESSAGE') {
                title = '💬 [Phòng Kinh Doanh] Giám Đốc Minh Trí';
                body = 'Chào cả đội ngũ, hôm nay chúng ta có 3 dự án điện mặt trời mái nhà cần chốt sớm!';
                link = '#workplace';
            } else if (type === 'QUOTATION') {
                title = '📑 Báo giá mới: BG-HYB-' + Math.floor(1000 + Math.random() * 9000);
                body = 'Biệt Thự Thảo Điền • Hệ thống Hybrid 15kWp • 235.000.000 đ';
                link = '#boq-list';
            }

            const res = await fetch('/api/notifications/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, title, body, link })
            });
            const json = await res.json();
            if (json.success) {
                console.log('✅ Đã bắn thông báo thử nghiệm:', json.data);
            }
        } catch(e) {
            alert('Lỗi gửi thông báo test: ' + e.message);
        }
    }
};

// Tự động khởi chạy khi tài liệu nạp xong
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.modNotifications.init());
} else {
    window.modNotifications.init();
}
