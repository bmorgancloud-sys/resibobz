// Browser test for Phase 4: quotes. Create, PDF, convert, back out, expired warning, cancel,
// totals/numbering independence, auto-save on/off, backup round trip and old Phase 3 backups.
//
// Run with: node --test "tests/browser/*.e2e.js"
//
// Drives the real screens in headless Chrome at 360px; seeds through the app's own db.js/quote.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const harness = require('./harness.js');

let page, cdp, evaluate, waitFor, tmp;
const js = (v) => JSON.stringify(v);

/** Click the first visible button/link/label whose text is exactly `text` (optionally inside `scope`). */
const click = (text, scope = 'document') => evaluate(`(() => {
  const el = [...${scope}.querySelectorAll('button, a, label')].find((b) => b.textContent.trim() === ${js(text)} && b.offsetParent !== null);
  if (!el) throw new Error('No button ' + ${js(text)});
  el.click();
  return true;
})()`);
const hasButton = (text) => evaluate(`[...document.querySelectorAll('#view button, #view a')].some((b) => b.textContent.trim() === ${js(text)})`);

const go = async (hash, ready) => {
  await evaluate(`location.hash = ${js(hash)}; true`);
  await waitFor(`location.hash === ${js(hash)} && (${ready})`, hash);
};

/** Set the n-th editor field labelled `label` (inside line card `card` when given). */
const set = (label, value, card = null) => evaluate(`(() => {
  const root = ${card == null ? 'document.getElementById("view")' : `document.querySelectorAll('.line-item')[${card}]`};
  const l = [...root.querySelectorAll('.field label')].find((x) => x.textContent.trim() === ${js(label)});
  if (!l) throw new Error('No field ' + ${js(label)});
  l.control.value = ${js(value)};
  l.control.dispatchEvent(new Event('input', { bubbles: true }));
  l.control.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
const fieldValue = (label, card = null) => evaluate(`(() => {
  const root = ${card == null ? 'document.getElementById("view")' : `document.querySelectorAll('.line-item')[${card}]`};
  return [...root.querySelectorAll('.field label')].find((x) => x.textContent.trim() === ${js(label)}).control.value;
})()`);

const counters = () => evaluate(`db.getSettings().then((s) => ({ receipt: s.counter_receipt, quote: s.counter_quote }))`);
const dialogText = () => evaluate(`document.querySelector('dialog[open] p').textContent`);
const viewText = () => evaluate(`document.getElementById('view').textContent`);
const pdfText = (store, id) => evaluate(`db.get(${js(store)}, ${id}).then((r) => pdf.documentBlob(r)).then((b) => b.text())`);

/** Save a quote straight through db.js (for setting up states quickly). Returns its id. */
const seedQuote = (name, validUntil, lines = [['Pizza', 1000, 4000]]) => evaluate(`(async () => {
  const s = await db.getSettings();
  const q = quote.buildQuote({ customer: { name: ${js(name)}, phone: '' }, validUntil: ${js(validUntil)}, notes: '',
    lines: ${js(lines)}.map(([d, q, c]) => ({ description: d, qtyMilli: q, unitCents: c, zeroRated: false })) }, s, new Date());
  return (await db.saveNewDocument('quote', q)).id;
})()`);
const dayOffset = (n) => evaluate(`(() => { const d = new Date(); return filter.dayString(new Date(d.getFullYear(), d.getMonth(), d.getDate() + ${n})); })()`);

async function chooseFile(name, text) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, text);
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#backup-file' });
  await cdp.send('DOM.setFileInputFiles', { nodeId, files: [file] });
}

const ids = {};

test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resibobz-e2e-quotes-'));
  page = await harness.open('#/products');
  ({ cdp, evaluate, waitFor } = page);
  await cdp.send('DOM.enable');
  ids.firstReceipt = await evaluate(`(async () => {
    await db.setSettings({ business: { name: 'Demo Store', address: 'Belmopan', phone: '822-0000', email: '', gstTin: '000123' },
      receiptFooter: 'Thanks!' });
    await db.put('products', { name: 'Pizza', unit: '', priceCents: 4000, zeroRated: false });
    await db.put('customers', { name: 'Kimley Jone', phone: '622-9887', email: '', tin: '', address: '' });
    const s = await db.getSettings();
    const r = await db.saveNewDocument('receipt', receipt.buildReceipt({ customer: { name: 'Kimley Jone', phone: '622-9887' },
      paymentMethod: 'cash', lines: [{ description: 'Pizza', qtyMilli: 1000, unitCents: 4000, zeroRated: false }] }, s, new Date()));
    return r.id;
  })()`);
});

test.after(async () => {
  if (page) await page.close();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test('1. create a quote: QT-0001, receipt counter unchanged, PDF says QUOTATION with valid-until and notes', async () => {
  await go('#/quotes', `!!document.querySelector('.placeholder')`);
  assert.match(await viewText(), /No quotes yet/);
  assert.equal(await evaluate(`document.querySelector('.bottom-nav a.active').dataset.route`), 'quotes');
  await click('+ New quote');
  await waitFor(`location.hash === '#/quote/new' && !!document.querySelector('.line-item')`, 'quote editor');
  assert.equal(await evaluate(`document.getElementById('view-title').textContent`), 'New quote');
  assert.equal(await fieldValue('Valid until'), await dayOffset(14), 'default valid-until is today + 14 days');
  assert.equal(await evaluate(`!!document.querySelector('input[name=payment]')`), false, 'no payment method on quotes');

  await set('Name', 'Ana Lopez');
  await set('Phone', '633-1234');
  await set('Description', 'Pizza', 0);   // saved product: fills the price
  assert.equal(await fieldValue('Unit price ($)', 0), '40.00');
  await set('Qty', '2', 0);
  await click('+ Add item');
  await set('Description', 'Delivery', 1);
  await set('Unit price ($)', '10.00', 1);
  await set('Notes / terms', '50% deposit required');
  assert.match(await evaluate(`document.querySelector('.sticky-total').textContent`), /\$101\.25/); // 90 + 11.25 GST
  await click('Save quote');
  await waitFor(`/^#\\/quote\\/\\d+$/.test(location.hash) && !!document.querySelector('.summary-head')`, 'quote detail');

  ids.q1 = Number((await evaluate('location.hash')).split('/')[2]);
  const q = await evaluate(`db.get('quotes', ${ids.q1})`);
  assert.equal(q.number, 'QT-0001');
  assert.equal(q.type, 'quote');
  assert.equal(q.totalCents, 10125);
  assert.equal(q.notes, '50% deposit required');
  assert.equal(q.validUntil, await dayOffset(14));
  assert.deepEqual(await counters(), { receipt: 1, quote: 1 }, 'receipt counter unchanged');
  assert.equal(await evaluate(`document.getElementById('view-title').textContent`), 'QT-0001');
  assert.match(await viewText(), /Saved QT-0001/);
  assert.match(await evaluate(`document.querySelector('.summary-head .badge').textContent`), /^Open$/);
  for (const b of ['Convert to receipt', 'Edit', 'Cancel quote']) assert.ok(await hasButton(b), b + ' button');
  await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent === 'Share PDF' || b.textContent === 'Download PDF & send on WhatsApp')`, 'PDF ready');

  const text = await pdfText('quotes', ids.q1);
  const validDay = await evaluate(`receipt.formatDay(${js(q.validUntil)})`);
  assert.match(text, /\(QUOTATION\) Tj/);
  assert.match(text, /\(Quote no\.\) Tj/);
  assert.match(text, /\(Valid until\) Tj/);
  assert.ok(text.includes('(' + validDay + ') Tj'), 'valid-until date in the PDF');
  assert.match(text, /\(NOTES \/ TERMS\) Tj/);
  assert.match(text, /\(50% deposit required\) Tj/);
  assert.doesNotMatch(text, /\(RECEIPT\)|\(Payment\)|CANCELLED|VOID/);

  // Editing keeps the number; the WhatsApp text says Quotation.
  await click('Edit');
  await waitFor(`location.hash === '#/quote/${ids.q1}/edit' && !!document.querySelector('.line-item')`, 'edit');
  assert.equal(await fieldValue('Description', 1), 'Delivery');
  assert.equal(await fieldValue('Notes / terms'), '50% deposit required');
  await set('Notes / terms', '50% deposit required. Prices valid 14 days.');
  await click('Save quote');
  await waitFor(`location.hash === '#/quote/${ids.q1}' && !!document.querySelector('.summary-head')`, 'detail after edit');
  const edited = await evaluate(`db.get('quotes', ${ids.q1})`);
  assert.equal(edited.number, 'QT-0001');
  assert.equal(edited.date, q.date);
  assert.equal(edited.notes, '50% deposit required. Prices valid 14 days.');
  assert.deepEqual(await counters(), { receipt: 1, quote: 1 }, 'editing takes no new number');
  assert.match(await evaluate(`receipt.summaryText(${js(edited)})`), /^Demo Store\nQuotation QT-0001/);
});

test('2. convert: the receipt has the same lines and totals; quote shows Converted with a link; receipt shows From quote', async () => {
  await go('#/quote/' + ids.q1, `!!document.querySelector('.summary-head')`);
  await click('Convert to receipt');
  await waitFor(`location.hash === '#/new' && !!document.querySelector('.line-item')`, 'New Receipt pre-filled');
  assert.match(await evaluate(`document.querySelector('.notice').textContent`), /Converting quote QT-0001/);
  assert.equal(await evaluate(`document.querySelector('.bottom-nav a.active').dataset.route`), 'new');
  assert.equal(await fieldValue('Name'), 'Ana Lopez');
  assert.equal(await fieldValue('Phone'), '633-1234');
  assert.equal(await fieldValue('Description', 0), 'Pizza');
  assert.equal(await fieldValue('Qty', 0), '2');
  assert.equal(await fieldValue('Unit price ($)', 1), '10.00');
  assert.equal((await evaluate(`db.get('quotes', ${ids.q1})`)).receiptId, undefined, 'not converted before saving');

  await evaluate(`document.getElementById('pay-card').click(); true`);
  await click('Save receipt');
  await waitFor(`/^#\\/receipt\\/\\d+$/.test(location.hash) && !!document.querySelector('.notice-ok')`, 'receipt detail');
  const rid = Number((await evaluate('location.hash')).split('/')[2]);
  const [r, q] = await Promise.all([evaluate(`db.get('receipts', ${rid})`), evaluate(`db.get('quotes', ${ids.q1})`)]);
  assert.equal(r.number, 'INV-0002');
  assert.equal(r.paymentMethod, 'card');
  assert.equal(r.quoteId, ids.q1);
  assert.equal(r.quoteNumber, 'QT-0001');
  assert.deepEqual(r.lines, q.lines, 'same lines');
  for (const k of ['subtotalCents', 'taxableCents', 'zeroRatedCents', 'gstCents', 'totalCents']) assert.equal(r[k], q[k], k);
  assert.equal(q.receiptId, rid);
  assert.equal(q.receiptNumber, 'INV-0002');
  assert.ok(!isNaN(new Date(q.convertedAt)));
  assert.deepEqual(await counters(), { receipt: 2, quote: 1 });

  const back = await evaluate(`(() => { const a = [...document.querySelectorAll('.detail-link a')][0]; return a && { text: a.closest('p').textContent, href: a.getAttribute('href') }; })()`);
  assert.deepEqual(back, { text: 'From quote QT-0001', href: '#/quote/' + ids.q1 });

  await go('#/quote/' + ids.q1, `!!document.querySelector('.summary-head')`);
  assert.match(await evaluate(`document.querySelector('.summary-head .badge').textContent`), /^Converted$/);
  const fwd = await evaluate(`(() => { const a = document.querySelector('.notice-ok a'); return { text: a.closest('.notice').textContent, href: a.getAttribute('href') }; })()`);
  assert.match(fwd.text, /^Converted to INV-0002/);
  assert.equal(fwd.href, '#/receipt/' + rid);
  for (const b of ['Convert to receipt', 'Edit', 'Cancel quote']) assert.equal(await hasButton(b), false, 'no ' + b + ' on a converted quote');
  await go('#/quote/' + ids.q1 + '/edit', `!!document.querySelector('.placeholder')`);
  assert.match(await viewText(), /QT-0001 is converted and can't be edited/);
  await assert.rejects(evaluate(`db.get('quotes', ${ids.q1}).then((q) => db.updateQuote({ ...q, notes: 'x' }))`), /already converted/);
});

