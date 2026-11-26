// Run with: node --test tests/
// The demo (Settings > Developer > Load demo data, js/demo.js): obviously fake test data, with receipts from
// the 1st of last month to now and quotes, so every Stats card has something to show. Records have the
// same shape the app saves (and pass backup validation).
const test = require('node:test');
const assert = require('node:assert/strict');
const demo = require('../js/demo.js');
const receipt = require('../js/receipt.js');
const quote = require('../js/quote.js');
const stats = require('../js/stats.js');
const summary = require('../js/summary.js');
const backup = require('../js/backup.js');

const NOW = new Date(2026, 10, 25, 15, 30);   // Wed 25 Nov 2026, 3:30 pm
const D = demo.build({ now: NOW });
const day = (d) => summary.dayOf(new Date(d));
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysAgo = (iso, now) => stats.daysAgo(new Date(iso), now);
const strip = (r) => JSON.parse(JSON.stringify(r));   // drops the Symbol stats.js caches dates under

test('every name is obviously test data, and no phone can reach a real person', () => {
  assert.equal(D.products.length, 12);
  assert.equal(D.customers.length, 15);
  assert.deepEqual(D.products.map((p) => p.name), 'ABCDEFGHIJKL'.split('').map((x) => 'Test Product ' + x));
  assert.deepEqual(D.customers.map((c) => c.name),
    [...'ABCDEFGHI'.split('').map((x) => 'Test Customer ' + x), 'Test Company Ltd', ...'JKLMN'.split('').map((x) => 'Test Customer ' + x)]);
  assert.deepEqual(D.settings.business,
    { name: 'Test Store', address: '1 Test Street, Belmopan, Belize', phone: '+501 000-0000', email: 'test.store@example.com', gstTin: '000000000' });
  for (const c of D.customers) {
    // Belize numbers never start with 0, so wa.me/501000xxxx is nobody's WhatsApp; but there is a button to show.
    if (c.phone) {
      assert.match(c.phone, /^\+501 000-00\d\d$/, c.name);
      assert.match(receipt.whatsappNumber(c.phone), /^5010000\d\d\d$/, c.name);
      assert.equal(stats.waLink(c.phone), 'https://wa.me/' + receipt.whatsappNumber(c.phone), c.name);
    }
    if (c.email) assert.match(c.email, /@([\w-]+\.)*example\.com$/, c.name);
  }
  assert.ok(D.customers.some((c) => c.tin && c.address), 'a business customer shows TIN and address on its receipts');
  for (const p of D.products) assert.ok(Number.isInteger(p.priceCents) && p.priceCents > 0, p.name + ' price is integer cents');
  assert.ok(D.products.some((p) => p.zeroRated) && D.products.some((p) => !p.zeroRated));

  // Receipts and quotes only use the saved test customers (or a walk-in) and the saved test products.
  const phoneOf = new Map(D.customers.map((c) => [c.name, c.phone]));
  const products = new Set(D.products.map((p) => p.name));
  for (const r of [...D.receipts, ...D.quotes]) {
    assert.ok(r.customer.name === '' ? r.customer.phone === '' : phoneOf.get(r.customer.name) === r.customer.phone, r.number);
    for (const l of r.lines) assert.ok(products.has(l.description), r.number + ': ' + l.description);
  }
  // None of the old, real-sounding sample data.
  const all = JSON.stringify(D);
  for (const old of ['brandon', 'Eldon', 'Kimley', 'Belmopan Hardware', '615-0551', '610-0551', '622-9887', '822-', 'Rice', 'Pizza', 'Demo Store']) {
    assert.ok(!all.includes(old), 'no "' + old + '"');
  }
});

