// Builds seed.json: a deterministic Toucan Bill backup file (schema 2) for "Glow Nails Belmopan",
// a made-up salon. Records are built with the app's own pure modules (receipt.buildReceipt,
// quote.buildQuote, money.calcTotals), so every stored line value and total is exactly what the app
// would save. Run: node make-seed.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const money = require('../js/money.js');
const receipt = require('../js/receipt.js');
const quote = require('../js/quote.js');
const backup = require('../js/backup.js');

// ---- Deterministic randomness ----
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = Number(process.env.SEED) || 15; // picked by seed-search.js for a steady weekly rise
const rnd = mulberry32(SEED);
const pick = (weighted) => {
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  let x = rnd() * total;
  for (const [v, w] of weighted) { if ((x -= w) < 0) return v; }
  return weighted[weighted.length - 1][0];
};
const randInt = (a, b) => a + Math.floor(rnd() * (b - a + 1));

// Belize is UTC-6 all year.
const at = (day, hh, mm) => new Date(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-06:00`);
const dayStr = (d) => new Date(d.getTime() - 6 * 3600e3).toISOString().slice(0, 10);

// ---- Business ----
const logoPng = fs.readFileSync(path.join(__dirname, 'assets', 'glow-nails-logo.png'));
const business = {
  name: 'Glow Nails Belmopan',
  address: 'Market Square Plaza, Unit 4\nBelmopan, Cayo District, Belize',
  phone: '501-600-0000',
  email: 'hello@glownails.example',
  gstTin: '000123456',
};
const settings = {
  business,
  logo: { dataUrl: 'data:image/png;base64,' + logoPng.toString('base64'), format: 'PNG', width: 400, height: 400 },
  receiptFooter: 'Thank you for glowing with us! Book your next visit on WhatsApp.',
  pageSize: 'letter',
  gstRateBp: 1250,
  receiptPrefix: 'INV-',
  quotePrefix: 'QT-',
  numberPadding: 4,
  autoSaveContacts: true,
};

// ---- Products (prices GST-exclusive, in cents) ----
const created = '2026-09-20T15:00:00.000Z';
const productList = [
  { name: 'Gel manicure', unit: '', priceCents: 4000, zeroRated: false },
  { name: 'Pedicure', unit: '', priceCents: 3500, zeroRated: false },
  { name: 'Acrylic full set', unit: '', priceCents: 6500, zeroRated: false },
  { name: 'Spa pedicure', unit: '', priceCents: 5000, zeroRated: false },
  { name: 'Gel removal', unit: '', priceCents: 1500, zeroRated: false },
  { name: 'Polish change', unit: '', priceCents: 1500, zeroRated: false },
  { name: 'Nail art', unit: 'nail', priceCents: 500, zeroRated: false },
  { name: 'Acrylic fill', unit: '', priceCents: 4500, zeroRated: false },
  { name: 'Cuticle oil (retail)', unit: 'bottle', priceCents: 1800, zeroRated: false },
  { name: 'Gift voucher', unit: 'voucher', priceCents: 5000, zeroRated: true },
];
const products = productList.map((p, i) => ({ id: i + 1, ...p, createdAt: created, updatedAt: created }));
const P = Object.fromEntries(products.map((p) => [p.name, p]));

// ---- Customers (fake 501 numbers in the 600 range) ----
const customerList = [
  { name: 'Maria Gonzalez', phone: '600-1201', email: '', address: '', tin: '' },
  { name: 'Maria Chen', phone: '600-1202', email: 'maria.chen@example.com', address: '', tin: '' },
  { name: 'Rosa Maria Chi', phone: '600-1203', email: '', address: '', tin: '' },
  { name: 'Shanice Young', phone: '600-1204', email: '', address: '', tin: '' },
  { name: 'Andrea Cal', phone: '600-1205', email: '', address: '', tin: '' },
  { name: 'Keisha Flowers', phone: '600-1206', email: 'keisha.f@example.com', address: '', tin: '' },
  { name: 'Gabriela Tun', phone: '600-1207', email: '', address: '', tin: '' },
  { name: 'Cayo Bridal Boutique', phone: '600-1208', email: 'events@cayobridal.example',
    address: '18 Constitution Drive\nBelmopan, Cayo District', tin: '000987654' },
];
const customers = customerList.map((c, i) => ({ id: i + 1, ...c, createdAt: created, updatedAt: created }));
const C = Object.fromEntries(customers.map((c) => [c.name, c]));
const snap = (c) => (c ? { name: c.name, phone: c.phone, tin: c.tin, address: c.address } : { name: '', phone: '', tin: '', address: '' });

const line = (name, qty = 1) => ({ description: P[name].name, qtyMilli: qty * 1000, unitCents: P[name].priceCents, zeroRated: P[name].zeroRated });

// ---- Visits ----
function visitLines(progress) {
  const kind = pick([
    ['gel', 18], ['gelArt', 14], ['maniPedi', 12], ['acrylic', 8 + 10 * progress], ['fill', 8 + 6 * progress],
    ['spa', 8 + 4 * progress], ['pedi', 12], ['removalGel', 8], ['polish', 8],
  ]);
  const lines = {
    gel: () => [line('Gel manicure')],
    gelArt: () => [line('Gel manicure'), line('Nail art', randInt(2, 10))],
    maniPedi: () => [line('Gel manicure'), line('Pedicure')],
    acrylic: () => rnd() < 0.5 ? [line('Acrylic full set'), line('Nail art', randInt(2, 6))] : [line('Acrylic full set')],
    fill: () => [line('Acrylic fill')],
    spa: () => [line('Spa pedicure')],
    pedi: () => [line('Pedicure')],
    removalGel: () => [line('Gel removal'), line('Gel manicure')],
    polish: () => [line('Polish change')],
  }[kind]();
  if (rnd() < 0.1) lines.push(line('Cuticle oil (retail)'));
  if (rnd() < 0.04) lines.push(line('Gift voucher'));
  return lines;
}

const customerWeights = [
  ['Maria Gonzalez', 1.6], ['Maria Chen', 1.2], ['Rosa Maria Chi', 0.8], ['Shanice Young', 2], ['Andrea Cal', 1.5],
  ['Keisha Flowers', 2], ['Gabriela Tun', 1.5], [null, 3.2], // null = walk-in (blank customer)
];
const payWeights = [['cash', 5], ['card', 3], ['transfer', 2]];

const receipts = [];
function addReceipt(date, cust, lines, paymentMethod, extra = {}) {
  const r = receipt.buildReceipt({ customer: snap(cust), paymentMethod, lines }, settings, date);
  receipts.push({ ...r, ...extra });
  return receipts[receipts.length - 1];
}

// 8 weeks: Wed 23 Sep to Tue 17 Nov 2026, then the morning of Wed 18 Nov (the frozen "today").
const START = at('2026-09-23', 12, 0);
const DAYS = 56;
for (let d = 0; d < DAYS; d++) {
  const date = new Date(START.getTime() + d * 86400e3);
  const day = dayStr(date);
  const weekday = new Date(day + 'T12:00:00Z').getUTCDay(); // 0 Sun ... 6 Sat
  const progress = d / (DAYS - 1);
  let count = 2 + (rnd() < 0.2 + 0.5 * progress ? 1 : 0) + (rnd() < 0.05 + 0.35 * progress ? 1 : 0);
  if (weekday === 5 || weekday === 6) count = Math.min(4, count + 1);
  if (weekday === 0) count = 2;
  const minutes = [];
  for (let i = 0; i < count; i++) minutes.push(randInt(9 * 60, 17 * 60 + 30));
  minutes.sort((a, b) => a - b);
  for (const m of minutes) {
    const name = pick(customerWeights);
    addReceipt(at(day, Math.floor(m / 60), m % 60), name ? C[name] : null, visitLines(progress), pick(payWeights));
  }
}
// A normal morning yesterday, so the Today tile compares with something (keeps the % believable).
addReceipt(at('2026-11-17', 9, 5), C['Rosa Maria Chi'], [line('Spa pedicure')], 'card');
addReceipt(at('2026-11-17', 9, 40), null, [line('Gel manicure')], 'cash');
addReceipt(at('2026-11-17', 10, 20), C['Andrea Cal'], [line('Acrylic full set'), line('Nail art', 6)], 'transfer');
addReceipt(at('2026-11-17', 10, 35), C['Shanice Young'], [line('Gel manicure'), line('Pedicure')], 'cash');
// Early last week was quiet in the random data; a few more mornings keep "This week" believable.
addReceipt(at('2026-11-09', 9, 30), C['Gabriela Tun'], [line('Acrylic full set'), line('Nail art', 6)], 'card');
addReceipt(at('2026-11-09', 10, 15), null, [line('Spa pedicure')], 'cash');
addReceipt(at('2026-11-10', 9, 20), C['Maria Gonzalez'], [line('Gel manicure'), line('Pedicure')], 'cash');
addReceipt(at('2026-11-11', 9, 50), null, [line('Acrylic fill')], 'transfer');
// Today so far (before 10:41 AM): a walk-in and a regular.
addReceipt(at('2026-11-18', 9, 14), null, [line('Polish change')], 'cash');
addReceipt(at('2026-11-18', 10, 2), C['Keisha Flowers'], [line('Acrylic fill'), line('Nail art', 4)], 'transfer');

// ---- Quotes (dated, numbered in date order) ----
const quoteSpecs = [
  { day: at('2026-10-06', 11, 20), cust: 'Shanice Young', lines: [line('Acrylic full set'), line('Nail art', 10)],
    validUntil: '2026-10-20', notes: 'Price for full set with art on all 10 nails.', cancelledAt: at('2026-10-12', 16, 5) },
  { day: at('2026-10-12', 15, 40), cust: 'Cayo Bridal Boutique', lines: [line('Gel manicure', 6), line('Spa pedicure', 6)],
    validUntil: '2026-10-26', notes: 'Bridal party of 6. 50% deposit to book the date.',
    convert: { at: at('2026-10-24', 14, 30), pay: 'transfer' } },
  { day: at('2026-10-29', 10, 15), cust: 'Andrea Cal', lines: [line('Acrylic full set'), line('Nail art', 6), line('Cuticle oil (retail)')],
    validUntil: '2026-11-12', notes: '' },
  { day: at('2026-11-04', 13, 0), cust: 'Gabriela Tun', lines: [line('Spa pedicure'), line('Gel manicure')],
    validUntil: '2026-11-18', notes: 'Birthday treat package.', convert: { at: at('2026-11-06', 11, 15), pay: 'card' } },
  { day: at('2026-11-13', 16, 10), cust: 'Maria Chen', lines: [line('Spa pedicure', 2), line('Gel manicure', 2)],
    validUntil: '2026-11-27', notes: 'Mother and daughter, same appointment.' },
  { day: at('2026-11-17', 12, 30), cust: 'Keisha Flowers', lines: [line('Acrylic full set'), line('Nail art', 4), line('Gift voucher')],
    validUntil: '2026-12-01', notes: 'Includes a $50 gift voucher for her sister.' },
];
const quotes = [];
quoteSpecs.forEach((s, i) => {
  const q = quote.buildQuote({ customer: snap(C[s.cust]), lines: s.lines, validUntil: s.validUntil, notes: s.notes }, settings, s.day);
  q.id = i + 1;
  q.number = 'QT-' + String(i + 1).padStart(4, '0');
  if (s.cancelledAt) q.cancelledAt = s.cancelledAt.toISOString();
  if (s.convert) {
    const r = addReceipt(s.convert.at, C[s.cust], s.lines, s.convert.pay, { quoteId: q.id, quoteNumber: q.number });
    q._receipt = r;
    q.convertedAt = s.convert.at.toISOString();
  }
  quotes.push(q);
});

// ---- Number receipts in date order ----
receipts.sort((a, b) => a.date.localeCompare(b.date));
receipts.forEach((r, i) => { r.id = i + 1; r.number = 'INV-' + String(i + 1).padStart(4, '0'); });
for (const q of quotes) {
  if (q._receipt) { q.receiptId = q._receipt.id; q.receiptNumber = q._receipt.number; delete q._receipt; }
}

// ---- Two voided receipts (not quote conversions) ----
function voidFirstOn(day, reason, mins) {
  const r = receipts.find((x) => dayStr(new Date(x.date)) === day && !x.quoteId && !x.voided);
  r.voided = true;
  r.voidedAt = new Date(new Date(r.date).getTime() + mins * 60e3).toISOString();
  r.voidReason = reason;
  return r;
}
const v1 = voidFirstOn('2026-10-14', 'Wrong service entered', 12);
const v2 = voidFirstOn('2026-11-16', 'Customer was charged twice', 25);

// ---- Checks: every stored total matches the app's own recalculation ----
for (const r of [...receipts, ...quotes]) {
  const t = receipt.withTotals(r);
  for (const k of ['subtotalCents', 'gstCents', 'totalCents', 'taxableCents', 'zeroRatedCents']) {
    if (t[k] !== r[k]) throw new Error(`${r.number} ${k} mismatch`);
  }
  // Independent hand maths: GST per line = round half away from zero of net * 12.5%.
  let sub = 0, gst = 0;
  for (const l of r.lines) {
    const net = Math.round((l.qtyMilli * l.unitCents) / 1000);
    const g = l.zeroRated ? 0 : Math.floor((net * 1250 + 5000) / 10000);
    if (net !== l.netCents || g !== l.gstCents) throw new Error(`${r.number} line maths mismatch`);
    sub += net; gst += g;
  }
  if (sub !== r.subtotalCents || gst !== r.gstCents || sub + gst !== r.totalCents) throw new Error(`${r.number} totals mismatch`);
}

const data = {
  app: 'ResiboBZ', // the backup marker the app writes (kept from the old name on purpose)
  schemaVersion: 2,
  exportedAt: at('2026-11-17', 18, 0).toISOString(),
  settings,
  counters: { receipt: receipts.length, quote: quotes.length },
  products, customers, receipts, quotes,
};
const text = JSON.stringify(data, null, 2);
backup.parse(text); // the app's own validator must accept it
if (!process.env.DRY) fs.writeFileSync(path.join(__dirname, 'seed.json'), text);

// ---- Report ----
const counted = receipts.filter((r) => !r.voided);
const sum = (list, k) => list.reduce((s, r) => s + r[k], 0);
const byWeek = {};
for (const r of counted) { const w = Math.floor((new Date(r.date) - START) / (7 * 86400e3)); byWeek[w] = (byWeek[w] || 0) + r.totalCents; }
const hero = receipt.buildReceipt({ customer: snap(C['Maria Gonzalez']), paymentMethod: 'card',
  lines: [line('Gel manicure'), line('Pedicure'), line('Nail art', 4)] }, settings, at('2026-11-18', 10, 41));
console.log({
  receipts: receipts.length, counted: counted.length, walkIns: receipts.filter((r) => !r.customer.name).length,
  voided: [v1.number, v2.number], mariaReceipts: receipts.filter((r) => /maria/i.test(r.customer.name)).length,
  quotes: quotes.map((q) => q.number + ' ' + quote.status(q, at('2026-11-18', 10, 41))),
  totalSales: money.formatCents(sum(counted, 'totalCents')),
  weeklyTotals: Object.values(byWeek).map((c) => money.formatCents(c)),
  hero: { number: 'INV-' + String(receipts.length + 1).padStart(4, '0'), sub: money.formatCents(hero.subtotalCents),
    gst: money.formatCents(hero.gstCents), total: money.formatCents(hero.totalCents), lines: hero.lines.map((l) => l.description + ' ' + money.formatCents(l.netCents) + ' gst ' + money.formatCents(l.gstCents)) },
  convertOnCamera: 'QT-0005 -> INV-' + String(receipts.length + 2).padStart(4, '0'),
});
