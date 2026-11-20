// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const demo = require('../js/demo.js');

const emptyBusiness = { name: '', address: '', phone: '', email: '', gstTin: '' };

test('sample data: 6 products (standard and zero-rated) and 4 customers incl. one with a TIN', () => {
  assert.equal(demo.PRODUCTS.length, 6);
  assert.ok(demo.PRODUCTS.some((p) => p.zeroRated) && demo.PRODUCTS.some((p) => !p.zeroRated));
  assert.deepEqual(demo.PRODUCTS.find((p) => p.name === 'Rice 25lb').zeroRated, true);
  assert.equal(demo.PRODUCTS.find((p) => p.name === 'Pizza').priceCents, 500);
  for (const p of demo.PRODUCTS) assert.ok(Number.isInteger(p.priceCents), p.name + ' price is integer cents');
  assert.equal(demo.CUSTOMERS.length, 4);
  assert.deepEqual(demo.CUSTOMERS.slice(0, 3).map((c) => [c.name, c.phone]),
    [['brandon Morgan', '615-0551'], ['Eldon', '610-0551'], ['Kimley Jone', '622-9887']]);
  assert.ok(demo.CUSTOMERS.some((c) => c.tin));
  assert.equal(demo.BUSINESS.name, 'Demo Store');
  assert.match(demo.BUSINESS.address, /Belmopan/);
  assert.equal(demo.GST_RATE_BP, 1250);
});

test('empty install: adds everything and fills the business', () => {
  const p = demo.plan({ settings: { business: emptyBusiness }, products: [], customers: [] });
  assert.deepEqual(p.business, demo.BUSINESS);
  assert.equal(p.gstRateBp, 1250);
  assert.equal(p.products.length, 6);
  assert.equal(p.customers.length, 4);
  assert.equal(p.skippedProducts + p.skippedCustomers, 0);
});

test('existing products/customers are skipped by name, ignoring case and spaces', () => {
  const p = demo.plan({
    settings: { business: emptyBusiness, gstRateBp: 1250 },
    products: [{ name: ' rice 25LB ', priceCents: 1 }],
    customers: [{ name: 'Brandon morgan', phone: '999' }, { name: 'Someone else' }],
  });
  assert.equal(p.products.length, 5);
  assert.ok(!p.products.some((x) => x.name === 'Rice 25lb'));
  assert.equal(p.skippedProducts, 1);
  assert.equal(p.customers.length, 3);
  assert.ok(!p.customers.some((x) => x.name === 'brandon Morgan'));
  assert.equal(p.skippedCustomers, 1);
});

test('business: only empty fields are filled; existing GST rate is kept', () => {
  const p = demo.plan({
    settings: { business: { ...emptyBusiness, name: 'My Shop', gstTin: '  ' }, gstRateBp: 1000 },
    products: [], customers: [],
  });
  assert.equal(p.business.name, 'My Shop');
  assert.equal(p.business.gstTin, demo.BUSINESS.gstTin); // blank counts as empty
  assert.equal(p.business.address, demo.BUSINESS.address);
  assert.equal(p.gstRateBp, null);
});

test('everything already there: nothing to change', () => {
  const p = demo.plan({
    settings: { business: { name: 'A', address: 'B', phone: 'C', email: 'D', gstTin: 'E' }, gstRateBp: 1250 },
    products: demo.PRODUCTS, customers: demo.CUSTOMERS,
  });
  assert.equal(p.business, null);
  assert.equal(p.gstRateBp, null);
  assert.deepEqual(p.products, []);
  assert.deepEqual(p.customers, []);
});

test('plan returns copies, so callers cannot mutate the sample data', () => {
  const p = demo.plan({ settings: { business: emptyBusiness }, products: [], customers: [] });
  p.products[0].name = 'changed';
  assert.equal(demo.PRODUCTS[0].name, 'Rice 25lb');
});
