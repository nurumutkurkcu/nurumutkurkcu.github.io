// Nur Umut Kürkçü Temizlik ve Hijyen - Service Worker
// Sadece görsel kabuk (HTML/CSS/JS/ikon) önbelleğe alınır. Firebase/Firestore
// istekleri farklı bir alan adına gittiği için bu service worker'a hiç
// uğramaz — veri her zaman canlı ve senkron kalır.

const CACHE_NAME = 'nur-umut-shell-v5';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) { const clone = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(req, clone)); }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
