// Browser test for the "Update available, tap to reload" prompt (js/update.js + sw.js).
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

const mark = () => evaluate('window.__mark = true; true');
const reloaded = () => evaluate('document.readyState === "complete" && !window.__mark');
const promptShown = () => evaluate(`(() => { const b = document.querySelector('.update-bar'); return !!b && !b.hidden; })()`);
const tapPrompt = () => evaluate(`document.querySelector('.update-bar').click(), true`);
const dialogButton = (text) => evaluate(`(() => {
  const b = [...document.querySelectorAll('dialog[open] button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
  if (!b) return false;
  b.click();
  return true;
})()`);

/** Deploy a new sw.js and wait until it is installed and the prompt shows. */
async function deployUpdate() {
  page.server.swVersion = 'resibobz-e2e-' + (++version);
  await mark();
  await evaluate(`navigator.serviceWorker.getRegistration().then((r) => r.update()).then(() => true)`);
  await page.waitFor(`(() => { const b = document.querySelector('.update-bar'); return !!b && !b.hidden; })()`, 'update prompt', 15000);
}

/** Set a New Receipt field by its label, as typing would. */
const setField = (label, value) => evaluate(`(() => {
  const i = [...document.querySelectorAll('.field label')].find((l) => l.textContent.trim() === ${JSON.stringify(label)}).control;
  i.value = ${JSON.stringify(value)};
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

const hashIs = (h) => page.waitFor(`location.hash === ${JSON.stringify(h)} && document.readyState === 'complete'`, 'route ' + h);
const waitReload = (what) => page.waitFor('document.readyState === "complete" && !window.__mark', what, 15000);

test.before(async () => {
  page = await harness.open('#/new');
  ({ evaluate } = page);
});

test.after(async () => {
  if (page) await page.close();
});

test('first install takes control without a prompt or a reload', async () => {
  await mark();
  await page.waitFor('!!navigator.serviceWorker.controller', 'service worker to take control', 15000);
  await page.sleep(300);
  assert.equal(await reloaded(), false);
  assert.equal(await promptShown(), false);
});

test('an update waits and shows the prompt; it does not reload by itself', async () => {
  await deployUpdate();
  await page.sleep(500);
  assert.equal(await reloaded(), false, 'no reload until tapped');
  const waiting = await evaluate(`navigator.serviceWorker.getRegistration().then((r) => !!r.waiting)`);
  assert.equal(waiting, true, 'the new worker is waiting');
  assert.equal(await evaluate(`document.querySelector('.update-bar').textContent`), 'Update available, tap to reload');
});

test('a waiting update is still offered after the page is reopened', async () => {
  // A normal navigation, like reopening the app (a hard reload would bypass the service worker).
  await page.goto(page.base + '?reopen#/history');
  await page.waitFor(`(() => { const b = document.querySelector('.update-bar'); return !!b && !b.hidden; })()`, 'prompt after reopen', 15000);
});

test('tapping the prompt with nothing unsaved activates the update and reloads on the same route', async () => {
  await hashIs('#/history');
  await mark();
  await tapPrompt();
  await waitReload('reload after tapping');
  await hashIs('#/history');
  assert.equal(await promptShown(), false);
  assert.deepEqual(await evaluate('caches.keys()'), ['resibobz-e2e-' + version], 'only the newest cache is kept');
});

test('with a receipt in progress, tapping asks first; "Not now" keeps the draft', async () => {
  await evaluate(`location.hash = '#/new'; true`);
  await page.waitFor(`!!document.querySelector('.field label')`, 'New Receipt');
  await setField('Name', 'Walk-in Ana');
  await deployUpdate();
  assert.equal(await reloaded(), false, 'no reload while the draft has text');

  await tapPrompt();
  await page.waitFor(`!!document.querySelector('dialog[open]')`, 'confirm dialog');
  assert.ok(await dialogButton('Not now'));
  await page.sleep(500);
  assert.equal(await reloaded(), false, '"Not now" does not reload');
  assert.equal(await promptShown(), true, 'the prompt stays');

  await tapPrompt();
  await page.waitFor(`!!document.querySelector('dialog[open]')`, 'confirm dialog');
  assert.ok(await dialogButton('Reload'));
  await waitReload('reload after confirming');
  assert.deepEqual(await evaluate('caches.keys()'), ['resibobz-e2e-' + version]);
});

test('on a form (Settings), tapping also asks first', async () => {
  await evaluate(`location.hash = '#/settings'; true`);
  await page.waitFor(`document.title.startsWith('Settings') && !!document.querySelector('.field label')`, 'Settings');
  await deployUpdate();
  await tapPrompt();
  await page.waitFor(`!!document.querySelector('dialog[open]')`, 'confirm dialog');
  assert.ok(await dialogButton('Reload'));
  await waitReload('reload on Settings after confirming');
  await hashIs('#/settings');
});

const settingsVersion = () => evaluate(`(document.querySelector('.app-version') || {}).textContent || ''`);
const checkButton = () => evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Check for updates');
  if (!b) return false;
  b.click();
  return true;
})()`);

test('Settings shows the running version; "Check for updates" says up to date when nothing is new', async () => {
  await hashIs('#/settings');
  await page.waitFor(`(document.querySelector('.app-version') || {}).textContent === ${JSON.stringify('resibobz-e2e-' + version)}`,
    'app version in Settings', 15000);
  assert.ok(await checkButton(), 'Check for updates button');
  await page.waitFor(`(document.getElementById('toast') || {}).textContent === "You're up to date"`, 'up-to-date toast', 15000);
  assert.equal(await promptShown(), false);
});

test('"Check for updates" finds a new deploy and shows the prompt; the version changes after reloading', async () => {
  page.server.swVersion = 'resibobz-e2e-' + (++version);
  await mark();
  assert.ok(await checkButton());
  await page.waitFor(`(() => { const b = document.querySelector('.update-bar'); return !!b && !b.hidden; })()`, 'prompt after check', 15000);
  assert.equal(await settingsVersion(), 'resibobz-e2e-' + (version - 1), 'still the old version until reloaded');
  await tapPrompt();
  await page.waitFor(`!!document.querySelector('dialog[open]')`, 'confirm dialog');
  assert.ok(await dialogButton('Reload'));
  await waitReload('reload after check');
  await hashIs('#/settings');
  await page.waitFor(`(document.querySelector('.app-version') || {}).textContent === ${JSON.stringify('resibobz-e2e-' + version)}`,
    'new version in Settings', 15000);
});

test('coming back to the foreground checks for a new deploy (iOS resumes without reloading)', async () => {
  await evaluate(`location.hash = '#/history'; true`);
  await hashIs('#/history');
  page.server.swVersion = 'resibobz-e2e-' + (++version);
  await evaluate(`document.dispatchEvent(new Event('visibilitychange')), true`);
  await page.waitFor(`(() => { const b = document.querySelector('.update-bar'); return !!b && !b.hidden; })()`, 'prompt after resume', 15000);
});
