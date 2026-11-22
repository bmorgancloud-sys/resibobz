// Main capture run: stills, PDFs and recordings in story order, in ONE browser profile, so every shot
// shows the same data (hero receipt INV-0162 made on camera, QT-0005 converted to INV-0163 on camera).
// Run: node capture.js            (everything)
//      ONLY=01,02,R1 node capture.js   (only those outputs; state-changing steps still run)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const L = require('./lib.js');
const { start } = require('./server.js');

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const want = (id) => !ONLY || ONLY.includes(id);
const OUT = L.OUT;
const consoleLog = [];
const facts = {};

const at = (hh, mm) => new Date(`2026-11-18T${hh}:${mm}:00-06:00`);
const write = (name, data) => fs.writeFileSync(path.join(OUT, name), data);

async function main() {
  const srv = await start(0);
  const base = srv.url;
  const browser = await L.launch();
  const ctx = await L.newContext(browser);
  const page = await ctx.newPage();
  L.watchConsole(page, consoleLog);
  const setTime = (hh, mm) => ctx.clock.setFixedTime(at(hh, mm));
  // Headless Chrome never grants persistent storage by itself; an installed app normally has it.
  // Grant Chrome's real permission (no faking of the app's text), so Settings > Backup reads as on a phone.
  const grant = await ctx.newCDPSession(page);
  await grant.send('Browser.grantPermissions', { origin: base.replace(/\/$/, ''), permissions: ['durableStorage'] });

  // ---------- helpers bound to this page ----------
  const byLabel = (label, nth = 0) => page.getByLabel(label, { exact: true }).nth(nth);
  const option = (title) => page.locator('.typeahead-list:not([hidden]) .typeahead-option')
    .filter({ has: page.locator('.typeahead-title', { hasText: new RegExp('^' + title.replace(/[()]/g, '\\$&') + '$') }) }).first();
  const btn = (name) => page.getByRole('button', { name, exact: true });
  const top = () => page.evaluate(() => window.scrollTo(0, 0));
  /** Scroll so el's top is `offset` px from the viewport top (instant). */
  // The header is sticky only within the first screen (body is 100vh tall), so measure it after scrolling.
  const scrollTo = async (loc, offset = 16) => {
    for (let i = 0; i < 3; i++) {
      await loc.evaluate((el, off) => {
        const hb = Math.max(0, document.querySelector('.app-header').getBoundingClientRect().bottom);
        window.scrollBy(0, el.getBoundingClientRect().top - hb - off);
      }, offset);
      await L.sleep(120);
    }
    await L.sleep(200);
  };
  /** Tall still: viewport stretched to the page height, so fixed bars sit at the bottom (capture only). */
  const tall = async (name) => {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: L.PHONE.width, height: h });
    await L.sleep(400);
    await L.still(page, name);
    await page.setViewportSize({ width: L.PHONE.width, height: L.PHONE.height });
    await L.sleep(300);
  };
  const download = async (clickLoc, name) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), clickLoc.click()]);
    const file = path.join(OUT, name);
    await dl.saveAs(file);
    console.log('  file ' + name + ' (suggested ' + dl.suggestedFilename() + ')');
    return file;
  };
  const b64 = (file) => fs.readFileSync(file).toString('base64');
  const taps = (on) => page.evaluate((v) => document.documentElement.classList.toggle('cap-taps', v), on);
  const waitPdfReady = () => page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /^(Share PDF|Download PDF)$/.test(b.textContent) && !b.disabled), null, { timeout: 20000 });
  const reloadClean = async (hash) => { await page.goto(base + hash); await page.reload(); await L.waitApp(page); await L.sleep(600); };

  // Fill the hero receipt quickly or like a person.
  async function fillHero({ human }) {
    const type = async (loc, text) => {
      if (human) { await L.humanType(loc, text); await L.pause(350, 500); }
      else { await loc.tap(); await loc.pressSequentially(text, { delay: 10 }); await L.sleep(250); }
    };
    const tap = async (loc) => { await loc.tap(); if (human) await L.pause(300, 480); else await L.sleep(150); };
    await type(byLabel('Name'), 'Mar');
    await tap(option('Maria Gonzalez'));
    if (human) await L.smoothScrollTo(page, byLabel('Description', 0), 150); else await scrollTo(byLabel('Description', 0), 150);
    await type(byLabel('Description', 0), 'Gel m');
    await tap(option('Gel manicure'));
    await tap(btn('+ Add item'));
    await type(byLabel('Description', 1), 'Pedi');
    await tap(option('Pedicure'));
    await tap(btn('+ Add item'));
    await type(byLabel('Description', 2), 'Nail');
    await tap(option('Nail art'));
    const qty = byLabel('Qty', 2);
    await qty.tap();
    await qty.press('Control+a');
    if (human) { await L.sleep(200); await qty.pressSequentially('4', { delay: 80 }); await L.pause(); }
    else await qty.pressSequentially('4');
    if (human) await L.smoothScrollTo(page, page.locator('fieldset.segmented'), 330); else await scrollTo(page.locator('fieldset.segmented'), 330);
    await tap(page.locator('label[for="pay-card"]'));
  }

  // ---------- 0. Seed ----------
  console.log('Seeding');
  await L.importSeed(page, base);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });
  facts.seedReceipts = await page.evaluate(() => db.count('receipts'));

  // ---------- 01. New receipt stills (form filled, not saved) ----------
  console.log('01 new receipt');
  await setTime('10', '40');
  await reloadClean('#/new');
  await fillHero({ human: false });
  facts.formTotals = await page.locator('.sticky-totals').innerText();
  if (want('01')) {
    await L.still(page, '01-new-receipt.png');                 // items + payment + live totals
    await top();
    await L.still(page, '01a-new-receipt-customer.png');       // customer picked + first item
    await tall('01b-new-receipt-full.png');                    // whole form, totals bar at the bottom
  }

  // ---------- R1. Make the receipt on camera ----------
  console.log('R1 make receipt');
  await setTime('10', '41');
  await reloadClean('#/history');   // drops the unsaved draft above
  let rec = want('R1') ? await L.startRecording(page, 'R1-make-receipt') : null;
  await taps(true);
  await L.sleep(500);
  await page.locator('.bottom-nav a[data-route="new"]').tap();
  await byLabel('Name').waitFor();
  await L.pause(500, 700);
  await fillHero({ human: true });
  await L.sleep(700);
  await btn('Save receipt').tap();
  await page.waitForURL(/#\/receipt\/\d+$/);
  await waitPdfReady();
  await L.sleep(1100);
  await L.smoothScrollTo(page, page.locator('table.totals').first(), 260);
  await L.sleep(1300);
  await taps(false);
  if (rec) facts.R1 = await L.stopRecording(rec);
  const heroId = await page.evaluate(() => Number(location.hash.split('/')[2]));
  const hero = await page.evaluate((id) => db.get('receipts', id), heroId);
  facts.hero = { id: heroId, number: hero.number, customer: hero.customer.name, phone: hero.customer.phone, pay: hero.paymentMethod,
    subtotal: hero.subtotalCents, gst: hero.gstCents, total: hero.totalCents, date: hero.date };
  console.log('  hero', facts.hero);

  // ---------- 02. Receipt PDF (Letter + A4), from the app's own Download PDF button ----------
  console.log('02 receipt pdf');
  for (const size of ['letter', 'a4']) {
    await page.evaluate((s) => db.setSetting('pageSize', s), size);
    await reloadClean('#/receipt/' + heroId);
    await waitPdfReady();
    const f = await download(btn('Download PDF'), `02-receipt-${hero.number}-${size}.pdf`);
    if (want('02')) await L.pdfToPng(browser, base, b64(f), path.join(OUT, `02-receipt-pdf-${size}.png`));
  }
  await page.evaluate(() => db.setSetting('pageSize', 'letter'));
  if (want('02')) fs.copyFileSync(path.join(OUT, '02-receipt-pdf-letter.png'), path.join(OUT, '02-receipt-pdf.png'));

  // ---------- 03 + R2. Share ----------
  console.log('03 share');
  await reloadClean('#/receipt/' + heroId);
  await waitPdfReady();
  if (want('03')) {
    await scrollTo(page.locator('.summary-head').first(), 8);
    await L.still(page, '03-share-tap.png');
  }
  await top();
  await L.sleep(500);
  rec = want('R2') ? await L.startRecording(page, 'R2-share-start') : null;
  await taps(true);
  await L.sleep(900);
  await L.smoothScrollTo(page, page.locator('table.totals').first(), 300);
  await L.pause(600, 800);
  await btn('Share PDF').tap();
  await page.waitForFunction(() => window.__shares.length > 0);
  await taps(false);
  if (rec) facts.R2 = await L.stopRecording(rec, { tailMs: 250 });
  const shares = await page.evaluate(() => window.__shares);
  const shared = shares[0];
  const sharedPdf = Buffer.from(shared.files[0].base64, 'base64');
  write('03-shared-' + shared.files[0].name, sharedPdf);
  const dlPdf = fs.readFileSync(path.join(OUT, `02-receipt-${hero.number}-letter.pdf`));
  write('03-share-payload.json', JSON.stringify({
    note: 'navigator.share was stubbed for capture. This is exactly what the app passed to it when Share PDF was tapped.',
    title: shared.title, text: shared.text, url: shared.url || null,
    files: shared.files.map((f) => ({ name: f.name, type: f.type, size: f.size,
      sha256: crypto.createHash('sha256').update(Buffer.from(f.base64, 'base64')).digest('hex'),
      savedAs: '03-shared-' + f.name })),
    downloadedLetterPdfSha256: crypto.createHash('sha256').update(dlPdf).digest('hex'),
  }, null, 2));
  facts.share = { title: shared.title, text: shared.text, file: shared.files[0].name, size: shared.files[0].size };

  // ---------- 04. Products ----------
  console.log('04 products');
  if (want('04')) {
    await L.go(page, '#/products');
    await L.still(page, '04-products.png');
  }
  if (want('04b')) {
    await reloadClean('#/new');
    await byLabel('Name').tap();
    await byLabel('Name').pressSequentially('Shanice', { delay: 20 });
    await L.sleep(300);
    await option('Shanice Young').tap();
    await scrollTo(byLabel('Description', 0), 120);
    await byLabel('Description', 0).tap();
    await byLabel('Description', 0).pressSequentially('Ac', { delay: 40 });
    await L.sleep(500);
    await L.still(page, '04b-pick-product.png', { keepFocus: true });
  }

  // ---------- 05. Quote -> convert ----------
  console.log('05 quote convert');
  await setTime('10', '48');
  await reloadClean('#/quote/5');
  await waitPdfReady();
  if (want('05')) {
    await L.still(page, '05a-quote-top.png');
    await scrollTo(btn('Convert to receipt'), 520);
    await L.still(page, '05-quote.png');
  }
  await btn('Convert to receipt').tap();
  await page.waitForURL(/#\/new$/);
  await byLabel('Name').waitFor();
  await L.sleep(500);
  if (want('05b')) {
    await top();
    await L.still(page, '05b-convert.png');
  }
  await scrollTo(page.locator('fieldset.segmented'), 330);
  await page.locator('label[for="pay-cash"]').tap();
  await btn('Save receipt').tap();
  await page.waitForURL(/#\/receipt\/\d+$/);
  await waitPdfReady();
  const convId = await page.evaluate(() => Number(location.hash.split('/')[2]));
  const conv = await page.evaluate((id) => db.get('receipts', id), convId);
  facts.converted = { id: convId, number: conv.number, from: conv.quoteNumber, total: conv.totalCents, customer: conv.customer.name };
  if (want('05b')) {
    await top();
    await L.still(page, '05b2-converted-receipt.png');
  }
  if (want('05c')) {
    await L.go(page, '#/quotes');
    await scrollTo(page.locator('.list-summary'), 12);
    await L.still(page, '05c-quote-statuses.png');
    await top();
    await L.still(page, '05c2-quotes-top.png');
  }

  // ---------- 06. History search + filters ----------
  console.log('06 history');
  if (want('06') || want('06b')) {
    await reloadClean('#/history');
    const search = page.getByRole('searchbox', { name: 'Search receipts' });
    await search.tap();
    await search.pressSequentially('Maria', { delay: 40 });
    await L.sleep(600);
    facts.mariaSummary = await page.locator('.list-summary').innerText();
    if (want('06')) await L.still(page, '06-history-search.png');
    await search.fill('');
    await search.dispatchEvent('search');
    await page.locator('label[for="date-week"]').tap();
    await L.sleep(500);
    facts.weekSummary = await page.locator('.list-summary').innerText();
    if (want('06b')) await L.still(page, '06b-filters.png');
    await page.locator('label[for="date-custom"]').tap();
    const dates = page.locator('.date-range input[type=date]');
    await dates.nth(0).fill('2026-11-02');
    await dates.nth(0).dispatchEvent('change');
    await dates.nth(1).fill('2026-11-08');
    await dates.nth(1).dispatchEvent('change');
    await L.sleep(500);
    if (want('06b')) await L.still(page, '06c-custom-range.png');
  }

  // ---------- 07 + 08. Stats and GST ----------
  console.log('07 stats');
  await reloadClean('#/stats');
  await page.waitForFunction(() => window.statsTiming && document.querySelectorAll('canvas').length >= 2, null, { timeout: 20000 });
  await L.sleep(1500);
  const card = (title) => page.locator('section.card, .card').filter({ has: page.locator('h2', { hasText: new RegExp('^' + title + '$') }) }).first();
  if (want('07')) {
    await L.still(page, '07-stats.png');                               // at-a-glance tiles
    await scrollTo(card('Sales trend'), 12);
    await L.still(page, '07a-stats-trend.png');
    await scrollTo(card('Top products'), 12);
    await L.still(page, '07a2-top-products.png');
    await scrollTo(card('Busiest days'), 12);
    await L.still(page, '07a3-busiest-days.png');
  }
  if (want('07b')) { await scrollTo(card('Top customers'), 12); await L.still(page, '07b-top-customers.png'); }
  if (want('07c')) { await scrollTo(card('Quote conversion'), 12); await L.still(page, '07c-quote-conversion.png'); }
  console.log('08 gst');
  await scrollTo(card('Monthly GST summary'), 12);
  if (want('08')) await L.still(page, '08-gst-monthly.png');
  facts.gst = await card('Monthly GST summary').locator('table').innerText();
  const csv = await download(btn('Export CSV'), '08-gst-summary.csv');
  const gstPdf = await download(btn('Export PDF'), '08-gst-summary.pdf');
  if (want('08')) await L.pdfToPng(browser, base, b64(gstPdf), path.join(OUT, '08-gst-summary-pdf.png'));
  facts.gstCsv = fs.readFileSync(csv, 'utf8');

  // ---------- 09. Daily summary ----------
  console.log('09 daily summary');
  await reloadClean('#/history');
  await page.locator('a', { hasText: 'Daily summary' }).tap();
  await page.waitForURL(/#\/summary/);
  await waitPdfReady();
  await L.sleep(500);
  if (want('09')) {
    await L.still(page, '09-daily-summary.png');
    await scrollTo(page.locator('h2', { hasText: 'By payment method' }), 160);
    await L.still(page, '09a-daily-summary-payments.png');
  }
  facts.daily = await page.locator('.summary-body .card').first().innerText();
  const dayPdf = await download(btn('Download PDF'), '09-daily-summary.pdf');
  if (want('09')) await L.pdfToPng(browser, base, b64(dayPdf), path.join(OUT, '09-daily-summary-pdf.png'));

  // ---------- 10. Walk-in ----------
  console.log('10 walk-in');
  if (want('10')) {
    await reloadClean('#/new');
    await scrollTo(byLabel('Description', 0), 380);
    await byLabel('Description', 0).tap();
    await byLabel('Description', 0).pressSequentially('Polish change', { delay: 10 });
    await L.sleep(300);
    await top();
    await L.still(page, '10-walk-in.png');
    const walkId = await page.evaluate(async () => (await db.getAll('receipts')).find((r) => r.date.startsWith('2026-11-18T15:14')).id);
    await reloadClean('#/receipt/' + walkId);
    await waitPdfReady();
    await L.still(page, '10b-walk-in-receipt.png');
  }

  // ---------- 11. Zero-rated ----------
  console.log('11 zero-rated');
  if (want('11')) {
    await reloadClean('#/new');
    await scrollTo(byLabel('Description', 0), 150);
    await byLabel('Description', 0).tap();
    await byLabel('Description', 0).pressSequentially('Acrylic fu', { delay: 10 });
    await option('Acrylic full set').tap();
    await btn('+ Add item').tap();
    await byLabel('Description', 1).pressSequentially('Gift', { delay: 10 });
    await option('Gift voucher').tap();
    await L.sleep(300);
    await scrollTo(page.locator('.line-item').nth(1), 120);
    await L.still(page, '11-zero-rated.png');
  }

  // ---------- 12. Void ----------
  console.log('12 void');
  if (want('12')) {
    const voidId = await page.evaluate(async () => (await db.getAll('receipts')).filter((r) => r.voided).pop().id);
    await reloadClean('#/receipt/' + voidId);
    await waitPdfReady();
    await L.still(page, '12-void.png');
    const f = await download(btn('Download PDF'), '12-void-receipt.pdf');
    await L.pdfToPng(browser, base, b64(f), path.join(OUT, '12b-void-pdf.png'));
    await reloadClean('#/history');
    await page.locator('label[for="status-voided"]').tap();
    await L.sleep(400);
    await L.still(page, '12c-void-in-history.png');
  }

  // ---------- 13. Customers ----------
  if (want('13')) { console.log('13 customers'); await L.go(page, '#/customers'); await L.still(page, '13-customers.png'); }

  // ---------- 15. Backup, 18. GST setting ----------
  if (want('15')) {
    console.log('15 backup');
    await reloadClean('#/settings/backup');
    await L.sleep(800);
    await scrollTo(page.locator('h2', { hasText: /^Backup$/ }), 40);
    await L.still(page, '15-backup.png');
  }
  if (want('18')) {
    console.log('18 settings gst');
    await reloadClean('#/settings');
    await scrollTo(page.locator('h2', { hasText: /^GST$/ }), 200);
    await L.still(page, '18-settings-gst.png');
    await top();
    await L.still(page, '18b-settings-business.png');
  }

  // ---------- 14. Offline: reload with no network, make a receipt ----------
  console.log('14 offline');
  await setTime('10', '55');
  await reloadClean('#/new');
  let offlineHits = 0;
  const offlineUrls = [];
  const countHit = (req) => { offlineHits++; offlineUrls.push(req.url); };
  srv.server.on('request', countHit);
  await ctx.setOffline(true);
  // Belt and braces: DevTools' own offline switch too (Playwright's alone didn't hold after the screencast sessions).
  const net = await ctx.newCDPSession(page);
  await net.send('Network.enable');
  await net.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await page.reload();   // served by the service worker from its cache
  await L.waitApp(page);
  facts.offlineReloadOk = await page.evaluate(() => !!document.querySelector('#view form'));
  facts.offlineOnLineAfterReload = await page.evaluate(() => navigator.onLine);
  await byLabel('Name').tap();
  await byLabel('Name').pressSequentially('Shan', { delay: 20 });
  await option('Shanice Young').tap();
  await scrollTo(byLabel('Description', 0), 150);
  await byLabel('Description', 0).tap();
  await byLabel('Description', 0).pressSequentially('Acrylic fi', { delay: 10 });
  await option('Acrylic fill').tap();
  await btn('Save receipt').tap();
  await page.waitForURL(/#\/receipt\/\d+$/);
  await waitPdfReady();
  await L.sleep(400);
  const offId = await page.evaluate(() => Number(location.hash.split('/')[2]));
  facts.offline = await page.evaluate((id) => db.get('receipts', id).then((r) => ({ number: r.number, total: r.totalCents, customer: r.customer.name })), offId);
  facts.offline.serverRequestsWhileOffline = offlineHits; // 0 = reload and save used no network at all
  facts.offline.requestUrlsWhileOffline = offlineUrls;
  srv.server.off('request', countHit);
  if (want('14')) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await L.still(page, '14-offline.png');
  }
  await net.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await ctx.setOffline(false);

  // Hand the final data to the desktop shot (same data everywhere).
  const finalBackup = await page.evaluate(async () => JSON.stringify(await backup.collect(new Date())));
  write('.final-state.json', finalBackup);

  // ---------- 16. Update prompt (real service worker update) ----------
  console.log('16 update prompt');
  if (want('16')) {
    await reloadClean('#/history');
    srv.setSwVersion('toucanbill-v33-capture');
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
    await page.waitForFunction(() => { const b = document.querySelector('.update-bar'); return !!b && !b.hidden; }, null, { timeout: 30000 });
    await L.sleep(500);
    await L.still(page, '16-update-prompt.png');
    srv.setSwVersion(null);
  }

  // ---------- 17. Desktop ----------
  if (want('17')) {
    console.log('17 desktop');
    const dbrowser = await L.launch({ phone: false });
    const dctx = await L.newContext(dbrowser, { desktop: true });
    await dctx.clock.setFixedTime(at('10', '58'));
    const dp = await dctx.newPage();
    L.watchConsole(dp, consoleLog);
    await dp.goto(base + '#/stats');
    await L.waitApp(dp);
    await dp.evaluate(async (t) => { await backup.restore(backup.parse(t)); }, finalBackup);
    await dp.reload();
    await L.waitApp(dp);
    await dp.waitForFunction(() => document.querySelectorAll('canvas').length >= 2, null, { timeout: 20000 });
    await L.sleep(1800);
    await L.still(dp, '17-desktop.png');
    await dp.evaluate(() => { const h = [...document.querySelectorAll('h2')].find((x) => x.textContent.trim() === 'Trends'); window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 20); });
    await L.sleep(800);
    await L.still(dp, '17c-desktop-trends.png');
    await dp.evaluate((id) => { location.hash = '#/receipt/' + id; }, heroId);
    await dp.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Share PDF' && !b.disabled));
    await L.sleep(600);
    await L.still(dp, '17b-desktop-receipt.png');
    await dctx.close();
    await dbrowser.close();
  }

  write('capture-facts.json', JSON.stringify({ ...facts, console: consoleLog }, null, 2));
  console.log('console messages:', consoleLog.length ? consoleLog : 'none');
  await browser.close();
  srv.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
