// Browser test for the Stats tab's monthly GST summary (Phase 6 Step 1), using the hand-worked
// fixture (tests/fixtures.js) loaded into the real app: figures on screen, the month picker,
// the CSV download and the one-page PDF on Letter and A4. Also Steps 3, 4 and 6: products, customers, quotes.
//
// Run with: node --test --test-concurrency=1 "tests/browser/*.e2e.js"
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./harness.js');

let page, evaluate;
const card = () => evaluate(`document.querySelector('.gst-card').innerText`);

test.before(async () => {
  page = await harness.open('#/new');
  ({ evaluate } = page);
  await evaluate(`new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'tests/fixtures.js';
    s.onload = res; s.onerror = rej; document.body.append(s); })`);
  await evaluate(`db.replaceAll({
    settings: { business: fixtures.BUSINESS, gstRateBp: 1250 },
    counters: { receipt: fixtures.receipts.length, quote: fixtures.quotes.length },
    products: fixtures.products, customers: fixtures.customers, receipts: fixtures.receipts, quotes: fixtures.quotes,
  }).then(() => true)`);
  // Capture downloads instead of saving files.
  await evaluate(`(() => { window.__downloads = []; ui.download = (blob, name) => window.__downloads.push({ blob, name }); return true; })()`);
  await evaluate(`location.hash = '#/stats'; true`);
  await page.waitFor(`!!document.querySelector('.gst-card')`, 'GST card');
});

test.after(async () => {
  if (page) await page.close();
});

test('GST card defaults to last month and lists every month with receipts', async () => {
  const r = await evaluate(`(() => { const s = document.querySelector('.gst-card select');
    return { value: s.value, options: [...s.options].map((o) => o.value), want: stats.defaultGstMonth() }; })()`);
  assert.equal(r.value, r.want);
  assert.ok(r.options.includes('2026-10') && r.options.includes('2026-09'), r.options.join(' '));
  assert.equal(r.options[0] > r.options[1], true, 'newest first');
});

test('October 2026 on screen matches the hand-worked fixture, with each rate shown', async () => {
  await evaluate(`(() => { const s = document.querySelector('.gst-card select'); s.value = '2026-10'; s.dispatchEvent(new Event('change')); return true; })()`);
  const t = await card();
  assert.match(t, /Receipts\s+6/);
  assert.match(t, /Gross sales \(incl\. GST\)\s+\$58\.09/);
  assert.match(t, /Taxable sales \(excl\. GST\)\s+\$39\.01/);
  assert.match(t, /Zero-rated sales\s+\$14\.50/);
  assert.match(t, /GST at 10%\s+\$1\.20/);
  assert.match(t, /GST at 12\.5%\s+\$3\.38/);
  assert.match(t, /GST collected\s+\$4\.58/);
  assert.match(t, /1 voided receipt not counted/);
});

test('Export CSV downloads gst-summary-2026-10.csv with a BOM and a totals row', async () => {
  await evaluate(`[...document.querySelectorAll('.gst-card button')].find((b) => b.textContent === 'Export CSV').click(); true`);
  const d = await evaluate(`(async () => { const x = window.__downloads.pop();
    const bytes = new Uint8Array(await x.blob.arrayBuffer());
    return { name: x.name, type: x.blob.type, bom: [bytes[0], bytes[1], bytes[2]], text: new TextDecoder().decode(bytes) }; })()`);
  assert.equal(d.name, 'gst-summary-2026-10.csv');
  assert.match(d.type, /^text\/csv/);
  assert.deepEqual(d.bom, [0xef, 0xbb, 0xbf], 'UTF-8 BOM bytes');
  const lines = d.text.trim().split('\r\n');
  assert.equal(lines.length, 8, 'header + 6 receipts + totals');
  assert.equal(lines[7], 'Total,6 receipts,,39.01,14.50,4.58,58.09');
});

test('Export PDF: one page with the same figures, on Letter and on A4', async () => {
  await evaluate(`[...document.querySelectorAll('.gst-card button')].find((b) => b.textContent === 'Export PDF').click(); true`);
  await page.waitFor(`window.__downloads.length === 1`, 'PDF download', 15000);
  assert.equal(await evaluate(`window.__downloads.pop().name`), 'gst-summary-2026-10.pdf');

  for (const [size, box] of [['letter', /\/MediaBox \[0 0 612\.?\d* 792\.?\d*\]/], ['a4', /\/MediaBox \[0 0 595\.\d+ 841\.\d+\]/]]) {
    const text = await evaluate(`(async () => {
      const s = stats.gstSummary(await db.getAll('receipts'), '2026-10');
      return (await pdf.gstSummaryBlob(s, { pageSize: '${size}' })).text();
    })()`);
    assert.equal((text.match(/\/Type \/Page[^s]/g) || []).length, 1, size + ': exactly one page');
    assert.match(text, box, size + ' page size');
    for (const s of ['GST SUMMARY', 'Fixture Shop', 'October 2026', '$58.09', '$39.01', '$14.50', '$4.58', 'Standard rated \\(10%\\)',   // PDF text escapes parentheses
      'Standard rated \\(12.5%\\)', '$1.20', '$3.38','INV-0002 to INV-0008', '1 voided receipt not counted']) {
      assert.ok(text.includes(s), size + ' PDF contains ' + s);
    }
  }
});

