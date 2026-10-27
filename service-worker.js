/**
 * Service worker — hanya untuk cache file frontend (bukan database).
 * Data dari Google Apps Script selalu diambil langsung dari server.
 * Naikkan CACHE_VERSION setiap kali merilis perubahan besar.
 */
const CACHE_VERSION = 'homie-v2';
const APP_SHELL = [
  './', './index.html', './manifest.json',
  './css/style.css', './css/responsive.css',
  './js/app.js', './js/api.js', './js/utils.js', './js/ui.js', './js/dashboard.js', './js/finance.js',
  './js/creditcard.js', './js/shopping.js', './js/agenda.js', './js/documents.js', './js/reports.js',
  './js/settings.js', './js/demo-backend.js',
  './assets/icons/icon.svg', './assets/icons/icon-192.png', './assets/icons/icon-512.png'
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Jangan pernah cache API Google Apps Script.
  if (url.hostname.endsWith('script.google.com') || url.hostname.endsWith('googleusercontent.com')) return;

  if (url.origin === self.location.origin) {
    // Network first: selalu versi terbaru bila online, cache bila offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    // Stale-while-revalidate untuk library & font dari CDN.
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((response) => {
          if (response.ok || response.type === 'opaque') {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        }).catch(() => cached);
        return cached || network;
      })
    );
  }
});