test('3. start converting, then back out without saving: the quote stays Open', async () => {
  ids.q2 = await seedQuote('Back Out', await dayOffset(5));
  await go('#/quote/' + ids.q2, `!!document.querySelector('.summary-head')`);
  await click('Convert to receipt');
  await waitFor(`location.hash === '#/new' && !!document.querySelector('.notice')`, 'converting');
  assert.match(await evaluate(`document.querySelector('.notice').textContent`), /Converting quote QT-0002/);

  // Leave without saving.
  await go('#/quotes', `document.querySelectorAll('.list-row').length > 0`);
  const row = await evaluate(`(() => { const a = document.querySelector('a[href="#/quote/${ids.q2}"]'); return a.querySelector('.badge').textContent; })()`);
  assert.equal(row, 'Open');
  let q = await evaluate(`db.get('quotes', ${ids.q2})`);
  assert.equal(q.receiptId, undefined);
  assert.equal(q.convertedAt, undefined);

  // The pre-filled draft is still there; Discard drops it, and the quote is still Open.
  await go('#/new', `!!document.querySelector('.line-item')`);
  assert.match(await evaluate(`document.querySelector('.notice').textContent`), /Converting quote QT-0002/);
  await click('Discard');
  await waitFor(`!document.querySelector('#view .notice') && !!document.querySelector('.line-item')`, 'draft discarded');
  assert.equal(await fieldValue('Description', 0), '');
  assert.equal(await fieldValue('Name'), '');
  assert.equal(await evaluate(`Views.new.hasDraft()`), false);
  assert.equal(await evaluate(`db.get('quotes', ${ids.q2}).then((q) => quote.status(q))`), 'open');
  assert.deepEqual(await counters(), { receipt: 2, quote: 2 }, 'no receipt number used');
});

