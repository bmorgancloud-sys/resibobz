// Browser test: upgrading the IndexedDB database from version 1 (Phases 0-3) to version 2 (Phase 4)
// keeps every existing receipt, product, customer and setting.
//
// Run with: node --test "tests/browser/*.e2e.js"
//
// Builds a real version 1 database by hand, with the exact v1 schema from db.js, on a same-origin
// page where the app isn't running, then loads the app, which upgrades it.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./harness.js');

let page, evaluate, waitFor;

test.before(async () => {
  page = await harness.open('#/products');
  ({ evaluate, waitFor } = page);
});

test.after(async () => {
  if (page) await page.close();
});

/** Same-origin page with no app scripts, so nothing holds the database open. */
const offApp = () => page.goto(page.base + 'manifest.json');

test('8. upgrade v1 -> v2 keeps all receipts, products, customers and settings', async () => {
  await offApp();
  const seeded = await evaluate(`(async () => {
    const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await req(indexedDB.deleteDatabase('resibobz'));
    const open = indexedDB.open('resibobz', 1);
    open.onupgradeneeded = () => {
      // Version 1 schema, exactly as Phase 0-3 created it.
      const idb = open.result;
      idb.createObjectStore('settings', { keyPath: 'key' });
      idb.createObjectStore('products', { keyPath: 'id', autoIncrement: true }).createIndex('name', 'name');
      idb.createObjectStore('customers', { keyPath: 'id', autoIncrement: true }).createIndex('name', 'name');
      for (const name of ['receipts', 'quotes']) {
        const s = idb.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
        s.createIndex('number', 'number', { unique: true });
        s.createIndex('date', 'date');
        s.createIndex('customerId', 'customerId');
      }
    };
    const idb = await req(open);
    const data = {
      settings: [
        { key: 'business', value: { name: 'Old Shop', address: 'Orange Walk', phone: '322-1111', email: 'old@example.com', gstTin: '999' } },
        { key: 'gstRateBp', value: 1250 }, { key: 'receiptPrefix', value: 'R-' }, { key: 'quotePrefix', value: 'QT-' },
        { key: 'numberPadding', value: 4 }, { key: 'counter_receipt', value: 2 }, { key: 'counter_quote', value: 0 },
        { key: 'receiptFooter', value: 'Come again' }, { key: 'pageSize', value: 'a4' }, { key: 'autoSaveContacts', value: false },
        { key: 'lastBackupAt', value: '2026-11-01T10:00:00.000Z' },
      ],
      products: [{ id: 1, name: 'Rice', unit: 'bag', priceCents: 2500, zeroRated: true }, { id: 2, name: 'Soda', unit: '', priceCents: 200, zeroRated: false }],
      customers: [{ id: 1, name: 'Eldon', phone: '610-0551', email: '', tin: '', address: '' }],
      receipts: [
        { id: 1, number: 'R-0001', type: 'receipt', date: '2026-11-02T15:00:00.000Z', createdAt: '2026-11-02T15:00:00.000Z',
          customer: { name: 'Eldon', phone: '610-0551' }, paymentMethod: 'cash',
          lines: [{ description: 'Rice', qtyMilli: 1000, unitCents: 2500, zeroRated: true, netCents: 2500, gstCents: 0 }],
          gstRateBp: 1250, subtotalCents: 2500, taxableCents: 0, zeroRatedCents: 2500, gstCents: 0, totalCents: 2500,
          business: { name: 'Old Shop' }, footer: 'Come again' },
        { id: 2, number: 'R-0002', type: 'receipt', date: '2026-11-03T15:00:00.000Z', createdAt: '2026-11-03T15:00:00.000Z',
          customer: { name: '', phone: '' }, paymentMethod: 'card',
          lines: [{ description: 'Soda', qtyMilli: 2000, unitCents: 200, zeroRated: false, netCents: 400, gstCents: 50 }],
          gstRateBp: 1250, subtotalCents: 400, taxableCents: 400, zeroRatedCents: 0, gstCents: 50, totalCents: 450,
          business: { name: 'Old Shop' }, footer: 'Come again', voided: true, voidedAt: '2026-11-03T16:00:00.000Z', voidReason: 'Oops' },
      ],
    };
    const tx = idb.transaction(Object.keys(data), 'readwrite');
    for (const [store, rows] of Object.entries(data)) for (const r of rows) tx.objectStore(store).put(r);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    idb.close();
    return data;
  })()`);

  // Load the app: db.js opens version 2 and runs the upgrade.
  await page.goto(page.base + '#/history');
  await waitFor(`typeof db === 'object' && document.querySelectorAll('.list-row').length === 2`, 'History after upgrade');

  const after = await evaluate(`(async () => {
    const idb = await db.open();
    const tx = idb.transaction(['receipts', 'quotes'], 'readonly');
    const receiptIndexes = [...tx.objectStore('receipts').indexNames];
    const quoteIndexes = [...tx.objectStore('quotes').indexNames];
    const all = (s) => new Promise((res) => { const r = idb.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); });
    const settings = {};
    for (const row of await all('settings')) settings[row.key] = row.value;
    return {
      version: idb.version, receiptIndexes, quoteIndexes, settings, products: await all('products'), customers: await all('customers'), receipts: await all('receipts'), quotes: await all('quotes'),
    };
  })()`);

  assert.equal(after.version, 2);
  assert.deepEqual(after.receiptIndexes.sort(), ['customerId', 'date', 'number', 'quoteId']);
  assert.deepEqual(after.quoteIndexes.sort(), ['customerId', 'date', 'number']);
  assert.deepEqual(after.products, seeded.products);
  assert.deepEqual(after.customers, seeded.customers);
  assert.deepEqual(after.receipts, seeded.receipts);
  assert.deepEqual(after.quotes, []);
  for (const { key, value } of seeded.settings) assert.deepEqual(after.settings[key], value, 'setting ' + key);

  // The app works on the upgraded data: History shows both, numbering continues, quotes start at QT-0001.
  assert.match(await evaluate(`document.querySelector('.list-summary').textContent`), /^2 receipts · Total \$25\.00 \(1 void, not counted\)/);
  const numbers = await evaluate(`(async () => {
    const s = await db.getSettings();
    const line = [{ description: 'Rice', qtyMilli: 1000, unitCents: 2500, zeroRated: true }];
    const r = await db.saveNewDocument('receipt', receipt.buildReceipt({ customer: {}, paymentMethod: 'cash', lines: line }, s));
    const q = await db.saveNewDocument('quote', quote.buildQuote({ customer: {}, lines: line, validUntil: quote.defaultValidUntil(), notes: '' }, s));
    return [r.number, q.number];
  })()`);
  assert.deepEqual(numbers, ['R-0003', 'QT-0001']);

  // Opening again (already v2) runs no upgrade step and changes nothing.
  await page.reloadAt('#/history');
  await waitFor(`document.querySelectorAll('.list-row').length === 3`, 'History after reload');
  assert.equal(await evaluate(`db.count('products')`), 2);
});
