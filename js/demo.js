/*
 * demo.js: demo data for trying the app (Settings > Developer > Load demo data).
 * Exposes global `demo`. build() is pure and deterministic; db.startDemo() writes it.
 * Unit-tested in tests/demo.test.js; the whole flow in tests/browser/demo.e2e.js.
 *
 * The demo is a separate test shop in its own database ('resibobz-demo', see db.js). Loading it never
 * touches the real data: receipts can never be deleted, so fake ones must never land among real ones.
 * While it is open, a bar at the top says so and has "Back to my data".
 *
 * Every name is plainly made up ("Test Product A", "Test Customer B", "Test Store") and every phone is
 * +501 000-00xx. Belize numbers never start with 0, so the WhatsApp buttons (shown, so the demo has them)
 * open an invalid number and can never reach a real person. Written with +501 because a bare "000-0001"
 * reads as an international 00 prefix and gets no WhatsApp button at all (receipt.whatsappNumber).
 * (A testing client saw the old, real-sounding sample names and thought another user's data had loaded.)
 *
 * build({ now, seed }) returns the shape db.replaceAll() takes:
 *   - 12 products: Test Product A-J sell all the time; K last sold over 30 days ago and L never sold
 *     (the Stats slow movers; K only sells when the history reaches back 31+ days)
 *   - 15 customers: Test Customer A-I and Test Company Ltd (TIN + address) buy again and again;
 *     Test Customer J-N buy once each (Stats: one-time customers)
 *   - receipts every day from the 1st of last month up to `now`, so last month is complete (the monthly
 *     GST summary and "This month" compare with it): shop hours 7:00-19:59, busiest on Friday and
 *     Saturday, a little busier this month, about 45% walk-ins, cash/card/transfer, a few voided
 *   - a quote about every 3 days: converted (each with its receipt), cancelled, expired, and the newest open
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const receipt = isNode ? require('./receipt.js') : root.receipt;
  const quote = isNode ? require('./quote.js') : root.quote;
  const filter = isNode ? require('./filter.js') : root.filter;

  const BUSINESS = {
    name: 'Test Store',
    address: '1 Test Street, Belmopan, Belize',
    phone: '+501 000-0000',
    email: 'test.store@example.com',
    gstTin: '000000000',
  };
  const GST_RATE_BP = 1250; // 12.5%
  const FOOTER = 'Demo data: a test receipt, not a real sale.';
  const QUOTE_NOTES = 'Test quote (demo data). 50% deposit to start.';
  const VOID_REASON = 'Test void: wrong price entered';

  // priceCents are GST-exclusive. weight: how often it sells; qty: [min, max] on one receipt line.
  const PRODUCTS = [
    { name: 'Test Product A', unit: 'each', priceCents: 350, zeroRated: false, weight: 10, qty: [1, 6] },
    { name: 'Test Product B', unit: 'bag', priceCents: 1200, zeroRated: true, weight: 8, qty: [1, 3] },
    { name: 'Test Product C', unit: 'dozen', priceCents: 600, zeroRated: true, weight: 7, qty: [1, 4] },
    { name: 'Test Product D', unit: 'each', priceCents: 2500, zeroRated: false, weight: 5, qty: [1, 2] },
    { name: 'Test Product E', unit: 'bottle', priceCents: 250, zeroRated: false, weight: 9, qty: [1, 8] },
    { name: 'Test Product F', unit: 'each', priceCents: 4500, zeroRated: false, weight: 3, qty: [1, 1] },
    { name: 'Test Product G', unit: 'box', priceCents: 875, zeroRated: true, weight: 5, qty: [1, 3] },
    { name: 'Test Product H', unit: 'hour', priceCents: 1500, zeroRated: false, weight: 3, qty: [1, 3] },
    { name: 'Test Product I', unit: 'pack', priceCents: 125, zeroRated: false, weight: 6, qty: [2, 10] },
    { name: 'Test Product J', unit: 'trip', priceCents: 6000, zeroRated: false, weight: 2, qty: [1, 1] },
    // Slow movers (weight 0): K sells only on the first days of the history, 31+ days ago; L never sells.
    { name: 'Test Product K', unit: 'each', priceCents: 3500, zeroRated: false, weight: 0, qty: [1, 1] },
    { name: 'Test Product L', unit: 'each', priceCents: 8900, zeroRated: false, weight: 0, qty: [1, 1] },
  ];
  const SLOW_SELLER = PRODUCTS[10];

  // weight: share of the named receipts. Weight 0: buys exactly once, on the day in ONE_TIME_DAYS_AGO.
  const CUSTOMERS = [
    { name: 'Test Customer A', phone: '+501 000-0001', email: '', address: '', tin: '', weight: 10 },
    { name: 'Test Customer B', phone: '+501 000-0002', email: 'test.customer.b@example.com', address: '', tin: '', weight: 8 },
    { name: 'Test Customer C', phone: '+501 000-0003', email: '', address: '', tin: '', weight: 7 },
    { name: 'Test Customer D', phone: '+501 000-0004', email: '', address: '', tin: '', weight: 6 },
    { name: 'Test Customer E', phone: '+501 000-0005', email: 'test.customer.e@example.com', address: '', tin: '', weight: 5 },
    { name: 'Test Customer F', phone: '+501 000-0006', email: '', address: '', tin: '', weight: 4 },
    { name: 'Test Customer G', phone: '+501 000-0007', email: '', address: '', tin: '', weight: 3 },
    { name: 'Test Customer H', phone: '+501 000-0008', email: '', address: '', tin: '', weight: 3 },
    { name: 'Test Customer I', phone: '+501 000-0009', email: '', address: '', tin: '', weight: 2 },
    { name: 'Test Company Ltd', phone: '+501 000-0010', email: 'accounts@test-company.example.com',
      address: '2 Test Street, Belmopan', tin: '000000010', weight: 5 },
    { name: 'Test Customer J', phone: '+501 000-0011', email: '', address: '', tin: '', weight: 0 },
    { name: 'Test Customer K', phone: '', email: '', address: '', tin: '', weight: 0 },
    { name: 'Test Customer L', phone: '+501 000-0013', email: '', address: '', tin: '', weight: 0 },
    { name: 'Test Customer M', phone: '', email: '', address: '', tin: '', weight: 0 },
    { name: 'Test Customer N', phone: '+501 000-0015', email: 'test.customer.n@example.com', address: '', tin: '', weight: 0 },
  ];
  const ONE_TIME_DAYS_AGO = [1, 4, 8, 15, 26];   // always inside the history (it is at least 29 days long)

  const WEEKDAY_SALES = [5, 6, 6, 7, 11, 13, 3];   // receipts on a usual Monday ... Sunday (give or take 1)
  // What happens to quotes older than their 14 valid days, in turn; 'expired' = never answered.
  const OLD_QUOTE_OUTCOMES = ['converted', 'cancelled', 'expired', 'converted', 'converted', 'expired', 'converted', 'converted'];
  const OPEN_QUOTES = 3;   // the newest quotes stay open, so Stats has some to follow up

  const DAY_MS = 24 * 60 * 60 * 1000;
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n, h = 0, m = 0, s = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, h, m, s);
  const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);

  /** The first day of the demo history: the 1st of last month. */
  function historyStart(now = new Date()) {
    return new Date(now.getFullYear(), now.getMonth() - 1, 1);
  }

  /** mulberry32: small seeded PRNG, returns floats in [0, 1). */
  function prng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** The demo data at `now`: { settings, counters, lastBackupAt, products, customers, receipts, quotes }. */
  function build({ now = new Date(), seed = 1 } = {}) {
    const rnd = prng(seed);
    const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
    const pickWeighted = (list) => {
      let x = rnd() * list.reduce((sum, item) => sum + item.weight, 0);
      for (const item of list) { x -= item.weight; if (x < 0) return item; }
      return list[list.length - 1];
    };

    const start = historyStart(now);
    const days = daysBetween(start, now) + 1;   // calendar days, today included
    const settings = { business: { ...BUSINESS }, gstRateBp: GST_RATE_BP, receiptFooter: FOOTER };
    const added = start.toISOString();
    const products = PRODUCTS.map((p, i) => ({ id: i + 1, name: p.name, unit: p.unit, priceCents: p.priceCents,
      zeroRated: p.zeroRated, createdAt: added, updatedAt: added }));
    const customers = CUSTOMERS.map((c, i) => ({ id: i + 1, name: c.name, phone: c.phone, email: c.email,
      address: c.address, tin: c.tin, createdAt: added, updatedAt: added }));

    const selling = PRODUCTS.filter((p) => p.weight > 0);
    const regulars = CUSTOMERS.filter((c) => c.weight > 0);
    const oneTimeOn = new Map(CUSTOMERS.filter((c) => c.weight === 0).map((c, i) => [days - 1 - ONE_TIME_DAYS_AGO[i], c]));

    const line = (p, qty) => ({ description: p.name, qtyMilli: qty * 1000, unitCents: p.priceCents, zeroRated: p.zeroRated });
    /** `count` different products, the popular ones more often; quantities times `bulk`. */
    function pickLines(count, bulk = 1) {
      const chosen = [];
      while (chosen.length < count) {
        const p = pickWeighted(selling);
        if (!chosen.includes(p)) chosen.push(p);
      }
      return chosen.map((p) => line(p, int(p.qty[0], p.qty[1]) * bulk));
    }
    const lineCount = () => { const x = rnd(); return x < 0.35 ? 1 : x < 0.7 ? 2 : x < 0.9 ? 3 : 4; };
    const payment = () => { const x = rnd(); return x < 0.55 ? 'cash' : x < 0.85 ? 'card' : 'transfer'; };
    const customerOf = (c) => (c ? { name: c.name, phone: c.phone, tin: c.tin, address: c.address } : { name: '', phone: '' });
    const sell = (customer, lines, when, paymentMethod = payment()) =>
      receipt.buildReceipt({ customer, paymentMethod, lines }, settings, when);

    // ---- Everyday sales ----
    const sales = [];
    for (let i = 0; i < days; i++) {
      const day = addDays(start, i);
      const thisMonth = day.getMonth() === now.getMonth();
      const n = WEEKDAY_SALES[(day.getDay() + 6) % 7] + int(-1, 1) + (thisMonth ? 1 : 0);   // 2 or more
      const times = Array.from({ length: n }, () => addDays(start, i, int(7, 19), int(0, 59), int(0, 59))).sort((a, b) => a - b);
      const daySales = [];   // { r: receipt, keep: never voided }
      for (const t of times) {
        if (t > now) break;
        const first = !daySales.length;
        const lines = pickLines(lineCount());
        if (first && i < 4 && days - 1 - i >= 31) lines.push(line(SLOW_SELLER, 1));   // Test Product K: 31+ days ago only
        // Each day's first sale goes to the regulars in turn, so every one of them buys 2+ times (29+ days).
        const c = first ? regulars[i % regulars.length] : rnd() < 0.45 ? null : pickWeighted(regulars);
        daySales.push({ r: sell(customerOf(c), lines, t), keep: first });
      }
      // Today: once the shop has been open half an hour, there is at least one sale, so "Today" is never empty.
      const open = addDays(start, i, 7);
      if (!daySales.length && i === days - 1 && now - open >= 30 * 60 * 1000) {
        const t = new Date(open.getTime() + Math.floor(rnd() * (Math.min(now, addDays(start, i, 20)) - open)));
        daySales.push({ r: sell(customerOf(pickWeighted(regulars)), pickLines(lineCount()), t), keep: false });
      }
      const once = oneTimeOn.get(i);   // always a past day
      if (once) {
        daySales.push({ r: sell(customerOf(once), pickLines(lineCount()), addDays(start, i, int(9, 18), int(0, 59), int(0, 59))), keep: true });
      }
      // A few voided receipts, always including the second one two days ago (every past day has 2+).
      daySales.forEach(({ r, keep }, k) => {
        if (keep || !(rnd() < 0.012 || (i === days - 3 && k === 1))) return;
        const voidedAt = new Date(Math.min(now.getTime(), new Date(r.date).getTime() + 15 * 60 * 1000));
        Object.assign(r, { voided: true, voidedAt: voidedAt.toISOString(), voidReason: VOID_REASON });
      });
      for (const { r } of daySales) sales.push(r);
    }

    // ---- Quotes, about every 3 days ----
    const quotes = [];
    for (let i = int(0, 2); i < days; i += int(2, 4)) {
      const date = addDays(start, i, int(8, 17), int(0, 59), int(0, 59));
      if (date > now) break;
      const validUntil = filter.dayString(addDays(date, quote.VALID_DAYS));
      quotes.push(quote.buildQuote({ customer: customerOf(pickWeighted(regulars)), lines: pickLines(int(2, 4), int(2, 4)),
        validUntil, notes: QUOTE_NOTES }, settings, date));
    }
    const converted = new Map();   // quote -> the receipt it became
    let old = 0;
    quotes.forEach((q, k) => {
      const date = new Date(q.date);
      const age = daysBetween(date, now);
      const newest = k >= quotes.length - OPEN_QUOTES;
      let outcome = 'open';
      if (age > quote.VALID_DAYS) outcome = OLD_QUOTE_OUTCOMES[old++ % OLD_QUOTE_OUTCOMES.length];
      else if (!newest && age >= 3 && rnd() < 0.4) outcome = 'converted';
      if (outcome === 'converted') {
        // 1-5 days later for old quotes, 1-2 for recent ones: always before today.
        const when = addDays(date, int(1, age > quote.VALID_DAYS ? 5 : 2), int(9, 18), int(0, 59), int(0, 59));
        const lines = q.lines.map(({ description, qtyMilli, unitCents, zeroRated }) => ({ description, qtyMilli, unitCents, zeroRated }));
        converted.set(q, sell({ ...q.customer }, lines, when, rnd() < 0.5 ? 'transfer' : payment()));
      } else if (outcome === 'cancelled') {
        q.cancelledAt = addDays(date, int(1, 5), int(9, 18), int(0, 59)).toISOString();
      }
    });

    // Number in date order, like the app, then link each converted quote and its receipt both ways.
    const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    const receipts = sales.concat([...converted.values()]).sort(byDate);
    receipts.forEach((r, i) => { r.id = i + 1; r.number = 'INV-' + String(i + 1).padStart(4, '0'); });
    quotes.forEach((q, i) => { q.id = i + 1; q.number = 'QT-' + String(i + 1).padStart(4, '0'); });
    for (const [q, r] of converted) {
      Object.assign(q, { convertedAt: r.date, receiptId: r.id, receiptNumber: r.number });
      Object.assign(r, { quoteId: q.id, quoteNumber: q.number });
    }

    return {
      settings,
      counters: { receipt: receipts.length, quote: quotes.length },
      lastBackupAt: now.toISOString(),   // a demo has nothing to back up: no backup reminder
      products, customers, receipts, quotes,
    };
  }

  const api = { BUSINESS, GST_RATE_BP, PRODUCTS, CUSTOMERS, historyStart, build, prng };

  if (isNode) module.exports = api;
  else root.demo = api;
})(typeof window !== 'undefined' ? window : globalThis);
