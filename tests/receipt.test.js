// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../js/receipt.js');

const settings = {
  gstRateBp: 1250,
  business: { name: 'Corner Shop', address: '1 Main St', phone: '6221234', email: '', gstTin: '000123456' },
  receiptFooter: 'Thanks!',
};

function sample() {
  return r.buildReceipt({
    customer: { name: '  Ana  ', phone: '' },
    paymentMethod: 'cash',
    lines: [
      { description: ' Rice 5lb ', qtyMilli: 2000, unitCents: 999, zeroRated: true },
      { description: 'Soda', qtyMilli: 3000, unitCents: 250, zeroRated: false },
    ],
  }, settings, new Date('2026-11-19T15:00:00Z'));
}

test('buildReceipt computes and snapshots everything', () => {
  const rec = sample();
  assert.equal(rec.customer.name, 'Ana');
  assert.equal(rec.customer.tin, '');
  assert.equal(rec.customer.address, '');
  assert.equal(rec.lines[0].description, 'Rice 5lb');
  assert.equal(rec.lines[0].netCents, 1998);
  assert.equal(rec.lines[0].gstCents, 0);
  assert.equal(rec.lines[1].netCents, 750);
  assert.equal(rec.lines[1].gstCents, 94);   // 93.75 -> 94
  assert.equal(rec.subtotalCents, 2748);
  assert.equal(rec.taxableCents, 750);
  assert.equal(rec.zeroRatedCents, 1998);
  assert.equal(rec.gstCents, 94);
  assert.equal(rec.totalCents, 2842);
  assert.equal(rec.gstRateBp, 1250);
  assert.equal(rec.business.gstTin, '000123456');
  assert.notEqual(rec.business, settings.business); // copy, not reference
  assert.equal(rec.footer, 'Thanks!');
});

test('summaryText', () => {
  const rec = { ...sample(), number: 'INV-0007' };
  const text = r.summaryText(rec);
  assert.match(text, /^Corner Shop\nReceipt INV-0007 \(19 Nov 2026\)/);
  assert.match(text, /2 x Rice 5lb: \$19\.98 \(zero-rated\)/);
  assert.match(text, /GST \(12\.5%\): \$0\.94/);
  assert.match(text, /Total: BZD \$28\.42/);
  assert.match(text, /Paid by: Cash/);
});

test('whatsappNumber adds Belize code to 7-digit numbers', () => {
  assert.equal(r.whatsappNumber('622-1234'), '5016221234');
  assert.equal(r.whatsappNumber('+501 622 1234'), '5016221234');
  assert.equal(r.whatsappNumber('00501 6221234'), '5016221234');
  assert.equal(r.whatsappNumber('+1 (305) 555-0100'), '13055550100');
  assert.equal(r.whatsappNumber(''), '');
  assert.equal(r.whatsappNumber('123'), '');
});

test('whatsappUrl encodes text', () => {
  assert.equal(r.whatsappUrl('6221234', 'a b\nc'), 'https://wa.me/5016221234?text=a%20b%0Ac');
  assert.equal(r.whatsappUrl('', 'hi'), 'https://wa.me/?text=hi');
});

test('pdfFileName', () => {
  assert.equal(r.pdfFileName({ number: 'INV-0001' }), 'INV-0001.pdf');
  assert.equal(r.pdfFileName({ number: 'A/B 1' }), 'A_B_1.pdf');
});
