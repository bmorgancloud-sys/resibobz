// Browser test for customer type-ahead on New Receipt.
//
// Run with: node --test "tests/browser/*.e2e.js"
// (Not picked up by `node --test tests/`: it needs Chrome. No npm needed.)
//
// Opens the app in headless Chrome with a fresh profile at 360px wide (see harness.js),
// seeds real customers into IndexedDB through db.js, then types into the Name and Phone
// fields with real key input and checks the suggestions and where the dropdown sits.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./harness.js');

const WIDTH = harness.WIDTH;
const CUSTOMERS = [
  { name: 'brandon Morgan', phone: '615-0551' },
  { name: 'Eldon', phone: '610-0551' },
  { name: 'Kimley Jone', phone: '622-9887' },
];

let page, cdp, evaluate;

/** Find the New Receipt input whose label is `label`. */
const inputExpr = (label) => `[...document.querySelectorAll('.field label')]
  .find((l) => l.textContent.trim() === ${JSON.stringify(label)}).control`;

/** Clear the field, then type `text` one key at a time, like a user. */
async function typeInto(label, text) {
  await evaluate(`(() => { const i = ${inputExpr(label)}; i.focus(); i.select(); })()`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  for (const ch of text) await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: ch });
  await new Promise((r) => setTimeout(r, 50));
}

/** Typed value, visible suggestion titles, and the input/list/card geometry. */
function state(label) {
  return evaluate(`(() => {
    const input = ${inputExpr(label)};
    const list = document.getElementById(input.getAttribute('aria-controls'));
    const open = !!list && !list.hidden && input.getAttribute('aria-expanded') === 'true';
    const rect = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
    return {
      value: input.value,
      open,
      titles: open ? [...list.querySelectorAll('.typeahead-title')].map((t) => t.textContent) : [],
      subs: open ? [...list.querySelectorAll('.typeahead-sub')].map((t) => t.textContent) : [],
      input: rect(input),
      list: open ? rect(list) : null,
      card: rect(input.closest('.card')),
      // Is the input's own text visible, i.e. not under the list?
      inputOnTop: document.elementFromPoint(rect(input).left + 8, (rect(input).top + rect(input).bottom) / 2) === input,
      scrollWidth: document.documentElement.scrollWidth,
    };
  })()`);
}

function assertBelowField(s) {
  assert.ok(s.open, 'dropdown is open');
  assert.ok(s.list.top >= s.input.bottom - 0.5, `list top ${s.list.top} is below input bottom ${s.input.bottom}`);
  assert.ok(s.inputOnTop, 'typed text is not covered by the dropdown');
  assert.ok(s.list.left >= s.card.left - 0.5 && s.list.right <= s.card.right + 0.5,
    `list ${s.list.left}-${s.list.right} stays inside card ${s.card.left}-${s.card.right}`);
  assert.ok(s.scrollWidth <= WIDTH, 'no horizontal page scroll');
}

test.before(async () => {
  page = await harness.open('#/customers');
  ({ cdp, evaluate } = page);
  await evaluate(`Promise.all(${JSON.stringify(CUSTOMERS)}.map((c) => db.put('customers', { ...c, email: '', address: '', tin: '' })))`);
  // A real reload also proves the customers were persisted to IndexedDB.
  await page.reloadAt('#/new');
  await page.waitFor(`[...document.querySelectorAll('.field label')].some((l) => l.textContent.trim() === 'Phone')`, 'New Receipt');
});

test.after(async () => {
  if (page) await page.close();
});

test('Phone "615" suggests brandon Morgan only, below the Phone field', async () => {
  await typeInto('Phone', '615');
  const s = await state('Phone');
  assert.equal(s.value, '615');
  assert.deepEqual(s.titles, ['brandon Morgan']);
  assert.deepEqual(s.subs, ['615-0551']);
  assertBelowField(s);
});

test('Phone "610" suggests Eldon; "6150551" suggests brandon Morgan', async () => {
  await typeInto('Phone', '610');
  assert.deepEqual((await state('Phone')).titles, ['Eldon']);
  await typeInto('Phone', '6150551');
  assert.deepEqual((await state('Phone')).titles, ['brandon Morgan']);
});

test('Phone ignores formatting and a leading +501', async () => {
  await typeInto('Phone', '+501 (615) 05');
  assert.deepEqual((await state('Phone')).titles, ['brandon Morgan']);
});

test('Phone "0551" suggests brandon Morgan and Eldon', async () => {
  await typeInto('Phone', '0551');
  const s = await state('Phone');
  assert.deepEqual(s.titles, ['brandon Morgan', 'Eldon']);
  assertBelowField(s);
});

test('Phone "jon" and fewer than 3 digits suggest nothing, and keep the typed text', async () => {
  await typeInto('Phone', 'jon');
  let s = await state('Phone');
  assert.equal(s.open, false);
  assert.equal(s.value, 'jon');
  await typeInto('Phone', '61');
  s = await state('Phone');
  assert.equal(s.open, false);
  assert.equal(s.value, '61');
});

test('Name "kim" suggests Kimley Jone with phone, below the Name field', async () => {
  await typeInto('Name', 'kim');
  const s = await state('Name');
  assert.equal(s.value, 'kim');
  assert.deepEqual(s.titles, ['Kimley Jone']);
  assert.deepEqual(s.subs, ['622-9887']);
  assertBelowField(s);
});

test('Name digits do not match phone numbers', async () => {
  await typeInto('Name', '615');
  assert.equal((await state('Name')).open, false);
});

test('Picking from the Phone list fills name and phone', async () => {
  await typeInto('Name', '');
  await typeInto('Phone', '622');
  await evaluate(`(() => { const i = ${inputExpr('Phone')};
    document.getElementById(i.getAttribute('aria-controls')).querySelector('.typeahead-option').click(); })()`);
  assert.equal(await evaluate(`${inputExpr('Name')}.value`), 'Kimley Jone');
  assert.equal(await evaluate(`${inputExpr('Phone')}.value`), '622-9887');
});
