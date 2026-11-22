// Browser test for the Stats tab (#/stats), Phase 6 Step 0: empty state, the remembered range
// picker, the layout at 375 and 1280px, tests/stats.test.html, and the dev-only seed tool with its
// separate test database. Fails on any console error or warning.
//
// Run with: node --test --test-concurrency=1 "tests/browser/*.e2e.js"
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./harness.js');

let page, evaluate;

// Collects console errors/warnings and uncaught errors on every page load, before any app script runs.
const CAPTURE = `(() => {
  window.__problems = [];
  const keep = (kind) => (...a) => window.__problems.push(kind + ': ' + a.map((x) => (x && x.message) || String(x)).join(' '));
  const err = console.error.bind(console), warn = console.warn.bind(console);
  console.error = (...a) => { keep('error')(...a); err(...a); };
  console.warn = (...a) => { keep('warn')(...a); warn(...a); };
  addEventListener('error', (e) => keep('uncaught')(e.message));
  addEventListener('unhandledrejection', (e) => keep('rejection')(e.reason));
})()`;
const problems = () => evaluate('window.__problems || []');

async function visitStats() {
  await evaluate(`location.hash = '#/new'; true`);
  await page.waitFor(`location.hash === '#/new' && !!document.querySelector('.field')`, 'New Receipt');
  await evaluate(`location.hash = '#/stats'; true`);
  await page.waitFor(`!!document.querySelector('.stats-view') && document.querySelector('.stats-view').childElementCount > 0`, 'Stats view');
}

/** Save receipts through the real db.js. days: [monthOffset, day] pairs relative to today. */
function addReceipts(list) {
  return evaluate(`(async () => {
    const s = await db.getSettings();
    const now = new Date();
    for (const [monthOffset, day] of ${JSON.stringify(list)}) {
      const when = new Date(now.getFullYear(), now.getMonth() + monthOffset, Math.min(day, now.getDate()), 9, 0);
      await db.saveNewDocument('receipt', receipt.buildReceipt({ customer: { name: 'Kim', phone: '' }, paymentMethod: 'cash',
        lines: [{ description: 'Pizza', qtyMilli: 1000, unitCents: 1000, zeroRated: false }] }, s, when));
    }
    return true;
  })()`);
}

test.before(async () => {
  page = await harness.open('#/new');
  ({ evaluate } = page);
  await page.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: CAPTURE });
  await page.reloadAt('#/new');
  await page.waitFor('typeof db === "object" && !!document.querySelector("#view > div")', 'app to restart');
});

test.after(async () => {
  if (page) await page.close();
});

test('Stats tab: empty database shows the empty state, not blank boxes', async () => {
  await visitStats();
  const r = await evaluate(`({
    empty: document.querySelector('.stats-empty') && document.querySelector('.stats-empty').innerText,
    cards: document.querySelectorAll('.stats-card').length,
    picker: !!document.querySelector('.stats-picker'),
    active: document.querySelector('.bottom-nav a.active').dataset.route,
    title: document.getElementById('view-title').textContent,
  })`);
  assert.match(r.empty, /Make 5 receipts to see your trends\./);
  assert.equal(r.cards, 0);
  assert.equal(r.picker, false);
  assert.equal(r.active, 'stats');
  assert.equal(r.title, 'Stats');
  assert.deepEqual(await problems(), []);
});

test('Stats tab: under 5 receipts says how many to go; at 5 the picker and overview appear', async () => {
  // Today twice, earlier this month once, last month twice (one counted, plus a voided one).
  await addReceipts([[0, 1], [0, 1], [-1, 10], [-1, 12]]);
  await visitStats();
  assert.match(await evaluate(`document.querySelector('.stats-empty').innerText`), /4 so far, 1 to go\./);
  // The GST summary doesn't wait for 5 receipts: filing needs it from the first one.
  assert.match(await evaluate(`document.querySelector('.gst-card').innerText`), /Receipts\s+2/);   // last month
  assert.equal(await evaluate(`!!document.querySelector('.stats-picker')`), false, 'no trend picker yet');

  // A voided receipt never counts toward the 5.
  await evaluate(`(async () => { const s = await db.getSettings();
    const r = await db.saveNewDocument('receipt', receipt.buildReceipt({ customer: { name: '' }, paymentMethod: 'cash',
      lines: [{ description: 'X', qtyMilli: 1000, unitCents: 500, zeroRated: false }] }, s, new Date()));
    await db.voidReceipt(r.id, 'test'); return true; })()`);
  await visitStats();
  assert.ok(await evaluate(`!!document.querySelector('.stats-empty')`), 'still empty with a voided 5th receipt');

  await addReceipts([[0, 1]]);
  await visitStats();
  const r = await evaluate(`({
    empty: !!document.querySelector('.stats-empty'),
    checked: document.querySelector('.stats-picker input:checked').value,
    labels: [...document.querySelectorAll('.stats-picker .chips label')].map((l) => l.textContent),
    card: document.querySelector('.overview-card').innerText,
  })`);
  assert.equal(r.empty, false);
  assert.equal(r.checked, 'month', 'This month by default');
  assert.deepEqual(r.labels, ['Today', 'This week', 'This month', 'Last month', '90 days', 'Custom']);
  assert.match(r.card, /Receipts\s+3/);           // this month: 3 counted (the void is left out)
  assert.match(r.card, /\$33\.75/);              // 3 x ($10.00 + 12.5% GST)
  assert.match(r.card, /Previous period\s+\$22\.50 · 2 receipts/);
  assert.deepEqual(await problems(), []);
});

