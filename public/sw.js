const CACHE = 'pocketscan-v23';
const ASSETS = ['/', '/index.html', '/src/app.js', '/src/style.css', '/src/image.js', '/src/pdf.js', '/src/storage.js', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then(hit => hit || caches.match('/index.html'))));
});