test('4. a quote past its valid-until shows Expired, and converting it warns first', async () => {
  const yesterday = await dayOffset(-1);
  ids.q3 = await seedQuote('Late Larry', yesterday);
  await go('#/quotes', `document.querySelectorAll('.list-row').length > 0`);
  assert.equal(await evaluate(`document.querySelector('a[href="#/quote/${ids.q3}"] .badge').textContent`), 'Expired');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.chips')].map((r) => [...r.querySelectorAll('label')].map((l) => l.textContent))`), [
    ['Today', 'Week', 'Month', 'All', 'Custom'],
    ['All', 'Open', 'Expired', 'Converted', 'Cancelled'],
  ]);
  await evaluate(`document.getElementById('qstatus-expired').click(); true`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.list-row .list-title-text')].map((t) => t.textContent)`), ['QT-0003']);
  await evaluate(`document.getElementById('qstatus-open').click(); true`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.list-row .list-title-text')].map((t) => t.textContent)`), ['QT-0002']);
  await evaluate(`document.getElementById('qstatus-converted').click(); true`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.list-row .list-title-text')].map((t) => t.textContent)`), ['QT-0001']);
  await evaluate(`document.getElementById('qstatus-all').click(); true`);

  await go('#/quote/' + ids.q3, `!!document.querySelector('.summary-head')`);
  const day = await evaluate(`receipt.formatDay(${js(yesterday)})`);
  assert.match(await viewText(), new RegExp('This quote expired on ' + day));
  assert.ok(await hasButton('Edit'), 'expired quotes can still be edited');

  await click('Convert to receipt');
  await waitFor(`!!document.querySelector('dialog[open]')`, 'expired warning');
  assert.equal(await dialogText(), 'This quote expired on ' + day + '. Convert anyway?');
  await click('Cancel', `document.querySelector('dialog[open]')`);
  await page.sleep(100);
  assert.equal(await evaluate('location.hash'), '#/quote/' + ids.q3, 'Cancel stays on the quote');

  await click('Convert to receipt');
  await waitFor(`!!document.querySelector('dialog[open]')`, 'expired warning again');
  await click('Convert anyway', `document.querySelector('dialog[open]')`);
  await waitFor(`location.hash === '#/new' && !!document.querySelector('.notice')`, 'converting expired quote');
  assert.match(await evaluate(`document.querySelector('.notice').textContent`), /Converting quote QT-0003/);
  await click('Discard');
  await waitFor(`!document.querySelector('#view .notice')`, 'discarded');
});

test('5. cancel a quote: Cancelled, CANCELLED watermark, cannot be edited or converted', async () => {
  ids.q4 = await seedQuote('Cancel Carl', await dayOffset(10));
  await go('#/quote/' + ids.q4, `!!document.querySelector('.summary-head')`);
  await click('Cancel quote');
  await waitFor(`!!document.querySelector('dialog[open]')`, 'cancel confirm');
  assert.match(await dialogText(), /^Cancel quote QT-0004\?/);
  await click('Cancel quote', `document.querySelector('dialog[open]')`);
  await waitFor(`!!document.querySelector('.notice-danger')`, 'cancelled notice');

  const q = await evaluate(`db.get('quotes', ${ids.q4})`);
  assert.ok(!isNaN(new Date(q.cancelledAt)));
  assert.match(await evaluate(`document.querySelector('.summary-head .badge').textContent`), /^Cancelled$/);
  for (const b of ['Convert to receipt', 'Edit', 'Cancel quote']) assert.equal(await hasButton(b), false, 'no ' + b);
  assert.equal(await evaluate(`db.count('quotes')`), 4, 'never deleted');

  const text = await pdfText('quotes', ids.q4);
  assert.match(text, /\(CANCELLED\) Tj/);
  assert.match(text, /\/ca 0\.18/, 'watermark is see-through');
  assert.match(text, /\(QUOTATION\) Tj/);

  await go('#/quote/' + ids.q4 + '/edit', `!!document.querySelector('.placeholder')`);
  assert.match(await viewText(), /QT-0004 is cancelled and can't be edited/);
  const before = await counters();
  await assert.rejects(evaluate(`db.get('quotes', ${ids.q4}).then((q) => db.updateQuote({ ...q, notes: 'x' }))`), /cancelled/);
  await assert.rejects(evaluate(`db.getSettings().then((s) => db.saveConvertedReceipt(receipt.buildReceipt({ customer: {}, paymentMethod: 'cash',
    lines: [{ description: 'X', qtyMilli: 1000, unitCents: 100, zeroRated: false }] }, s), ${ids.q4}))`), /cancelled/);
  assert.deepEqual(await counters(), before, 'a refused conversion uses no receipt number');
  assert.equal(await evaluate(`db.count('receipts')`), 2);
});

test('6. quotes do not change History totals or receipt numbering', async () => {
  await go('#/history', `document.querySelectorAll('.list-row').length > 0`);
  const summary = await evaluate(`document.querySelector('.list-summary').textContent`);
  const receipts = await evaluate(`db.getAll('receipts')`);
  const total = receipts.reduce((s, r) => s + r.totalCents, 0);
  assert.equal(summary, '2 receipts · Total ' + (await evaluate(`money.formatCents(${total})`)));
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.list-row .list-title-text')].map((t) => t.textContent)`), ['INV-0002', 'INV-0001']);

  // Another quote (bigger than everything else) changes neither the History summary nor the next receipt number.
  await seedQuote('Big Spender', await dayOffset(3), [['Truck', 1000, 9999900]]);
  await go('#/products', `!!document.querySelector('#view > div')`);
  await go('#/history', `document.querySelectorAll('.list-row').length > 0`);
  assert.equal(await evaluate(`document.querySelector('.list-summary').textContent`), summary);
  assert.deepEqual(await counters(), { receipt: 2, quote: 5 });
  const next = await evaluate(`db.getSettings().then((s) => db.saveNewDocument('receipt', receipt.buildReceipt({ customer: {}, paymentMethod: 'cash',
    lines: [{ description: 'Soda', qtyMilli: 1000, unitCents: 200, zeroRated: false }] }, s))).then((r) => r.number)`);
  assert.equal(next, 'INV-0003');
  assert.equal(await evaluate(`filter.summarize([]).totalCents`), 0);
});

test('9. saving a quote auto-saves a new customer and product when ON, and not when OFF', async () => {
  const names = async () => ({
    customers: (await evaluate(`db.getAll('customers')`)).map((c) => c.name),
    products: (await evaluate(`db.getAll('products')`)).map((p) => p.name),
  });
  // From test 1 (toggle on by default): Ana Lopez and Delivery were added; Pizza was not duplicated.
  let n = await names();
  assert.ok(n.customers.includes('Ana Lopez'));
  assert.ok(n.products.includes('Delivery'));
  assert.equal(n.products.filter((p) => p === 'Pizza').length, 1);

  async function saveQuoteVia(name, item) {
    await go('#/quote/new', `!!document.querySelector('.line-item')`);
    await set('Name', name);
    await set('Description', item, 0);
    await set('Unit price ($)', '7.00', 0);
    await click('Save quote');
    await waitFor(`/^#\\/quote\\/\\d+$/.test(location.hash) && !!document.querySelector('.summary-head')`, 'saved ' + name);
    await page.sleep(300); // auto-save runs after the save
  }

  await saveQuoteVia('Zed Newman', 'Widget');
  n = await names();
  assert.ok(n.customers.includes('Zed Newman'), 'customer auto-saved');
  assert.ok(n.products.includes('Widget'), 'product auto-saved');

  await evaluate(`db.setSetting('autoSaveContacts', false)`);
  await saveQuoteVia('Yuri Offman', 'Gadget');
  n = await names();
  assert.ok(!n.customers.includes('Yuri Offman'), 'toggle off: no customer');
  assert.ok(!n.products.includes('Gadget'), 'toggle off: no product');
  await evaluate(`db.setSetting('autoSaveContacts', true)`);
});

test('7. export, clear, import restores quotes and the QT counter; an old Phase 3 backup still imports', async () => {
  await go('#/settings', `!!document.getElementById('backup')`);
  await evaluate(`ui.download = (blob, name) => { blob.text().then((text) => { window.__dl = { name, text }; }); }; true`);
  await click('Export backup');
  await waitFor('!!window.__dl', 'backup download');
  const { name, text } = await evaluate('window.__dl');
  const file = JSON.parse(text);
  assert.equal(file.schemaVersion, 2);
  assert.equal(file.quotes.length, 7);
  assert.equal(file.counters.quote, 7);
  const before = await evaluate(`db.dumpAll()`);

  await evaluate(`Promise.all(db.STORES.map((s) => db.clear(s))).then(() => true)`);
  await page.reloadAt('#/settings');
  await waitFor(`!!document.getElementById('backup')`, 'settings after reload');
  assert.equal(await evaluate(`db.count('quotes')`), 0);
  assert.equal((await counters()).quote, 0);

  await chooseFile(name, text);
  await waitFor(`!!document.querySelector('dialog[open]')`, 'import confirm');
  assert.match(await dialogText(), /3 receipts, 7 quotes, /);
  await click('Replace all data', `document.querySelector('dialog[open]')`);
  await waitFor(`document.getElementById('toast') && document.getElementById('toast').textContent === 'Backup imported'`, 'import done');

  const after = await evaluate(`db.dumpAll()`);
  assert.deepEqual(after.quotes, before.quotes, 'quotes incl. converted/cancelled fields');
  assert.deepEqual(after.receipts, before.receipts, 'receipts incl. quote links');
  assert.deepEqual(await counters(), { receipt: 3, quote: 7 });
  assert.equal(await seedQuote('After Import', await dayOffset(1)).then((id) => evaluate(`db.get('quotes', ${id}).then((q) => q.number)`)), 'QT-0008');

  // A Phase 3 file: schemaVersion 1, no quotes list, no quote counter.
  const old = { ...file, schemaVersion: 1, counters: { receipt: 3 } };
  delete old.quotes;
  old.receipts = old.receipts.map(({ quoteId, quoteNumber, ...r }) => r);
  await chooseFile('phase3.json', JSON.stringify(old));
  await waitFor(`!!document.querySelector('dialog[open]')`, 'phase 3 import confirm');
  assert.match(await dialogText(), /This backup has 3 receipts, \d+ products?, /);
  await click('Replace all data', `document.querySelector('dialog[open]')`);
  await waitFor(`document.getElementById('toast') && document.getElementById('toast').textContent === 'Backup imported' && db.count('quotes').then((n) => n === 0)`, 'phase 3 import done');
  assert.equal(await evaluate(`db.count('quotes')`), 0);
  assert.equal(await evaluate(`db.count('receipts')`), 3);
  assert.deepEqual(await counters(), { receipt: 3, quote: 0 });
  await go('#/quotes', `!!document.querySelector('.placeholder')`);
  const id = await seedQuote('Fresh Start', await dayOffset(1));
  assert.equal(await evaluate(`db.get('quotes', ${id}).then((q) => q.number)`), 'QT-0001');
});
