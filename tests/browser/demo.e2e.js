// Browser test: Settings > Developer > "Load demo data" opens the demo, a separate database full of plainly
// fake test data, and never touches the phone's own data. Starts from the live version with the OLD sample
// data loaded (as a testing client's phone has it) and checks the update itself keeps every stored row.
//
// Run with: node --test --test-concurrency=1 "tests/browser/*.e2e.js"
//
// 1. Serves the live version (LIVE_REF, read from git) and fills its database through its own db.js and its
//    old "Load demo data" (Demo Store, 6 products, 4 real-sounding customers), plus receipts and a quote.
// 2. Deploys this working tree on the same origin and taps "Update available, tap to reload": the raw
//    IndexedDB rows, the schema and localStorage are identical afterwards.
// 3. Loads the new demo from Settings: the app reloads on 'resibobz-demo' with a Demo bar, on a full Stats
//    tab; History, Quotes, Products and Customers show only test names; nothing scrolls sideways.
// 4. A receipt saved in the demo stays in the demo; "Reload demo data" starts it again. "Back to my data"
//    returns to 'resibobz', exactly as it was.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const harness = require('./harness.js');

const ROOT = path.resolve(__dirname, '..', '..');
// "Blue theme, navy toucan icons and the install guide" (toucanbill-v34), live when the demo was redone.
// Pinned so the test keeps meaning "update from what testers have installed" after this branch is merged.
const LIVE_REF = process.env.LIVE_REF || 'de53c2b';
const NEW_CACHE = /const CACHE_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'))[1];

let page, evaluate, waitFor, liveDir, mine;

const git = (...args) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });

/** Write the app files of LIVE_REF into a temp folder (no checkout, the working tree is untouched). */
function exportLive() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toucanbill-live-'));
  const files = git('ls-tree', '-r', '--name-only', LIVE_REF).toString().split('\n')
    .filter((f) => f && !f.startsWith('tests/') && !/\.mp4$/.test(f));
  for (const f of files) {
    const out = path.join(dir, f);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, git('show', LIVE_REF + ':' + f));
  }
  return dir;
}

/** Everything stored for database `name`: raw rows of every store, schema, and our localStorage keys. */
const snapshot = (name) => evaluate(`(async () => {
  const idb = await new Promise((res, rej) => { const r = indexedDB.open(${JSON.stringify(name)}); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const stores = [...idb.objectStoreNames].sort();
  const out = { name: idb.name, version: idb.version, stores, indexes: {}, rows: {}, local: {} };
  for (const s of stores) {
    const st = idb.transaction(s).objectStore(s);
    out.indexes[s] = [...st.indexNames].sort();
    out.rows[s] = await new Promise((res) => { const r = st.getAll(); r.onsuccess = () => res(r.result); });
  }
  idb.close();
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out.local[k] = localStorage.getItem(k); }
  return out;
})()`);

// Console errors/warnings and uncaught errors, collected on every page load before any app script runs.
const CAPTURE = `(() => {
  window.__problems = [];
  const keep = (kind) => (...a) => window.__problems.push(kind + ': ' + a.map((x) => (x && x.message) || String(x)).join(' '));
  const err = console.error.bind(console), warn = console.warn.bind(console);
  console.error = (...a) => { keep('error')(...a); err(...a); };
  console.warn = (...a) => { keep('warn')(...a); warn(...a); };
  addEventListener('error', (e) => keep('uncaught')(e.message));
  addEventListener('unhandledrejection', (e) => keep('rejection')(e.reason));
})()`;
const problems = () => evaluate('window.__problems || []');

/** Open a route and wait until `ready` is true. */
async function go(hash, ready) {
  await evaluate(`location.hash = ${JSON.stringify(hash)}; true`);
  await waitFor(`location.hash === ${JSON.stringify(hash)} && (${ready})`, hash, 10000);
}

/** Click a button by its text (in `scope`), after marking the page so a reload can be told apart. */
const click = (scope, text) => evaluate(`(() => { window.__old = true;
  [...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find((b) => b.textContent === ${JSON.stringify(text)}).click(); return true; })()`);

/** Nothing on screen sticks out past `width` (the same check as layout.e2e.js, condensed). */
async function assertFits(width, what) {
  const m = await evaluate(`(() => {
    const W = ${width}, out = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('dialog') || el.offsetParent === null) continue;
      let clipped = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (getComputedStyle(a).overflowX !== 'visible') { clipped = a.getBoundingClientRect().right <= W + 0.5; break; }
      }
      const r = el.getBoundingClientRect();
      if (!clipped && r.width && r.right > W + 0.5) out.push(el.tagName.toLowerCase() + '.' + (typeof el.className === 'string' ? el.className : ''));
    }
    return { inner: window.innerWidth, scroll: document.documentElement.scrollWidth, out: out.slice(0, 6) };
  })()`);
  assert.ok(m.inner === width && m.scroll <= m.inner, `${what} at ${width}px: page is ${m.scroll}px wide. Too wide: ${m.out.join(', ')}`);
}

