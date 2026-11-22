// Browser test for Phase 3: History list, search and filters, void, VOID PDF, backup export/import.
//
// Run with: node --test "tests/browser/*.e2e.js"
//
// Seeds a business (with a logo), products, customers and 3 receipts through the app's own
// db.js/receipt.js, then drives the real screens in headless Chrome at 360px.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const harness = require('./harness.js');

let page, cdp, evaluate, waitFor, tmp;
const ids = {}; // receipt ids by name: walkin (yesterday), kim, eldon

const js = (v) => JSON.stringify(v);

/** Click the first visible button/link whose text is exactly `text` (optionally inside `scope`). */
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

/** Visible History rows: [{ number, voided, amount, struck }]. */
const rows = () => evaluate(`[...document.querySelectorAll('.list-row')].map((a) => ({
  number: a.querySelector('.list-title').firstChild.textContent,
  voided: !!a.querySelector('.badge-void'),
  amount: a.querySelector('.list-amount').textContent,
  struck: getComputedStyle(a.querySelector('.list-amount')).textDecorationLine === 'line-through',
}))`);
const numbers = async () => (await rows()).map((r) => r.number);

async function searchFor(q) {
  await evaluate(`(() => {
    const s = document.querySelector('input[type=search]');
    s.value = ${js(q)};
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await page.sleep(350); // 200ms debounce + render
}

/** Everything in the database, minus the device-only lastBackupAt. */
const dumpAll = () => evaluate(`db.dumpAll().then((d) => { delete d.settings.lastBackupAt; return d; })`);

async function chooseFile(name, text) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, text);
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#backup-file' });
  await cdp.send('DOM.setFileInputFiles', { nodeId, files: [file] });
}

test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resibobz-e2e-files-'));
  page = await harness.open('#/products');
  ({ cdp, evaluate, waitFor } = page);
  await cdp.send('DOM.enable');

  Object.assign(ids, await evaluate(`(async () => {
    // A real PNG logo, as Settings would store it.
    const c = document.createElement('canvas'); c.width = 8; c.height = 4;
    const g = c.getContext('2d'); g.fillStyle = '#0b5cab'; g.fillRect(0, 0, 8, 4);
    await db.setSettings({
      business: { name: 'Demo Store', address: 'Belmopan', phone: '822-0000', email: 'demo@example.com', gstTin: '000123' },
      logo: { dataUrl: c.toDataURL('image/png'), format: 'PNG', width: 8, height: 4 },
      receiptFooter: 'Thanks!', pageSize: 'a4',
    });
    await db.put('products', { name: 'Pizza', priceCents: 4000, zeroRated: false });
    await db.put('products', { name: 'Rice 25lb', priceCents: 1000, zeroRated: true });
    await db.put('customers', { name: 'Kimley Jone', phone: '622-9887', email: '', tin: '', address: '' });
    await db.put('customers', { name: 'Eldon', phone: '610-0551', email: '', tin: '', address: '' });

    const settings = await db.getSettings();
    const save = (customer, lines, when) => db.saveNewDocument('receipt',
      receipt.buildReceipt({ customer, paymentMethod: 'cash', lines }, settings, when)).then((r) => r.id);
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
    return {
      walkin: await save({ name: '', phone: '' }, [{ description: 'Pizza', qtyMilli: 2500, unitCents: 4000, zeroRated: false }], yesterday), // 100.00 + 12.50
      kim: await save({ name: 'Kimley Jone', phone: '622-9887' }, [{ description: 'Pizza', qtyMilli: 1000, unitCents: 4000, zeroRated: false }], now), // 40.00 + 5.00
      eldon: await save({ name: 'Eldon', phone: '610-0551' }, [{ description: 'Rice 25lb', qtyMilli: 2000, unitCents: 1000, zeroRated: true }], now), // 20.00
    };
  })()`));
});

test.after(async () => {
  if (page) await page.close();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test('1. three receipts, one voided: History lists 3, total excludes the void, its PDF has the VOID watermark', async () => {
  // Void Eldon's receipt through the detail screen, with a reason.
  await go('#/receipt/' + ids.eldon, `!!document.querySelector('.summary-head')`);
  await click('Void receipt');
  await waitFor(`!!document.querySelector('dialog[open] input')`, 'void dialog');
  const dialogText = await evaluate(`document.querySelector('dialog[open] p').textContent`);
  assert.equal(dialogText, 'Void receipt INV-0003? It stays in History marked VOID, is left out of every total, ' +
    "and its number is never reused. This can't be undone.");
  // The reason is required: OK with an empty box shows an inline error and keeps the dialog open.
  await click('Void receipt', `document.querySelector('dialog[open]')`);
  assert.equal(await evaluate(`document.querySelector('dialog[open] .field-error').textContent`), 'Enter a reason, e.g. wrong price');
  assert.equal((await evaluate(`db.get('receipts', ${ids.eldon})`)).voided, undefined, 'not voided without a reason');
  await evaluate(`(() => { const i = document.querySelector('dialog[open] input'); i.value = 'Wrong item'; return true; })()`);
  await click('Void receipt', `document.querySelector('dialog[open]')`);
  await waitFor(`!!document.querySelector('.notice-danger')`, 'voided notice');

  const r = await evaluate(`db.get('receipts', ${ids.eldon})`);
  assert.equal(r.voided, true);
  assert.equal(r.voidReason, 'Wrong item');
  assert.ok(!isNaN(new Date(r.voidedAt)));
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent === 'Void receipt')`), false,
    'no Void button on a voided receipt');
  assert.match(await evaluate(`document.querySelector('.notice-danger').textContent`), /Reason: Wrong item/);

  await go('#/history', `document.querySelectorAll('.list-row').length > 0`);
  assert.deepEqual(await rows(), [
    { number: 'INV-0003', voided: true, amount: '$20.00', struck: true },
    { number: 'INV-0002', voided: false, amount: '$45.00', struck: false },
    { number: 'INV-0001', voided: false, amount: '$112.50', struck: false },
  ]);
  assert.equal(await evaluate(`document.querySelector('.list-summary').textContent`),
    '3 receipts · Total $157.50 (1 void, not counted)');
  const heights = await evaluate(`[...document.querySelectorAll('.list-row')].map((a) => a.getBoundingClientRect().height)`);
  assert.ok(heights.every((hgt) => hgt >= 48), 'rows are at least 48px tall: ' + heights);
  assert.ok(await evaluate(`document.documentElement.scrollWidth <= ${harness.WIDTH}`), 'no horizontal scroll');

  // PDF: the watermark is the 150pt "VOID"; an active receipt has no VOID at all.
  const pdfText = (id) => evaluate(`db.get('receipts', ${id}).then((r) => pdf.receiptBlob(r)).then((b) => b.text())`);
  const voidPdf = await pdfText(ids.eldon);
  const okPdf = await pdfText(ids.kim);
  assert.match(voidPdf, /\/F\d+ 150 Tf/, 'large watermark font');
  assert.match(voidPdf, /\(VOID\) Tj/);
  assert.match(voidPdf, /\/ca 0\.18/, 'watermark is see-through');
  assert.doesNotMatch(okPdf, /VOID/);
});

