// Browser test for the Stats charts (Phase 6 Step 5): Chart.js from lib/ (never a CDN), the sales trend
// and busiest-days charts, no stacked charts after quick range changes, cleanup when leaving the tab,
// the weekly switch, fitting at 375px, and rendering offline from the service worker cache.
//
// Run with: node --test --test-concurrency=1 "tests/browser/*.e2e.js"
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./harness.js');

let page, evaluate;

const chartState = () => evaluate(`({
  instances: window.Chart ? Object.keys(Chart.instances).length : -1,
  canvases: document.querySelectorAll('.chart-box canvas').length,
  types: window.Chart ? Object.values(Chart.instances).map((c) => c.config.type).sort() : [],
  points: window.Chart ? (Object.values(Chart.instances).find((c) => c.config.type === 'line') || { data: { labels: [] } }).data.labels.length : 0,
})`);

async function visitStats() {
  await evaluate(`location.hash = '#/new'; true`);
  await page.waitFor(`location.hash === '#/new' && !!document.querySelector('.field')`, 'New Receipt');
  await evaluate(`location.hash = '#/stats'; true`);
  await page.waitFor(`window.Chart && Object.keys(Chart.instances).length === 2`, 'two charts', 10000);
}

test.before(async () => {
  page = await harness.open('#/new');
  ({ evaluate } = page);
  await evaluate(`new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'tests/seed-data.js';
    s.onload = res; s.onerror = rej; document.body.append(s); })`);
  await evaluate(`db.replaceAll(seedData.generate({ receipts: 300 })).then(() => true)`);
  await evaluate(`localStorage.setItem('resibobz.stats.range', JSON.stringify({ preset: 'last90' })); true`);
});

test.after(async () => {
  if (page) await page.close();
});

test('Chart.js loads from lib/ and draws the sales trend (one point per day) and busiest days', async () => {
  await visitStats();
  const s = await chartState();
  assert.deepEqual(s.types, ['bar', 'line']);
  assert.equal(s.canvases, 2);
  assert.equal(s.points, 90, 'last 90 days: one point per day');
  const scripts = await evaluate(`performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /chart/i.test(n))`);
  assert.ok(scripts.length && scripts.every((n) => n.startsWith(page.base + 'lib/')), 'Chart.js only from lib/: ' + scripts.join(' '));
  const bar = await evaluate(`Object.values(Chart.instances).find((c) => c.config.type === 'bar').data.labels`);
  assert.deepEqual(bar, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  // The numbers table matches the chart data.
  assert.equal(await evaluate(`document.querySelectorAll('.trend-card .chart-table tbody tr').length`), 90);
});

test('changing the range 10 times quickly never stacks or duplicates charts', async () => {
  await evaluate(`(() => {
    const ids = ['today', 'week', 'month', 'lastMonth', 'last90'];
    for (let i = 0; i < 10; i++) document.querySelector('label[for="stats-range-' + ids[i % ids.length] + '"]').click();
    return true; })()`);
  await page.waitFor(`window.Chart && Object.keys(Chart.instances).length === 2`, 'charts settle', 10000);
  await page.sleep(300);
  const s = await chartState();
  assert.equal(s.instances, 2, 'exactly two live Chart instances');
  assert.equal(s.canvases, 2, 'exactly two canvases');
  assert.equal(s.points, 90, 'the last click (90 days) won');
});

test('a custom range over 90 days switches to weekly points', async () => {
  await evaluate(`(() => {
    document.querySelector('label[for="stats-range-custom"]').click();
    const [f, t] = document.querySelectorAll('.stats-picker input[type=date]');
    const now = new Date(), from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 110);
    f.value = filter.dayString(from); t.value = filter.dayString(now); t.dispatchEvent(new Event('change'));
    return true; })()`);
  await page.waitFor(`/Weekly sales/.test(document.querySelector('.trend-card').innerText) && Object.keys(Chart.instances).length === 2`, 'weekly chart', 10000);
  const s = await chartState();
  assert.ok(s.points >= 16 && s.points <= 18, '111 days -> 16 to 18 weekly points, got ' + s.points);
  await evaluate(`document.querySelector('label[for="stats-range-last90"]').click(); true`);
});

test('leaving the Stats tab destroys its charts', async () => {
  await visitStats();
  await evaluate(`location.hash = '#/history'; true`);
  await page.waitFor(`location.hash === '#/history'`, 'History');
  assert.equal((await chartState()).instances, 0);
});

test('charts fit inside a 375px screen', async () => {
  await page.setWidth(375);
  await visitStats();
  await page.sleep(200);
  const m = await evaluate(`({ inner: innerWidth, scroll: document.documentElement.scrollWidth,
    boxes: [...document.querySelectorAll('.chart-box canvas')].map((c) => { const r = c.getBoundingClientRect(); return [r.left, r.right, r.height]; }) })`);
  assert.equal(m.inner, 375);
  assert.ok(m.scroll <= 375, 'no sideways scroll');
  for (const [left, right, height] of m.boxes) assert.ok(left >= 0 && right <= 375 && height > 100, `canvas ${left}-${right}px, ${height}px tall`);
  await page.setWidth(harness.WIDTH);
});

test('charts render offline from the service worker cache', async () => {
  await page.waitFor('!!navigator.serviceWorker.controller', 'service worker to take control', 15000);
  assert.ok(await evaluate(`caches.keys().then((ks) => Promise.all(ks.map((k) => caches.open(k).then((c) => c.match('lib/chart.umd.min.js'))))).then((r) => r.some(Boolean))`),
    'lib/chart.umd.min.js is precached');
  await page.cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  try {
    await page.goto(page.base + '?offline#/stats');
    await page.waitFor(`window.Chart && Object.keys(Chart.instances).length === 2`, 'charts offline', 10000);
    assert.equal((await chartState()).canvases, 2);
  } finally {
    await page.cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }
});
