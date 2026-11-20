// Shared plumbing for tests/browser/*.e2e.js: a throwaway static server for the app and
// headless Chrome (fresh profile, phone width) driven over the DevTools protocol.
// No npm: uses Node's built-in http, fetch and WebSocket. Set CHROME=/path/to/chrome
// if Chrome isn't in a default install location.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const WIDTH = 360;

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Serve the app. server.swVersion, when set, replaces CACHE_VERSION in sw.js,
 * which is how a test simulates deploying an update.
 */
function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
    if (p === '/sw.js' && server.swVersion) {
      const src = fs.readFileSync(file, 'utf8').replace(/const CACHE_VERSION = '[^']*'/, `const CACHE_VERSION = '${server.swVersion}'`);
      res.writeHead(200, headers).end(src);
      return;
    }
    res.writeHead(200, headers);
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
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
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
      for (const w of waiters.filter((w) => w.method === msg.method)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg.params);
      }
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const once = (method) => new Promise((resolve) => waiters.push({ method, resolve }));
  return { send, once, close: () => ws.close() };
}

/**
 * Start server + Chrome and open the app at `hash`. Returns page helpers and close().
 */
async function open(hash = '#/new') {
  const server = await serve();
  const base = `http://localhost:${server.address().port}/`;
  const chrome = await launchChrome();
  const cdp = await connect(chrome.wsUrl);
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 800, deviceScaleFactor: 2, mobile: true });

  async function evaluate(expression) {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }

  /** Poll until `expression` is truthy. Errors (e.g. mid-reload) count as "not yet". */
  async function waitFor(expression, what, timeoutMs = 5000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      try { if (await evaluate(expression)) return; } catch {}
      await sleep(50);
    }
    throw new Error('Timed out waiting for ' + what);
  }

  async function goto(url) {
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url });
    await loaded;
  }

  /** Change only the hash, then do a real reload (hash changes alone fire no load event). */
  async function reloadAt(h) {
    await evaluate(`location.hash = ${JSON.stringify(h)}`);
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.reload', { ignoreCache: true });
    await loaded;
  }

  async function close() {
    try { cdp.close(); } catch {}
    server.close();
    // Wait for Chrome to exit so its profile files are unlocked (Windows), then delete them.
    const exited = new Promise((r) => chrome.proc.once('exit', r));
    chrome.proc.kill();
    await exited;
    fs.rmSync(chrome.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }

  await goto(base + hash);
  await waitFor('typeof db === "object" && !!document.querySelector("#view > div")', 'app to start');
  return { server, base, cdp, evaluate, waitFor, goto, reloadAt, close, sleep, WIDTH };
}

module.exports = { open, WIDTH, sleep };
