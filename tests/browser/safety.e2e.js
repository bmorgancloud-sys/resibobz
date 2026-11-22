// Browser tests for the safety hardening: CSP, escaping, no outside requests, double saves, failed
// saves, void + corrected receipt, totals recalculated, input validation, backup banner, import safety
// copy, storage status, the global error bar, the nearly-full warning and logo limits.
//
// Run with: node --test "tests/browser/*.e2e.js"
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./harness.js');

let page, evaluate, waitFor;
const js = JSON.stringify;
const XSS = '<img src=x onerror=alert(1)>';

const click = (text, scope = 'document') => evaluate(`(() => {
  const el = [...${scope}.querySelectorAll('button, a, label.btn')].find((b) => b.textContent.trim() === ${js(text)} && b.offsetParent !== null);
  if (!el) throw new Error('No button ' + ${js(text)});
  el.click();
  return true;
})()`);
const go = async (hash, ready) => {
  await evaluate(`location.hash = ${js(hash)}; true`);
  await waitFor(ready, hash);
};
/** Type into the field labelled `label` (the n-th one), as a user would. */
const setField = (label, value, n = 0) => evaluate(`(() => {
  const i = [...document.querySelectorAll('.field label')].filter((l) => l.textContent.trim() === ${js(label)})[${n}].control;
  i.value = ${js(value)};
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
const fieldValue = (label, n = 0) => evaluate(`[...document.querySelectorAll('.field label')].filter((l) => l.textContent.trim() === ${js(label)})[${n}].control.value`);
const fieldError = (label, n = 0) => evaluate(`(() => {
  const i = [...document.querySelectorAll('.field label')].filter((l) => l.textContent.trim() === ${js(label)})[${n}].control;
  const e = document.getElementById(i.id + '-err');
  return e && !e.hidden ? e.textContent : '';
})()`);
const toastText = () => evaluate(`(document.getElementById('toast') || {}).textContent || ''`);
const count = (store) => evaluate(`db.count(${js(store)})`);
/** Capture downloads instead of saving files: window.__dls = [{ name, text }]. */
const stubDownloads = () => evaluate(`window.__dls = []; ui.download = (blob, name) => { blob.text().then((text) => window.__dls.push({ name, text })); }; true`);

test.before(async () => {
  page = await harness.open('#/products');
  ({ evaluate, waitFor } = page);
  await evaluate(`window.alert = () => { window.__alerted = true; }; true`);
  await evaluate(`db.setSettings({ business: { name: 'Sunny Salon', address: '', phone: '', email: '', gstTin: '123' } }).then(() => true)`);
});

test.after(async () => {
  if (page) await page.close();
});

test('security headers: the CSP from netlify.toml is enforced, so injected inline script never runs', async () => {
  const headers = await evaluate(`fetch('./', { cache: 'no-store' }).then((r) => ({
    csp: r.headers.get('content-security-policy'), nosniff: r.headers.get('x-content-type-options'),
    referrer: r.headers.get('referrer-policy'), permissions: r.headers.get('permissions-policy') }))`);
  assert.match(headers.csp, /default-src 'self'/);
  assert.doesNotMatch(headers.csp, /unsafe-inline|unsafe-eval/);
  assert.deepEqual([headers.nosniff, headers.referrer, headers.permissions],
    ['nosniff', 'no-referrer', 'camera=(), microphone=(), geolocation=()']);
  await evaluate(`(() => { const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.body.append(s); return true; })()`);
  await page.sleep(100);
  assert.equal(await evaluate('window.__inline'), undefined, 'inline script blocked');
  assert.equal(await evaluate(`document.querySelectorAll('script:not([src])').length`), 1, 'only the probe; the app has no inline scripts');
});

test(`escaping: a customer and product named ${XSS} show as plain text everywhere`, async () => {
  await evaluate(`Promise.all([
    db.put('customers', { name: ${js(XSS)}, phone: '610-7777', email: '', tin: '', address: ${js(XSS)} }),
    db.put('products', { name: ${js(XSS)}, priceCents: 500, zeroRated: false }),
  ]).then(() => true)`);
  // Typed into New Receipt, as a user would, then saved.
  await go('#/new', `!!document.querySelector('.line-item')`);
  await setField('Name', XSS);
  await setField('Description', XSS);
  await setField('Unit price ($)', '5');
  await click('Save receipt');
  await waitFor(`/^#\\/receipt\\/\\d+/.test(location.hash) && !!document.querySelector('.summary-head')`, 'saved receipt');
  assert.match(await evaluate(`document.getElementById('view').textContent`), /<img src=x onerror=alert\(1\)>/);

  const screens = [
    ['#/history', `document.querySelectorAll('.list-row').length > 0`],
    ['#/customers', `document.querySelectorAll('.list-row').length > 0`],
    ['#/products', `document.querySelectorAll('.list-row').length > 0`],
  ];
  for (const [hash, ready] of screens) {
    await go(hash, ready);
    assert.match(await evaluate(`document.getElementById('view').textContent`), /<img src=x onerror=alert\(1\)>/, hash + ' shows the text');
  }
  // History search results.
  await go('#/history', `!!document.querySelector('input[type=search]')`);
  await evaluate(`(() => { const s = document.querySelector('input[type=search]'); s.value = '<img'; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await page.sleep(350);
  assert.equal(await evaluate(`document.querySelectorAll('.list-row').length`), 1);
  // Type-ahead suggestions on New Receipt.
  await go('#/new', `!!document.querySelector('.line-item')`);
  await setField('Name', '<img');
  await waitFor(`!!document.querySelector('.typeahead-option')`, 'customer suggestion');
  assert.match(await evaluate(`document.querySelector('.typeahead-option').textContent`), /<img src=x/);

  assert.equal(await evaluate(`document.querySelectorAll('img[src="x"]').length`), 0, 'no <img> element was ever created');
  assert.equal(await evaluate('window.__alerted'), undefined, 'no alert ran');
  // WhatsApp text is URL-encoded; the PDF is drawn as text by jsPDF.
  const r = await evaluate(`db.getAll('receipts').then((a) => a[a.length - 1])`);
  assert.match(await evaluate(`receipt.whatsappUrl('', receipt.summaryText(${js(r)}))`), /%3Cimg%20src%3Dx%20onerror%3Dalert\(1\)%3E/);
  assert.ok(await evaluate(`pdf.documentBlob(${js(r)}).then((b) => b.size > 1000)`));
  await setField('Name', '');
});

test('double tap on Save makes one receipt; a failed save says "Not saved — try again" and keeps the typing', async () => {
  await go('#/new', `!!document.querySelector('.line-item')`);
  await setField('Name', 'Maria');
  await setField('Description', 'Haircut');
  await setField('Unit price ($)', '25');

  // The database refuses once: nothing is lost and nothing claims success.
  const before = await count('receipts');
  await evaluate(`window.__realSave = db.saveNewDocument; db.saveNewDocument = () => Promise.reject(new Error('QuotaExceededError')); true`);
  await click('Save receipt');
  await waitFor(`(document.getElementById('toast') || {}).textContent === 'Not saved — try again'`, 'not saved toast');
  assert.equal(await count('receipts'), before);
  assert.equal(await evaluate('location.hash'), '#/new');
  assert.deepEqual([await fieldValue('Name'), await fieldValue('Description'), await fieldValue('Unit price ($)')], ['Maria', 'Haircut', '25']);
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Save receipt').disabled`), false);
  await evaluate(`db.saveNewDocument = window.__realSave; true`);

  // Two taps in the same instant: one receipt.
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Save receipt'); b.click(); b.click(); b.form.requestSubmit(); return true; })()`);
  await waitFor(`/^#\\/receipt\\/\\d+/.test(location.hash)`, 'saved');
  await page.sleep(300);
  assert.equal(await count('receipts'), before + 1);
});