test('2. search by number, customer name, phone and amount', async () => {
  await go('#/history', `document.querySelectorAll('.list-row').length > 0`);
  await evaluate(`(() => {
    const s = document.querySelector('input[type=search]');
    s.value = 'kim'; s.dispatchEvent(new Event('input', { bubbles: true })); return true;
  })()`);
  assert.equal((await numbers()).length, 3, 'debounced: list unchanged straight after typing');
  await page.sleep(350);
  assert.deepEqual(await numbers(), ['INV-0002']);

  for (const [q, want] of [
    ['0002', ['INV-0002']], ['R-0002', ['INV-0002']], ['INV-0001', ['INV-0001']],
    ['Kimley', ['INV-0002']], ['eldon', ['INV-0003']],
    ['6229887', ['INV-0002']], ['610-0551', ['INV-0003']],
    ['45', ['INV-0002']], ['112.5', ['INV-0001']], ['20', ['INV-0003']],
  ]) {
    await searchFor(q);
    assert.deepEqual(await numbers(), want, 'search ' + q);
  }
  await searchFor('nobody');
  assert.deepEqual(await numbers(), []);
  assert.equal(await evaluate(`document.querySelector('.list .placeholder').textContent`), 'No receipts found');
  await searchFor('');
});

/** Date chip by its visible label: { label, rect, checked }. */
const chip = (text) => evaluate(`(() => {
  const l = [...document.querySelectorAll('.chips label')].find((x) => x.textContent === ${js(text)});
  l.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const r = l.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, checked: l.control.checked };
})()`);

