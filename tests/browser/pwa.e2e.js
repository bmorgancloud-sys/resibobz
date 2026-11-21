// Browser test for installability: manifest, iPhone tags, and that sw.js precaches every app file.
//
// Run with: node --test "tests/browser/*.e2e.js"
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('./harness.js');

const ROOT = path.resolve(__dirname, '..', '..');
let page, evaluate;

test.before(async () => {
  page = await harness.open('#/new');
  ({ evaluate } = page);
  await page.waitFor('!!navigator.serviceWorker.controller', 'service worker to take control', 15000);
});

test.after(async () => {
  if (page) await page.close();
});

test('Chrome reports no installability errors and reads the manifest', async () => {
  const { installabilityErrors } = await page.cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installabilityErrors, []);
  const { errors, data } = await page.cdp.send('Page.getAppManifest');
  assert.deepEqual(errors, []);
  const m = JSON.parse(data);
  assert.equal(m.short_name, 'ResiboBZ');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.display, 'standalone');
  assert.ok(m.theme_color && m.background_color);
  const icon = (sizes, purpose) => m.icons.find((i) => i.sizes === sizes && i.purpose === purpose);
  assert.ok(icon('192x192', 'any') && icon('512x512', 'any') && icon('512x512', 'maskable'), '192, 512 and maskable 512 icons');
});

test('index.html links the manifest, theme colour and iPhone tags; the touch icon is 180px', async () => {
  const head = await evaluate(`({
    manifest: !!document.querySelector('link[rel=manifest][href="manifest.json"]'),
    theme: (document.querySelector('meta[name=theme-color]') || {}).content,
    capable: (document.querySelector('meta[name=apple-mobile-web-app-capable]') || {}).content,
    title: (document.querySelector('meta[name=apple-mobile-web-app-title]') || {}).content,
    status: !!document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]'),
    touch: (document.querySelector('link[rel=apple-touch-icon]') || {}).getAttribute?.('href'),
  })`);
  assert.deepEqual(head, { manifest: true, theme: '#0b5cab', capable: 'yes', title: 'ResiboBZ', status: true, touch: 'icons/icon-180.png' });
  const png = fs.readFileSync(path.join(ROOT, 'icons', 'icon-180.png'));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [180, 180]);
});

test('every file the app loads is precached by the service worker', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const referenced = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const pdfLibs = [...fs.readFileSync(path.join(ROOT, 'js', 'pdf.js'), 'utf8').matchAll(/'(lib\/[^']+\.js)'/g)].map((m) => m[1]);
  const wanted = new Set([...referenced, ...manifest.icons.map((i) => i.src), ...pdfLibs]);

  const cached = await evaluate(`caches.keys().then((k) => caches.open(k[0])).then((c) => c.keys()).then((reqs) => reqs.map((r) => new URL(r.url).pathname))`);
  const missing = [...wanted].filter((p) => !cached.includes('/' + p));
  assert.deepEqual(missing, [], 'not precached');
  assert.ok(cached.includes('/'), 'the app shell (./) is precached');
});

test('works offline: the cached app starts and saves a receipt and a summary', async () => {
  await page.cdp.send('Network.enable');
  await page.cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  try {
    await page.goto(page.base + '?offline#/history');
    await page.waitFor('typeof db === "object" && !!document.querySelector("#view > div")', 'app to start offline', 10000);
    const result = await evaluate(`(async () => {
      const s = await db.getSettings();
      const r = await db.saveNewDocument('receipt', receipt.buildReceipt({ customer: { name: 'Offline' }, paymentMethod: 'cash',
        lines: [{ description: 'Ice', qtyMilli: 1000, unitCents: 700, zeroRated: false }] }, s, new Date()));
      const sum = summary.daily(await db.getAll('receipts'), summary.dayOf(new Date()));
      const blob = await pdf.summaryBlob(sum);
      return { number: r.number, total: sum.totalCents, pdf: blob.size > 1000 };
    })()`);
    assert.equal(result.total, 788);
    assert.equal(result.pdf, true, 'the PDF library loads from the cache');
  } finally {
    await page.cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }
});
