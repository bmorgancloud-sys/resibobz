// Browser test for automatic reload on app updates (js/update.js + sw.js).
//
// Run with: node --test "tests/browser/*.e2e.js"
//
// Uses the real service worker in headless Chrome. An "update" is simulated by having the
// test server change CACHE_VERSION in sw.js and asking the registration to check for it.
// A reload is detected with a marker on `window`, which a reload wipes.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./harness.js');

let page, evaluate, version = 0;

/** Put a marker on window that only a reload removes, and watch for a controller change. */
const mark = () => evaluate(`window.__mark = true; window.__ctlChanged = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { window.__ctlChanged = true; }); true`);
const reloaded = () => evaluate('document.readyState === "complete" && !window.__mark');

/** Deploy a new sw.js and wait until the new worker controls the page (or the page reloaded). */
async function deployUpdate() {
  page.server.swVersion = 'resibobz-e2e-' + (++version);
  await mark();
  await evaluate(`navigator.serviceWorker.getRegistration().then((r) => r.update()).then(() => true)`);
  await page.waitFor('window.__ctlChanged || !window.__mark', 'new service worker to take control', 15000);
  await page.sleep(300); // give an (unwanted) reload the chance to happen
}

/** Set a New Receipt / Settings field by its label, as typing would. */
const setField = (label, value) => evaluate(`(() => {
  const i = [...document.querySelectorAll('.field label')].find((l) => l.textContent.trim() === ${JSON.stringify(label)}).control;
  i.value = ${JSON.stringify(value)};
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

const hashIs = (h) => page.waitFor(`location.hash === ${JSON.stringify(h)} && document.readyState === 'complete'`, 'route ' + h);

test.before(async () => {
  page = await harness.open('#/new');
  ({ evaluate } = page);
});

test.after(async () => {
  if (page) await page.close();
});

test('first install does not reload the page', async () => {
  await mark();
  await page.waitFor('!!navigator.serviceWorker.controller', 'service worker to take control', 15000);
  await page.sleep(300);
  assert.equal(await reloaded(), false);
});

test('an update with nothing unsaved reloads straight away, on the same route', async () => {
  await deployUpdate();
  await page.waitFor('document.readyState === "complete" && !window.__mark', 'reload');
  await hashIs('#/new');
});

test('an update with a receipt in progress waits until the draft is saved or cleared', async () => {
  await page.waitFor(`!!document.querySelector('.field label')`, 'New Receipt');
  await setField('Name', 'Walk-in Ana');
  await deployUpdate();
  assert.equal(await reloaded(), false, 'no reload while the draft has text');

  // Switching tabs with a draft still doesn't reload (the draft survives tab switches).
  await evaluate(`location.hash = '#/history'; true`);
  await page.sleep(300);
  assert.equal(await reloaded(), false, 'no reload on navigation while the draft has text');

  await evaluate(`location.hash = '#/new'; true`);
  await page.waitFor(`!!document.querySelector('.field label')`, 'New Receipt');
  assert.equal(await evaluate(`[...document.querySelectorAll('.field label')].find((l) => l.textContent.trim() === 'Name').control.value`), 'Walk-in Ana');

  // Clear the draft, then navigate: now it reloads, landing on the new route.
  await setField('Name', '');
  await evaluate(`location.hash = '#/history'; true`);
  await page.waitFor('document.readyState === "complete" && !window.__mark', 'reload after the draft was cleared');
  await hashIs('#/history');
});

test('an update while on a form (Settings) waits until the user navigates away', async () => {
  await evaluate(`location.hash = '#/settings'; true`);
  await page.waitFor(`document.title.startsWith('Settings') && !!document.querySelector('.field label')`, 'Settings');
  await deployUpdate();
  assert.equal(await reloaded(), false, 'no reload on the Settings form');

  await evaluate(`location.hash = '#/customers'; true`);
  await page.waitFor('document.readyState === "complete" && !window.__mark', 'reload on navigation');
  await hashIs('#/customers');
});

test('after reloading, the page runs the new service worker version', async () => {
  const keys = await evaluate('caches.keys()');
  assert.deepEqual(keys, ['resibobz-e2e-' + version], 'only the newest cache is kept');
});