test('totals are recalculated from the lines on save; a tampered total is never stored', async () => {
  const saved = await evaluate(`(async () => {
    const s = await db.getSettings();
    const r = receipt.buildReceipt({ customer: {}, paymentMethod: 'cash', lines: [{ description: 'Colour', qtyMilli: 2000, unitCents: 4000, zeroRated: false }] }, s);
    r.totalCents = 1; r.subtotalCents = 1; r.gstCents = 0; r.lines[0].netCents = 1;
    return db.saveNewDocument('receipt', r);
  })()`);
  assert.deepEqual([saved.subtotalCents, saved.gstCents, saved.totalCents, saved.lines[0].netCents], [8000, 1000, 9000, 8000]);
  const stored = await evaluate(`db.get('receipts', ${saved.id})`);
  assert.equal(stored.totalCents, 9000);
  await assert.rejects(evaluate(`(async () => {
    const s = await db.getSettings();
    const r = receipt.buildReceipt({ customer: {}, paymentMethod: 'cash', lines: [{ description: 'X', qtyMilli: 1000, unitCents: 100, zeroRated: false }] }, s);
    r.lines[0].qtyMilli = 0;
    return db.saveNewDocument('receipt', r);
  })()`), /invalid quantity/);
});

test('validation: friendly inline messages for quantity, price and GST rate; no pop-ups', async () => {
  await go('#/new', `!!document.querySelector('.line-item')`);
  await setField('Description', 'Trim');
  await setField('Qty', '0');
  await setField('Unit price ($)', '12.505');
  await click('Save receipt');
  assert.equal(await fieldError('Qty'), 'Quantity must be more than 0');
  assert.equal(await fieldError('Unit price ($)'), 'Use at most 2 decimals, e.g. 12.50');
  await setField('Qty', '1');
  await setField('Unit price ($)', '-3');
  await click('Save receipt');
  assert.equal(await fieldError('Unit price ($)'), "Price can't be negative");
  await setField('Qty', '99999');
  await setField('Unit price ($)', '99999999');
  await click('Save receipt');
  assert.equal(await fieldError('Unit price ($)'), 'This line total is too large');
  assert.equal(await evaluate('location.hash'), '#/new', 'nothing saved');
  await click('Remove item').catch(() => {});
  await setField('Description', ''); await setField('Qty', '1'); await setField('Unit price ($)', '');

  await go('#/settings', `!!document.getElementById('backup')`);
  await setField('GST rate (%)', '120');
  await click('Save settings');
  assert.equal(await fieldError('GST rate (%)'), 'Enter a rate from 0 to 100, e.g. 12.5');
  assert.equal(await evaluate('window.__alerted'), undefined);
  assert.equal(await evaluate(`db.getSetting('gstRateBp')`), 1250, 'bad rate not saved');
  // Length limits on what people type.
  assert.deepEqual(await evaluate(`['Business name', 'Address', 'Footer note'].map((t) =>
    [...document.querySelectorAll('.field label')].find((l) => l.textContent.trim() === t).control.maxLength)`), [100, 300, 300]);
});

