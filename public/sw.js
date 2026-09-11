// SUNGO ERP - Service Worker for PWA
const CACHE_NAME = 'sungo-erp-v2-ai-20260909';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/baohanh.html',
  '/js/ai-assistant.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('SW cache.addAll warning:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Không cache API hoặc các request không phải GET
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  // Network-First đối với các trang HTML (luôn cập nhật code mới nhất từ server)
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            return cached || caches.match('/dashboard.html') || caches.match('/index.html');
          });
        })
    );
    return;
  }

  // Cache fallback cho icons / static assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

// =========================================================================
// PWA WEB PUSH NOTIFICATION (Chạy ngầm khi tắt app / màn hình điện thoại)
// =========================================================================
self.addEventListener('push', (event) => {
  let data = {
    title: '💬 SUNGO Workplace',
    body: 'Bạn có tin nhắn hoặc thông báo mới trong hệ thống',
    url: '/dashboard.html#workplace',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png'
  };

  if (event.data) {
    try {
      const json = event.data.json();
      data = Object.assign(data, json);
    } catch (e) {
      data.body = event.data.text() || data.body;
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: data.tag || 'sungo-workplace-msg',
    renotify: true,
    data: {
      url: data.url || '/dashboard.html#workplace'
    },
    actions: [
      { action: 'open', title: 'Mở xem ngay' },
      { action: 'close', title: 'Đóng' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'close') {
    return;
  }

  const targetUrl = (event.notification.data && event.notification.data.url) || '/dashboard.html#workplace';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Nếu đã có tab đang mở -> chuyển tới tab đó và điều hướng
      for (const client of clientList) {
        if ('focus' in client) {
          if (client.url.includes('/dashboard.html')) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
      }
      // Nếu chưa có tab nào mở -> mở cửa sổ mới
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