test('a month with no receipts shows zeros and a message, and still exports', async () => {
  const months = await evaluate(`[...document.querySelectorAll('.gst-card select option')].map((o) => o.value)`);
  const empty = months.find((m) => m > '2026-11');  // after the fixture (only when today is after Nov 2026)
  if (!empty) return;
  await evaluate(`(() => { const s = document.querySelector('.gst-card select'); s.value = '${empty}'; s.dispatchEvent(new Event('change')); return true; })()`);
  const t = await card();
  assert.match(t, /Receipts\s+0/);
  assert.match(t, /GST collected\s+\$0\.00/);
  assert.match(t, /No receipts in/);
});

// ---- Step 3: top products and slow movers (same fixture) ----

/** Pick a custom range in the Trends picker and wait for the Top products card. */
async function customRange(from, to) {
  await evaluate(`(() => {
    document.querySelector('label[for="stats-range-custom"]').click();
    const [f, t] = document.querySelectorAll('.stats-picker input[type=date]');
    f.value = '${from}'; t.value = '${to}'; t.dispatchEvent(new Event('change'));
    return true; })()`);
  await page.waitFor(`!!document.querySelector('.top-products')`, 'Top products card');
}
const topRows = () => evaluate(`[...document.querySelectorAll('.top-products .rank-list li')].map((li) =>
  [li.querySelector('.rank-name').textContent, li.querySelector('.rank-value').textContent])`);

test('Top products for October: by sales, then by quantity (merged spellings, voids left out)', async () => {
  await customRange('2026-10-01', '2026-10-31');
  assert.deepEqual(await topRows(), [['Batteries AA', '$27.00'], ['Coke 500ml', '$9.00'], ['Bread loaf', '$8.00'],
    ['Rice 5lb', '$6.50'], ['Gum', '$2.97'], ['Candy', '$0.04']]);
  await evaluate(`document.querySelector('label[for="top-by-quantity"]').click(); true`);
  assert.deepEqual(await topRows(), [['Coke 500ml', '6 sold'], ['Batteries AA', '3 sold'], ['Gum', '3 sold'],
    ['Bread loaf', '2 sold'], ['Candy', '1 sold'], ['Rice 5lb', '1 sold']]);
});

test('Top products follow the range picker and keep the By quantity choice', async () => {
  await customRange('2026-09-01', '2026-09-30');   // only INV-0001: 1 x Coke
  assert.deepEqual(await topRows(), [['Coke 500ml', '1 sold']]);
  await customRange('2026-01-01', '2026-01-31');
  assert.match(await evaluate(`document.querySelector('.top-products').innerText`), /No sales in this range\./);
  await evaluate(`document.querySelector('label[for="top-by-revenue"]').click(); true`);
});

test('Slow movers: the never-sold Phone charger is listed first', async () => {
  const rows = await evaluate(`[...document.querySelectorAll('.slow-movers .rank-list li')].map((li) =>
    [li.querySelector('.rank-name').textContent, li.querySelector('.rank-value').textContent])`);
  assert.deepEqual(rows[0], ['Phone charger', 'Never sold']);
  assert.match(await evaluate(`document.querySelector('.slow-movers').innerText`), /no sales in the last 30 days/);
});

// ---- Step 4: top customers (same fixture) ----

const customerRows = () => evaluate(`[...document.querySelectorAll('.top-customers .rank-list li')].map((li) => ({
  name: li.querySelector('.rank-name').textContent, sub: li.querySelector('.rank-sub').textContent,
  value: li.querySelector('.rank-value').textContent,
  wa: li.querySelector('a.wa-btn') ? li.querySelector('a.wa-btn').href : '',
  waSize: li.querySelector('.wa-btn').getBoundingClientRect().width }))`);

test('Top customers for October: ranking, totals, walk-in and repeat match the fixture', async () => {
  await customRange('2026-10-01', '2026-10-31');
  const rows = await customerRows();
  assert.deepEqual(rows.map((r) => [r.name, r.value]), [['Maria Chen', '$34.05'], ['Jose Garcia', '$13.29'], ['Ana Lopez', '$5.69']]);
  // The year only shows when it isn't this year.
  assert.match(rows[0].sub, /^2 receipts · last 18 Nov( 2026)?$/);
  assert.match(rows[2].sub, /^1 receipt · last 9 Nov( 2026)?$/);
  const t = await evaluate(`document.querySelector('.customer-mix').innerText`);
  assert.match(t, /Walk-in \(not ranked\)\s+\$5\.06 · 1 receipt/);
  assert.match(t, /Repeat customers\s+2 · 67%/);
  assert.match(t, /One-time customers\s+1 · 33%/);
});

