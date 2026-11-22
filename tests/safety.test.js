// Unit tests for the safety-hardening helpers: js/safety.js (pure part), money.priceError/qtyError,
// receipt.withTotals. Run with: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const safety = require('../js/safety.js');
const money = require('../js/money.js');
const receipt = require('../js/receipt.js');

test('daysAgo counts local calendar days: never / today / yesterday / N days ago', () => {
  const now = new Date(2026, 10, 22, 9, 0);
  assert.equal(safety.daysAgo(null, now), 'never');
  assert.equal(safety.daysAgo('not a date', now), 'never');
  assert.equal(safety.daysAgo(new Date(2026, 10, 22, 0, 5).toISOString(), now), 'today');
  assert.equal(safety.daysAgo(new Date(2026, 10, 21, 23, 59).toISOString(), now), 'yesterday');
  assert.equal(safety.daysAgo(new Date(2026, 10, 13, 18, 0).toISOString(), now), '9 days ago');
  assert.equal(safety.daysAgo(new Date(2026, 10, 25).toISOString(), now), 'today', 'a clock set back never shows a negative');
});

test('nearlyFull: 90% used or under 25 MB left; unknown quota is not "full"', () => {
  const MB = 1024 * 1024;
  assert.equal(safety.nearlyFull(undefined, undefined), false);
  assert.equal(safety.nearlyFull(10 * MB, 0), false);
  assert.equal(safety.nearlyFull(100 * MB, 2000 * MB), false);
  assert.equal(safety.nearlyFull(1800 * MB, 2000 * MB), true);
  assert.equal(safety.nearlyFull(80 * MB, 100 * MB), true, 'only 20 MB left');
});

test('formatBytes and isNoise', () => {
  assert.equal(safety.formatBytes(512), '512 bytes');
  assert.equal(safety.formatBytes(1536), '1.5 KB');
  assert.equal(safety.formatBytes(5 * 1024 * 1024), '5 MB');
  assert.equal(safety.isNoise('ResizeObserver loop completed with undelivered notifications.'), true);
  assert.equal(safety.isNoise('Script error.'), true);
  assert.equal(safety.isNoise('TypeError: x is undefined'), false);
});

test('priceError: 0 or more, at most 2 decimals, up to $100,000,000, friendly messages', () => {
  for (const ok of ['0', '12', '12.5', '12.50', '$1,234.50', ' 7 ', '100000000']) assert.equal(money.priceError(ok), '', ok);
  assert.equal(money.priceError(''), 'Enter a price, e.g. 12.50');
  assert.equal(money.priceError('abc'), 'Enter a price, e.g. 12.50');
  assert.equal(money.priceError('-5'), "Price can't be negative");
  assert.equal(money.priceError('12.505'), 'Use at most 2 decimals, e.g. 12.50');
  assert.equal(money.priceError('100000000.01'), 'Price is too large (max $100,000,000.00)');
});

test('qtyError: more than 0, at most 3 decimals, up to 99,999', () => {
  for (const ok of ['1', '0.5', '1.125', '99999']) assert.equal(money.qtyError(ok), '', ok);
  assert.equal(money.qtyError(''), 'Enter a quantity');
  assert.equal(money.qtyError('0'), 'Quantity must be more than 0');
  assert.equal(money.qtyError('-2'), 'Quantity must be more than 0');
  assert.equal(money.qtyError('1.2345'), 'Use at most 3 decimals');
  assert.equal(money.qtyError('two'), 'Enter a number, e.g. 2 or 1.5');
  assert.equal(money.qtyError('100000'), 'Quantity is too large (max 99,999)');
});

const settings = { gstRateBp: 1250, business: { name: 'Shop' }, receiptFooter: '' };
const lines = [
  { description: 'Haircut', qtyMilli: 1000, unitCents: 2500, zeroRated: false },
  { description: 'Water', qtyMilli: 2000, unitCents: 150, zeroRated: true },
];

test('withTotals recalculates every line value and total from the lines (a tampered total is replaced)', () => {
  const r = receipt.buildReceipt({ customer: {}, paymentMethod: 'cash', lines }, settings);
  const tampered = { ...r, subtotalCents: 1, gstCents: 0, totalCents: 1, lines: r.lines.map((l) => ({ ...l, netCents: 0, gstCents: 0 })) };
  const fixed = receipt.withTotals(tampered);
  assert.deepEqual(fixed, r);
  assert.equal(fixed.totalCents, 2500 + 313 + 300); // GST 312.5 rounds half away from zero
  assert.deepEqual(receipt.withTotals(r), r, 'a correct record is unchanged');
});

test('withTotals refuses invalid lines and rates before anything is written', () => {
  const r = receipt.buildReceipt({ customer: {}, paymentMethod: 'cash', lines }, settings);
  const bad = (mutate, re) => { const c = structuredClone(r); mutate(c); assert.throws(() => receipt.withTotals(c), re); };
  bad((c) => { c.lines = []; }, /at least one item/);
  bad((c) => { c.lines[0].qtyMilli = 0; }, /line 1 has an invalid quantity/);
  bad((c) => { c.lines[1].unitCents = -1; }, /line 2 has an invalid price/);
  bad((c) => { c.lines[0].unitCents = 12.5; }, /invalid price/);
  bad((c) => { c.lines[0].description = '  '; }, /needs a description/);
  bad((c) => { c.gstRateBp = 10001; }, /GST rate/);
});