test('receipts every day from the 1st of last month to now, numbered in date order like the app', () => {
  const r = D.receipts;
  assert.equal(day(r[0].date), '2026-10-01');
  assert.ok(new Date(r.at(-1).date) <= NOW);
  const perDay = new Map();
  for (const x of r) perDay.set(day(x.date), (perDay.get(day(x.date)) || 0) + 1);
  for (let d = new Date(2026, 9, 1); d < new Date(2026, 10, 25); d = addDays(d, 1)) {
    assert.ok(perDay.get(day(d)) >= 2, day(d) + ' has receipts');
  }
  assert.ok(perDay.get('2026-11-25') >= 1, 'today has receipts by 3:30 pm');
  assert.ok(r.length > 300 && r.length < 700, r.length + ' receipts');

  r.forEach((x, i) => {
    assert.equal(x.id, i + 1);
    assert.equal(x.number, 'INV-' + String(i + 1).padStart(4, '0'));
    if (i) assert.ok(r[i - 1].date <= x.date, x.number + ' in date order');
    assert.equal(x.type, 'receipt');
    assert.ok(['cash', 'card', 'transfer'].includes(x.paymentMethod));
    assert.equal(x.gstRateBp, 1250);
    assert.equal(x.business.name, 'Test Store');
    assert.match(x.footer, /test receipt/);
    assert.deepEqual(receipt.withTotals(x), x, x.number + ': stored values are what db.js would calculate');
  });
  D.quotes.forEach((q, i) => {
    assert.equal(q.id, i + 1);
    assert.equal(q.number, 'QT-' + String(i + 1).padStart(4, '0'));
    assert.equal(q.type, 'quote');
    assert.equal(q.validUntil, day(addDays(new Date(q.date), quote.VALID_DAYS)));
    assert.deepEqual(receipt.withTotals(q), q, q.number);
  });
  assert.deepEqual(D.counters, { receipt: r.length, quote: D.quotes.length });
  assert.equal(D.lastBackupAt, NOW.toISOString(), 'no backup reminder in the demo');

  // A realistic mix.
  const walkIns = r.filter((x) => !x.customer.name).length / r.length;
  assert.ok(walkIns > 0.3 && walkIns < 0.6, 'walk-ins ' + walkIns);
  const voided = r.filter((x) => x.voided);
  assert.ok(voided.length >= 1 && voided.length <= r.length * 0.03, voided.length + ' voided');
  for (const v of voided) assert.ok(v.voidReason && v.voidedAt >= v.date);
  assert.ok(voided.some((v) => day(v.date) === '2026-11-23'), 'a voided receipt two days ago');
  assert.deepEqual([...new Set(r.map((x) => x.paymentMethod))].sort(), ['card', 'cash', 'transfer']);
  assert.ok(r.some((x) => x.lines.some((l) => l.zeroRated)) && r.some((x) => x.lines.some((l) => !l.zeroRated)));
});

test('every Stats card has something to show at 3:30 pm on 25 Nov', () => {
  const tiles = stats.glance(D.receipts, NOW);
  for (const t of tiles) {
    assert.ok(t.current.count > 0 && t.previous.count > 0, t.label + ' and the period before it have sales');
    assert.ok(['up', 'down', 'flat'].includes(t.change.kind), t.label + ': ' + t.text);
  }
  const gst = stats.gstSummary(D.receipts, stats.defaultGstMonth(NOW));
  assert.equal(stats.defaultGstMonth(NOW), '2026-10');
  assert.ok(gst.count > 150 && gst.taxableCents > 0 && gst.zeroRatedCents > 0 && gst.gstCents > 0, 'October GST summary');

  const month = stats.getRange('month', NOW);
  assert.ok(stats.summarizeRange(D.receipts, month).count > 100);
  assert.ok(stats.summarizeRange(D.receipts, stats.previousRange(month)).count > 150);

  const top = stats.topProducts(D.receipts, month, { products: D.products });
  assert.deepEqual(top.items.map((i) => i.name).sort(), 'ABCDEFGHIJ'.split('').map((x) => 'Test Product ' + x));
  const byQty = stats.topProducts(D.receipts, month, { products: D.products, by: 'quantity' });
  assert.notDeepEqual(byQty.items.map((i) => i.name), top.items.map((i) => i.name), 'By quantity ranks differently from By sales');

  const slow = stats.slowMovers(D.receipts, D.products, NOW);
  assert.deepEqual(slow.map((s) => s.name), ['Test Product L', 'Test Product K']);
  assert.equal(slow[0].lastSale, null, 'L never sold');
  assert.ok(stats.daysAgo(slow[1].lastSale, NOW) >= 31, 'K last sold over 30 days ago');

  const cust = stats.topCustomers(D.receipts, month, { customers: D.customers, now: NOW });
  assert.equal(cust.items.length, 10);
  assert.ok(cust.items.every((c) => /^Test /.test(c.name) && c.waNumber), 'test names, each with a WhatsApp button');
  assert.equal(cust.repeat.repeat, 10, 'the 10 regulars come back');
  assert.ok(cust.repeat.oneTime >= 3, 'one-time customers this month');
  assert.ok(cust.walkIn.count > 0);

  const week = stats.weekdayAverages(D.receipts, month, NOW);
  assert.ok(week.every((w) => w.averageCents > 0));
  assert.deepEqual(week.slice().sort((a, b) => b.averageCents - a.averageCents).slice(0, 2).map((w) => w.day).sort(), ['Fri', 'Sat'],
    'Friday and Saturday are the busiest days');
  assert.ok(stats.salesSeries(D.receipts, month, NOW).points.every((p) => p.count > 0), 'a sale every day this month');

  const q = stats.quoteStats(D.quotes, month, NOW);
  assert.ok(q.sent >= 5 && q.converted >= 1 && q.openValueCents > 0, JSON.stringify(q));
  const follow = stats.followUps(D.quotes, { now: NOW, businessName: 'Test Store' });
  assert.ok(follow.length >= 3 && follow.every((f) => /^https:\/\/wa\.me\/5010000\d{3}\?text=/.test(f.waUrl)), 'follow-ups with WhatsApp');
  assert.ok(stats.expiredCount(D.quotes, NOW) >= 1);
});

