/*
 * seed-data.js: realistic fake data for the dev-only seed tool (tests/seed.html).
 * Pure and deterministic: the same options give the same data. Needs money, receipt, filter and
 * quote (globals in the browser, require() in Node). Output is the shape db.replaceAll() takes.
 *
 * generate({ receipts = 300, days = 120, quotes = 40, now = new Date(), seed = 1 })
 *   - receipts spread over the last `days` days (today included), shop hours 7:00-20:59,
 *     busier on Fridays and Saturdays
 *   - lines: mostly saved products, some free-text items (with messy spellings), zero-rated items
 *   - about 45% walk-ins, the rest named customers (a few regulars buy far more often)
 *   - cash / card / transfer, about 2% voided
 *   - two slow movers for Stats: "Ceiling fan" (never sold) and "Rain boots" (no sales in the last 45 days)
 *   - `quotes` quotes: about 40% converted (each has a matching receipt, counted in `receipts`),
 *     10% cancelled, the rest open or expired
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const receipt = isNode ? require('../js/receipt.js') : root.receipt;
  const quote = isNode ? require('../js/quote.js') : root.quote;
  const filter = isNode ? require('../js/filter.js') : root.filter;

  const PRODUCTS = [
    ['Rice 25lb', 'bag', 2750, true], ['Red kidney beans 4lb', 'bag', 1200, true], ['Eggs (dozen)', 'dozen', 600, true],
    ['Flour 5lb', 'bag', 550, true], ['Sugar 4lb', 'bag', 480, true], ['Bread loaf', 'each', 400, true],
    ['Whole chicken', 'each', 1650, true], ['Cooking oil 1L', 'bottle', 900, false], ['Soft drink 20oz', 'each', 250, false],
    ['Bottled water', 'each', 150, false], ['Pizza', 'each', 500, false], ['Batteries AA (4)', 'pack', 950, false],
    ['Phone credit $10', 'each', 1000, false], ['Laundry soap', 'each', 725, false], ['Delivery fee', 'trip', 1000, false],
    ['Phone charger', 'each', 2500, false], ['Mosquito coil', 'box', 350, false],
  ];
  // Free-text items, typed differently each time (Stats groups them by normalized name).
  const FREE_TEXT = [
    [['Ice bag', 'ice bag', 'ICE BAG ', ' Ice  bag'], 300, false],
    [['Tamales', 'tamales', 'Tamales '], 200, true],
    [['Repair labour', 'Repair  labour', 'repair labour'], 3500, false],
    [['Coconut water', 'coconut water'], 350, false],
    [['Plantain', 'plantain ', 'PLANTAIN'], 100, true],
    [['Hair cut', 'Haircut fee'], 1500, false],
  ];
  const FIRST = ['Maria', 'Jose', 'Ana', 'Luis', 'Carmen', 'Kevin', 'Shanice', 'Darnell', 'Rosa', 'Elvin', 'Keisha', 'Andre',
    'Yolanda', 'Marlon', 'Gloria', 'Ricardo', 'Tanya', 'Omar', 'Lucia', 'Dwayne', 'Isabel', 'Neri', 'Sharon', 'Pedro'];
  const LAST = ['Chen', 'Garcia', 'Lopez', 'Young', 'Castillo', 'Flowers', 'Martinez', 'Gill', 'Bol', 'Usher', 'Tun', 'Arnold'];

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

  function generate({ receipts: receiptCount = 300, days = 120, quotes: quoteCount = 40, now = new Date(), seed = 1 } = {}) {
    const rnd = prng(seed);
    const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const pad = (n) => String(n).padStart(4, '0');
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const business = { name: 'Test Data Store', address: 'Belmopan, Cayo District', phone: '822-0000',
      email: 'test@example.com', gstTin: '000999888' };
    const settings = { gstRateBp: 1250, business, receiptFooter: 'Thank you for your business!' };

    const products = PRODUCTS.map(([name, unit, priceCents, zeroRated], i) =>
      ({ id: i + 1, name, unit, priceCents, zeroRated, createdAt: today.toISOString(), updatedAt: today.toISOString() }));
    const selling = products.slice();   // the everyday range; the two below are slow movers
    const NEVER = { id: products.length + 1, name: 'Ceiling fan', unit: 'each', priceCents: 8900, zeroRated: false };
    const STOPPED = { id: products.length + 2, name: 'Rain boots', unit: 'pair', priceCents: 2200, zeroRated: false };
    products.push(NEVER, STOPPED);
    const stoppedAfter = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 45); // Rain boots: none since

    const customers = [];
    for (let i = 0; i < 30; i++) {
      // Unique names (the second time round the first names, the surnames shift by 5).
      const name = FIRST[i % FIRST.length] + ' ' + LAST[(i * 7 + Math.floor(i / FIRST.length) * 5) % LAST.length];
      const n = String(6000000 + i * 37717).slice(0, 7);
      // Phones typed in different ways: "622-1234", "+501 622 1234", or none.
      const phone = i % 6 === 5 ? '' : i % 3 === 0 ? '+501 ' + n.slice(0, 3) + ' ' + n.slice(3) : n.slice(0, 3) + '-' + n.slice(3);
      customers.push({ id: i + 1, name, phone, email: '', tin: '', address: '', createdAt: today.toISOString() });
    }

    /** A random moment `maxDaysAgo`..0 days back, shop hours, weighted to Fri/Sat; never in the future. */
    function when(maxDaysAgo) {
      for (;;) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - int(0, maxDaysAgo - 1), int(7, 20), int(0, 59), int(0, 59));
        const weight = [0.5, 0.8, 0.8, 0.9, 1, 1.4, 1.3][(d.getDay() + 6) % 7]; // Mon..Sun
        if (d <= now && rnd() < weight / 1.4) return d;
      }
    }

    function customer() {
      if (rnd() < 0.45) return { name: '', phone: '' };
      // Regulars: the first 6 customers get about half of the named sales.
      const c = rnd() < 0.5 ? customers[int(0, 5)] : pick(customers);
      return { name: c.name, phone: c.phone };
    }

    function lines(date) {
      const out = [];
      if (date && date < stoppedAfter && rnd() < 0.08) {
        out.push({ description: STOPPED.name, qtyMilli: 1000, unitCents: STOPPED.priceCents, zeroRated: false });
      }
      for (let i = int(1, 4); i > 0; i--) {
        if (rnd() < 0.75) {
          const p = pick(selling);
          out.push({ description: p.name, qtyMilli: int(1, 4) * 1000, unitCents: p.priceCents, zeroRated: p.zeroRated });
        } else {
          const [names, unitCents, zeroRated] = pick(FREE_TEXT);
          out.push({ description: pick(names), qtyMilli: int(1, 6) * 1000, unitCents, zeroRated });
        }
      }
      return out;
    }

    const payment = () => { const x = rnd(); return x < 0.6 ? 'cash' : x < 0.85 ? 'card' : 'transfer'; };

    // Quotes first: converted ones each get a matching receipt a few days later.
    const quoteList = [];
    const receiptList = [];
    for (let i = 0; i < quoteCount; i++) {
      const date = when(days);
      const cust = rnd() < 0.15 ? { name: '', phone: '' } : (() => { const c = pick(customers); return { name: c.name, phone: c.phone }; })();
      const validUntil = filter.dayString(new Date(date.getFullYear(), date.getMonth(), date.getDate() + quote.VALID_DAYS));
      const q = quote.buildQuote({ customer: cust, lines: lines(), validUntil, notes: '' }, settings, date);
      const x = rnd();
      const convertAt = new Date(date.getTime() + int(1, 7) * 86400000);
      if (x < 0.4 && convertAt <= now && receiptList.length < receiptCount) {
        const r = receipt.buildReceipt({ customer: q.customer, paymentMethod: payment(), lines: q.lines }, settings, convertAt);
        r._quote = q;
        q._receipt = r;
        receiptList.push(r);
      } else if (x < 0.5) {
        q.cancelledAt = new Date(Math.min(now.getTime(), date.getTime() + int(1, 5) * 86400000)).toISOString();
      }
      quoteList.push(q);
    }
    while (receiptList.length < receiptCount) {
      const date = when(days);
      const r = receipt.buildReceipt({ customer: customer(), paymentMethod: payment(), lines: lines(date) }, settings, date);
      if (rnd() < 0.02) Object.assign(r, { voided: true, voidedAt: r.date, voidReason: 'Entered by mistake' });
      receiptList.push(r);
    }

    // Number in date order, like the real app, then fill in the quote <-> receipt links.
    const byDate = (a, b) => new Date(a.date) - new Date(b.date);
    receiptList.sort(byDate).forEach((r, i) => { r.id = i + 1; r.number = 'INV-' + pad(i + 1); });
    quoteList.sort(byDate).forEach((q, i) => { q.id = i + 1; q.number = 'QT-' + pad(i + 1); });
    for (const q of quoteList) {
      const r = q._receipt;
      if (!r) continue;
      Object.assign(q, { convertedAt: r.date, receiptId: r.id, receiptNumber: r.number });
      Object.assign(r, { quoteId: q.id, quoteNumber: q.number });
      delete q._receipt;
      delete r._quote;
    }

    return {
      settings: { business, gstRateBp: 1250, receiptFooter: settings.receiptFooter },
      counters: { receipt: receiptList.length, quote: quoteList.length },
      lastBackupAt: now.toISOString(),
      products, customers, receipts: receiptList, quotes: quoteList,
    };
  }

  const api = { generate, prng };
  if (isNode) module.exports = api;
  else root.seedData = api;
})(typeof window !== 'undefined' ? window : globalThis);
