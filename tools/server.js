// tools/server.js: tiny static dev server for Toucan Bill. Node built-ins only (no npm), works offline.
//
//   node tools/server.js [port]        (default 3000; start.bat runs this)
//
// Serves the project folder on http://localhost:<port> and opens it in the default browser.
// Set RESIBOBZ_NO_OPEN=1 to skip opening the browser.
// If Toucan Bill is already running on the port, it just opens the browser and exits (code 0).
// Any other failure prints the reason and exits with code 1, so start.bat can pause on it.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2]) || 3000;
const APP_URL = `http://localhost:${PORT}`;
const MARKER = 'X-ResiboBZ-Dev-Server';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

function handle(req, res) {
  let p;
  try {
    p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  const inside = file === ROOT || file.startsWith(ROOT + path.sep);
  fs.stat(file, (err, st) => {
    if (!inside || err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain', [MARKER]: '1' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache', // the service worker does the offline caching
      [MARKER]: '1',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

function openBrowser() {
  if (process.env.RESIBOBZ_NO_OPEN) return;
  const cmd = process.platform === 'win32' ? `start "" "${APP_URL}"`
    : process.platform === 'darwin' ? `open "${APP_URL}"` : `xdg-open "${APP_URL}"`;
  exec(cmd, (err) => { if (err) console.log(`Could not open the browser. Open ${APP_URL} yourself.`); });
}

/** Is Toucan Bill (this server) already answering on the port? */
function alreadyRunning() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/`, { timeout: 2000 }, (res) => {
      res.resume();
      resolve(!!res.headers[MARKER.toLowerCase()]);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

function fail(message) {
  console.error('\nERROR: ' + message + '\n');
  process.exit(1);
}

/** Listen on one address; resolves the server, or rejects with the listen error. */
function listen(host) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handle);
    server.once('error', reject);
    server.listen(PORT, host, () => resolve(server));
  });
}

async function main() {
  if (!fs.existsSync(path.join(ROOT, 'index.html'))) fail('index.html not found in ' + ROOT);
  try {
    // Local only (no firewall prompt). "localhost" can mean 127.0.0.1 or ::1, so serve both.
    await listen('127.0.0.1');
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      if (await alreadyRunning()) {
        console.log(`Toucan Bill is already running at ${APP_URL}. Opening it in your browser.`);
        openBrowser();
        setTimeout(() => process.exit(0), 500);
        return;
      }
      fail(`Port ${PORT} is already used by another program. Close it, or run: node tools\\server.js 3001`);
    }
    fail(`Could not start the server: ${err.message}`);
  }
  await listen('::1').catch(() => {}); // no IPv6 on this machine: fine, 127.0.0.1 works

  console.log('Toucan Bill dev server');
  console.log(`Serving ${ROOT}`);
  console.log(`Open ${APP_URL}`);
  console.log('');
  console.log('Server running - keep this window open');
  console.log('(Close this window or press Ctrl+C to stop the server.)');
  openBrowser();
}

process.on('uncaughtException', (err) => fail(err.stack || String(err)));
main();