test('Stats tab: the range choice survives a reload; Custom starts from the shown range', async () => {
  await evaluate(`document.querySelector('label[for="stats-range-lastMonth"]').click(); true`);
  await page.waitFor(`/Receipts\\s+2/.test(document.querySelector('.overview-card').innerText)`, 'last month figures');

  await page.reloadAt('#/stats');
  await page.waitFor(`!!document.querySelector('.overview-card')`, 'Stats after reload');
  assert.equal(await evaluate(`document.querySelector('.stats-picker input:checked').value`), 'lastMonth');
  assert.match(await evaluate(`document.querySelector('.overview-card').innerText`), /Receipts\s+2/);

  await evaluate(`document.querySelector('label[for="stats-range-custom"]').click(); true`);
  const c = await evaluate(`(() => {
    const [from, to] = [...document.querySelectorAll('.stats-picker input[type=date]')].map((i) => i.value);
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1), last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from, to, want: [filter.dayString(first), filter.dayString(last)],
      hidden: document.querySelector('.stats-picker .date-range').hidden,
      label: document.querySelector('.stats-range-label').textContent, card: document.querySelector('.overview-card').innerText };
  })()`);
  assert.equal(c.hidden, false);
  assert.deepEqual([c.from, c.to], c.want, 'Custom is prefilled with last month');
  assert.match(c.card, /Receipts\s+2/);
  assert.match(c.label, / · compared with /);

  // A backwards custom range shows a hint instead of numbers.
  await evaluate(`(() => { const [f, t] = document.querySelectorAll('.stats-picker input[type=date]');
    f.value = '2026-11-10'; t.value = '2026-11-01'; t.dispatchEvent(new Event('change')); return true; })()`);
  assert.equal(await evaluate(`document.querySelector('.stats-range-label').textContent`), '"To" is before "From".');
  // Range cards disappear; Slow movers (always the last 30 days) and Follow up (all open quotes) stay.
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.stats-grid .stats-card h2')].map((x) => x.textContent)`), ['Slow movers', 'Follow up']);
  await evaluate(`document.querySelector('label[for="stats-range-month"]').click(); true`);
  assert.deepEqual(await problems(), []);
});

test('Stats tab: one column at 375px; two columns, max 1000px wide at 1280px', async () => {
  for (const [width, cols] of [[375, 1], [1280, 2]]) {
    await page.setWidth(width);
    await visitStats();
    await page.sleep(100);
    const m = await evaluate(`(() => {
      // Columns = distinct left edges of the cards in the trends area.
      const grid = new Set([...document.querySelectorAll('.stats-grid > .card')].map((c) => Math.round(c.getBoundingClientRect().left))).size;
      const main = document.querySelector('.app-main').getBoundingClientRect().width;
      const chipsTop = new Set([...document.querySelectorAll('.stats-picker .chips label')].map((l) => Math.round(l.getBoundingClientRect().top))).size;
      return { grid, main, chipRows: chipsTop, inner: innerWidth, scroll: document.documentElement.scrollWidth };
    })()`);
    assert.equal(m.inner, width, 'viewport not widened');
    assert.ok(m.scroll <= width, `no sideways scroll at ${width}px`);
    assert.equal(m.grid, cols, `${cols} grid column(s) at ${width}px`);
    assert.equal(m.chipRows, width < 720 ? 2 : 1, 'range chips: 3 + 3 on phones, one row on desktop');
    if (width === 1280) assert.ok(m.main <= 1000, 'page capped at 1000px: ' + m.main);
  }
  await page.setWidth(harness.WIDTH);
});

