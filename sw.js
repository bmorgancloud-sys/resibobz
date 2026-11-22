/*
 * Service worker: cache-first offline shell.
 * When you add or rename a file the app loads, add it to ASSETS and bump CACHE_VERSION.
 */
const CACHE_VERSION = 'resibobz-v30';

// Use './' for the shell, never 'index.html': some static servers redirect
// /index.html, and a cached redirect breaks offline navigation.
const ASSETS = [
  './',
  'manifest.json',
  'css/app.css',
  'js/money.js',
  'js/receipt.js',
  'js/filter.js',
  'js/summary.js',
  'js/stats.js',
  'js/quote.js',
  'js/backup.js',
  'js/db.js',
  'js/ui.js',
  'js/stats-ui.js',
  'js/typeahead.js',
  'js/autosave.js',
  'js/editor.js',
  'js/pdf.js',
  'js/detail.js',
  'js/demo.js',
  'js/views/new.js',
  'js/views/history.js',
  'js/views/receipt.js',
  'js/views/summary.js',
  'js/views/quotes.js',
  'js/views/quote.js',
  'js/views/quote-edit.js',
  'js/views/stats.js',
  'js/views/products.js',
  'js/views/customers.js',
  'js/views/settings.js',
  'js/update.js',
  'js/app.js',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'lib/jspdf.umd.min.js',
  'lib/jspdf.plugin.autotable.min.js',
  'lib/chart.umd.min.js',
];

// Installs up to resibobz-v18 run an update.js that has no "tap to reload" prompt and never sends
// SKIP_WAITING, so a waiting worker would sit there until every tab closed. Take over from those
// once; their update.js then reloads the page when it is safe.
const LEGACY_CACHE = /^resibobz-v([1-9]|1[0-8])$/;

// A new version installs, then waits: js/update.js shows "Update available, tap to reload"
// and posts SKIP_WAITING when the user taps it. The first install has nothing to wait for.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // cache: 'reload' bypasses the HTTP cache so a new version never caches stale files.
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => caches.keys())
      .then((keys) => { if (keys.some((k) => LEGACY_CACHE.test(k))) return self.skipWaiting(); })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  // Settings > App version asks the worker that controls the page, so it shows the code really running.
  if (event.data && event.data.type === 'GET_VERSION' && event.ports[0]) event.ports[0].postMessage(CACHE_VERSION);
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Dev pages under tests/ (stats.test.html, seed.html) always load the files on disk, never this
// cache, so they test the code being edited. Nothing under tests/ is ever precached.
const TESTS_PREFIX = new URL('tests/', self.registration.scope).href;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.url.startsWith(TESTS_PREFIX) || req.referrer.startsWith(TESTS_PREFIX)) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req).catch(() =>
        req.mode === 'navigate' ? caches.match('./') : Response.error()
      );
    })
  );
});