// The 1st, 2nd and last day of every month of 2026 (Jan reaches back into 2025), morning and afternoon,
// plus the shortest histories (1 March: February is 28 or 29 days) and the edges of a day.
function moments() {
  const out = [];
  for (let m = 0; m < 12; m++) {
    for (const d of [1, 2, new Date(2026, m + 1, 0).getDate()]) {
      out.push(new Date(2026, m, d, 7, 40), new Date(2026, m, d, 16, 5));
    }
  }
  out.push(new Date(2027, 2, 1, 12, 0), new Date(2028, 2, 1, 12, 0), new Date(2026, 6, 15, 0, 1), new Date(2026, 6, 15, 6, 59),
    new Date(2026, 6, 15, 23, 59, 59));
  return out;
}

test('on any day of the year: history from the 1st of last month, slow movers, all quote statuses, links', () => {
  for (const now of moments()) {
    const at = ' (' + now.toString().slice(0, 21) + ')';
    const d = demo.build({ now });
    const start = demo.historyStart(now);
    const today = day(now);
    const r = d.receipts;
    assert.equal(day(r[0].date), day(start), 'starts on the 1st of last month' + at);
    assert.ok([...r, ...d.quotes].every((x) => new Date(x.date) <= now), 'nothing in the future' + at);
    const perDay = new Map();
    for (const x of r) perDay.set(day(x.date), (perDay.get(day(x.date)) || 0) + 1);
    for (let t = start; day(t) < today; t = addDays(t, 1)) assert.ok(perDay.get(day(t)) >= 2, day(t) + at);
    if (now.getHours() * 60 + now.getMinutes() >= 7 * 60 + 30) assert.ok(perDay.get(today) >= 1, 'a sale today' + at);
    r.forEach((x, i) => assert.equal(x.id, i + 1));

    // Slow movers: K (sold only 31+ days ago, when the history reaches that far) and L (never sold).
    const slow = stats.slowMovers(r, d.products, now);
    assert.deepEqual(slow.map((s) => s.name).sort(), ['Test Product K', 'Test Product L'], 'slow movers' + at);
    const kSales = r.filter((x) => x.lines.some((l) => l.description === 'Test Product K'));
    assert.ok(kSales.every((x) => daysAgo(x.date, now) >= 31), 'K only 31+ days ago' + at);
    assert.equal(kSales.length > 0, stats.daysAgo(start, now) >= 31, 'K sells when the history reaches 31 days back' + at);

    // Customers: the regulars come back; J-N buy exactly once each.
    const counted = r.filter(summary.counts);
    for (const c of d.customers) {
      const n = counted.filter((x) => x.customer.name === c.name).length;
      if (/^Test Customer [J-N]$/.test(c.name)) assert.equal(n, 1, c.name + ' buys once' + at);
      else assert.ok(n >= 2, c.name + ' buys again' + at);
    }
    assert.ok(r.some((x) => x.voided), 'a voided receipt' + at);

    // Quotes: all four statuses; converted ones link to a later receipt that links back.
    const statuses = new Set(d.quotes.map((q) => quote.status(q, now)));
    assert.deepEqual([...statuses].sort(), ['cancelled', 'converted', 'expired', 'open'], 'quote statuses' + at);
    assert.ok(stats.followUps(d.quotes, { now }).length >= 3, 'quotes to follow up' + at);
    for (const q of d.quotes.filter((x) => x.receiptId)) {
      const rec = r[q.receiptId - 1];
      assert.equal(rec.quoteId, q.id);
      assert.equal(rec.number, q.receiptNumber);
      assert.equal(q.convertedAt, rec.date);
      assert.ok(rec.date > q.date && !rec.voided, q.number + at);
      assert.deepEqual(rec.lines, q.lines, q.number + ' became a receipt for the same lines' + at);
    }
    for (const q of d.quotes.filter((x) => x.cancelledAt)) assert.ok(q.cancelledAt > q.date && new Date(q.cancelledAt) <= now);
    assert.deepEqual(d.counters, { receipt: r.length, quote: d.quotes.length });
  }
});

test('historyStart is the 1st of last month, across the new year', () => {
  assert.equal(day(demo.historyStart(new Date(2027, 0, 15))), '2026-12-01');
  assert.equal(day(demo.historyStart(new Date(2026, 2, 31, 23, 59))), '2026-02-01');
});

test('deterministic, and a backup of the demo passes import validation', () => {
  assert.deepEqual(strip(demo.build({ now: NOW })), strip(D));
  assert.notDeepEqual(strip(demo.build({ now: NOW, seed: 2 })).receipts, strip(D).receipts);
  const file = { app: 'ResiboBZ', schemaVersion: backup.SCHEMA_VERSION, exportedAt: NOW.toISOString(), ...strip(D) };
  const parsed = backup.parse(JSON.stringify(file));
  assert.equal(parsed.receipts.length, D.receipts.length);
  assert.equal(parsed.quotes.length, D.quotes.length);
  assert.deepEqual(parsed.counters, D.counters);
});
