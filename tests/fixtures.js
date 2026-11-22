/*
 * fixtures.js: a fixed, hand-made data set for the Stats tests (tests/stats.cases.js).
 * Works in Node (require) and in the browser (window.fixtures; load money, receipt, filter and quote first).
 *
 * Records are built with receipt.buildReceipt / quote.buildQuote so they have exactly the shape the
 * app saves. Every expected figure below is worked out BY HAND in the comments; the tests compare
 * against these numbers, never against the code's own output.
 *
 * "Now" is Saturday 21 Nov 2026, 12:00 local. GST rate 12.5% (1250 bp) unless marked 10% (1000 bp):
 * R2 and R3 were saved before a rate change.  GST per line = net x rate, rounded half away from zero.
 *
 * Saved products (id, name, price, zero-rated):
 *   1 Coke 500ml 150 · 2 Bread loaf 400 ZR · 3 Rice 5lb 650 ZR · 4 Batteries AA 900 · 5 Phone charger 2500 (never sold)
 *   6 Phone case 1200
 * Saved customers: 1 Maria Chen 622-1234 · 2 Jose Garcia +501 610 5555 · 3 Ana Lopez (no phone)
 *   · 4 Pedro Never 633-0000 (never bought)
 *
 * Receipts (number, local date/time, payment, customer, lines -> net / GST / total, in cents):
 *  INV-0001 Wed 30 Sep 23:59:59 cash  walk-in   1 x Coke 500ml 150            -> 150 / 18.75=19 / 169
 *  INV-0002 Thu  1 Oct 00:00:00 cash  Maria  10%  2 x Coke 500ml 150 = 300, GST 30
 *                                                1 x Bread loaf 400 ZR          -> 700 / 30 / 730
 *  INV-0003 Mon  5 Oct 14:30 card     Jose   10%  1 x Batteries AA 900, GST 90 -> 900 / 90 / 990
 *  INV-0004 Mon 12 Oct 09:00 cash     walk-in   3 x "coke 500ml " 150 = 450      -> 450 / 56.25=56 / 506
 *  INV-0005 Thu 15 Oct 11:00 transfer Maria     1 x Rice 5lb 650 ZR
 *                                                2 x Batteries AA 900 = 1800, GST 225 -> 2450 / 225 / 2675
 *                                                (converted from QT-0001)
 *  INV-0006 Tue 20 Oct 16:00 cash     "ana lopez "  1 x "COKE  500ML" 150, GST 18.75=19
 *                                                1 x Bread loaf 400 ZR          -> 550 / 19 / 569
 *  INV-0007 Sun 25 Oct 10:00 card     walk-in   10 x Batteries AA 900 = 9000    -> VOIDED, never counted
 *  INV-0008 Sat 31 Oct 23:59:00 cash  Jose (+501 610 5555)
 *                                                3 x Gum 99 = 297, GST 37.125=37
 *                                                1 x Candy 4, GST 0.5=1         -> 301 / 38 / 339
 *  INV-0009 Sun  1 Nov 00:00:00 cash  walk-in   1 x Coke 500ml 150             -> 150 / 19 / 169
 *  INV-0010 Mon  2 Nov 10:00 card     Maria     1 x Phone case 1200, GST 150   -> 1200 / 150 / 1350
 *  INV-0011 Mon  9 Nov 12:00 cash     Ana       4 x Bread loaf 400 ZR = 1600   -> 1600 / 0 / 1600
 *  INV-0012 Tue 10 Nov 13:00 transfer Jose      1 x Batteries AA 900, 112.5=113 -> 900 / 113 / 1013
 *  INV-0013 Mon 16 Nov 08:00 cash     walk-in   2 x Coke 500ml 150 = 300, 37.5=38 -> 300 / 38 / 338
 *  INV-0014 Wed 18 Nov 15:00 card     Maria     1 x Rice 5lb 650 ZR            -> 650 / 0 / 650
 *  INV-0015 Fri 20 Nov 17:30 cash     walk-in   1 x Batteries AA 900           -> 900 / 113 / 1013
 *  INV-0016 Sat 21 Nov 09:00 cash     Jose      2 x Coke 500ml 150             -> 300 / 38 / 338
 *  INV-0017 Sat 21 Nov 10:30 card     walk-in   1 x Rice 5lb 650 ZR            -> VOIDED, never counted
 *
 * Quotes (never sales):
 *  QT-0001 Sat 10 Oct  Maria   1 x Rice 5lb 650 ZR + 2 x Batteries AA 900 -> total 2675, converted to INV-0005
 *  QT-0002 Tue 20 Oct  Jose    5 x Batteries AA 900 = 4500, 562.5=563     -> total 5063, valid to 3 Nov: expired
 *  QT-0003 Sun 15 Nov  Ana (622-7777 on the quote only) 10 x Bread loaf 400 ZR -> total 4000, valid to 29 Nov: open
 *  QT-0004 Sun  1 Nov  walk-in 1 x Phone case 1200, GST 150               -> total 1350, cancelled 5 Nov
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const receipt = isNode ? require('../js/receipt.js') : root.receipt;
  const quote = isNode ? require('../js/quote.js') : root.quote;

  const NOW = new Date(2026, 10, 21, 12, 0, 0);
  const BUSINESS = { name: 'Fixture Shop', address: 'Belmopan', phone: '822-0000', email: '', gstTin: '000111222' };
  const RATE = { gstRateBp: 1250, business: BUSINESS, receiptFooter: '' };
  const OLD_RATE = { gstRateBp: 1000, business: BUSINESS, receiptFooter: '' };

  const at = (m, d, hh = 12, mm = 0, ss = 0) => new Date(2026, m - 1, d, hh, mm, ss);
  const line = (description, qty, unitCents, zeroRated = false) => ({ description, qtyMilli: qty * 1000, unitCents, zeroRated });

  const WALK_IN = { name: '', phone: '' };
  const MARIA = { name: 'Maria Chen', phone: '622-1234' };
  const JOSE = { name: 'Jose Garcia', phone: '610-5555' };
  const JOSE_INTL = { name: 'Jose Garcia', phone: '+501 610 5555' };
  const ANA = { name: 'Ana Lopez', phone: '' };

  const products = [
    { id: 1, name: 'Coke 500ml', unit: 'each', priceCents: 150, zeroRated: false },
    { id: 2, name: 'Bread loaf', unit: 'each', priceCents: 400, zeroRated: true },
    { id: 3, name: 'Rice 5lb', unit: 'bag', priceCents: 650, zeroRated: true },
    { id: 4, name: 'Batteries AA', unit: 'pack', priceCents: 900, zeroRated: false },
    { id: 5, name: 'Phone charger', unit: 'each', priceCents: 2500, zeroRated: false },
    { id: 6, name: 'Phone case', unit: 'each', priceCents: 1200, zeroRated: false },
  ];

  const customers = [
    { id: 1, name: 'Maria Chen', phone: '622-1234', email: '', tin: '', address: '' },
    { id: 2, name: 'Jose Garcia', phone: '+501 610 5555', email: '', tin: '', address: '' },
    { id: 3, name: 'Ana Lopez', phone: '', email: '', tin: '', address: '' },
    { id: 4, name: 'Pedro Never', phone: '633-0000', email: '', tin: '', address: '' },
  ];

  const receipts = [];
  function sale(when, paymentMethod, customer, lines, settings = RATE, extra = {}) {
    const id = receipts.length + 1;
    const r = { id, number: 'INV-' + String(id).padStart(4, '0'),
      ...receipt.buildReceipt({ customer, paymentMethod, lines }, settings, when), ...extra };
    receipts.push(r);
    return r;
  }
  const voided = (when) => ({ voided: true, voidedAt: when.toISOString(), voidReason: 'Mistake' });

  sale(at(9, 30, 23, 59, 59), 'cash', WALK_IN, [line('Coke 500ml', 1, 150)]);
  sale(at(10, 1, 0, 0, 0), 'cash', MARIA, [line('Coke 500ml', 2, 150), line('Bread loaf', 1, 400, true)], OLD_RATE);
  sale(at(10, 5, 14, 30), 'card', JOSE, [line('Batteries AA', 1, 900)], OLD_RATE);
  sale(at(10, 12, 9, 0), 'cash', WALK_IN, [line('coke 500ml ', 3, 150)]);
  sale(at(10, 15, 11, 0), 'transfer', MARIA, [line('Rice 5lb', 1, 650, true), line('Batteries AA', 2, 900)], RATE,
    { quoteId: 1, quoteNumber: 'QT-0001' });
  sale(at(10, 20, 16, 0), 'cash', { name: 'ana lopez ', phone: '' }, [line('COKE  500ML', 1, 150), line('Bread loaf', 1, 400, true)]);
  sale(at(10, 25, 10, 0), 'card', WALK_IN, [line('Batteries AA', 10, 900)], RATE, voided(at(10, 25, 10, 5)));
  sale(at(10, 31, 23, 59, 0), 'cash', JOSE_INTL, [line('Gum', 3, 99), line('Candy', 1, 4)]);
  sale(at(11, 1, 0, 0, 0), 'cash', WALK_IN, [line('Coke 500ml', 1, 150)]);
  sale(at(11, 2, 10, 0), 'card', MARIA, [line('Phone case', 1, 1200)]);
  sale(at(11, 9, 12, 0), 'cash', ANA, [line('Bread loaf', 4, 400, true)]);
  sale(at(11, 10, 13, 0), 'transfer', JOSE, [line('Batteries AA', 1, 900)]);
  sale(at(11, 16, 8, 0), 'cash', WALK_IN, [line('Coke 500ml', 2, 150)]);
  sale(at(11, 18, 15, 0), 'card', MARIA, [line('Rice 5lb', 1, 650, true)]);
  sale(at(11, 20, 17, 30), 'cash', WALK_IN, [line('Batteries AA', 1, 900)]);
  sale(at(11, 21, 9, 0), 'cash', JOSE, [line('Coke 500ml', 2, 150)]);
  sale(at(11, 21, 10, 30), 'card', WALK_IN, [line('Rice 5lb', 1, 650, true)], RATE, voided(at(11, 21, 10, 31)));

  const quotes = [];
  function quoted(when, customer, lines, validUntil, extra = {}) {
    const id = quotes.length + 1;
    const q = { id, number: 'QT-' + String(id).padStart(4, '0'),
      ...quote.buildQuote({ customer, lines, validUntil, notes: '' }, RATE, when), ...extra };
    quotes.push(q);
    return q;
  }
  quoted(at(10, 10, 10, 0), MARIA, [line('Rice 5lb', 1, 650, true), line('Batteries AA', 2, 900)], '2026-10-24',
    { convertedAt: at(10, 15, 11, 0).toISOString(), receiptId: 5, receiptNumber: 'INV-0005' });
  quoted(at(10, 20, 9, 0), JOSE, [line('Batteries AA', 5, 900)], '2026-11-03');
  quoted(at(11, 15, 9, 0), { name: 'Ana Lopez', phone: '622-7777' }, [line('Bread loaf', 10, 400, true)], '2026-11-29');
  quoted(at(11, 1, 9, 0), WALK_IN, [line('Phone case', 1, 1200)], '2026-11-15', { cancelledAt: at(11, 5, 9, 0).toISOString() });

  /** Hand-worked figures (see the table above). */
  const EXPECT = {
    // Per receipt: [subtotal (net), GST, total]
    receipts: {
      'INV-0001': [150, 19, 169], 'INV-0002': [700, 30, 730], 'INV-0003': [900, 90, 990],
      'INV-0004': [450, 56, 506], 'INV-0005': [2450, 225, 2675], 'INV-0006': [550, 19, 569],
      'INV-0007': [9000, 1125, 10125], 'INV-0008': [301, 38, 339], 'INV-0009': [150, 19, 169],
      'INV-0010': [1200, 150, 1350], 'INV-0011': [1600, 0, 1600], 'INV-0012': [900, 113, 1013],
      'INV-0013': [300, 38, 338], 'INV-0014': [650, 0, 650], 'INV-0015': [900, 113, 1013],
      'INV-0016': [300, 38, 338], 'INV-0017': [650, 0, 650],
    },
    quotes: { 'QT-0001': 2675, 'QT-0002': 5063, 'QT-0003': 4000, 'QT-0004': 1350 },
    // October 2026 = "last month" at NOW: INV-0002..0006 and 0008 (0001 is 30 Sep, 0007 is void, 0009 is 1 Nov).
    //   subtotal  700 + 900 + 450 + 2450 + 550 + 301 = 5351
    //   taxable   300 + 900 + 450 + 1800 + 150 + 301 = 3901
    //   zero      400 +   0 +   0 +  650 + 400 +   0 = 1450   (3901 + 1450 = 5351)
    //   GST        30 +  90 +  56 +  225 +  19 +  38 =  458   (10%: 30 + 90 = 120 on 1200; 12.5%: 338 on 2701)
    //   total     730 + 990 + 506 + 2675 + 569 + 339 = 5809   (5351 + 458)
    october: { count: 6, subtotalCents: 5351, taxableCents: 3901, zeroRatedCents: 1450, gstCents: 458, totalCents: 5809 },
    // November 2026 to NOW ("this month"): INV-0009..0016 (0017 void).
    //   total 169 + 1350 + 1600 + 1013 + 338 + 650 + 1013 + 338 = 6471;  GST 19 + 150 + 113 + 38 + 113 + 38 = 471
    november: { count: 8, subtotalCents: 6000, gstCents: 471, totalCents: 6471 },
    // This week (Mon 16 - Sun 22 Nov): INV-0013..0016 = 338 + 650 + 1013 + 338
    week: { count: 4, totalCents: 2339 },
    // Today (Sat 21 Nov): INV-0016 only (0017 void)
    today: { count: 1, totalCents: 338 },
  };

  const api = { NOW, BUSINESS, products, customers, receipts, quotes, EXPECT };

  if (isNode) module.exports = api;
  else root.fixtures = api;
})(typeof window !== 'undefined' ? window : globalThis);
