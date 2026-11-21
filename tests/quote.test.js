// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const quote = require('../js/quote.js');
const receipt = require('../js/receipt.js');
const filter = require('../js/filter.js');

const NOW = new Date(2026, 10, 20, 10, 0); // Fri 20 Nov 2026, local
const SETTINGS = {
  gstRateBp: 1250, receiptFooter: 'Thank you!',
  business: { name: 'Demo Store', address: 'Belmopan', phone: '822-0000', email: '', gstTin: '000123' },
};
const INPUT = {
  customer: { name: ' Kim ', phone: '622-9887', tin: '', address: '' },
  lines: [
    { description: 'Pizza', qtyMilli: 2000, unitCents: 4000, zeroRated: false },
    { description: 'Rice 25lb', qtyMilli: 1000, unitCents: 2500, zeroRated: true },
  ],
  validUntil: '2026-12-04',
  notes: ' 50% deposit required ',
};

test('default valid-until is today + 14 days (local), across a month and year end', () => {
  assert.equal(quote.defaultValidUntil(NOW), '2026-12-04');
  assert.equal(quote.defaultValidUntil(new Date(2026, 11, 25, 23, 30)), '2027-01-08');
});

test('buildQuote: receipt-style snapshot and cents totals, no payment method, quote fields', () => {
  const q = quote.buildQuote(INPUT, SETTINGS, NOW);
  assert.equal(q.type, 'quote');
  assert.ok(!('paymentMethod' in q));
  assert.equal(q.validUntil, '2026-12-04');
  assert.equal(q.notes, '50% deposit required');
  assert.equal(q.customer.name, 'Kim');
  assert.equal(q.subtotalCents, 10500);
  assert.equal(q.gstCents, 1000);
  assert.equal(q.totalCents, 11500);
  assert.equal(q.zeroRatedCents, 2500);
  assert.deepEqual(q.business, SETTINGS.business);
  // The same lines through buildReceipt give the same totals (conversion keeps the amounts).
  const r = receipt.buildReceipt({ ...INPUT, paymentMethod: 'cash' }, SETTINGS, NOW);
  assert.deepEqual(r.lines, q.lines);
  assert.equal(r.totalCents, q.totalCents);
});

test('buildQuote on edit keeps id, number, date and createdAt; refreshes the snapshot', () => {
  const first = { ...quote.buildQuote(INPUT, SETTINGS, NOW), id: 7, number: 'QT-0007' };
  const later = new Date(2026, 10, 22, 9);
  const q = quote.buildQuote({ ...INPUT, notes: 'Changed' }, { ...SETTINGS, gstRateBp: 1500 }, later, first);
  assert.equal(q.id, 7);
  assert.equal(q.number, 'QT-0007');
  assert.equal(q.date, first.date);
  assert.equal(q.createdAt, first.createdAt);
  assert.equal(q.updatedAt, later.toISOString());
  assert.equal(q.notes, 'Changed');
  assert.equal(q.gstRateBp, 1500);
});

test('status: open through the valid-until day, expired after; converted/cancelled win', () => {
  const q = { validUntil: '2026-11-20' };
  assert.equal(quote.status(q, NOW), 'open');
  assert.equal(quote.status(q, new Date(2026, 10, 20, 23, 59)), 'open');
  assert.equal(quote.status(q, new Date(2026, 10, 21, 0, 1)), 'expired');
  assert.equal(quote.status({ ...q, cancelledAt: 'x' }, NOW), 'cancelled');
  assert.equal(quote.status({ ...q, receiptId: 3, convertedAt: 'x' }, new Date(2027, 0, 1)), 'converted');
  assert.equal(quote.isActive(q, new Date(2027, 0, 1)), true, 'expired quotes can still be converted');
  assert.equal(quote.isActive({ ...q, cancelledAt: 'x' }, NOW), false);
  assert.equal(quote.isActive({ ...q, receiptId: 1 }, NOW), false);
  assert.equal(quote.statusLabel('expired'), 'Expired');
});

test('filter.apply with quote statuses, search and newest first', () => {
  const Q = [
    { id: 1, number: 'QT-0001', date: NOW.toISOString(), customer: { name: 'Kim' }, totalCents: 4500, validUntil: '2026-12-04' },
    { id: 2, number: 'QT-0002', date: NOW.toISOString(), customer: { name: 'Eldon' }, totalCents: 2000, validUntil: '2026-11-01' },
    { id: 3, number: 'QT-0003', date: NOW.toISOString(), customer: { name: 'Ana' }, totalCents: 100, validUntil: '2026-12-04', cancelledAt: 'x' },
    { id: 4, number: 'QT-0004', date: NOW.toISOString(), customer: { name: 'Bo' }, totalCents: 100, validUntil: '2026-11-01', receiptId: 9 },
  ];
  const ids = (status, query) => filter.apply(Q, { status, query, now: NOW, statusOf: quote.status }).map((q) => q.id);
  assert.deepEqual(ids('all'), [4, 3, 2, 1]);
  assert.deepEqual(ids('open'), [1]);
  assert.deepEqual(ids('expired'), [2]);
  assert.deepEqual(ids('cancelled'), [3]);
  assert.deepEqual(ids('converted'), [4]);
  assert.deepEqual(ids('all', '0002'), [2]);
  assert.deepEqual(ids('all', 'kim'), [1]);
  assert.deepEqual(ids('all', '45'), [1]);
});

test('WhatsApp summary says Quotation, with valid-until and notes and no payment', () => {
  const q = { ...quote.buildQuote(INPUT, SETTINGS, NOW), number: 'QT-0003' };
  const text = receipt.summaryText(q);
  assert.match(text, /^Demo Store\nQuotation QT-0003 \(20 Nov 2026\)\n/);
  assert.match(text, /Valid until: 04 Dec 2026/);
  assert.match(text, /50% deposit required/);
  assert.doesNotMatch(text, /Receipt|Paid by/);
  assert.match(receipt.summaryText({ ...q, cancelledAt: 'x' }), /Quotation QT-0003 \(20 Nov 2026\) - CANCELLED/);
});

test('formatDay reads YYYY-MM-DD as a local day', () => {
  assert.equal(receipt.formatDay('2026-12-04'), '04 Dec 2026');
  assert.equal(receipt.formatDay(''), '');
  assert.equal(receipt.formatDay(undefined), '');
});