/** Tap a date chip like a finger would; dy shifts the tap from the pill's centre. */
async function tapChip(text, dy = 0) {
  const r = await chip(text);
  const x = (r.left + r.right) / 2;
  const y = (r.top + r.bottom) / 2 + dy;
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
}

const selectedChip = () => evaluate(`[...document.querySelectorAll('.chips input')].filter((i) => i.checked).map((i) => i.labels[0].textContent)`);

test('3. date chips: All by default, Today excludes yesterday, Custom shows From/To; filters combine', async () => {
  await go('#/history', `document.querySelectorAll('.list-row').length > 0`);
  assert.equal(await evaluate(`!!document.querySelector('select')`), false, 'no date dropdown any more');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.chips label')].map((l) => l.textContent)`),
    ['Today', 'Week', 'Month', 'All', 'Custom']);
  assert.deepEqual(await selectedChip(), ['All']);
  assert.equal((await chip('Today')).height, 48, 'chips are 48px tall, like the status buttons');
  assert.equal(await evaluate(`document.querySelector('.date-range').hidden`), true);

  await tapChip('Today');
  assert.deepEqual(await selectedChip(), ['Today']);
  assert.deepEqual(await numbers(), ['INV-0003', 'INV-0002']);
  assert.deepEqual(await evaluate(`(() => { const s = getComputedStyle(document.querySelector('.chips input:checked + label')); return [s.backgroundColor, s.color]; })()`),
    ['rgb(13, 93, 170)', 'rgb(255, 255, 255)'], 'selected chip is blue #0D5DAA with white text');

  // The whole 48px button is the tap target: a tap 22px above its centre still selects it.
  await tapChip('Week', -22);
  assert.deepEqual(await selectedChip(), ['Week']);
  const yesterdayInThisWeek = new Date().getDay() !== 1; // weeks start Monday
  assert.deepEqual(await numbers(), yesterdayInThisWeek ? ['INV-0003', 'INV-0002', 'INV-0001'] : ['INV-0003', 'INV-0002']);

  await tapChip('Custom');
  assert.equal(await evaluate(`document.querySelector('.date-range').hidden`), false, 'Custom reveals From/To');
  const today = await evaluate(`filter.dayString(new Date())`);
  await evaluate(`(() => { const i = document.querySelector('.date-range input'); i.value = ${js(today)}; i.dispatchEvent(new Event('change')); return true; })()`);
  assert.deepEqual(await numbers(), ['INV-0003', 'INV-0002'], 'From today excludes yesterday');
  await evaluate(`(() => { const i = document.querySelector('.date-range input'); i.value = ''; i.dispatchEvent(new Event('change')); return true; })()`);

  await tapChip('Today');
  assert.equal(await evaluate(`document.querySelector('.date-range').hidden`), true, 'other chips hide From/To');
  assert.deepEqual(await numbers(), ['INV-0003', 'INV-0002']);
  assert.match(await evaluate(`document.querySelector('.list-summary').textContent`), /^2 receipts · Total \$45\.00/);
  await evaluate(`document.getElementById('status-active').click(); true`);
  assert.deepEqual(await numbers(), ['INV-0002']);
  await evaluate(`document.getElementById('status-voided').click(); true`);
  assert.deepEqual(await numbers(), ['INV-0003']);
  await evaluate(`document.getElementById('status-all').click(); true`);
  await tapChip('All');
  assert.deepEqual(await numbers(), ['INV-0003', 'INV-0002', 'INV-0001']);
});

