// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../js/typeahead.js');

const products = [
  { name: 'Coca-Cola 12oz' },
  { name: 'Cola Champagne' },
  { name: 'Jalapeño chips' },
  { name: 'Rice 5lb' },
  { name: 'White rice 25lb' },
].sort((a, b) => a.name.localeCompare(b.name));
const names = (xs) => xs.map((x) => x.name);
const byName = { text: (p) => p.name };

test('norm lowercases, trims and strips accents', () => {
  assert.equal(t.norm('  José PÉREZ '), 'jose perez');
  assert.equal(t.norm(null), '');
});

test('score: prefix < word prefix < contains < none', () => {
  assert.equal(t.score('rice 5lb', 'ri'), 0);
  assert.equal(t.score('white rice 25lb', 'ri'), 1);
  assert.equal(t.score('coca-cola 12oz', 'ola'), 2);
  assert.equal(t.score('coca-cola 12oz', 'cola'), 1); // word after a hyphen
  assert.equal(t.score('rice', 'beans'), -1);
});

test('empty query returns the first items in the given order', () => {
  assert.deepEqual(names(t.match(products, '  ', { ...byName, limit: 2 })), ['Coca-Cola 12oz', 'Cola Champagne']);
});

test('ranks prefix matches before word and substring matches', () => {
  assert.deepEqual(names(t.match(products, 'cola', byName)), ['Cola Champagne', 'Coca-Cola 12oz']);
  assert.deepEqual(names(t.match(products, 'rice', byName)), ['Rice 5lb', 'White rice 25lb']);
});

test('matching ignores case and accents', () => {
  assert.deepEqual(names(t.match(products, 'JALAPENO', byName)), ['Jalapeño chips']);
});

test('respects limit and returns nothing for no match', () => {
  assert.equal(t.match(products, 'o', { ...byName, limit: 1 }).length, 1);
  assert.deepEqual(t.match(products, 'xyz', byName), []);
});

const customers = [
  { name: 'Ana Gomez', phone: '622-1234' },
  { name: 'Bob 622 Ltd', phone: '' },
  { name: 'Carlos', phone: '+501 610 5555' },
  { name: 'José Pérez', phone: '(501) 633-6221' },
  { name: 'José Pérez', phone: '501 600 7777' },
];
const byCustomerName = { text: (c) => c.name };
const byPhone = { phone: (c) => c.phone };

test('name field: matches customer names only, never phone numbers', () => {
  assert.deepEqual(names(t.match(customers, '6221', byCustomerName)), []);
  assert.deepEqual(names(t.match(customers, '610 55', byCustomerName)), []);
  // Digits that are part of a name still match that name.
  assert.deepEqual(names(t.match(customers, '622', byCustomerName)), ['Bob 622 Ltd']);
});

test('name field: case/accent-insensitive with the usual ranking', () => {
  assert.deepEqual(names(t.match(customers, 'JOSE', byCustomerName)), ['José Pérez', 'José Pérez']);
  assert.deepEqual(names(t.match(customers, 'perez', byCustomerName)), ['José Pérez', 'José Pérez']);
  assert.deepEqual(names(t.match(customers, 'go', byCustomerName)), ['Ana Gomez']);
});

test('phoneDigits keeps digits only and drops a leading +501 / 501', () => {
  assert.equal(t.phoneDigits('+501 (622) 12-34'), '6221234');
  assert.equal(t.phoneDigits('501-622-1234'), '6221234');
  assert.equal(t.phoneDigits('622 1234'), '6221234');
  assert.equal(t.phoneDigits(null), '');
});

test('phone field: matches phone digits only, ignoring formatting and 501', () => {
  assert.deepEqual(names(t.matchPhone(customers, '622-12', byPhone)), ['Ana Gomez']);
  assert.deepEqual(names(t.matchPhone(customers, '(610) 55', byPhone)), ['Carlos']);
  assert.deepEqual(names(t.matchPhone(customers, '+501 610', byPhone)), ['Carlos']);
  assert.deepEqual(names(t.matchPhone(customers, '501610', byPhone)), ['Carlos']);
  // Names are not searched from the phone field.
  assert.deepEqual(names(t.matchPhone(customers, 'Ana', byPhone)), []);
});

test('phone field: starts-with ranks before contains', () => {
  // Ana is 6221234 (starts with 6221), José is 6336221 (contains it).
  assert.deepEqual(names(t.matchPhone(customers, '6221', byPhone)), ['Ana Gomez', 'José Pérez']);
  const list = [{ name: 'A', phone: '600-6331' }, { name: 'B', phone: '633-0000' }];
  assert.deepEqual(names(t.matchPhone(list, '633', byPhone)), ['B', 'A']);
});

test('phone field: no suggestions before 3 digits (a leading 501 does not count)', () => {
  assert.deepEqual(t.matchPhone(customers, '61', byPhone), []);
  assert.deepEqual(t.matchPhone(customers, '+501 61', byPhone), []);
  assert.deepEqual(t.matchPhone(customers, '501', byPhone), []);
  assert.deepEqual(t.matchPhone(customers, '', byPhone), []);
  assert.equal(t.matchPhone(customers, '600', byPhone).length, 1);
});

test('no match returns nothing, so the typed walk-in text is kept', () => {
  assert.deepEqual(t.match(customers, 'Zed', byCustomerName), []);
  assert.deepEqual(t.matchPhone(customers, '999', byPhone), []);
});
