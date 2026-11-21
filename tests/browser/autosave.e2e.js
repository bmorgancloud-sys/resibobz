// Browser test: saving a receipt adds its customer and items to saved Customers/Products
// (js/autosave.js), asks before changing a saved price, and respects the Settings toggle.
//
// Run with: node --test "tests/browser/*.e2e.js"
// Fresh Chrome profile at 360px wide (see harness.js); receipts are saved through the real
// New Receipt form and the results are read back from IndexedDB through db.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./harness.js');

let page, cdp, evaluate, waitFor;
const js = (v) => JSON.stringify(v);

/** Click the first visible button/label whose text is exactly `text` (optionally inside `scope`). */
const click = (text, scope = 'document') => evaluate(`(() => {
  const el = [...${scope}.querySelectorAll('button, a, label.btn')].find((b) => b.textContent.trim() === ${js(text)} && b.offsetParent !== null);
  if (!el) throw new Error('No button ' + ${js(text)});
  el.click();
  return true;
})()`);

/** The n-th (0-based) New Receipt control labelled `label`. */
const control = (label, n = 0) => `[...document.querySelectorAll('.field label')]
  .filter((l) => l.textContent.trim() === ${js(label)})[${n}].control`;

const customers = () => evaluate(`db.getAll('customers')`);
const products = () => evaluate(`db.getAll('products').then((ps) => ps.sort((a, b) => a.id - b.id))`);
const dialogOpen = () => evaluate(`!!document.querySelector('dialog[open]')`);

/**
 * Fill and save a receipt through the New Receipt form.
 * customer: { name, phone, tin }; lines: [[description, price, zeroRated?]]
 */
async function saveReceipt(customer, lines) {
  await evaluate(`location.hash = '#/new'; true`);
  await waitFor(`location.hash === '#/new' && !!document.querySelector('.line-item')`, 'New Receipt');
  await evaluate(`(() => {
    const set = (i, v) => { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); };
    const c = ${js(customer)};
    // Always set every field: the draft survives tab switches, so clear anything left over.
    set(${control('Name')}, c.name || '');
    set(${control('Phone')}, c.phone || '');
    set(${control('TIN')}, c.tin || '');
    const lines = ${js(lines)};
    lines.forEach(([desc, price, zero], n) => {
      if (n > 0) [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '+ Add item').click();
      const card = document.querySelectorAll('.line-item')[n];
      const field = (label) => [...card.querySelectorAll('.field label')].find((l) => l.textContent.trim() === label).control;
      set(field('Description'), desc);  // an exact saved name fills the price, so set price after
      set(field('Unit price ($)'), price);
      const z = card.querySelector('input[type=checkbox]');
      if (z.checked !== !!zero) z.click();
    });
    return true;
  })()`);
  await click('Save receipt');
  await waitFor(`!!document.querySelector('.notice-ok')`, 'saved receipt screen');
}

/** Type like a user (real key input) into the n-th field labelled `label`; return suggestion titles. */
async function suggestions(label, text) {
  await evaluate(`(() => { const i = ${control(label)}; i.focus(); i.select(); return true; })()`);
  for (const ch of text) await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: ch });
  await page.sleep(80);
  return evaluate(`(() => {
    const list = document.getElementById(${control(label)}.getAttribute('aria-controls'));
    return list && !list.hidden ? [...list.querySelectorAll('.typeahead-title')].map((t) => t.textContent) : [];
  })()`);
}

test.before(async () => {
  page = await harness.open('#/new');
  ({ cdp, evaluate, waitFor } = page);
});

test.after(async () => {
  if (page) await page.close();
});

test('1. new customer + 2 new items: 1 customer and 2 products with prices and zero-rated flags', async () => {
  await saveReceipt({ name: 'Maria Chan', phone: '615-1234', tin: '000111' },
    [['Chicken plate', '12.00'], ['Rice 25lb', '27.50', true]]);
  await waitFor(`db.getAll('products').then((p) => p.length === 2)`, 'products saved');
  const cs = await customers();
  assert.equal(cs.length, 1);
  assert.deepEqual([cs[0].name, cs[0].phone, cs[0].tin], ['Maria Chan', '615-1234', '000111']);
  assert.deepEqual((await products()).map((p) => [p.name, p.priceCents, p.zeroRated]),
    [['Chicken plate', 1200, false], ['Rice 25lb', 2750, true]]);
  assert.equal(await dialogOpen(), false, 'no price dialog for new items');
});

test('7. the next receipt\'s type-ahead finds the new customer and products', async () => {
  await evaluate(`location.hash = '#/new'; true`);
  await waitFor(`location.hash === '#/new' && !!document.querySelector('.line-item')`, 'New Receipt');
  assert.deepEqual(await suggestions('Name', 'mar'), ['Maria Chan']);
  assert.deepEqual(await suggestions('Phone', '6151'), ['Maria Chan']);
  assert.deepEqual(await suggestions('Description', 'ric'), ['Rice 25lb']);
  assert.deepEqual(await suggestions('Description', 'chick'), ['Chicken plate']);
});

