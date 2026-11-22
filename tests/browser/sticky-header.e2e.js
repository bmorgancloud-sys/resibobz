// Browser test: the yellow header stays at the top of the screen however far a long page scrolls.
//
// Run with: node --test "tests/browser/*.e2e.js"
//
// Regression: `html, body { height: 100% }` made the body exactly one screen tall, so the sticky
// header's containing block ended after the first screen and the header scrolled away on long pages
// (Settings, History, Stats). The body must grow with its content (min-height).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./harness.js');

let page, evaluate;

/** Scroll to `y` (or the bottom) and report where the header is and how tall the body is. */
const scrollAndMeasure = (y) => evaluate(`(async () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  window.scrollTo(0, ${y === 'bottom' ? 'max' : y});
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const h = document.querySelector('.app-header').getBoundingClientRect();
  return { scrollY: Math.round(scrollY), max: Math.round(max), top: Math.round(h.top), bottom: Math.round(h.bottom),
    bodyH: Math.round(document.body.getBoundingClientRect().height), docH: document.documentElement.scrollHeight };
})()`);

async function route(hash) {
  await evaluate(`location.hash = ${JSON.stringify(hash)}`);
  await page.waitFor('!!document.querySelector("#view > div") && document.querySelector("#view").textContent.length > 0', hash);
  await page.sleep(400);
}

test.before(async () => {
  page = await harness.open('#/new');
  ({ evaluate } = page);
  // Enough receipts for History and Stats to be several screens long.
  await evaluate(`(async () => {
    await db.setSettings({ business: { name: 'Sticky Test Shop', address: '', phone: '', email: '', gstTin: '000123456' } });
    for (let i = 0; i < 30; i++) {
      const r = receipt.buildReceipt({ customer: { name: 'Customer ' + i, phone: '' }, paymentMethod: 'cash',
        lines: [{ description: 'Item ' + i, qtyMilli: 1000, unitCents: 1000 + i * 100, zeroRated: false }] },
        await db.getSettings(), new Date(Date.now() - i * 3600e3));
      await db.saveNewDocument('receipt', r);
    }
    return true;
  })()`);
});

test.after(async () => {
  if (page) await page.close();
});

for (const hash of ['#/settings', '#/history', '#/stats']) {
  test(`header stays at the top when ${hash} is scrolled to the bottom`, async () => {
    await route(hash);
    const m = await scrollAndMeasure('bottom');
    assert.ok(m.max > 1000, `${hash} should be several screens long for this test (max scroll ${m.max})`);
    assert.ok(m.scrollY > 1000, `${hash} did not scroll (scrollY ${m.scrollY})`);
    assert.equal(m.top, 0, `header scrolled away on ${hash}: top ${m.top}px at scrollY ${m.scrollY}`);
    assert.ok(m.bodyH >= m.docH - 1, `body (${m.bodyH}px) must grow with the page (${m.docH}px)`);
  });
}

test('short pages still fill the screen (body at least one screen tall)', async () => {
  await evaluate(`location.hash = '#/customers'`);
  await page.sleep(400);
  const m = await scrollAndMeasure(0);
  const inner = await evaluate('innerHeight');
  assert.ok(m.bodyH >= inner, `body ${m.bodyH}px is shorter than the screen ${inner}px`);
});
