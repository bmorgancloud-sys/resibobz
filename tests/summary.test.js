// Run with: node --test tests/
// Daily Summary maths (js/summary.js) against a hand-worked fixture.
const test = require('node:test');
const assert = require('node:assert/strict');
const receipt = require('../js/receipt.js');
const quote = require('../js/quote.js');
const summary = require('../js/summary.js');

const BUSINESS = { name: 'Test Shop', address: '', phone: '', email: '', gstTin: '' };
const RATE_NOW = { gstRateBp: 1250, business: BUSINESS };   // current setting: 12.5%
const RATE_OLD = { gstRateBp: 1000, business: BUSINESS };   // a receipt saved when the rate was 10%

// Local times (the app's day runs 00:00:00 to 23:59:59 local).
const at = (d, hh, mm = 0, ss = 0) => new Date(2026, 10, d, hh, mm, ss);
const line = (description, qty, unitCents, zeroRated = false) => ({ description, qtyMilli: qty * 1000, unitCents, zeroRated });

let nextId = 1;
function sale(when, paymentMethod, lines, settings = RATE_NOW, extra = {}) {
  const id = nextId++;
  return { id, number: 'INV-' + String(id).padStart(4, '0'),
    ...receipt.buildReceipt({ customer: { name: '' }, paymentMethod, lines }, settings, when), ...extra };
}

// ---- Fixture: Friday 20 Nov 2026, plus its neighbours ----
//
// R1 00:00:00 cash      1 x $1.00 std            net 100   GST 12.5 -> 13     total 113
// R2 09:15    cash      2 x $10.00 std           net 2000  GST 250
//                       1 x $3.33 zero-rated     net 333   GST 0              total 2583
// R3 13:40    card      3 x $0.99 std            net 297   GST 37.125 -> 37
//                       1 x $0.04 std            net 4     GST 0.5 -> 1
//                       1 x $0.04 std            net 4     GST 0.5 -> 1       total 344
//                       (GST on the 305 subtotal would be 38.125 -> 38: per-line rounding gives 39)
// R4 23:59:00 transfer  1 x $50.00 std at 10%    net 5000  GST 500            total 5500
// V  12:00    cash      $100.00, VOIDED                                  -> excluded
// Q  10:00    quote     $200.00                                          -> excluded
// N  21 Nov 00:00:00 cash  1 x $7.00 std         net 700   GST 87.5 -> 88     total 788   (next day)
// P  19 Nov 23:59:59 card  1 x $9.00 std         net 900   GST 112.5 -> 113   total 1013  (day before)
//
// 20 Nov: 4 receipts
//   Subtotal 100 + 2333 + 305 + 5000 = 7738   (standard 7405, zero-rated 333)
//   GST      13 + 250 + 39 + 500     = 802
//   Total    113 + 2583 + 344 + 5500 = 8540  (= 7738 + 802)
//   Cash 2 = 113 + 2583 = 2696 · Card 1 = 344 · Transfer 1 = 5500   -> 2696 + 344 + 5500 = 8540
//   By rate: 10%   net 5000 GST 500
//            12.5% net 2405 GST 302  (100 + 2000 + 305; 13 + 250 + 39)
const R1 = sale(at(20, 0, 0, 0), 'cash', [line('Bread', 1, 100)]);
const R2 = sale(at(20, 9, 15), 'cash', [line('Paint', 2, 1000), line('Rice', 1, 333, true)]);
const R3 = sale(at(20, 13, 40), 'card', [line('Nails', 3, 99), line('Washer', 1, 4), line('Washer', 1, 4)]);
const R4 = sale(at(20, 23, 59), 'transfer', [line('Cement', 1, 5000)], RATE_OLD);
const V = sale(at(20, 12), 'cash', [line('Drill', 1, 10000)], RATE_NOW,
  { voided: true, voidedAt: at(20, 12, 5).toISOString(), voidReason: 'Wrong item' });
const Q = { id: 1, number: 'QT-0001', ...quote.buildQuote({ customer: { name: 'Kim' }, validUntil: '2026-12-20', notes: '',
  lines: [line('Fence', 1, 20000)] }, RATE_NOW, at(20, 10)) };
const N = sale(at(21, 0, 0, 0), 'cash', [line('Ice', 1, 700)]);
const P = sale(at(19, 23, 59, 59), 'card', [line('Rope', 1, 900)]);

const ALL = [N, V, R3, Q, R1, P, R4, R2]; // any order; the quote mixed in on purpose

test('fixture lines are what the hand working says (per-line GST, half away from zero)', () => {
  assert.deepEqual([R1.gstCents, R1.totalCents], [13, 113]);
  assert.deepEqual([R2.subtotalCents, R2.zeroRatedCents, R2.gstCents, R2.totalCents], [2333, 333, 250, 2583]);
  assert.deepEqual(R3.lines.map((l) => l.gstCents), [37, 1, 1]);
  assert.deepEqual([R3.subtotalCents, R3.gstCents, R3.totalCents], [305, 39, 344]);
  assert.deepEqual([R4.gstRateBp, R4.gstCents, R4.totalCents], [1000, 500, 5500]);
  assert.deepEqual([N.totalCents, P.totalCents], [788, 1013]);
});

test('daily summary: totals for 20 Nov', () => {
  const s = summary.daily(ALL, '2026-11-20');
  assert.equal(s.day, '2026-11-20');
  assert.equal(s.count, 4);
  assert.equal(s.subtotalCents, 7738);
  assert.equal(s.taxableCents, 7405);
  assert.equal(s.zeroRatedCents, 333);
  assert.equal(s.gstCents, 802);
  assert.equal(s.totalCents, 8540);
  assert.equal(s.subtotalCents + s.gstCents, s.totalCents);
});

