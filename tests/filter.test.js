// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const filter = require('../js/filter.js');

// Local times; Friday 20 Nov 2026, 10:00.
const NOW = new Date(2026, 10, 20, 10, 0);
const at = (y, m, d, hh = 9) => new Date(y, m - 1, d, hh).toISOString();

const R = [
  { id: 1, number: 'INV-0001', date: at(2026, 11, 20), customer: { name: 'Kimley Jone', phone: '622-9887' }, totalCents: 4500, gstCents: 500 },
  { id: 2, number: 'INV-0002', date: at(2026, 11, 20, 11), customer: { name: 'Eldon', phone: '610 0551' }, totalCents: 2000, gstCents: 0, voided: true },
  { id: 3, number: 'INV-0003', date: at(2026, 11, 19), customer: { name: '', phone: '' }, totalCents: 11250, gstCents: 1250 },
  { id: 12, number: 'INV-0012', date: at(2026, 11, 1), customer: { name: 'brandon Morgan', phone: '+501 615-0551' }, totalCents: 45999, gstCents: 0 },
  { id: 13, number: 'INV-0013', date: at(2026, 10, 31), customer: { name: 'Belmopan Hardware', phone: '' }, totalCents: 450, gstCents: 50 },
];
const ids = (list) => list.map((r) => r.id);
const search = (q) => ids(filter.apply(R, { query: q, now: NOW })).sort((a, b) => a - b);

test('no filters: everything, newest first', () => {
  assert.deepEqual(ids(filter.apply(R, { now: NOW })), [2, 1, 3, 12, 13]);
});

test('search by receipt number: digits, full number, or another prefix', () => {
  assert.deepEqual(search('0012'), [12]);
  assert.deepEqual(search('INV-0012'), [12]);
  assert.deepEqual(search('inv-0012'), [12]);
  assert.deepEqual(search('R-0012'), [12]);
  assert.deepEqual(search('0002'), [2]);
});

test('search by customer name, case-insensitive substring', () => {
  assert.deepEqual(search('kim'), [1]);
  assert.deepEqual(search('MORGAN'), [12]);
  assert.deepEqual(search('zzz'), []);
});

test('search by phone ignores formatting and +501; needs 3+ digits', () => {
  assert.deepEqual(search('6229887'), [1]);
  assert.deepEqual(search('622-9887'), [1]);
  assert.deepEqual(search('610 0551'), [2]);
  assert.deepEqual(search('+501 6150551'), [12]);
  assert.deepEqual(search('0551'), [2, 12]);
});

test('search by amount: "45" is $45.xx only, decimals narrow it', () => {
  assert.deepEqual(search('45'), [1]);            // not $459.99, not $4.50
  assert.deepEqual(search('$45'), [1]);
  assert.deepEqual(search('45.00'), [1]);
  assert.deepEqual(search('459'), [12]);
  assert.deepEqual(search('459.9'), [12]);
  assert.deepEqual(search('4.5'), [13]);
  assert.deepEqual(search('112.50'), [3]);
  assert.deepEqual(search('045'), []);            // leading zero: a number, not an amount
});

test('Today excludes yesterday; This week starts Monday; This month', () => {
  assert.deepEqual(ids(filter.apply(R, { preset: 'today', now: NOW })), [2, 1]);
  assert.deepEqual(ids(filter.apply(R, { preset: 'week', now: NOW })), [2, 1, 3]); // Mon 16 - Sun 22 Nov
  assert.deepEqual(ids(filter.apply(R, { preset: 'month', now: NOW })), [2, 1, 3, 12]);
  // On a Sunday the week still began the Monday before.
  const sunday = new Date(2026, 10, 22, 20);
  assert.deepEqual(filter.dateRange('week', sunday).from, new Date(2026, 10, 16));
});

test('custom range is inclusive of both days; either end optional', () => {
  const custom = (fromDay, toDay) => ids(filter.apply(R, { preset: 'custom', fromDay, toDay, now: NOW }));
  assert.deepEqual(custom('2026-11-19', '2026-11-19'), [3]);
  assert.deepEqual(custom('2026-11-01', ''), [2, 1, 3, 12]);
  assert.deepEqual(custom('', '2026-10-31'), [13]);
  assert.deepEqual(custom('', ''), [2, 1, 3, 12, 13]);
});

test('status filter, combined with search and date', () => {
  assert.deepEqual(ids(filter.apply(R, { status: 'voided', now: NOW })), [2]);
  assert.deepEqual(ids(filter.apply(R, { status: 'active', preset: 'today', now: NOW })), [1]);
  assert.deepEqual(ids(filter.apply(R, { status: 'active', query: 'eldon', now: NOW })), []);
});

test('summary counts listed receipts but totals only non-voided ones', () => {
  const s = filter.summarize(filter.apply(R, { preset: 'today', now: NOW }));
  assert.deepEqual(s, { count: 2, active: 1, voided: 1, totalCents: 4500, gstCents: 500 });
});

test('backup reminder: none without receipts; shown if never or over 7 days', () => {
  assert.equal(filter.needsBackup(null, 0, NOW), false);
  assert.equal(filter.needsBackup(null, 3, NOW), true);
  assert.equal(filter.needsBackup(new Date(2026, 10, 14, 10).toISOString(), 3, NOW), false); // 6 days
  assert.equal(filter.needsBackup(new Date(2026, 10, 12, 9).toISOString(), 3, NOW), true);   // 8 days
});
