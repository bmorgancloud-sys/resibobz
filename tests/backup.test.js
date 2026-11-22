// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const backup = require('../js/backup.js');

const NOW = new Date(2026, 10, 20, 15, 30);

function receipt(id, number) {
  return { id, number, date: NOW.toISOString(), customer: { name: '' }, lines: [], subtotalCents: 100, gstCents: 13, totalCents: 113 };
}

function dump() {
  return {
    settings: {
      business: { name: 'Demo Store' }, logo: { dataUrl: 'data:image/png;base64,iVBOR', format: 'PNG', width: 1, height: 1 },
      gstRateBp: 1250, receiptPrefix: 'INV-', quotePrefix: 'QT-', numberPadding: 4, pageSize: 'a4',
      counter_receipt: 3, counter_quote: 0, lastBackupAt: '2026-11-01T00:00:00.000Z',
    },
    products: [{ id: 1, name: 'Rice', priceCents: 2500, zeroRated: true }],
    customers: [{ id: 4, name: 'Eldon', phone: '610-0551' }],
    receipts: [receipt(1, 'INV-0001'), receipt(2, 'INV-0002'), receipt(3, 'INV-0003')],
    quotes: [],
  };
}

test('build: header, settings without counters or device keys, counters section', () => {
  const b = backup.build(dump(), NOW);
  assert.equal(b.app, 'ResiboBZ');
  assert.equal(b.schemaVersion, 2);
  assert.equal(b.exportedAt, NOW.toISOString());
  assert.deepEqual(b.counters, { receipt: 3, quote: 0 });
  assert.equal(b.settings.logo.dataUrl, 'data:image/png;base64,iVBOR');
  assert.equal(b.settings.pageSize, 'a4');
  for (const k of ['counter_receipt', 'counter_quote', 'lastBackupAt']) assert.ok(!(k in b.settings), k);
  assert.equal(b.receipts.length, 3);
});

test('fileName uses the local date', () => {
  assert.equal(backup.fileName(NOW), 'toucanbill-backup-2026-11-20.json');
});

test('rebrand: the file marker stays "ResiboBZ" (data format unchanged); "Toucan Bill" files import too', () => {
  const b = backup.build(dump(), NOW);
  assert.equal(b.app, 'ResiboBZ');
  // A backup exported by the pre-rebrand app (same JSON) still imports...
  assert.equal(backup.parse(JSON.stringify(b)).receipts.length, 3);
  // ...and so does one marked with the new name.
  assert.equal(backup.parse(JSON.stringify({ ...b, app: 'Toucan Bill' })).receipts.length, 3);
});

test('parse accepts its own output (round trip) and summarises it', () => {
  const b = backup.parse(JSON.stringify(backup.build(dump(), NOW)));
  assert.deepEqual(b.products, dump().products);
  assert.equal(backup.summary(b), '3 receipts, 1 product, 1 customer, exported 2026-11-20');
});

test('counters continue from the highest imported number, even if the file counter is lower', () => {
  const b = backup.build(dump(), NOW);
  assert.deepEqual(backup.countersFor(b), { receipt: 3, quote: 0 });
  b.counters.receipt = 1;                                    // stale counter
  b.receipts.push(receipt(9, 'R-0012'));                     // prefix changed at some point
  assert.deepEqual(backup.countersFor(b), { receipt: 12, quote: 0 });
  b.counters.receipt = 40;                                   // numbers burnt after the last receipt
  assert.deepEqual(backup.countersFor(b), { receipt: 40, quote: 0 });
});

test('parse rejects bad files with a clear message', () => {
  const bad = (mutate, re) => {
    let text = mutate;
    if (typeof mutate === 'function') {
      const b = backup.build(dump(), NOW);
      mutate(b);
      text = JSON.stringify(b);
    }
    assert.throws(() => backup.parse(text), re);
  };
  bad('{not json', /not valid JSON/);
  bad('', /not valid JSON/);
  bad('[]', /not a Toucan Bill backup/);
  bad((b) => { b.app = 'Other'; }, /not a Toucan Bill backup/);
  bad((b) => { b.schemaVersion = 99; }, /different version/);
  bad((b) => { delete b.schemaVersion; }, /different version/);
  bad((b) => { delete b.receipts; }, /receipts list is missing/);
  bad((b) => { b.receipts[1].number = 'INV-0001'; }, /share number INV-0001/);
  bad((b) => { b.receipts[0].totalCents = 1.13; }, /damaged amount/);
  bad((b) => { b.receipts[0].id = 'x'; }, /no valid id/);
  bad((b) => { b.products[0].priceCents = '25'; }, /Product 1 is damaged/);
  bad((b) => { b.settings.gstRateBp = 12.5; }, /GST rate/);
  bad((b) => { b.settings.autoSaveContacts = 'yes'; }, /Auto-save/);
  bad((b) => { b.settings.logo = { dataUrl: 'javascript:alert(1)' }; }, /logo/);
  bad((b) => { b.counters.receipt = -1; }, /counters are damaged/);
  bad((b) => { delete b.counters; }, /counters are missing/);
});

function quoteDoc(id, number, extra = {}) {
  return { ...receipt(id, number), type: 'quote', validUntil: '2026-12-04', notes: '50% deposit', ...extra };
}

test('v2 round trip keeps quotes and the quote counter; summary counts quotes', () => {
  const d = dump();
  d.settings.counter_quote = 3;
  d.quotes = [quoteDoc(1, 'QT-0001'), quoteDoc(2, 'QT-0002', { cancelledAt: NOW.toISOString() }),
    quoteDoc(3, 'QT-0003', { convertedAt: NOW.toISOString(), receiptId: 3, receiptNumber: 'INV-0003' })];
  const b = backup.parse(JSON.stringify(backup.build(d, NOW)));
  assert.equal(b.schemaVersion, 2);
  assert.deepEqual(b.quotes, d.quotes);
  assert.deepEqual(backup.countersFor(b), { receipt: 3, quote: 3 });
  assert.equal(backup.summary(b), '3 receipts, 3 quotes, 1 product, 1 customer, exported 2026-11-20');
});

test('an old Phase 3 (schemaVersion 1) backup without quotes imports: empty quotes, quote counter 0', () => {
  const old = backup.build(dump(), NOW);
  old.schemaVersion = 1;
  delete old.quotes;
  delete old.counters.quote;
  const b = backup.parse(JSON.stringify(old));
  assert.deepEqual(b.quotes, []);
  assert.deepEqual(backup.countersFor(b), { receipt: 3, quote: 0 });
  assert.equal(backup.summary(b), '3 receipts, 1 product, 1 customer, exported 2026-11-20');
});

test('v2 requires the quotes list and checks quote dates and numbers', () => {
  const b = backup.build(dump(), NOW);
  delete b.quotes;
  assert.throws(() => backup.parse(JSON.stringify(b)), /quotes list is missing/);
  const c = backup.build({ ...dump(), quotes: [quoteDoc(1, 'QT-0001', { validUntil: '4/12/2026' })] }, NOW);
  assert.throws(() => backup.parse(JSON.stringify(c)), /valid-until/);
  const dup = backup.build({ ...dump(), quotes: [quoteDoc(1, 'QT-0001'), quoteDoc(2, 'QT-0001')] }, NOW);
  assert.throws(() => backup.parse(JSON.stringify(dup)), /share number QT-0001/);
});
