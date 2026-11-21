/*
 * Service worker: cache-first offline shell.
 * When you add or rename a file the app loads, add it to ASSETS and bump CACHE_VERSION.
 */
const CACHE_VERSION = 'resibobz-v16';

// Use './' for the shell, never 'index.html': some static servers redirect
// /index.html, and a cached redirect breaks offline navigation.
const ASSETS = [
  './',
  'manifest.json',
  'css/app.css',
  'js/money.js',
  'js/receipt.js',
  'js/filter.js',
  'js/backup.js',
  'js/db.js',
  'js/ui.js',
  'js/typeahead.js',
  'js/pdf.js',
  'js/demo.js',
  'js/views/new.js',
  'js/views/history.js',
  'js/views/receipt.js',
  'js/views/products.js',
  'js/views/customers.js',
  'js/views/settings.js',
  'js/update.js',
  'js/app.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'lib/jspdf.umd.min.js',
  'lib/jspdf.plugin.autotable.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // cache: 'reload' bypasses the HTTP cache so a new version never caches stale files.
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req).catch(() =>
        req.mode === 'navigate' ? caches.match('./') : Response.error()
      );
    })
  );
});
