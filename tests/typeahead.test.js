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

test('customers match by phone digits when the query looks like a phone number', () => {
  const customers = [
    { name: 'Ana Gomez', phone: '622-1234' },
    { name: 'Bob 622 Ltd', phone: '' },
    { name: 'Carlos', phone: '+501 610 5555' },
  ];
  const opts = { text: (c) => c.name, digits: (c) => c.phone };
  assert.deepEqual(names(t.match(customers, '6221', opts)), ['Ana Gomez']);
  assert.deepEqual(names(t.match(customers, '610 55', opts)), ['Carlos']);
  // Name matches rank ahead of phone matches.
  assert.deepEqual(names(t.match(customers, '622', opts)), ['Bob 622 Ltd', 'Ana Gomez']);
  // Fewer than 3 digits never matches phones.
  assert.deepEqual(names(t.match(customers, '61', opts)), []);
});