test.before(async () => {
  liveDir = exportLive();
  page = await harness.open('#/history', { root: liveDir });
  ({ evaluate, waitFor } = page);
  await page.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: CAPTURE });
  await page.reloadAt('#/history');
  await waitFor('typeof db === "object" && !!document.querySelector("#view > div")', 'live app to restart');
});

test.after(async () => {
  if (page) await page.close();
  if (liveDir) fs.rmSync(liveDir, { recursive: true, force: true });
});

test('a phone on the live version, with the old sample data loaded, updates and keeps every stored row', async () => {
  assert.equal(await evaluate('document.title'), 'History · Toucan Bill');
  await waitFor('!!navigator.serviceWorker.controller', 'live service worker in control', 15000);
  assert.match(await evaluate(`caches.keys().then((k) => k.join())`), /^toucanbill-v\d+$/);
  assert.notEqual(await evaluate(`caches.keys().then((k) => k.join())`), NEW_CACHE, 'CACHE_VERSION was bumped');

  // The tester's phone: the old sample data (Settings > Developer > Load demo data) plus a few tries of their own.
  await evaluate(`(async () => {
    await demo.load();
    const s = await db.getSettings();
    const line = (description, cents, qty = 1, zeroRated = false) => ({ description, qtyMilli: qty * 1000, unitCents: cents, zeroRated });
    await db.saveNewDocument('receipt', receipt.buildReceipt({ customer: { name: 'Eldon', phone: '610-0551' }, paymentMethod: 'cash',
      lines: [line('Pizza', 500, 2), line('Rice 25lb', 2750, 1, true)] }, s));
    const r2 = await db.saveNewDocument('receipt', receipt.buildReceipt({ customer: {}, paymentMethod: 'card', lines: [line('Soft drink 20oz', 250, 4)] }, s));
    await db.voidReceipt(r2.id, 'Wrong item');
    await db.saveNewDocument('quote', quote.buildQuote({ customer: { name: 'Belmopan Hardware Ltd' }, lines: [line('Delivery fee', 1000)],
      validUntil: quote.defaultValidUntil(), notes: '' }, s));
    await db.setSettings({ lastBackupAt: '2026-11-20T10:00:00.000Z' });
    return true;
  })()`);
  // Stats on "Last month", which the demo always has in full (the range choice is per device, shared with the demo).
  await evaluate(`localStorage.setItem('resibobz.stats.range', JSON.stringify({ preset: 'lastMonth' })); true`);
  mine = await snapshot('resibobz');
  assert.deepEqual([mine.name, mine.version], ['resibobz', 2]);
  assert.deepEqual([mine.rows.products.length, mine.rows.customers.length, mine.rows.receipts.length, mine.rows.quotes.length], [6, 4, 2, 1]);
  assert.ok(mine.rows.customers.some((c) => c.name === 'brandon Morgan'), 'the old sample customers are on the phone');

  // Deploy this version on the same origin; the tester taps the update prompt.
  page.server.root = ROOT;
  await evaluate(`navigator.serviceWorker.getRegistration().then((r) => r.update()).then(() => true)`);
  await waitFor(`(() => { const b = document.querySelector('.update-bar'); return !!b && !b.hidden; })()`, 'update prompt', 15000);
  await evaluate(`window.__old = true; document.querySelector('.update-bar').click(); true`);
  await waitFor(`!window.__old && document.readyState === 'complete' && typeof db === 'object' && document.querySelectorAll('#view .list-row').length === 2`,
    'reload into the new version', 15000);
  assert.equal(await evaluate('appUpdate.version()'), NEW_CACHE);
  assert.equal(await evaluate('db.DB_NAME'), 'resibobz');
  assert.deepEqual(await snapshot('resibobz'), mine, 'IndexedDB rows, schema and localStorage are identical after the update');
  assert.deepEqual(await evaluate('caches.keys()'), [NEW_CACHE]);
  assert.equal(await evaluate(`!!document.querySelector('.demo-bar')`), false, 'no demo bar on the real data');
  assert.deepEqual(await problems(), []);
});

