// Local static server for the capture run. Serves the repo exactly like Netlify (same security headers
// from netlify.toml), plus /__capture/* for capture-only helper pages (no CSP). setSwVersion() changes
// CACHE_VERSION in the served sw.js to simulate a deploy (same trick as tests/browser/update.e2e.js).
// Nothing in the app is changed on disk.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const CAPTURE = __dirname;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf', '.map': 'application/json' };

function securityHeaders() {
  const toml = fs.readFileSync(path.join(REPO, 'netlify.toml'), 'utf8');
  const block = /for = "\/\*"\s*\[headers\.values\]([\s\S]*?)(?:\n\s*\n|\[\[)/.exec(toml);
  const out = {};
  if (block) for (const m of block[1].matchAll(/^\s*([\w-]+)\s*=\s*"(.*)"\s*$/gm)) out[m[1]] = m[2];
  return out;
}

function start(port = 0) {
  const SEC = securityHeaders();
  const state = { swVersion: null };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let base = REPO;
    let capture = false;
    if (p.startsWith('/__capture/')) { base = CAPTURE; p = p.slice('/__capture'.length); capture = true; }
    else if (p.startsWith('/video-capture/')) { res.writeHead(404).end(); return; }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(base, p);
    if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
    if (!capture) Object.assign(headers, SEC);
    if (!capture && p === '/sw.js' && state.swVersion) {
      const src = fs.readFileSync(file, 'utf8').replace(/const CACHE_VERSION = '[^']*'/, `const CACHE_VERSION = '${state.swVersion}'`);
      res.writeHead(200, headers).end(src);
      return;
    }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${server.address().port}/`;
    resolve({ server, url, setSwVersion: (v) => { state.swVersion = v; }, close: () => server.close() });
  }));
}

module.exports = { start, REPO, CAPTURE };

if (require.main === module) {
  start(Number(process.argv[2]) || 3100).then((s) => console.log('Serving ' + s.url));
}