test('4. export, clear everything, import: all data matches and numbering continues', async () => {
  // Never backed up yet: History shows the reminder.
  assert.match(await evaluate(`document.querySelector('.notice') ? document.querySelector('.notice').textContent : ''`), /Back up your receipts.*Last backup: never/);

  await go('#/settings', `!!document.getElementById('backup')`);
  await evaluate(`ui.download = (blob, name) => { blob.text().then((text) => { window.__dl = { name, text }; }); }; true`);
  await click('Export backup');
  await waitFor('!!window.__dl', 'backup download');
  const { name, text } = await evaluate('window.__dl');
  const today = await evaluate(`filter.dayString(new Date())`);
  assert.equal(name, 'toucanbill-backup-' + today + '.json');
  const file = JSON.parse(text);
  assert.equal(file.app, 'ResiboBZ');
  assert.equal(file.schemaVersion, 2);
  assert.deepEqual(file.counters, { receipt: 3, quote: 0 });
  assert.match(file.settings.logo.dataUrl, /^data:image\/png;base64,/);
  assert.match(await evaluate(`document.querySelector('#backup').textContent`), /Last backup: today \(\d\d \w{3} \d{4}/);

  const before = await dumpAll();

  // Clear all data, then check it really is gone after a reload.
  await evaluate(`Promise.all(db.STORES.map((s) => db.clear(s))).then(() => true)`);
  await page.reloadAt('#/settings');
  await waitFor(`!!document.getElementById('backup')`, 'settings after reload');
  assert.equal(await evaluate(`db.count('receipts')`), 0);
  assert.equal(await evaluate(`db.getSetting('logo')`), null);

  await chooseFile(name, text);
  await waitFor(`!!document.querySelector('dialog[open]')`, 'import confirm');
  assert.match(await evaluate(`document.querySelector('dialog[open] p').textContent`),
    new RegExp('3 receipts, 2 products, 2 customers, exported ' + today));
  await click('Replace all data', `document.querySelector('dialog[open]')`);
  await waitFor(`document.getElementById('toast') && document.getElementById('toast').textContent === 'Backup imported'`, 'import done');

  const after = await dumpAll();
  assert.deepEqual(after.settings, before.settings, 'settings incl. logo, counters, prefix');
  assert.deepEqual(after.products, before.products);
  assert.deepEqual(after.customers, before.customers);
  assert.deepEqual(after.receipts, before.receipts, 'receipts incl. void fields');
  assert.equal(await evaluate(`db.getSetting('lastBackupAt')`), file.exportedAt);

  // Next receipt, saved through New Receipt, continues at INV-0004 and offers History.
  await go('#/new', `!!document.querySelector('.line-item')`);
  await evaluate(`(() => {
    const set = (label, v) => {
      const i = [...document.querySelectorAll('.field label')].find((l) => l.textContent.trim() === label).control;
      i.value = v; i.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('Description', 'Soda'); set('Qty', '1'); set('Unit price ($)', '2.00');
    return true;
  })()`);
  await click('Save receipt');
  await waitFor(`!!document.querySelector('.notice-ok')`, 'saved notice');
  assert.equal(await evaluate(`document.getElementById('view-title').textContent`), 'INV-0004');
  assert.match(await evaluate(`location.hash`), /^#\/receipt\/\d+$/, '"/saved" is dropped from the URL');
  assert.doesNotMatch(await evaluate(`document.getElementById('view').textContent`), /null|undefined/);
  assert.match(await evaluate(`document.getElementById('view').textContent`), /Total \(USD at 2:1\)US\$1\.13/); // $2.25 / 2
  await click('View in History');
  await waitFor(`document.querySelectorAll('.list-row').length === 4`, 'History with 4 receipts');
  assert.equal((await numbers())[0], 'INV-0004');
});

test('5. a bad backup file shows an error and changes nothing', async () => {
  await go('#/settings', `!!document.getElementById('backup')`);
  const before = await dumpAll();
  const errorText = () => evaluate(`(() => { const e = document.querySelector('#backup .field-error'); return e.hidden ? '' : e.textContent; })()`);

  for (const [fname, content, re] of [
    ['broken.json', '{"app":"ResiboBZ","schemaVersion":1,', /not valid JSON/],
    ['other.json', '{"app":"SomethingElse","schemaVersion":1}', /not a Toucan Bill backup/],
    ['future.json', JSON.stringify({ app: 'ResiboBZ', schemaVersion: 3 }), /different version/],
  ]) {
    await chooseFile(fname, content);
    await waitFor(`!document.querySelector('#backup .field-error').hidden`, 'error for ' + fname);
    const msg = await errorText();
    assert.match(msg, re);
    assert.match(msg, /Your data was not changed\./);
    assert.equal(await evaluate(`!!document.querySelector('dialog[open]')`), false, 'no confirm dialog');
    await evaluate(`document.querySelector('#backup .field-error').hidden = true; true`);
  }
  assert.deepEqual(await dumpAll(), before);
});
