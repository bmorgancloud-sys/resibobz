// Run with: node --test tests/
// The dev-only seed generator (tests/seed-data.js) makes consistent data that the app can load.
const test = require('node:test');
const assert = require('node:assert/strict');
const seedData = require('./seed-data.js');
const backup = require('../js/backup.js');

const NOW = new Date(2026, 10, 21, 15, 0);

test('seed: 300 receipts and 40 quotes over 120 days, linked and in the past', () => {
  const d = seedData.generate({ receipts: 300, days: 120, quotes: 40, now: NOW, seed: 300 });
  assert.equal(d.receipts.length, 300);
  assert.equal(d.quotes.length, 40);
  const earliest = new Date(2026, 10, 21 - 119);
  for (const r of d.receipts) {
    const t = new Date(r.date);
    assert.ok(t <= NOW && t >= earliest, r.number + ' within the last 120 days');
    assert.equal(r.totalCents, r.subtotalCents + r.gstCents);
  }
  // Numbers follow date order, ids are 1..n.
  d.receipts.forEach((r, i) => assert.equal(r.id, i + 1));
  for (let i = 1; i < d.receipts.length; i++) assert.ok(new Date(d.receipts[i - 1].date) <= new Date(d.receipts[i].date));
  // Converted quotes point at a receipt that points back.
  const converted = d.quotes.filter((q) => q.receiptId);
  assert.ok(converted.length >= 5, 'some quotes converted');
  for (const q of converted) {
    const r = d.receipts.find((x) => x.id === q.receiptId);
    assert.equal(r.quoteId, q.id);
    assert.equal(r.number, q.receiptNumber);
  }
  assert.ok(d.quotes.some((q) => q.cancelledAt), 'some cancelled');
  assert.ok(d.receipts.some((r) => !r.customer.name), 'some walk-ins');
  assert.equal(new Set(d.customers.map((c) => c.name)).size, d.customers.length, 'customer names are unique');
  assert.ok(d.receipts.some((r) => r.lines.some((l) => l.zeroRated)), 'some zero-rated lines');
  assert.ok(d.receipts.some((r) => r.lines.some((l) => !d.products.some((p) => p.name === l.description))), 'some free-text items');
  // Slow movers for the Stats tab: Ceiling fan never sold; Rain boots sold, but not in the last 45 days.
  const sold = (name) => d.receipts.filter((r) => r.lines.some((l) => l.description === name));
  assert.ok(d.products.some((p) => p.name === 'Ceiling fan') && sold('Ceiling fan').length === 0);
  assert.ok(sold('Rain boots').length > 0);
  assert.ok(sold('Rain boots').every((r) => new Date(r.date) < new Date(2026, 10, 21 - 45)));
});

test('seed: deterministic, and 2,000 receipts pass backup validation', () => {
  const a = seedData.generate({ receipts: 50, now: NOW, seed: 7 });
  const b = seedData.generate({ receipts: 50, now: NOW, seed: 7 });
  assert.deepEqual(a, b);
  const big = seedData.generate({ receipts: 2000, now: NOW, seed: 2000 });
  assert.equal(big.receipts.length, 2000);
  const file = { app: 'ResiboBZ', schemaVersion: backup.SCHEMA_VERSION, exportedAt: NOW.toISOString(), ...big };
  const parsed = backup.parse(JSON.stringify(file));
  assert.equal(parsed.receipts.length, 2000);
});