test('2 + 4. same phone typed differently makes no duplicate; new price asks, Keep keeps, Update updates', async () => {
  await saveReceipt({ name: 'Maria', phone: '+501 615 1234' }, [['chicken plate', '14.00']]);
  await waitFor(`!!document.querySelector('dialog[open]')`, 'price dialog');
  assert.equal(await evaluate(`document.querySelector('dialog[open] p').textContent`),
    'Update saved prices?\nChicken plate: $12.00 → $14.00');
  const fit = await evaluate(`(() => { const r = document.querySelector('dialog[open]').getBoundingClientRect();
    return { left: r.left, right: r.right, scroll: document.documentElement.scrollWidth, inner: innerWidth }; })()`);
  assert.ok(fit.left >= 0 && fit.right <= harness.WIDTH && fit.scroll <= fit.inner && fit.inner === harness.WIDTH,
    'dialog fits the 360px screen: ' + js(fit));
  await click('Keep old prices', `document.querySelector('dialog[open]')`);
  await page.sleep(150);
  assert.equal((await products())[0].priceCents, 1200, 'Keep leaves the price');
  assert.equal((await customers()).length, 1, '"+501 615 1234" matched "615-1234"');

  await saveReceipt({ phone: '6151234' }, [['Chicken plate', '14.00']]);
  await waitFor(`!!document.querySelector('dialog[open]')`, 'price dialog again');
  await click('Update', `document.querySelector('dialog[open]')`);
  await waitFor(`db.get('products', 1).then((p) => p.priceCents === 1400)`, 'Update changes the price');
  const cs = await customers();
  assert.equal(cs.length, 1, '"6151234" matched too');
  assert.equal(cs[0].name, 'Maria Chan', 'name unchanged');
});

test('3. an existing customer with no phone gets the phone; the name is not changed', async () => {
  await evaluate(`db.put('customers', { name: 'Ana Lopez', phone: '', email: '', address: '', tin: '' })`);
  await saveReceipt({ name: 'ana lopez', phone: '622-1111' }, [['Rice 25lb', '27.50', true]]);
  await waitFor(`db.getAll('customers').then((cs) => cs.some((c) => c.phone === '622-1111'))`, 'phone added');
  const cs = await customers();
  assert.equal(cs.length, 2);
  assert.equal(cs.find((c) => c.phone === '622-1111').name, 'Ana Lopez');
  await page.sleep(150);
  assert.equal(await dialogOpen(), false, 'same price: no dialog');
});

test('5. a walk-in receipt creates no customer', async () => {
  await saveReceipt({}, [['Soda', '2.50']]);
  await waitFor(`db.getAll('products').then((p) => p.length === 3)`, 'Soda saved');
  assert.equal((await customers()).length, 2);
});

test('an auto-save failure keeps the receipt and shows a notice', async () => {
  const receiptsBefore = await evaluate(`db.count('receipts')`);
  await evaluate(`window.__putMany = db.putMany; db.putMany = () => Promise.reject(new Error('disk full')); true`);
  try {
    await saveReceipt({ name: 'Fail Case' }, [['Brand new thing', '3.00']]);
    await waitFor(`document.getElementById('toast').textContent === 'Receipt saved, but customer/products were not updated'`, 'failure notice');
  } finally {
    await evaluate(`db.putMany = window.__putMany; true`);
  }
  assert.equal(await evaluate(`db.count('receipts')`), receiptsBefore + 1, 'receipt saved');
  assert.ok(!(await customers()).some((c) => c.name === 'Fail Case'));
});

test('6. toggle OFF in Settings: nothing is auto-saved and no price dialog', async () => {
  await evaluate(`location.hash = '#/settings'; true`);
  await waitFor(`!!document.getElementById('backup')`, 'Settings');
  await evaluate(`(() => {
    const label = [...document.querySelectorAll('.check-label')].find((l) => l.textContent === 'Auto-save new customers & products');
    const box = label.closest('label').querySelector('input');
    if (!box.checked) throw new Error('toggle should default to on');
    box.click();
    return true;
  })()`);
  await click('Save settings');
  await waitFor(`db.getSetting('autoSaveContacts').then((v) => v === false)`, 'setting saved');

  const before = { c: await customers(), p: await products() };
  await saveReceipt({ name: 'Zed Newman', phone: '633-9999' }, [['Widget', '5.00'], ['Chicken plate', '99.00']]);
  await page.sleep(300);
  assert.equal(await dialogOpen(), false);
  assert.deepEqual(await customers(), before.c);
  assert.deepEqual(await products(), before.p);
});
