// Browser test: no screen may scroll sideways at phone widths (320, 360, 390px).
//
// Run with: node --test "tests/browser/*.e2e.js"
//
// Why not just `scrollWidth > innerWidth`: on a phone (mobile emulation here, real Android too)
// an over-wide element WIDENS the layout viewport, so innerWidth grows along with scrollWidth
// and that check passes while the page still scrolls sideways. So this test also requires
// innerWidth to equal the screen width, and names the elements sticking out on failure.
//
// Seeds deliberately awkward data: long unbroken names, emails, descriptions, a long receipt
// prefix and huge amounts. There is no Quotes screen yet; add '#/quotes' here when there is.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./harness.js');

const WIDTHS = [320, 360, 390];
const LONG = 'Supercalifragilisticexpialidocious';

let page, evaluate, ids;

/** Screen width check plus the elements that stick out past it. */
function measure(width) {
  return evaluate(`(() => {
    const W = ${width};
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('dialog') || el.offsetParent === null) continue;
      // Clipped inside a sideways-scrolling row (e.g. the date chips) that itself fits: not page overflow.
      let clipped = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (getComputedStyle(a).overflowX !== 'visible') { clipped = a.getBoundingClientRect().right <= W + 0.5; break; }
      }
      if (clipped) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.right > W + 0.5) out.push(el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).join('.') : '') + ' (right ' + Math.round(r.right) + ')');
    }
    return { inner: window.innerWidth, scroll: document.documentElement.scrollWidth, out: out.slice(0, 6) };
  })()`);
}

async function assertFits(width, what) {
  const m = await measure(width);
  assert.ok(m.inner === width && m.scroll <= m.inner,
    `${what} at ${width}px: page is ${m.scroll}px wide (viewport ${m.inner}px). Too wide: ${m.out.join(', ') || '?'}`);
}

/** Go to a route and wait for its content (and for async renders to settle). */
async function visit(hash) {
  await evaluate(`location.hash = ${JSON.stringify(hash)}; true`);
  await page.waitFor(`location.hash === ${JSON.stringify(hash)} && document.querySelector('#view > div') && document.querySelector('#view > div').childElementCount > 0`, hash);
  await page.sleep(150);
}

test.before(async () => {
  page = await harness.open('#/products');
  ({ evaluate } = page);
  ids = await evaluate(`(async () => {
    await demo.load();
    await db.setSettings({ receiptPrefix: 'INVOICE-BELMOPAN-BRANCH-' });
    const pid = await db.put('products', { name: 'Extra long product ${LONG}${LONG}', unit: 'bag${LONG}', priceCents: 123456789012, zeroRated: true });
    const cid = await db.put('customers', { name: 'Hardware${LONG}${LONG}Limited', phone: '+501 622-9887-1234-5678', email: 'accounts.receivable.department@belmopanhardware${LONG}.example.com', tin: '000123456789000123456789', address: '${LONG}${LONG} Street' });
    const s = await db.getSettings();
    s.business = { ...s.business, email: 'very.long.business.email.address@${LONG}.example.com', address: '${LONG}${LONG}' };
    const r = await db.saveNewDocument('receipt', receipt.buildReceipt({
      customer: { name: 'Hardware${LONG}${LONG}Limited', phone: '622-9887', tin: '000123456789000123456789', address: '${LONG}' },
      paymentMethod: 'transfer',
      lines: [{ description: '${LONG}${LONG}', qtyMilli: 123456, unitCents: 9876543210, zeroRated: false }],
    }, s, new Date()));
    await db.voidReceipt(r.id, '${LONG}${LONG}');
    await db.saveNewDocument('receipt', receipt.buildReceipt({ customer: { name: 'Kim', phone: '' }, paymentMethod: 'cash',
      lines: [{ description: 'Pizza', qtyMilli: 1000, unitCents: 500, zeroRated: false }] }, s, new Date()));
    return { receipt: r.id, product: pid, customer: cid };
  })()`);
});

test.after(async () => {
  if (page) await page.close();
});

for (const width of WIDTHS) {
  test(`every screen fits ${width}px with no sideways scroll`, async () => {
    await page.setWidth(width);
    const routes = [
      ['#/history', 'History'],
      ['#/receipt/' + ids.receipt, 'Receipt detail (voided)'],
      ['#/new', 'New Receipt'],
      ['#/products', 'Products'],
      ['#/products/' + ids.product, 'Product edit'],
      ['#/products/new', 'Product add'],
      ['#/customers', 'Customers'],
      ['#/customers/' + ids.customer, 'Customer edit'],
      ['#/settings', 'Settings'],
    ];
    for (const [hash, what] of routes) {
      await visit(hash);
      await assertFits(width, what);
    }

    // History: date chips in one row that may scroll inside itself, never the page.
    await visit('#/history');
    await evaluate(`document.getElementById('date-custom').click(); true`);
    await assertFits(width, 'History custom range');
    const chips = await evaluate(`(() => {
      const row = document.querySelector('.chips');
      const r = row.getBoundingClientRect();
      return { left: r.left, right: r.right, count: row.querySelectorAll('label').length,
        overflowX: getComputedStyle(row).overflowX, dateInputs: !document.querySelector('.date-range').hidden };
    })()`);
    assert.equal(chips.count, 5);
    assert.ok(chips.left >= 0 && chips.right <= width, `chip row spans ${chips.left}-${chips.right}px, outside 0-${width}px`);
    assert.equal(chips.overflowX, 'auto', 'chip row scrolls inside itself');
    assert.ok(chips.dateInputs, 'Custom shows the From/To inputs');
    await evaluate(`(() => { const row = document.querySelector('.chips'); row.scrollLeft = row.scrollWidth; return true; })()`);
    await assertFits(width, 'History with the chip row scrolled to the end');

    // Every status button visible.
    const buttons = await evaluate(`[...document.querySelectorAll('.segmented label')].map((l) => l.getBoundingClientRect().right)`);
    assert.equal(buttons.length, 3);
    for (const right of buttons) assert.ok(right <= width, `status button ends at ${right}px, past ${width}px`);
    await evaluate(`document.getElementById('date-all').click(); true`);

    // New Receipt with a long description typed in.
    await visit('#/new');
    await evaluate(`(() => {
      const i = [...document.querySelectorAll('.field label')].find((l) => l.textContent.trim() === 'Description').control;
      i.value = ${JSON.stringify(LONG + LONG)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true;
    })()`);
    await assertFits(width, 'New Receipt with long description');
    await evaluate(`(() => { const i = [...document.querySelectorAll('.field label')].find((l) => l.textContent.trim() === 'Description').control;
      i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`); // leave no draft behind

    // Dialog buttons stay inside the dialog.
    await visit('#/products/' + ids.product);
    await evaluate(`ui.confirm('Replace all data on this device?', { okText: 'Replace all data', danger: true }); true`);
    await page.waitFor(`!!document.querySelector('dialog[open]')`, 'dialog');
    const d = await evaluate(`(() => { const d = document.querySelector('dialog[open]'); const r = d.getBoundingClientRect();
      return { right: r.right, overflow: d.scrollWidth - d.clientWidth, btns: [...d.querySelectorAll('button')].map((b) => b.getBoundingClientRect().right) }; })()`);
    await evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Cancel').click(); true`);
    assert.ok(d.right <= width && d.overflow <= 0, `dialog fits (${d.right}px, overflow ${d.overflow}px)`);
    for (const right of d.btns) assert.ok(right <= d.right + 0.5, `dialog button ends at ${right}px, past the dialog edge ${d.right}px`);
  });
}
