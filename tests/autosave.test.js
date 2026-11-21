// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const autosave = require('../js/autosave.js');

const NOW = new Date('2026-11-20T12:00:00.000Z');
const line = (description, unitCents, zeroRated = false) => ({ description, qtyMilli: 1000, unitCents, zeroRated });
const doc = (customer, lines = []) => ({ customer: { name: '', phone: '', tin: '', address: '', ...customer }, lines });
const plan = (d, stored = {}) => autosave.plan(d, stored, NOW);

test('1. new customer and 2 new items: 1 customer and 2 products with prices and zero-rated flags', () => {
  const p = plan(doc({ name: ' Maria Chan ', phone: '615-1234', tin: '000111', address: 'Belmopan' },
    [line('Chicken plate', 1200), line('Rice 25lb', 2750, true)]));
  assert.equal(p.customers.length, 1);
  const c = p.customers[0];
  assert.equal(c.id, undefined);
  assert.deepEqual([c.name, c.phone, c.email, c.tin, c.address], ['Maria Chan', '615-1234', '', '000111', 'Belmopan']);
  assert.equal(c.createdAt, NOW.toISOString());
  assert.deepEqual(p.products.map((x) => [x.name, x.priceCents, x.zeroRated]),
    [['Chicken plate', 1200, false], ['Rice 25lb', 2750, true]]);
  assert.ok(p.products.every((x) => x.id === undefined && x.unit === ''));
  assert.deepEqual(p.priceChanges, []);
});

test('2. phone typed as "615-1234", "6151234" or "+501 615 1234" matches the same customer', () => {
  const customers = [{ id: 7, name: 'Maria Chan', phone: '615-1234', email: '', tin: '', address: '' }];
  for (const phone of ['615-1234', '6151234', '+501 615 1234', '501-615-1234']) {
    const p = plan(doc({ name: 'Maria', phone }), { customers });
    assert.deepEqual(p.customers, [], phone + ' made no new customer and changed nothing');
  }
});

test('phone match wins over a different customer with the same name', () => {
  const customers = [
    { id: 1, name: 'John', phone: '600-0000', tin: '' },
    { id: 2, name: 'Johnny B', phone: '615-1234', tin: '' },
  ];
  const p = plan(doc({ name: 'John', phone: '6151234', tin: 'T9' }), { customers });
  assert.equal(p.customers.length, 1);
  assert.equal(p.customers[0].id, 2);
  assert.equal(p.customers[0].name, 'Johnny B');
  assert.equal(p.customers[0].tin, 'T9');
});

test('3. existing customer with no phone gets the phone; the name is not changed', () => {
  const customers = [{ id: 3, name: 'Maria Chan', phone: '', email: 'm@x.bz', tin: 'OLD', address: '', createdAt: 'then' }];
  const p = plan(doc({ name: '  maria CHAN ', phone: '615-1234', tin: 'NEW', address: 'Belmopan' }), { customers });
  assert.equal(p.customers.length, 1);
  const c = p.customers[0];
  assert.equal(c.id, 3);
  assert.equal(c.name, 'Maria Chan');
  assert.equal(c.phone, '615-1234');
  assert.equal(c.tin, 'OLD', 'existing TIN kept');
  assert.equal(c.email, 'm@x.bz');
  assert.equal(c.address, 'Belmopan');
  assert.equal(c.createdAt, 'then');
  assert.equal(c.updatedAt, NOW.toISOString());
});

test('matching customer with nothing new to add is not rewritten', () => {
  const customers = [{ id: 3, name: 'Maria', phone: '615-1234', tin: '', address: '' }];
  assert.deepEqual(plan(doc({ name: 'MARIA' }), { customers }).customers, []);
});

test('phone that matches nobody falls back to the name', () => {
  const customers = [{ id: 4, name: 'Maria', phone: '622-0000' }];
  const p = plan(doc({ name: 'maria', phone: '615-1234' }), { customers });
  assert.deepEqual(p.customers, [], 'existing phone is never overwritten, and no duplicate is made');
});

test('phone only, no match: saved with the phone as its name', () => {
  const p = plan(doc({ phone: '615-1234' }));
  assert.equal(p.customers.length, 1);
  assert.equal(p.customers[0].name, '615-1234');
  assert.equal(p.customers[0].phone, '615-1234');
});