test('daily summary: breakdown by payment method adds up exactly to the total', () => {
  const s = summary.daily(ALL, '2026-11-20');
  assert.deepEqual(s.byPayment.map((p) => [p.id, p.label, p.count, p.totalCents]), [
    ['cash', 'Cash', 2, 2696],
    ['card', 'Card', 1, 344],
    ['transfer', 'Transfer', 1, 5500],
  ]);
  assert.equal(s.byPayment.reduce((n, p) => n + p.totalCents, 0), s.totalCents);
  assert.equal(s.byPayment.reduce((n, p) => n + p.count, 0), s.count);
});

test('daily summary: GST uses each receipt\'s own stored rate, not the current setting', () => {
  const s = summary.daily(ALL, '2026-11-20');
  assert.deepEqual(s.byRate, [
    { gstRateBp: 1000, taxableCents: 5000, gstCents: 500 },
    { gstRateBp: 1250, taxableCents: 2405, gstCents: 302 },
  ]);
  // At today's 12.5% the cement would have carried $6.25 GST; the summary keeps the $5.00 on the receipt.
  assert.equal(s.byRate.reduce((n, r) => n + r.gstCents, 0), s.gstCents);
});

test('daily summary: quotes and voided receipts are left out', () => {
  const s = summary.daily(ALL, '2026-11-20');
  assert.deepEqual(s.receipts.map((r) => r.number), [R1.number, R2.number, R3.number, R4.number], 'oldest first');
  assert.ok(!s.receipts.includes(V));
  assert.ok(!s.receipts.includes(Q));
  assert.deepEqual(s.excluded, { voided: 1, cancelled: 0 });
  assert.equal(summary.counts(Q), false);
  assert.equal(summary.counts(V), false);
  assert.equal(summary.counts({ ...R1, cancelledAt: at(20, 9).toISOString() }), false);
});

test('daily summary: day boundaries are local 00:00:00 to 23:59:59', () => {
  // 23:59 on the 20th counts on the 20th; 00:00 on the 21st counts on the 21st.
  assert.ok(summary.daily(ALL, '2026-11-20').receipts.includes(R4));
  assert.ok(summary.daily(ALL, '2026-11-20').receipts.includes(R1));
  assert.ok(!summary.daily(ALL, '2026-11-20').receipts.includes(N));

  const next = summary.daily(ALL, '2026-11-21');
  assert.deepEqual([next.count, next.gstCents, next.totalCents], [1, 88, 788]);
  assert.deepEqual(next.receipts, [N]);

  const before = summary.daily(ALL, '2026-11-19');
  assert.deepEqual([before.count, before.totalCents], [1, 1013]);
  assert.deepEqual(before.byPayment.find((p) => p.id === 'card'), { id: 'card', label: 'Card', count: 1, totalCents: 1013 });

  const { from, to } = summary.dayBounds('2026-11-20');
  assert.equal(from.getTime(), new Date(2026, 10, 20, 0, 0, 0, 0).getTime());
  assert.equal(to.getTime() - 1, new Date(2026, 10, 20, 23, 59, 59, 999).getTime());
});

test('daily summary: an empty day, or a day with only void receipts, counts nothing', () => {
  const empty = summary.daily(ALL, '2026-11-22');
  assert.equal(empty.count, 0);
  assert.equal(empty.totalCents, 0);
  assert.deepEqual(empty.byPayment.map((p) => p.count), [0, 0, 0]);
  const onlyVoid = summary.daily([V, Q], '2026-11-20');
  assert.equal(onlyVoid.count, 0);
  assert.equal(onlyVoid.excluded.voided, 1);
});

test('daily summary: an unknown payment method gets its own row, so the breakdown still adds up', () => {
  const odd = sale(at(20, 15), 'cheque', [line('Gift', 1, 1000)]);
  const s = summary.daily([...ALL, odd], '2026-11-20');
  assert.equal(s.totalCents, 8540 + 1125);
  assert.deepEqual(s.byPayment.at(-1), { id: 'cheque', label: 'cheque', count: 1, totalCents: 1125 });
  assert.equal(s.byPayment.reduce((n, p) => n + p.totalCents, 0), s.totalCents);
});

test('dayBounds rejects invalid dates; daily throws on them', () => {
  assert.equal(summary.dayBounds('2026-02-30'), null);
  assert.equal(summary.dayBounds('20/11/2026'), null);
  assert.equal(summary.dayBounds(''), null);
  assert.throws(() => summary.daily(ALL, 'nope'), /Invalid date/);
  assert.equal(summary.dayOf(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('summaryText and pdfFileName', () => {
  const s = summary.daily(ALL, '2026-11-20');
  const text = summary.summaryText(s, 'Test Shop');
  assert.match(text, /^Test Shop\nDaily summary 20 Nov 2026\n/);
  assert.match(text, /Receipts: 4/);
  assert.match(text, /Subtotal \(excl\. GST\): \$77\.38/);
  assert.match(text, /GST collected: \$8\.02/);
  assert.match(text, /Total: BZD \$85\.40/);
  assert.match(text, /Cash: 2 · \$26\.96/);
  assert.match(text, /1 voided, not counted/);
  assert.equal(summary.pdfFileName(s), 'daily-summary-2026-11-20.pdf');
});
