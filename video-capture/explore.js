// Dev helper: import the seed and save full-page low-res looks at the main routes into .explore/.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib.js');
const { start } = require('./server.js');

(async () => {
  const srv = await start(0);
  const browser = await L.launch();
  const ctx = await L.newContext(browser);
  const page = await ctx.newPage();
  const log = [];
  L.watchConsole(page, log);
  await L.importSeed(page, srv.url);
  const dir = path.join(L.OUT, '.explore');
  fs.mkdirSync(dir, { recursive: true });
  const routes = (process.argv[2] || '#/new,#/history,#/quotes,#/stats,#/products,#/customers,#/settings,#/summary,#/receipt/152,#/quote/5').split(',');
  for (const r of routes) {
    await L.go(page, r, 1500);
    const info = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, h2: [...document.querySelectorAll('h2')].map((x) => x.textContent.trim()) }));
    console.log(r, JSON.stringify(info));
    await page.screenshot({ path: path.join(dir, r.replace(/[#/]+/g, '_') + '.png'), fullPage: true, scale: 'css' });
  }
  console.log('console:', log);
  await browser.close();
  srv.close();
})();