test('4. existing product at a new price: price change reported, product not rewritten; same price: nothing', () => {
  const products = [
    { id: 10, name: 'Chicken plate', priceCents: 1200, zeroRated: false },
    { id: 11, name: 'Soda', priceCents: 250, zeroRated: false },
  ];
  const p = plan(doc({}, [line(' chicken PLATE ', 1400), line('Soda', 250)]), { products });
  assert.deepEqual(p.products, []);
  assert.deepEqual(p.priceChanges, [{ id: 10, name: 'Chicken plate', oldCents: 1200, newCents: 1400 }]);
  assert.equal(autosave.priceMessage(p.priceChanges, (c) => '$' + (c / 100).toFixed(2)),
    'Update saved prices?\nChicken plate: $12.00 → $14.00');
});

test('5. walk-in receipt (no name, no phone) creates no customer', () => {
  const p = plan(doc({ name: '  ', phone: '', tin: 'X', address: 'Y' }, [line('Soda', 250)]));
  assert.deepEqual(p.customers, []);
  assert.equal(p.products.length, 1);
});

test('blank lines and $0.00 lines are skipped; a repeated name uses its first line', () => {
  const p = plan(doc({}, [line('', 500), line('Free sample', 0), line('Soda', 250), line('SODA ', 300)]));
  assert.deepEqual(p.products.map((x) => [x.name, x.priceCents]), [['Soda', 250]]);
  assert.deepEqual(p.priceChanges, []);
});

// ---- run() / applyPrices() against a fake db ----

function fakeDb({ settings = {}, customers = [], products = [] } = {}) {
  const stores = { customers: [...customers], products: [...products] };
  let nextId = 100;
  return {
    stores,
    writes: 0,
    async getSetting(k) { return k in settings ? settings[k] : (k === 'autoSaveContacts' ? true : undefined); },
    async getAll(s) { return stores[s].map((r) => ({ ...r })); },
    async get(s, id) { const r = stores[s].find((x) => x.id === id); return r && { ...r }; },
    async putMany(by) {
      this.writes++;
      for (const [s, recs] of Object.entries(by)) {
        for (const r of recs || []) {
          const i = r.id == null ? -1 : stores[s].findIndex((x) => x.id === r.id);
          if (i >= 0) stores[s][i] = { ...r };
          else stores[s].push({ ...r, id: r.id ?? nextId++ });
        }
      }
    },
  };
}

test('run(): writes the new customer and products through db.putMany', async () => {
  globalThis.db = fakeDb();
  const r = await autosave.run(doc({ name: 'Maria', phone: '6151234' }, [line('Chicken plate', 1200), line('Rice', 2750, true)]), NOW);
  assert.equal(db.stores.customers.length, 1);
  assert.equal(db.stores.products.length, 2);
  assert.equal(db.writes, 1, 'one transaction');
  assert.deepEqual(r.priceChanges, []);
});

test('6. toggle OFF: nothing is auto-saved', async () => {
  globalThis.db = fakeDb({ settings: { autoSaveContacts: false }, products: [{ id: 1, name: 'Soda', priceCents: 250 }] });
  const r = await autosave.run(doc({ name: 'Maria', phone: '6151234' }, [line('Chicken plate', 1200), line('Soda', 300)]), NOW);
  assert.equal(r.skipped, true);
  assert.deepEqual(r.priceChanges, [], 'no price question either');
  assert.equal(db.writes, 0);
  assert.equal(db.stores.customers.length, 0);
  assert.equal(db.stores.products.length, 1);
});

test('4b. "Keep" leaves the price; applyPrices ("Update") changes it', async () => {
  globalThis.db = fakeDb({ products: [{ id: 1, name: 'Chicken plate', priceCents: 1200, zeroRated: false, unit: 'plate' }] });
  const r = await autosave.run(doc({}, [line('Chicken plate', 1400)]), NOW);
  assert.equal(r.priceChanges.length, 1);
  assert.equal(db.stores.products[0].priceCents, 1200, 'unchanged until the user chooses (Keep = do nothing)');
  await autosave.applyPrices(r.priceChanges, NOW);
  assert.equal(db.stores.products[0].priceCents, 1400);
  assert.equal(db.stores.products[0].unit, 'plate', 'other fields kept');
  assert.equal(db.stores.products[0].updatedAt, NOW.toISOString());
});

test.after(() => { delete globalThis.db; });