test('WhatsApp buttons: wa.me links with the 501 code for customers with a phone, none without', async () => {
  const rows = await customerRows();
  assert.deepEqual(rows.map((r) => r.wa), ['https://wa.me/5016221234', 'https://wa.me/5016105555', '']);
  assert.ok(rows.every((r) => r.waSize >= 48), 'buttons (and the spacer) are 48px');
  assert.equal(await evaluate(`document.querySelector('.top-customers a.wa-btn').getAttribute('aria-label')`), 'WhatsApp Maria Chen');
  assert.equal(await evaluate(`document.querySelector('.top-customers a.wa-btn').target`), '_blank');
});

// ---- Step 6: quote conversion (same fixture; runs last because it converts a quote) ----

const quoteCardText = () => evaluate(`document.querySelector('.quote-card').innerText`);
const followRows = () => evaluate(`[...document.querySelectorAll('.follow-up .rank-list li')].map((li) => ({
  name: li.querySelector('.rank-name').textContent, href: li.querySelector('.rank-name').getAttribute('href'),
  sub: li.querySelector('.rank-sub').textContent, value: li.querySelector('.rank-value').textContent,
  wa: li.querySelector('a.wa-btn') ? li.querySelector('a.wa-btn').href : '' }))`);

test('Quote conversion for October and the follow-up list match the fixture', async () => {
  await customRange('2026-10-01', '2026-10-31');
  const t = await quoteCardText();
  assert.match(t, /Quotes sent\s+2/);
  assert.match(t, /Converted to receipts\s+1/);
  assert.match(t, /Conversion rate\s+50%/);
  assert.match(t, /Open quotes value\s+\$0\.00/);
  await customRange('2026-01-01', '2026-01-31');
  assert.match(await quoteCardText(), /Conversion rate\s+—/);

  // Keep QT-0003 open whatever day the test runs (its fixture valid-until is 29 Nov 2026).
  await evaluate(`(async () => { const q = await db.get('quotes', 3); await db.put('quotes', { ...q, validUntil: '2099-12-31' }); return true; })()`);
  await evaluate(`location.hash = '#/new'; true`);
  await page.waitFor(`location.hash === '#/new'`, 'New');
  await evaluate(`location.hash = '#/stats'; true`);
  await page.waitFor(`!!document.querySelector('.follow-up')`, 'Stats');
  const rows = await followRows();
  // Open quotes only: QT-0003. QT-0002 (expired) is counted in the note below the list.
  assert.deepEqual(rows.map((r) => [r.name, r.value, r.href]), [['Ana Lopez', '$40.00', '#/quote/3']]);
  assert.match(rows[0].sub, /^QT-0003 · (today|\d+ days? old)$/);
  assert.ok(rows[0].wa.startsWith('https://wa.me/5016227777?text='), rows[0].wa);
  assert.equal(decodeURIComponent(rows[0].wa.split('?text=')[1]),
    'Hi Ana, just following up on quotation QT-0003 for $40.00 from Fixture Shop. Would you like to go ahead? Happy to answer any questions.');
  assert.match(await evaluate(`document.querySelector('.follow-up').innerText`), /1 expired quote can still be converted\. See Quotes/);
});

test('converting a quote through the app removes it from follow-ups, updates the rate, and the link survives export -> import', async () => {
  // Convert QT-0003 the way New Receipt does: db.saveConvertedReceipt (one transaction).
  await evaluate(`(async () => {
    const q = await db.get('quotes', 3);
    const s = await db.getSettings();
    const r = receipt.buildReceipt({ customer: q.customer, paymentMethod: 'cash', lines: q.lines }, s, new Date());
    await db.saveConvertedReceipt(r, q.id);
    return true; })()`);
  await evaluate(`location.hash = '#/new'; true`);
  await page.waitFor(`location.hash === '#/new'`, 'New');
  await evaluate(`location.hash = '#/stats'; true`);
  await page.waitFor(`!!document.querySelector('.follow-up')`, 'Stats');
  await customRange('2026-11-01', '2026-11-30');
  assert.deepEqual(await followRows(), [], 'QT-0003 left the follow-up list');
  assert.match(await evaluate(`document.querySelector('.follow-up').innerText`), /No open quotes to follow up\./);
  const t = await quoteCardText();
  assert.match(t, /Converted to receipts\s+1/);
  assert.match(t, /Conversion rate\s+50%/);
  assert.match(t, /Open quotes value\s+\$0\.00/);

  // Export, then import the same file: the link (receiptId / receiptNumber / convertedAt) is kept.
  const r = await evaluate(`(async () => {
    const before = await db.get('quotes', 3);
    const file = JSON.stringify(await backup.collect());
    await backup.restore(backup.parse(file));
    const after = await db.get('quotes', 3);
    return { before: [before.receiptId, before.receiptNumber, before.convertedAt], after: [after.receiptId, after.receiptNumber, after.convertedAt] };
  })()`);
  assert.ok(r.before[0] > 0 && /^INV-/.test(r.before[1]) && r.before[2]);
  assert.deepEqual(r.after, r.before);
});
