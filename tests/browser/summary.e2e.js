// Browser test for Daily Summary (#/summary): figures on screen, empty dates, the date picker and the PDF.
//
// Run with: node --test "tests/browser/*.e2e.js"
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./harness.js');

let page, evaluate;

const text = () => evaluate(`document.querySelector('#view').innerText`);
const visit = async (hash, what) => {
  await evaluate(`location.hash = ${JSON.stringify(hash)}; true`);
  await page.waitFor(`location.hash === ${JSON.stringify(hash)} && !!document.querySelector('.summary-body') && document.querySelector('.summary-body').childElementCount > 0`, what);
};

test.before(async () => {
  page = await harness.open('#/history');
  ({ evaluate } = page);
  // 20 Nov 2026: cash $25.83 (with a zero-rated line), card $3.44, transfer $55.00 at an old 10% rate,
  // a voided cash sale and a quote (neither counted), and a sale at 00:00 on the 21st.
  await evaluate(`(async () => {
    const s = await db.getSettings();
    s.business = { ...s.business, name: 'Test Shop' };
    await db.setSettings({ business: s.business });
    const at = (d, hh, mm = 0) => new Date(2026, 10, d, hh, mm);
    const line = (description, qty, unitCents, zeroRated = false) => ({ description, qtyMilli: qty * 1000, unitCents, zeroRated });
    const save = (when, paymentMethod, lines, rate = 1250) => db.saveNewDocument('receipt',
      receipt.buildReceipt({ customer: { name: 'Kim' }, paymentMethod, lines }, { ...s, gstRateBp: rate }, when));
    await save(at(20, 9, 15), 'cash', [line('Paint', 2, 1000), line('Rice', 1, 333, true)]);
    await save(at(20, 13, 40), 'card', [line('Nails', 3, 99), line('Washer', 1, 4), line('Washer', 1, 4)]);
    await save(at(20, 23, 59), 'transfer', [line('Cement', 1, 5000)], 1000);
    const v = await save(at(20, 12), 'cash', [line('Drill', 1, 10000)]);
    await db.voidReceipt(v.id, 'Wrong item');
    await db.saveNewDocument('quote', quote.buildQuote({ customer: { name: 'Kim' }, validUntil: '2026-12-20', notes: '',
      lines: [line('Fence', 1, 20000)] }, s, at(20, 10)));
    await save(at(21, 0, 0), 'cash', [line('Ice', 1, 700)]);
    return true;
  })()`);
});

test.after(async () => {
  if (page) await page.close();
});

test('History links to the Daily Summary, which highlights the History tab', async () => {
  await evaluate(`location.hash = '#/new'; true`);
  await page.waitFor(`location.hash === '#/new' && !!document.querySelector('.field label')`, 'New Receipt');
  await evaluate(`location.hash = '#/history'; true`);
  await page.waitFor(`!!document.querySelector('a.summary-link')`, 'Daily summary link');
  await evaluate(`document.querySelector('a.summary-link').click(), true`);
  await page.waitFor(`location.hash === '#/summary' && !!document.querySelector('.summary-body')`, 'summary');
  assert.equal(await evaluate(`document.querySelector('.bottom-nav a.active').dataset.route`), 'history');
  assert.equal(await evaluate(`document.querySelector('.summary-body').closest('#view').querySelector('input[type=date]').value`),
    await evaluate('summary.dayOf(new Date())'), 'defaults to today');
});

test('20 Nov: count, subtotal, GST, total and payment methods; void and quote left out', async () => {
  await visit('#/summary/2026-11-20', 'summary for 20 Nov');
  const t = await text();
  assert.match(t, /Receipts\s+3/);
  assert.match(t, /Subtotal \(excl\. GST\)\s+\$76\.38/);   // 2333 + 305 + 5000
  assert.match(t, /GST collected\s+\$7\.89/);              // 250 + 39 + 500
  assert.match(t, /Total \(BZD\)\s+\$84\.27/);
  const pay = await evaluate(`[...document.querySelectorAll('.pay-table tbody tr')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())`);
  assert.deepEqual(pay, ['Cash 1 receipt $25.83', 'Card 1 receipt $3.44', 'Transfer 1 receipt $55.00']);
  assert.match(await evaluate(`document.querySelector('.pay-table tfoot').innerText.replace(/\\s+/g, ' ')`), /Total 3 \$84\.27/);
  assert.match(t, /1 voided receipt not counted/);
  assert.equal(await evaluate(`document.querySelectorAll('.summary-body .list-row').length`), 3);
});

test('the PDF is built with the same figures, ready to share or download', async () => {
  await page.waitFor(`[...document.querySelectorAll('.summary-body button')].some((b) => !b.disabled && /PDF/.test(b.textContent))`, 'PDF ready', 15000);
  const pdfText = await evaluate(`(async () => {
    const s = summary.daily(await db.getAll('receipts'), '2026-11-20');
    const blob = await pdf.summaryBlob(s);
    return blob.type + ' ' + blob.size + ' ' + (await blob.text());
  })()`);
  assert.match(pdfText, /^application\/pdf \d+/);
  for (const s of ['DAILY SUMMARY', 'Test Shop', '$76.38', '$7.89', '$84.27', '$25.83', '$3.44', '$55.00']) {
    assert.ok(pdfText.includes(s), 'PDF contains ' + s);
  }
});

test('the date picker switches days and updates the address; an empty day shows a message', async () => {
  await evaluate(`(() => { const i = document.querySelector('#view input[type=date]'); i.value = '2026-11-21'; i.dispatchEvent(new Event('change')); return true; })()`);
  await page.waitFor(`location.hash === '#/summary/2026-11-21' && /Total \\(BZD\\)\\s+\\$7\\.88/.test(document.querySelector('#view').innerText)`, '21 Nov');
  await visit('#/summary/2026-11-22', 'empty day');
  const t = await text();
  assert.match(t, /No receipts on this date/);
  assert.doesNotMatch(t, /\$0\.00/);
  assert.equal(await evaluate(`document.querySelectorAll('.summary-body button').length`), 0, 'nothing to share');
});
