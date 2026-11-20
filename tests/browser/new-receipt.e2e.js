// Browser test for customer type-ahead on New Receipt.
//
// Run with: node tests/browser/new-receipt.e2e.js
// (Not picked up by `node --test tests/`: it needs Chrome. No npm needed.)
//
// Serves the app from a throwaway local server, launches headless Chrome with a fresh
// profile at 360px wide, seeds real customers into IndexedDB through db.js, then types
// into the Name and Phone fields with real key input and checks the suggestions and
// where the dropdown sits. Set CHROME=/path/to/chrome if it isn't in the default place.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const WIDTH = 360;
const CUSTOMERS = [
  { name: 'brandon Morgan', phone: '615-0551' },
  { name: 'Eldon', phone: '610-0551' },
  { name: 'Kimley Jone', phone: '622-9887' },
];

const CHROME_PATHS = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png' };

function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function launchChrome() {
  const exe = CHROME_PATHS.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('Chrome not found; set CHROME=/path/to/chrome');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'resibobz-e2e-'));
  const proc = spawn(exe, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', `--window-size=${WIDTH},800`, 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await new Promise((r) => setTimeout(r, 100));
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  return { proc, profile, wsUrl: page.webSocketDebuggerUrl };
}

/** Minimal Chrome DevTools Protocol client. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const waiters = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      for (const w of waiters.filter((w) => w.method === msg.method)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg.params); }
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const once = (method) => new Promise((resolve) => waiters.push({ method, resolve }));
  return { send, once, close: () => ws.close() };
}

let server, chrome, cdp, base;

async function evaluate(expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

async function waitFor(expression, what) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(expression)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Timed out waiting for ' + what);
}

async function goto(url) {
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await loaded;
}

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
  server = await serve();
  base = `http://localhost:${server.address().port}/`;
  chrome = await launchChrome();
  cdp = await connect(chrome.wsUrl);
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 800, deviceScaleFactor: 2, mobile: true });
  await goto(base + '#/customers');
  await waitFor('typeof db === "object"', 'app scripts');
  await evaluate(`Promise.all(${JSON.stringify(CUSTOMERS)}.map((c) => db.put('customers', { ...c, email: '', address: '', tin: '' })))`);
  // Hash-only navigation fires no load event, so set the hash and reload for real
  // (which also proves the customers were persisted to IndexedDB).
  await evaluate(`location.hash = '#/new'`);
  const reloaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.reload', { ignoreCache: true });
  await reloaded;
  await waitFor(`!!document.querySelector('.field label') && [...document.querySelectorAll('.field label')].some((l) => l.textContent.trim() === 'Phone')`, 'New Receipt');
});

test.after(async () => {
  try { cdp && cdp.close(); } catch {}
  if (server) server.close();
  if (chrome) {
    // Wait for Chrome to exit so its profile files are unlocked (Windows), then delete them.
    const exited = new Promise((r) => chrome.proc.once('exit', r));
    chrome.proc.kill();
    await exited;
    fs.rmSync(chrome.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
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
