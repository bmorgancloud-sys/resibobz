// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../js/money.js');

test('roundDiv rounds half away from zero', () => {
  assert.equal(m.roundDiv(1500, 1000), 2);
  assert.equal(m.roundDiv(1499, 1000), 1);
  assert.equal(m.roundDiv(-1500, 1000), -2);
  assert.equal(m.roundDiv(0, 1000), 0);
});

test('parseCents', () => {
  assert.equal(m.parseCents('12'), 1200);
  assert.equal(m.parseCents('12.5'), 1250);
  assert.equal(m.parseCents('12.05'), 1205);
  assert.equal(m.parseCents('$1,234.50'), 123450);
  assert.equal(m.parseCents('.99'), 99);
  assert.equal(m.parseCents('5.'), 500);
  assert.equal(m.parseCents(' 0 '), 0);
  assert.equal(m.parseCents('12.345'), null);
  assert.equal(m.parseCents('abc'), null);
  assert.equal(m.parseCents(''), null);
  assert.equal(m.parseCents('.'), null);
  assert.equal(m.parseCents('-5'), null);
  assert.equal(m.parseCents('-5', { allowNegative: true }), -500);
  assert.equal(m.parseCents('1.2.3'), null);
});

test('formatCents', () => {
  assert.equal(m.formatCents(0), '$0.00');
  assert.equal(m.formatCents(5), '$0.05');
  assert.equal(m.formatCents(123450), '$1,234.50');
  assert.equal(m.formatCents(100000000), '$1,000,000.00');
  assert.equal(m.formatCents(-500), '-$5.00');
  assert.throws(() => m.formatCents(1.5));
});

test('centsToInput round-trips', () => {
  for (const c of [0, 5, 99, 100, 123450]) assert.equal(m.parseCents(m.centsToInput(c)), c);
});

test('parseQty / formatQty', () => {
  assert.equal(m.parseQty('1'), 1000);
  assert.equal(m.parseQty('1.5'), 1500);
  assert.equal(m.parseQty('0.125'), 125);
  assert.equal(m.parseQty('0'), null);
  assert.equal(m.parseQty('1.2345'), null);
  assert.equal(m.formatQty(1500), '1.5');
  assert.equal(m.formatQty(2000), '2');
  assert.equal(m.formatQty(125), '0.125');
});

test('parseRate / formatRate', () => {
  assert.equal(m.parseRate('12.5'), 1250);
  assert.equal(m.parseRate('12.5%'), 1250);
  assert.equal(m.parseRate('0'), 0);
  assert.equal(m.parseRate('100'), 10000);
  assert.equal(m.parseRate('100.01'), null);
  assert.equal(m.parseRate('12.555'), null);
  assert.equal(m.formatRate(1250), '12.5');
  assert.equal(m.formatRate(1200), '12');
  assert.equal(m.formatRate(1225), '12.25');
});

test('gstOn at 12.5%', () => {
  assert.equal(m.gstOn(1000, 1250), 125);   // $10.00 -> $1.25
  assert.equal(m.gstOn(1, 1250), 0);        // 0.125c -> 0
  assert.equal(m.gstOn(4, 1250), 1);        // 0.5c -> 1 (half up)
  assert.equal(m.gstOn(999, 1250), 125);    // 124.875c -> 125
});

test('calcLine', () => {
  assert.deepEqual(m.calcLine({ qtyMilli: 2000, unitCents: 1000, zeroRated: false }, 1250),
    { netCents: 2000, gstCents: 250, totalCents: 2250 });
  assert.deepEqual(m.calcLine({ qtyMilli: 2000, unitCents: 1000, zeroRated: true }, 1250),
    { netCents: 2000, gstCents: 0, totalCents: 2000 });
  // 1.5 lb @ $3.33 = 499.5c -> 500c
  assert.equal(m.calcLine({ qtyMilli: 1500, unitCents: 333, zeroRated: false }, 1250).netCents, 500);
});

test('calcTotals adds up from rounded lines', () => {
  const t = m.calcTotals([
    { qtyMilli: 1000, unitCents: 999, zeroRated: false },  // net 999, gst 125
    { qtyMilli: 1000, unitCents: 999, zeroRated: false },  // net 999, gst 125
    { qtyMilli: 3000, unitCents: 250, zeroRated: true },   // net 750, gst 0
  ], 1250);
  assert.equal(t.subtotalCents, 2748);
  assert.equal(t.taxableCents, 1998);
  assert.equal(t.zeroRatedCents, 750);
  assert.equal(t.gstCents, 250);
  assert.equal(t.totalCents, 2998);
  assert.equal(t.totalCents, t.lines.reduce((s, l) => s + l.totalCents, 0));
});

test('calcTotals with no lines', () => {
  const t = m.calcTotals([], 1250);
  assert.equal(t.totalCents, 0);
});
