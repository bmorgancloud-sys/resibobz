// Browser test: a phone running the production app (ResiboBZ, before the Toucan Bill rebrand) updates
// to this version and keeps every receipt, quote, customer, product and setting.
//
// Run with: node --test "tests/browser/*.e2e.js"
//
// 1. Serves the production code (PROD_REF, read straight from git) and fills the database through
//    that version's own db.js, as a real user's phone would have it.
// 2. Switches the server to this working tree on the same origin (same IndexedDB), lets the new
//    service worker install, and taps "Update available, tap to reload", exactly like the user will.
// 3. Checks the raw database and localStorage are unchanged and that every screen shows the data.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const harness = require('./harness.js');

const ROOT = path.resolve(__dirname, '..', '..');
// "Phase 6: Stats tab", the version live before the rebrand. Pinned so the test keeps meaning
// "upgrade from what the client has installed" after this branch is merged.
const PROD_REF = process.env.PROD_REF || '2c6b92f';
const NEW_CACHE = /const CACHE_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'))[1];

let page, evaluate, waitFor, prodDir;

const git = (...args) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });

/** Write the app files of PROD_REF into a temp folder (no checkout, the working tree is untouched). */
function exportProd() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toucanbill-prod-'));
  const files = git('ls-tree', '-r', '--name-only', PROD_REF).toString().split('\n')
    .filter((f) => f && !f.startsWith('tests/'));
  for (const f of files) {
    const out = path.join(dir, f);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, git('show', PROD_REF + ':' + f));
  }
  return dir;
}

