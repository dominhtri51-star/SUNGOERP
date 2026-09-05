// SUNGO ERP - PWA Installer & Service Worker Manager
(function() {
    'use strict';

    // 1. Đăng ký Service Worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function() {
            navigator.serviceWorker.register('/sw.js', { scope: '/' })
                .then(function(reg) {
                    reg.onupdatefound = function() {
                        const installingWorker = reg.installing;
                        if (installingWorker) {
                            installingWorker.onstatechange = function() {
                                if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                    console.log('SUNGO ERP có phiên bản mới. Đã sẵn sàng cập nhật!');
                                }
                            };
                        }
                    };
                })
                .catch(function(err) {
                    console.warn('Đăng ký ServiceWorker không thành công:', err);
                });
        });
    }

    // 2. Kiểm tra nếu app đang chạy ở chế độ Standalone (đã cài đặt)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                         window.navigator.standalone === true ||
                         document.referrer.includes('android-app://');

    let deferredPrompt = null;

    // Hàm gọi cài đặt chủ động
    window.triggerPwaInstall = function() {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then(function(res) {
                if (res.outcome === 'accepted') {
                    console.log('Người dùng đã cài đặt SUNGO ERP');
                }
                deferredPrompt = null;
                const banner = document.getElementById('pwa-install-banner');
                if (banner) banner.remove();
            });
        } else {
            alert('📱 Cách cài đặt SUNGO ERP vào điện thoại:\n\n1. Trên trình duyệt Chrome / Cốc Cốc, nhấn vào biểu tượng dấu 3 chấm (⋮) ở góc trên bên phải màn hình.\n2. Chọn "Cài đặt ứng dụng" (hoặc "Thêm vào màn hình chính").\n3. Biểu tượng ứng dụng SUNGO ERP sẽ xuất hiện ngoài màn hình điện thoại!');
        }
    };

    function updateInstallButtons() {
        const btns = document.querySelectorAll('.pwa-install-trigger, #sidebar-install-pwa-btn');
        btns.forEach(function(btn) {
            if (!isStandalone) {
                btn.classList.remove('hidden');
            } else {
                btn.classList.add('hidden');
            }
        });
    }

    if (isStandalone) {
        // Đang mở dạng App PWA -> không hiển thị banner
        return;
    }

    // Kiểm tra nếu người dùng đã bấm tắt banner trong 3 ngày qua
    const dismissKey = 'sungo_pwa_prompt_dismissed';
    const lastDismissed = localStorage.getItem(dismissKey);
    const shouldShowBanner = !lastDismissed || (Date.now() - parseInt(lastDismissed, 10)) > 3 * 24 * 60 * 60 * 1000;

    // Tạo Banner UI Cài Đặt
    function createInstallBanner() {
        if (!shouldShowBanner) return;
        if (document.getElementById('pwa-install-banner')) return;

        const banner = document.createElement('div');
        banner.id = 'pwa-install-banner';
        banner.className = 'fixed bottom-18 sm:bottom-6 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-sm z-35 bg-slate-900/95 backdrop-blur-md border border-amber-500/40 text-white p-4 rounded-2xl shadow-2xl transition-all duration-300 transform translate-y-0 flex flex-col gap-3';
        
        banner.innerHTML = `
            <div class="flex items-center gap-3">
                <img src="/icons/icon-192.png" alt="SUNGO ERP" class="w-11 h-11 rounded-xl shadow-md border border-amber-500/30 shrink-0">
                <div class="flex-1 min-w-0">
                    <h4 class="text-sm font-black text-amber-400 truncate">Cài Đặt App SUNGO ERP</h4>
                    <p class="text-xs text-slate-300 leading-tight mt-0.5">Dùng toàn màn hình, mượt mà & mở ngay từ màn hình chính điện thoại.</p>
                </div>
                <button id="pwa-close-btn" class="text-slate-400 hover:text-white p-1 text-sm rounded-lg transition cursor-pointer" title="Đóng">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="flex gap-2 mt-1">
                <button id="pwa-install-btn" class="flex-1 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-black py-2.5 px-3 rounded-xl text-xs uppercase tracking-wider shadow-lg shadow-amber-500/25 flex items-center justify-center gap-2 transition active:scale-95 cursor-pointer">
                    <i class="fas fa-download"></i>
                    <span>Cài Đặt Ngay</span>
                </button>
            </div>
        `;

        document.body.appendChild(banner);

        document.getElementById('pwa-install-btn').addEventListener('click', function() {
            window.triggerPwaInstall();
        });

        document.getElementById('pwa-close-btn').addEventListener('click', function() {
            localStorage.setItem(dismissKey, Date.now().toString());
            banner.remove();
        });
    }

    // Lắng nghe sự kiện cài đặt của Android Chrome
    window.addEventListener('beforeinstallprompt', function(e) {
        e.preventDefault();
        deferredPrompt = e;
        updateInstallButtons();
        setTimeout(createInstallBanner, 1500);
    });

    // Lắng nghe khi cài đặt thành công
    window.addEventListener('appinstalled', function() {
        deferredPrompt = null;
        const banner = document.getElementById('pwa-install-banner');
        if (banner) banner.remove();
        updateInstallButtons();
        console.log('App SUNGO ERP đã được cài đặt thành công!');
    });

    document.addEventListener('DOMContentLoaded', function() {
        updateInstallButtons();
    });
})();