test('Glance tiles: Today updates after a new receipt; colours follow the change; big numbers on a phone', async () => {
  const tiles = () => evaluate(`[...document.querySelectorAll('.glance-tile')].map((t) => ({
    period: t.dataset.period, total: t.querySelector('.glance-total').textContent, sub: t.querySelector('.glance-sub').textContent,
    change: t.querySelector('.glance-change').textContent, cls: t.querySelector('.glance-change').className,
    size: parseFloat(getComputedStyle(t.querySelector('.glance-total')).fontSize), left: t.getBoundingClientRect().left }))`);
  await visitStats();
  const before = await tiles();
  assert.deepEqual(before.map((t) => t.period), ['today', 'week', 'month']);

  // Save a $10.00 + 12.5% GST receipt now, reopen the tab: Today goes up by $11.25 and one receipt.
  await evaluate(`(async () => { const s = await db.getSettings();
    await db.saveNewDocument('receipt', receipt.buildReceipt({ customer: { name: '' }, paymentMethod: 'card',
      lines: [{ description: 'Coffee', qtyMilli: 1000, unitCents: 1000, zeroRated: false }] }, s, new Date())); return true; })()`);
  await visitStats();
  const after = await tiles();
  const cents = (s) => Number(s.replace(/[$,.]/g, ''));
  assert.equal(cents(after[0].total) - cents(before[0].total), 1125, 'Today total +$11.25');
  assert.equal(Number(after[0].sub.split(' ')[0]) - Number(before[0].sub.split(' ')[0]), 1, 'Today +1 receipt');
  for (const t of after) {
    const kind = /↑/.test(t.change) ? 'up' : /↓/.test(t.change) ? 'down' : /^Same/.test(t.change) ? 'flat' : /^New/.test(t.change) ? 'new' : 'none';
    assert.ok(t.cls.includes('is-' + kind), t.period + ': "' + t.change + '" has class is-' + kind);
    assert.ok(t.size >= 24, t.period + ' total is at least 24px on a phone');
  }
  assert.equal(new Set(after.map((t) => Math.round(t.left))).size, 1, 'stacked in one column at 360px');

  await page.setWidth(1280);
  await visitStats();
  assert.equal(new Set((await tiles()).map((t) => Math.round(t.left))).size, 3, 'three across at 1280px');
  await page.setWidth(harness.WIDTH);
  assert.deepEqual(await problems(), []);
});

test('tests/stats.test.html runs every case in the browser and all pass', async () => {
  await page.goto(page.base + 'tests/stats.test.html');
  await page.waitFor(`document.getElementById('summary').className !== ''`, 'test page to finish');
  const r = await evaluate(`({ text: document.getElementById('summary').textContent, cls: document.getElementById('summary').className,
    pass: document.querySelectorAll('li.pass').length, fail: [...document.querySelectorAll('li.fail')].map((l) => l.innerText) })`);
  assert.deepEqual(r.fail, []);
  assert.equal(r.cls, 'ok', r.text);
  assert.ok(r.pass >= 14, r.text);
  assert.deepEqual(await problems(), []);
});

test('seed tool fills only resibobz-test; the app shows a test bar and goes back to real data', async () => {
  await page.goto(page.base + 'tests/seed.html');
  await page.waitFor(`/Database: resibobz-test/.test(document.getElementById('status').textContent)`, 'seed page ready');
  assert.equal(await evaluate(`localStorage.getItem('resibobz.useTestDb')`), null, 'visiting the seed page does not switch the app');

  await evaluate(`document.querySelector('[data-seed="300"]').click(); true`);
  await page.waitFor(`/Seeded in/.test(document.getElementById('status').textContent)`, 'seeding', 20000);
  assert.match(await evaluate(`document.getElementById('status').textContent`), /300 receipts, 40 quotes/);

  const loaded = page.cdp.once('Page.loadEventFired');
  await evaluate(`document.getElementById('open').click(); true`);
  await loaded;
  await page.waitFor(`!!document.querySelector('.test-db-bar') && !!document.querySelector('.overview-card')`, 'app on test data');
  assert.equal(await evaluate('db.DB_NAME'), 'resibobz-test');
  assert.ok(await evaluate(`db.count('receipts')`) >= 300);

  const back = page.cdp.once('Page.loadEventFired');
  await evaluate(`document.querySelector('.test-db-bar button').click(); true`);
  await back;
  await page.waitFor('typeof db === "object" && !!document.querySelector("#view > div")', 'app on real data');
  assert.equal(await evaluate('db.DB_NAME'), 'resibobz');
  assert.equal(await evaluate(`!!document.querySelector('.test-db-bar')`), false);
  assert.equal(await evaluate(`db.count('receipts')`), 7, 'real data untouched (6 counted + 1 voided)');
  assert.deepEqual(await problems(), []);
});
