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
// prefix and huge amounts. Covers the Quotes list, quote editor and quote detail too, and checks
// that all seven bottom-nav labels show in full. Covers the Stats tab (with the Custom range open).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./harness.js');

const WIDTHS = [320, 360, 375, 390, 430];
const LONG = 'Supercalifragilisticexpialidocious';

let page, evaluate, ids;

/** Screen width check plus the elements that stick out past it. */
function measure(width) {
  return evaluate(`(() => {
    const W = ${width};
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('dialog') || el.offsetParent === null) continue;
      // Clipped inside a scrolling/clipping box that itself fits: not page overflow.
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

/** Every chip row (ui.chipGroup) on screen: inside the screen, not scrollable, every label whole and 48px+ tall. */
async function assertChipRows(width, what, expectedRows) {
  const rows = await evaluate(`[...document.querySelectorAll('.chips')].map((row) => {
    const r = row.getBoundingClientRect();
    return { left: r.left, right: r.right, overflowX: getComputedStyle(row).overflowX, scrolls: row.scrollWidth > row.clientWidth,
      labels: [...row.querySelectorAll('label')].map((l) => { const b = l.getBoundingClientRect();
        return { text: l.textContent, cut: l.scrollWidth > l.clientWidth, left: b.left, right: b.right, height: b.height }; }) };
  })`);
  assert.equal(rows.length, expectedRows, what + ': chip rows');
  for (const r of rows) {
    assert.ok(r.left >= 0 && r.right <= width + 0.5, `${what} at ${width}px: chip row spans ${r.left}-${r.right}px`);
    assert.ok(!['auto', 'scroll'].includes(r.overflowX) && !r.scrolls, `${what} at ${width}px: chip row scrolls sideways`);
    for (const l of r.labels) {
      assert.ok(!l.cut, `${what} at ${width}px: chip "${l.text}" is cut off`);
      assert.ok(l.left >= 0 && l.right <= width + 0.5 && l.height >= 48, `${what} at ${width}px: chip "${l.text}" fits and is 48px+ tall`);
    }
  }
  return rows;
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
    await db.setSettings({ quotePrefix: 'QUOTATION-BELMOPAN-BRANCH-' });
    const q = await db.saveNewDocument('quote', quote.buildQuote({
      customer: { name: 'Hardware${LONG}${LONG}Limited', phone: '622-9887', tin: '000123456789000123456789', address: '${LONG}' },
      lines: [{ description: '${LONG}${LONG}', qtyMilli: 123456, unitCents: 9876543210, zeroRated: false }],
      validUntil: '2020-01-01', notes: '${LONG}${LONG} deposit',
    }, s, new Date()));
    await db.saveNewDocument('quote', quote.buildQuote({ customer: { name: 'Kim' }, validUntil: quote.defaultValidUntil(), notes: '',
      lines: [{ description: 'Pizza', qtyMilli: 1000, unitCents: 500, zeroRated: false }] }, s, new Date()));
    await db.saveNewDocument('receipt', receipt.buildReceipt({ customer: { name: 'Kim', phone: '' }, paymentMethod: 'cash',
      lines: [{ description: 'Pizza', qtyMilli: 1000, unitCents: 500, zeroRated: false }] }, s, new Date()));
    for (let i = 0; i < 5; i++) {  // enough receipts for the Stats tab to show its sections
      await db.saveNewDocument('receipt', receipt.buildReceipt({ customer: { name: '${LONG}${LONG}', phone: '' }, paymentMethod: 'card',
        lines: [{ description: '${LONG}', qtyMilli: 99000, unitCents: 9876543210, zeroRated: false }] }, s, new Date()));
    }
    return { receipt: r.id, product: pid, customer: cid, quote: q.id };
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
      ['#/quotes', 'Quotes list'],
      ['#/quote/' + ids.quote, 'Quote detail (expired)'],
      ['#/quote/' + ids.quote + '/edit', 'Quote editor (edit)'],
      ['#/quote/new', 'Quote editor (new)'],
      ['#/summary/' + require('../../js/summary.js').dayOf(new Date()), 'Daily summary (demo data)'],
      ['#/summary/2020-01-01', 'Daily summary (empty)'],
      ['#/stats', 'Stats (custom range)'],
    ];
    // Stats with the Custom range open, so the From/To row is measured too.
    await evaluate(`localStorage.setItem('resibobz.stats.range', JSON.stringify({ preset: 'custom', custom: { from: '2020-01-01', to: '2030-12-31' } })); true`);
    for (const [hash, what] of routes) {
      await visit(hash);
      await assertFits(width, what);
      // The highlighted tab's label shows in full too (every tab is the active one on some route here).
      const active = await evaluate(`(() => { const s = document.querySelector('.bottom-nav a.active span');
        return { label: s.textContent, cut: s.scrollWidth > s.clientWidth + 0.5 }; })()`);
      assert.ok(!active.cut, `${what} at ${width}px: the active nav label "${active.label}" is cut off`);
    }

    // Bottom nav: seven tabs, each label shown in full (not cut off with an ellipsis), 48px+ tall.
    const nav = await evaluate(`[...document.querySelectorAll('.bottom-nav a')].map((a) => {
      const s = a.querySelector('span'); const r = a.getBoundingClientRect();
      return { label: s.textContent, cut: s.scrollWidth > s.clientWidth + 0.5, right: r.right, height: r.height };
    })`);
    assert.deepEqual(nav.map((n) => n.label), ['New', 'History', 'Quotes', 'Stats', 'Products', 'Customers', 'Settings']);
    for (const n of nav) {
      assert.ok(!n.cut, `nav label "${n.label}" is cut off at ${width}px`);
      assert.ok(n.right <= width + 0.5 && n.height >= 48, `nav "${n.label}" fits and is 48px+ tall`);
    }
    // Being the active tab never makes a label wider (bold did: "Custom…" at 360px), whatever the phone's font.
    const grow = await evaluate(`[...document.querySelectorAll('.bottom-nav a')].map((a) => {
      const s = a.querySelector('span'), was = a.classList.contains('active');
      a.classList.remove('active'); const off = s.scrollWidth;
      a.classList.add('active'); const on = s.scrollWidth;
      a.classList.toggle('active', was);
      return { label: s.textContent, off, on };
    }).filter((x) => x.on !== x.off)`);
    assert.deepEqual(grow, [], `active nav labels are as wide as inactive ones at ${width}px`);

    // Quotes: the status chip row and the date chip row stay inside the screen.
    await visit('#/quotes');
    const qrows = await assertChipRows(width, 'Quotes', 2);
    // Date chips: one row of 5. Statuses: 5 across from 440px, else 3 + 2 (both rows filling the width).
    assert.equal(new Set(await evaluate(`[...document.querySelectorAll('.chips')[0].querySelectorAll('label')].map((l) => Math.round(l.getBoundingClientRect().top))`)).size, 1, 'date chips in one row');
    const statusTops = await evaluate(`[...document.querySelectorAll('.chips')[1].querySelectorAll('label')].map((l) => Math.round(l.getBoundingClientRect().top))`);
    assert.equal(new Set(statusTops).size, width >= 440 ? 1 : 2, 'status chips: rows');
    assert.ok(qrows[1].labels.at(-1).right >= qrows[1].right - 1, 'second status row fills the width');
    await evaluate(`document.getElementById('date-custom').click(); true`);
    await assertFits(width, 'Quotes with custom range');
    await evaluate(`document.getElementById('date-all').click(); true`);

    // History: five date chips in one row, no sideways scrolling.
    await visit('#/history');
    await evaluate(`document.getElementById('date-custom').click(); true`);
    await assertFits(width, 'History custom range');
    const [hrow] = await assertChipRows(width, 'History', 1);
    assert.deepEqual(hrow.labels.map((l) => l.text), ['Today', 'Week', 'Month', 'All', 'Custom']);
    const widths = hrow.labels.map((l) => Math.round(l.right - l.left));
    assert.ok(Math.max(...widths) - Math.min(...widths) <= 1, `date chips are equal width: ${widths}`);
    assert.ok(await evaluate(`!document.querySelector('.date-range').hidden`), 'Custom shows the From/To inputs');

    // Every status button visible.
    const buttons = await evaluate(`[...document.querySelectorAll('.segmented:not(.chips) label')].map((l) => l.getBoundingClientRect().right)`);
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
