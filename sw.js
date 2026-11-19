/*
 * Service worker: cache-first offline shell.
 * When you add or rename a file the app loads, add it to ASSETS and bump CACHE_VERSION.
 */
const CACHE_VERSION = 'resibobz-v2';

// Use './' for the shell, never 'index.html': some static servers redirect
// /index.html, and a cached redirect breaks offline navigation.
const ASSETS = [
  './',
  'manifest.json',
  'css/app.css',
  'js/db.js',
  'js/app.js',
  'icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
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