/** Everything stored on the phone: raw IndexedDB rows of every store, schema, and our localStorage keys. */
const snapshot = () => evaluate(`(async () => {
  const idb = await new Promise((res, rej) => { const r = indexedDB.open('resibobz'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
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

/** Open a route and wait until its view has rendered. */
async function go(hash, ready) {
  await evaluate(`location.hash = ${JSON.stringify(hash)}; true`);
  await waitFor(ready, hash);
}
const rows = () => evaluate(`document.querySelectorAll('#view .list-row').length`);

test.before(async () => {
  prodDir = exportProd();
  page = await harness.open('#/history', { root: prodDir });
  ({ evaluate, waitFor } = page);
});

test.after(async () => {
  if (page) await page.close();
  if (prodDir) fs.rmSync(prodDir, { recursive: true, force: true });
});

test('a database made by the production app loads unchanged after the rebrand update', async () => {
  // ---- 1. Production app: installed offline, with real-looking data ----
  assert.equal(await evaluate('document.title'), 'History · ResiboBZ', 'starts on the production version');
  await waitFor('!!navigator.serviceWorker.controller', 'production service worker in control', 15000);
  const prodCache = await evaluate('caches.keys().then((k) => k.join())');
  assert.match(prodCache, /^resibobz-v\d+$/);

  await evaluate(`(async () => {
    await db.setSettings({
      business: { name: 'Sunny Salon', address: '12 Albert St, Belize City', phone: '223-4567', email: 'hi@sunny.bz', gstTin: '000123456' },
      logo: { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', format: 'PNG', width: 1, height: 1 },
      receiptFooter: 'Thanks, come again!', pageSize: 'a4', receiptPrefix: 'INV-', quotePrefix: 'QT-',
      autoSaveContacts: false, lastBackupAt: '2026-11-15T10:00:00.000Z',
    });
    await db.putMany({
      products: [{ name: 'Haircut', priceCents: 2500, zeroRated: false }, { name: 'Bottled water', priceCents: 150, zeroRated: true }],
      customers: [{ name: 'Maria Lopez', phone: '610-1234', email: '', tin: '', address: 'Belmopan' }, { name: 'Jose Chan', phone: '', email: 'jose@example.com', tin: '77', address: '' }],
    });
    const s = await db.getSettings();
    const line = (description, cents, qty = 1, zeroRated = false) => ({ description, qtyMilli: qty * 1000, unitCents: cents, zeroRated });
    const r1 = await db.saveNewDocument('receipt', receipt.buildReceipt({ customer: { name: 'Maria Lopez', phone: '610-1234' }, paymentMethod: 'cash', lines: [line('Haircut', 2500), line('Bottled water', 150, 2, true)] }, s));
    const r2 = await db.saveNewDocument('receipt', receipt.buildReceipt({ customer: {}, paymentMethod: 'card', lines: [line('Haircut', 2500)] }, s));
    await db.saveNewDocument('receipt', receipt.buildReceipt({ customer: { name: 'Jose Chan' }, paymentMethod: 'transfer', lines: [line('Colour', 8000)] }, s));
    await db.voidReceipt(r2.id, 'Typed the wrong price');
    const q = (name) => db.saveNewDocument('quote', quote.buildQuote({ customer: { name }, lines: [line('Wedding party', 30000)], validUntil: quote.defaultValidUntil(), notes: '50% deposit' }, s));
    await q('Maria Lopez');
    const q2 = await q('Jose Chan');
    const q3 = await q('Walk-in');
    await db.cancelQuote(q2.id);
    await db.saveConvertedReceipt(receipt.buildReceipt({ customer: { name: 'Walk-in' }, paymentMethod: 'cash', lines: [line('Wedding party', 30000)] }, s), q3.id);
    return r1.number;
  })()`);
  await evaluate(`localStorage.setItem('resibobz.stats.range', JSON.stringify({ preset: 'last90' })); true`);

  const before = await snapshot();
  assert.equal(before.name, 'resibobz');
  assert.equal(before.version, 2);
  assert.deepEqual(before.stores, ['customers', 'products', 'quotes', 'receipts', 'settings']);
  assert.equal(before.rows.receipts.length, 4);
  assert.equal(before.rows.quotes.length, 3);

  // ---- 2. Deploy the rebrand: same origin, new files; the user taps the update prompt ----
  page.server.root = ROOT;
  await evaluate(`navigator.serviceWorker.getRegistration().then((r) => r.update()).then(() => true)`);
  await waitFor(`(() => { const b = document.querySelector('.update-bar'); return !!b && !b.hidden; })()`, 'update prompt', 15000);
  await evaluate(`window.__old = true; document.querySelector('.update-bar').click(); true`);
  await waitFor(`!window.__old && document.readyState === 'complete' && typeof db === 'object' && document.querySelectorAll('#view .list-row').length > 0`,
    'reload into the new version', 15000);
  assert.equal(await evaluate('document.title'), 'History · Toucan Bill', 'now running the rebrand');
  assert.equal(await evaluate('appUpdate.version()'), NEW_CACHE);

  // ---- 3. Nothing stored changed ----
  const after = await snapshot();
  assert.deepEqual(after, before, 'IndexedDB rows, schema and localStorage are identical after the update');
  assert.equal(await evaluate('db.DB_NAME'), 'resibobz');
  assert.deepEqual(await evaluate('caches.keys()'), [NEW_CACHE], 'the old offline copy was replaced, not kept alongside');

  // ---- ...and every screen shows it ----
  assert.equal(await rows(), 4, 'History: all 4 receipts');
  assert.equal(await evaluate(`document.querySelectorAll('#view .badge-void').length`), 1, 'the voided one is still VOID');
  assert.match(await evaluate(`document.querySelector('.list-summary').textContent`), /^4 receipts · Total \$458\.63 \(1 void, not counted\)/);

  await go('#/quotes', `document.querySelectorAll('#view .list-row').length === 3`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#view .list-row .badge')].map((b) => b.textContent).sort()`), ['Cancelled', 'Converted', 'Open']);
  await go('#/products', `document.querySelectorAll('#view .list-row').length === 2`);
  await go('#/customers', `document.querySelectorAll('#view .list-row').length === 2`);

  await go('#/settings', `!!document.getElementById('app')`);
  const shown = await evaluate(`(() => {
    const val = (t) => [...document.querySelectorAll('.field label')].find((l) => l.textContent.trim().startsWith(t)).control.value;
    return { name: val('Business name'), tin: val('GST TIN'), prefix: val('Receipt prefix'), logo: !!document.querySelector('.logo-preview img') };
  })()`);
  assert.deepEqual(shown, { name: 'Sunny Salon', tin: '000123456', prefix: 'INV-', logo: true });

  // Receipts still open and print; numbering carries on from the old counters.
  const id = before.rows.receipts[0].id;
  await go('#/receipt/' + id, `/INV-0001/.test(document.getElementById('view').textContent)`);
  const pdfBytes = await evaluate(`pdf.documentBlob(${JSON.stringify(before.rows.receipts[0])}).then((b) => b.size)`);
  assert.ok(pdfBytes > 1000, 'receipt PDF builds');
  const next = await evaluate(`(async () => {
    const s = await db.getSettings();
    const r = await db.saveNewDocument('receipt', receipt.buildReceipt({ customer: {}, paymentMethod: 'cash', lines: [{ description: 'Trim', qtyMilli: 1000, unitCents: 1000, zeroRated: false }] }, s));
    const q = await db.saveNewDocument('quote', quote.buildQuote({ customer: {}, lines: [{ description: 'Trim', qtyMilli: 1000, unitCents: 1000, zeroRated: false }], validUntil: quote.defaultValidUntil(), notes: '' }, s));
    return [r.number, q.number];
  })()`);
  assert.deepEqual(next, ['INV-0005', 'QT-0004']);
});