test('void needs a reason; "Issue corrected receipt" copies it into a new receipt with the next number', async () => {
  const id = await evaluate(`db.getAll('receipts').then((a) => a.find((r) => r.lines[0].description === 'Haircut').id)`);
  const original = await evaluate(`db.get('receipts', ${id})`);
  await go('#/receipt/' + id, `!!document.querySelector('.summary-head')`);
  await click('Void receipt');
  await waitFor(`!!document.querySelector('dialog[open] input')`, 'void dialog');
  await click('Void receipt', `document.querySelector('dialog[open]')`);
  assert.equal(await evaluate(`document.querySelector('dialog[open] .field-error').textContent`), 'Enter a reason, e.g. wrong price');
  await evaluate(`(() => { const i = document.querySelector('dialog[open] input'); i.value = 'Wrong price'; return true; })()`);
  await click('Void receipt', `document.querySelector('dialog[open]')`);
  await waitFor(`!!document.querySelector('.notice-danger')`, 'voided');

  await click('Issue corrected receipt');
  await waitFor(`location.hash === '#/new' && !!document.querySelector('.line-item')`, 'new receipt');
  assert.match(await evaluate(`document.getElementById('view').textContent`), new RegExp('Copied from voided receipt ' + original.number));
  assert.deepEqual([await fieldValue('Name'), await fieldValue('Description'), await fieldValue('Unit price ($)')], ['Maria', 'Haircut', '25.00']);
  await setField('Unit price ($)', '30');
  await click('Save receipt');
  await waitFor(`/^#\\/receipt\\/\\d+/.test(location.hash) && !!document.querySelector('.summary-head')`, 'corrected saved');
  // Auto-save then offers to update the saved product's price ($25 -> $30): leave it as it was.
  await waitFor(`!!document.querySelector('dialog[open]')`, 'price update offer');
  assert.match(await evaluate(`document.querySelector('dialog[open]').textContent`), /Haircut: \$25\.00 → \$30\.00/);
  await evaluate(`document.querySelector('dialog[open] .btn-secondary').click(), true`);
  const all = await evaluate(`db.getAll('receipts')`);
  const fresh = all[all.length - 1];
  assert.notEqual(fresh.number, original.number);
  assert.equal(fresh.totalCents, 3375);
  const old = all.find((r) => r.id === id);
  assert.equal(old.voided, true);
  assert.equal(old.voidReason, 'Wrong price');
  assert.equal(old.number, original.number, 'the voided number is kept, never reused');
});

