// Phase 6 release checks (run after Step 6): Stats performance with 2,000 receipts on a throttled CPU,
// no console errors/warnings on any screen, layout at tablet/desktop widths, and no way to reach the
// seed tool / test database from the production app (nothing under tests/ is linked or precached).
//
// Run with: node --test --test-concurrency=1 "tests/browser/*.e2e.js"
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('./harness.js');

const ROOT = path.resolve(__dirname, '..', '..');
const CPU_SLOWDOWN = 4;   // Chrome DevTools' "mid-tier mobile" preset is a 4x CPU slowdown
let page, evaluate;

const CAPTURE = `(() => {
  window.__problems = [];
  const keep = (kind) => (...a) => window.__problems.push(kind + ': ' + a.map((x) => (x && x.message) || String(x)).join(' '));
  const err = console.error.bind(console), warn = console.warn.bind(console);
  console.error = (...a) => { keep('error')(...a); err(...a); };
  console.warn = (...a) => { keep('warn')(...a); warn(...a); };
  addEventListener('error', (e) => keep('uncaught')(e.message));
  addEventListener('unhandledrejection', (e) => keep('rejection')(e.reason));
})()`;

async function visit(hash) {
  await evaluate(`location.hash = ${JSON.stringify(hash)}; true`);
  await page.waitFor(`location.hash === ${JSON.stringify(hash)} && document.querySelector('#view > div') && document.querySelector('#view > div').childElementCount > 0`, hash);
  await page.sleep(150);
}

test.before(async () => {
  page = await harness.open('#/new');
  ({ evaluate } = page);
  await page.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: CAPTURE });
  await page.reloadAt('#/new');
  await page.waitFor('typeof db === "object" && !!document.querySelector("#view > div")', 'app to restart');
  await evaluate(`new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'tests/seed-data.js';
    s.onload = res; s.onerror = rej; document.body.append(s); })`);
  await evaluate(`db.replaceAll(seedData.generate({ receipts: 2000, quotes: 40, seed: 2000 })).then(() => true)`);
  await evaluate(`localStorage.setItem('resibobz.stats.range', JSON.stringify({ preset: 'last90' })); true`);
  // Start fresh, like opening the app: don't time Stats while the page is still clearing up the seeding.
  await page.reloadAt('#/new');
  await page.waitFor('typeof db === "object" && !!document.querySelector("#view > div")', 'app to restart');
});

test.after(async () => {
  if (page) await page.close();
});

test(`Stats renders 2,000 receipts in under 500 ms with a ${CPU_SLOWDOWN}x slower CPU`, async () => {
  await visit('#/stats');                                      // warm-up: Chart.js parsed once
  await page.waitFor(`window.statsTiming && window.statsTiming.chartsMs != null`, 'charts', 20000);
  await page.cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
  try {
    const runs = [];
    for (let i = 0; i < 5; i++) {
      await evaluate(`window.statsTiming = null; true`);
      await visit('#/new');
      await visit('#/stats');
      await page.waitFor(`window.statsTiming && window.statsTiming.chartsMs != null`, 'charts', 20000);
      runs.push(await evaluate('window.statsTiming'));
    }
    const sorted = runs.map((r) => r.ms).sort((a, b) => a - b);
    const median = sorted[2];
    console.log(`    Stats with ${runs[0].receipts} receipts, CPU ${CPU_SLOWDOWN}x slower: median ${median} ms; runs `
      + runs.map((r) => `${r.ms} ms (database ${r.dbMs}, charts drawn ${r.chartsMs})`).join(', '));
    assert.equal(runs[0].receipts, 2000);
    assert.ok(median < 500, `median render ${median} ms`);
  } finally {
    await page.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
});

test('no console errors or warnings on any screen (with 2,000 receipts)', async () => {
  const ids = await evaluate(`(async () => ({ r: (await db.getAll('receipts'))[5].id, q: (await db.getAll('quotes'))[0].id }))()`);
  for (const hash of ['#/new', '#/history', '#/receipt/' + ids.r, '#/summary', '#/quotes', '#/quote/' + ids.q, '#/quote/new',
    '#/stats', '#/products', '#/products/new', '#/customers', '#/settings']) {
    await visit(hash);
  }
  await page.waitFor(`window.Chart !== undefined`, 'Chart.js');
  assert.deepEqual(await evaluate('window.__problems'), []);
});

for (const width of [768, 1280]) {
  test(`main screens fit ${width}px; Stats uses two columns`, async () => {
    await page.setWidth(width);
    for (const hash of ['#/stats', '#/history', '#/quotes', '#/new', '#/settings']) {
      await visit(hash);
      const m = await evaluate(`({ inner: innerWidth, scroll: document.documentElement.scrollWidth })`);
      assert.ok(m.inner === width && m.scroll <= width, `${hash} at ${width}px: ${m.scroll}px wide`);
    }
    await visit('#/stats');
    const cols = await evaluate(`new Set([...document.querySelectorAll('.stats-grid > .card')].map((c) => Math.round(c.getBoundingClientRect().left))).size`);
    assert.equal(cols, 2);
    await page.setWidth(harness.WIDTH);
  });
}

test('the seed tool and test pages are not reachable from the app, and nothing under tests/ is precached', async () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const assets = JSON.parse('[' + /const ASSETS = \[([\s\S]*?)\];/.exec(sw)[1].replace(/'/g, '"').replace(/,\s*$/, '') + ']');
  assert.deepEqual(assets.filter((a) => a.startsWith('tests/')), [], 'no tests/ files in ASSETS');
  // No app file links to a test page (db.js only mentions seed.html in a comment).
  for (const file of ['index.html', ...assets.filter((a) => /\.(js|html)$/.test(a))]) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.ok(!/['"`][^'"`\n]*tests\//.test(src), file + ' links to tests/');
  }
  // In the running app: no link to tests/, the real database, no test bar.
  await visit('#/settings');
  assert.equal(await evaluate(`document.querySelectorAll('a[href*="tests/"]').length`), 0);
  assert.equal(await evaluate('db.DB_NAME'), 'resibobz');
  assert.equal(await evaluate(`!!document.querySelector('.test-db-bar')`), false);
  // Netlify answers 404 for /tests/*.
  assert.match(fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8'), /from = "\/tests\/\*"[\s\S]*?status = 404/);
  // The worker never caches anything under tests/.
  const cached = await evaluate(`caches.keys().then((ks) => Promise.all(ks.map((k) => caches.open(k).then((c) => c.keys())))).then((all) => all.flat().map((r) => r.url))`);
  assert.deepEqual(cached.filter((u) => u.includes('/tests/')), []);
});