test('Load demo data opens a separate test shop; a full Stats tab; Back to my data finds everything as it was', async () => {
  // ---- Open the demo from Settings ----
  await go('#/settings', `!!document.getElementById('developer')`);
  assert.match(await evaluate(`document.getElementById('developer').textContent`), /Your own data is not changed/);
  await click('#developer', 'Load demo data');
  await waitFor(`!!document.querySelector('dialog[open]')`, 'confirm dialog');
  const msg = await evaluate(`document.querySelector('dialog[open] p').textContent`);
  const m = /separate test shop with 12 test products, 15 test customers, (\d+) receipts \(01 \w{3} \d{4} to today\) and (\d+) quotes/.exec(msg);
  assert.ok(m, msg);
  assert.match(msg, /Your own data stays exactly as it is/);
  const [receipts, quotes] = [Number(m[1]), Number(m[2])];
  assert.ok(receipts > 150 && quotes >= 8, msg);

  await click('dialog[open]', 'Load demo data');
  await waitFor(`!window.__old && typeof db === 'object' && db.DB_NAME === 'resibobz-demo' && !!document.querySelector('.demo-bar') && !!document.querySelector('.overview-card')`,
    'the demo, on Stats', 15000);
  assert.equal(await evaluate('location.hash'), '#/stats');
  assert.equal(await evaluate(`document.querySelector('.demo-bar span').textContent`), 'DEMO: test data only. Your own data is safe.');
  assert.equal(await evaluate(`db.count('receipts')`), receipts, 'the counts the dialog showed');
  assert.equal(await evaluate(`db.count('quotes')`), quotes);

  // ---- Stats: every card filled (range: Last month, always complete in the demo) ----
  await waitFor(`!!window.statsTiming && window.statsTiming.chartsMs != null`, 'charts drawn', 15000);
  const s = await evaluate(`(() => {
    const names = (sel) => [...document.querySelectorAll(sel + ' .rank-name')].map((e) => e.textContent);
    const cell = (card, label) => [...document.querySelectorAll(card + ' tr')].find((r) => r.textContent.startsWith(label)).lastElementChild.textContent;
    return {
      tiles: document.querySelectorAll('.glance-tile').length,
      gstReceipts: Number(cell('.gst-card', 'Receipts')), gstZero: cell('.gst-card', 'Zero-rated sales'),
      overview: Number(cell('.overview-card', 'Receipts')),
      top: names('.top-products'), slow: names('.slow-movers').sort(), customers: names('.top-customers'),
      wa: document.querySelectorAll('.top-customers a.wa-btn[href^="https://wa.me/5010000"]').length,
      repeat: cell('.top-customers', 'Repeat customers'), sent: Number(cell('.quote-card', 'Quotes sent')),
      follow: names('.follow-up').length, charts: document.querySelectorAll('.stats-view canvas').length,
    };
  })()`);
  assert.equal(s.tiles, 3);
  assert.ok(s.overview > 150, 'last month: ' + s.overview + ' receipts');
  assert.ok(s.gstReceipts > 150, 'monthly GST summary (last month): ' + s.gstReceipts + ' receipts');
  assert.match(s.gstZero, /^\$[1-9][\d,]*\.\d\d$/, 'zero-rated sales in the GST summary');
  assert.equal(s.top.length, 10);
  assert.ok(s.top.every((n) => /^Test Product [A-K]$/.test(n)), s.top.join());
  assert.deepEqual(s.slow, ['Test Product K', 'Test Product L']);
  assert.equal(s.customers.length, 10);
  assert.ok(s.customers.every((n) => /^Test (Customer [A-N]|Company Ltd)$/.test(n)), s.customers.join());
  assert.equal(s.wa, 10, 'a WhatsApp button per top customer, to a number that cannot exist');
  assert.match(s.repeat, /^10 · \d+%$/);
  assert.ok(s.sent >= 5 && s.follow >= 3, JSON.stringify(s));
  assert.equal(s.charts, 2);

  // ---- The other screens: only test names, none of the old sample data ----
  await go('#/history', `document.querySelectorAll('#view .list-row').length === ${receipts}`);
  const hist = await evaluate(`({ voids: document.querySelectorAll('#view .badge-void').length, text: document.getElementById('view').textContent })`);
  assert.ok(hist.voids >= 1);
  assert.doesNotMatch(hist.text, /Eldon|brandon|Pizza|Rice|Demo Store|Belmopan Hardware/);
  await go('#/products', `document.querySelectorAll('#view .list-row').length === 12`);
  assert.ok(await evaluate(`[...document.querySelectorAll('#view .list-row')].every((r) => /Test Product [A-L]/.test(r.textContent))`));
  await go('#/customers', `document.querySelectorAll('#view .list-row').length === 15`);
  assert.ok(await evaluate(`[...document.querySelectorAll('#view .list-row')].every((r) => /Test (Customer [A-N]|Company Ltd)/.test(r.textContent))`));
  await go('#/quotes', `document.querySelectorAll('#view .list-row').length === ${quotes}`);
  assert.deepEqual(await evaluate(`[...new Set([...document.querySelectorAll('#view .list-row .badge')].map((b) => b.textContent))].sort()`),
    ['Cancelled', 'Converted', 'Expired', 'Open']);

  // ---- Phone widths, with the bar showing ----
  for (const width of [320, 360, 390]) {
    await page.setWidth(width);
    for (const hash of ['#/stats', '#/history', '#/customers', '#/settings']) {
      await go(hash, `document.querySelector('#view > div') && document.querySelector('#view > div').childElementCount > 0`);
      await page.sleep(150);
      await assertFits(width, 'Demo ' + hash);
    }
    const bar = await evaluate(`(() => { const b = document.querySelector('.demo-bar button').getBoundingClientRect(); return { right: b.right, height: b.height }; })()`);
    assert.ok(bar.right <= width && bar.height >= 48, `Back to my data fits and is 48px+ tall at ${width}px`);
  }
  await page.setWidth(harness.WIDTH);

  // ---- Settings in the demo; saving writes to the demo only ----
  await go('#/settings', `!!document.getElementById('developer')`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#developer button')].map((b) => b.textContent)`), ['Back to my data', 'Reload demo data']);
  assert.equal(await evaluate(`[...document.querySelectorAll('.field label')].find((l) => l.textContent.trim().startsWith('Business name')).control.value`),
    'Test Store');
  // A backup made in the demo can't be mistaken for a backup of the phone's own data.
  assert.match(await evaluate(`document.querySelector('#backup .backup-privacy').textContent`), /^This is the demo: a backup here holds test data only/);
  await evaluate(`window.__dl = null; ui.download = (blob, name) => { window.__dl = name; };
    [...document.querySelectorAll('#backup button')].find((b) => b.textContent === 'Export backup').click(); true`);
  await waitFor('!!window.__dl', 'demo backup export');
  assert.match(await evaluate('window.__dl'), /^toucanbill-demo-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const saved = await evaluate(`(async () => {
    const s = await db.getSettings();
    const r = await db.saveNewDocument('receipt', receipt.buildReceipt({ customer: { name: 'Test Customer A', phone: '+501 000-0001' }, paymentMethod: 'cash',
      lines: [{ description: 'Test Product A', qtyMilli: 1000, unitCents: 350, zeroRated: false }] }, s));
    return r.number;
  })()`);
  assert.equal(saved, 'INV-' + String(receipts + 1).padStart(4, '0'));

  // "Reload demo data" starts again: fresh data, the receipt saved in the demo is gone.
  await go('#/settings', `!!document.getElementById('developer')`);
  await click('#developer', 'Reload demo data');
  await waitFor(`!!document.querySelector('dialog[open]')`, 'confirm dialog');
  const msg2 = await evaluate(`document.querySelector('dialog[open] p').textContent`);
  assert.match(msg2, /^Start the demo again with fresh test data up to today: .* Your own data is not affected\.$/);
  const again = Number(/(\d+) receipts/.exec(msg2)[1]);
  await click('dialog[open]', 'Reload demo data');
  await waitFor(`!window.__old && typeof db === 'object' && db.DB_NAME === 'resibobz-demo' && !!document.querySelector('.overview-card')`, 'the demo again', 15000);
  assert.equal(await evaluate(`db.count('receipts')`), again, 'replaced, not added to: the receipt saved in the demo is gone');

  // ---- Back to my data, from a receipt: lands on History with the phone's own data, untouched ----
  await go('#/receipt/3', `/INV-0003/.test(document.getElementById('view').textContent)`);
  await click('.demo-bar', 'Back to my data');
  await waitFor(`!window.__old && typeof db === 'object' && db.DB_NAME === 'resibobz' && document.querySelectorAll('#view .list-row').length === 2`,
    'back on my data', 15000);
  assert.equal(await evaluate('location.hash'), '#/history');
  assert.equal(await evaluate(`!!document.querySelector('.demo-bar')`), false);
  assert.deepEqual(await snapshot('resibobz'), mine, 'my data: every row, the schema and localStorage exactly as before the demo');
  assert.ok(await evaluate(`db.count('receipts').then((n) => n === 2)`));
  assert.equal((await snapshot('resibobz-demo')).rows.receipts.length, again, 'the demo stays in its own database');
  assert.deepEqual(await problems(), []);
});