test('backup banner: "Back up your receipts" exports from New Receipt; Settings shows days ago, storage and the privacy line', async () => {
  await evaluate(`db.setSetting('lastBackupAt', new Date(Date.now() - 9 * 864e5).toISOString()).then(() => true)`);
  await go('#/new', `!!document.querySelector('.line-item')`);
  await waitFor(`!!document.querySelector('.backup-banner')`, 'banner');
  assert.match(await evaluate(`document.querySelector('.backup-banner').textContent`), /^Back up your receipts.*Last backup: 9 days ago/);
  await stubDownloads();
  await click('Export backup now', `document.querySelector('.backup-banner')`);
  await waitFor(`window.__dls.length === 1 && !document.querySelector('.backup-banner')`, 'export from banner');
  const file = JSON.parse(await evaluate('window.__dls[0].text'));
  assert.equal(file.app, 'ResiboBZ');
  assert.equal(file.schemaVersion, 2);
  for (const k of ['settings', 'counters', 'products', 'customers', 'receipts', 'quotes']) assert.ok(k in file, 'backup has ' + k);
  assert.equal(file.receipts.length, await count('receipts'));

  await go('#/settings', `!!document.getElementById('backup')`);
  const text = await evaluate(`document.getElementById('backup').textContent`);
  assert.match(text, /Your receipts are stored only on this device\. Back up weekly\./);
  assert.match(text, /Last backup: today \(/);
  await waitFor(`/^Storage: (protected|not protected)/.test(document.querySelector('.storage-status').textContent)`, 'storage status');
});

test('import: a safety copy downloads first, then "Replace all data on this phone?"; Cancel changes nothing', async () => {
  const before = await evaluate(`db.dumpAll()`);
  await stubDownloads();
  const file = await evaluate(`backup.collect(new Date()).then((d) => JSON.stringify({ ...d, receipts: [] }))`);
  await evaluate(`(() => {
    const input = document.getElementById('backup-file');
    const dt = new DataTransfer();
    dt.items.add(new File([${js(file)}], 'old.json', { type: 'application/json' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
    return true;
  })()`);
  await waitFor(`!!document.querySelector('dialog[open]')`, 'confirm');
  assert.match(await evaluate(`document.querySelector('dialog[open] p').textContent`), /^Replace all data on this phone\?.*A copy of your current data was saved to your downloads first\./);
  await waitFor('window.__dls.length === 1', 'safety copy');
  const copy = await evaluate('window.__dls[0]');
  assert.match(copy.name, /^toucanbill-backup-\d{4}-\d\d-\d\d-before-import\.json$/);
  assert.equal(JSON.parse(copy.text).receipts.length, before.receipts.length, 'the copy holds the current data');
  await click('Cancel', `document.querySelector('dialog[open]')`);
  assert.deepEqual(await evaluate(`db.dumpAll()`), before);
});

test('"Something went wrong" bar with "Export backup now" on any uncaught error', async () => {
  await evaluate(`setTimeout(() => { throw new Error('boom'); }); true`);
  await waitFor(`!!document.querySelector('.error-bar')`, 'error bar');
  assert.match(await evaluate(`document.querySelector('.error-bar').textContent`), /^Something went wrong.*Export backup now/);
  await click('Dismiss', `document.querySelector('.error-bar')`);
  assert.equal(await evaluate(`!!document.querySelector('.error-bar')`), false);
  await evaluate(`Promise.reject(new Error('async boom')); true`);
  await waitFor(`!!document.querySelector('.error-bar')`, 'error bar for a rejected promise');
  await click('Dismiss', `document.querySelector('.error-bar')`);
});

test('logo: a big photo is shrunk to at most 400 x 600 px and about 200 KB; other file types are refused', async () => {
  await go('#/settings', `!!document.getElementById('logo-file')`);
  const pick = (expr) => evaluate(`(async () => {
    const input = document.getElementById('logo-file');
    const dt = new DataTransfer();
    dt.items.add(await (${expr}));
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
    return true;
  })()`);
  // 2400 x 3000 random noise: a worst case for PNG size.
  await pick(`new Promise((res) => {
    const c = document.createElement('canvas'); c.width = 2400; c.height = 3000;
    const g = c.getContext('2d'); const d = g.createImageData(2400, 3000);
    for (let i = 0; i < d.data.length; i++) d.data[i] = (i % 4 === 3) ? 255 : Math.random() * 256;
    g.putImageData(d, 0, 0);
    c.toBlob((b) => res(new File([b], 'photo.png', { type: 'image/png' })), 'image/png');
  })`);
  await waitFor(`!!document.querySelector('.logo-preview img')`, 'logo preview', 20000);
  await click('Save settings');
  await waitFor(`(document.getElementById('toast') || {}).textContent === 'Settings saved'`, 'saved');
  const logo = await evaluate(`db.getSetting('logo')`);
  const bytes = Math.floor((logo.dataUrl.length - logo.dataUrl.indexOf(',') - 1) * 3 / 4);
  assert.ok(logo.width <= 400 && logo.height <= 600, logo.width + 'x' + logo.height);
  assert.ok(bytes <= 200 * 1024, bytes + ' bytes');

  await pick(`Promise.resolve(new File(['GIF89a'], 'anim.gif', { type: 'image/gif' }))`);
  await waitFor(`!document.querySelector('.logo-field + .field-hint + .field-error, [role=group] .field-error').hidden`, 'logo error');
  assert.match(await evaluate(`document.querySelector('[role=group] .field-error').textContent`), /Choose a PNG, JPG or WebP image/);
});

test('privacy: every request the app made, across all tabs, a PDF and the charts, went to this site only', async () => {
  for (const hash of ['#/new', '#/history', '#/quotes', '#/stats', '#/products', '#/customers', '#/settings']) {
    await go(hash, `!!document.querySelector('#view > div') && document.querySelector('#view > div').childElementCount > 0`);
    await page.sleep(200);
  }
  await evaluate(`pdf.ensureLoaded ? pdf.ensureLoaded() : true`).catch(() => {});
  const urls = await evaluate(`performance.getEntriesByType('resource').map((e) => e.name)`);
  assert.ok(urls.length > 10, 'saw the app load its files');
  const outside = urls.filter((u) => !u.startsWith(page.base) && !u.startsWith('data:') && !u.startsWith('blob:'));
  assert.deepEqual(outside, []);
});

test('nearly full storage shows a warning banner on start', async () => {
  const { identifier } = await page.cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `navigator.storage.estimate = () => Promise.resolve({ usage: 95e6, quota: 100e6 });`,
  });
  try {
    await page.reloadAt('#/new');
    await waitFor(`!!document.querySelector('.storage-full')`, 'nearly full banner');
    assert.match(await evaluate(`document.querySelector('.storage-full').textContent`), /Phone storage is nearly full/);
  } finally {
    await page.cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
});
