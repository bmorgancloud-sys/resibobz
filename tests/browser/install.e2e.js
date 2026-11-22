// Browser test: the install guide at /install (install.html + install.css + install.js, how-to.mp4,
// how-to-poster.jpg). It runs under the production CSP (no inline styles or scripts), and none of its
// files are precached or served by the service worker.
//
// Run with: node --test "tests/browser/*.e2e.js"
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('./harness.js');

const ROOT = path.resolve(__dirname, '..', '..');
const GUIDE_FILES = ['install.html', 'install.css', 'install.js', 'how-to.mp4', 'how-to-poster.jpg'];

let page, evaluate;

test.before(async () => {
  page = await harness.open('#/new');   // the app registers its service worker first
  ({ evaluate } = page);
  await page.waitFor('!!navigator.serviceWorker.controller', 'service worker to take control', 15000);
});

test.after(async () => {
  if (page) await page.close();
});

test('install.html has no inline styles or scripts (the CSP would block them)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'install.html'), 'utf8');
  assert.doesNotMatch(html, /<style|style="|<script>(?!<\/script>)|<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.match(html, /<link rel="stylesheet" href="install\.css">/);
  assert.match(html, /<script src="install\.js"><\/script>/);
  assert.doesNotMatch(html, /501XXXXXXX/, 'help link still has the placeholder number');
  for (const f of GUIDE_FILES) assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' exists');
});

test('netlify.toml serves /install from install.html', () => {
  const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
  assert.match(toml, /\[\[redirects\]\]\s*from = "\/install"\s*to = "\/install\.html"\s*status = 200/);
});

for (const route of ['install', 'install.html']) {
  test(`/${route} loads with its stylesheet and script working`, async () => {
    await page.goto(page.base + route);
    await page.waitFor('document.readyState === "complete"', 'install page');
    const r = await evaluate(`(() => {
      const sel = [...document.querySelectorAll('.tab')].filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.id);
      const shown = [...document.querySelectorAll('.panel.on')].map((p) => p.id);
      return {
        title: document.title,
        bodyFont: getComputedStyle(document.body).fontSize,                 // 19px comes from install.css
        headerBg: getComputedStyle(document.querySelector('header')).backgroundImage,
        selected: sel, shown,
        guess: document.getElementById('guess').textContent,              // changed by install.js
        help: document.querySelector('a[href^="https://wa.me/"]').getAttribute('href'),
        video: document.querySelector('video').getAttribute('src'),
        poster: document.querySelector('video').getAttribute('poster'),
        logo: document.querySelector('header img').naturalWidth,
      };
    })()`);
    assert.equal(r.title, 'Get Toucan Bill on your phone');
    assert.equal(r.bodyFont, '19px', 'install.css did not apply');
    assert.match(r.headerBg, /gradient/, 'blue header gradient missing');
    assert.equal(r.selected.length, 1, 'install.js should select one tab');
    assert.equal(r.shown.length, 1);
    assert.match(r.guess, /^We think you have/, 'install.js did not run');
    assert.equal(r.help, 'https://wa.me/5016150551?text=Hi%2C%20I%20need%20help%20installing%20Toucan%20Bill');
    assert.equal(r.video, 'how-to.mp4');
    assert.equal(r.poster, 'how-to-poster.jpg');
    assert.ok(r.logo > 0, 'the toucan icon did not load');
  });
}

test('the tabs switch between iPhone, Android and computer steps', async () => {
  for (const key of ['iphone', 'android', 'computer']) {
    const shown = await evaluate(`(() => { document.getElementById('t-${key}').click(); return [...document.querySelectorAll('.panel.on')].map((p) => p.id); })()`);
    assert.deepEqual(shown, ['p-' + key]);
  }
});

test('the video and poster are served with the right types', async () => {
  const r = await evaluate(`Promise.all(['how-to.mp4', 'how-to-poster.jpg'].map((u) =>
    fetch(u, { cache: 'no-store' }).then((res) => res.status + ' ' + res.headers.get('content-type'))))`);
  assert.deepEqual(r, ['200 video/mp4', '200 image/jpeg']);
});

test('nothing from the install guide is precached', async () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const assets = JSON.parse('[' + /const ASSETS = \[([\s\S]*?)\];/.exec(sw)[1].replace(/'/g, '"').replace(/,\s*$/, '') + ']');
  assert.deepEqual(assets.filter((a) => GUIDE_FILES.includes(a) || a === 'install'), [], 'guide files in ASSETS');
  const cached = await evaluate(`caches.keys().then((ks) => Promise.all(ks.map((k) => caches.open(k).then((c) => c.keys()))))
    .then((all) => all.flat().map((r) => new URL(r.url).pathname))`);
  assert.ok(cached.length > 10, 'the app cache should exist');
  assert.deepEqual(cached.filter((p) => /\/(install(\.html|\.css|\.js)?|how-to\.mp4|how-to-poster\.jpg)$/.test(p)), []);
});

test('the install guide fits a 320px screen (no sideways scroll)', async () => {
  await page.setWidth(320);
  await page.goto(page.base + 'install');
  await page.waitFor('document.readyState === "complete"', 'install page');
  const r = await evaluate('({ inner: innerWidth, scroll: document.documentElement.scrollWidth })');
  await page.setWidth(harness.WIDTH);
  assert.equal(r.inner, 320);
  assert.ok(r.scroll <= 320, 'page is ' + r.scroll + 'px wide');
});
