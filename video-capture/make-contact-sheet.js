// Builds a contact sheet (grid of stills with file names) by laying images out in an HTML page and
// screenshotting it. Usage: node make-contact-sheet.js [out.png] [glob-prefix filter, comma list]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib.js');

(async () => {
  const out = process.argv[2] || 'contact-sheet.png';
  const only = process.argv[3] ? process.argv[3].split(',') : null;
  const files = fs.readdirSync(L.OUT).filter((f) => /^\d\d.*\.png$/.test(f) && f !== out)
    .filter((f) => !only || only.some((p) => f.startsWith(p))).sort();
  const cols = 6, cellW = 300;
  const cells = files.map((f) => {
    const b64 = fs.readFileSync(path.join(L.OUT, f)).toString('base64');
    return `<figure><div class="img"><img src="data:image/png;base64,${b64}"></div><figcaption>${f}</figcaption></figure>`;
  }).join('');
  const html = `<html><head><style>
    body{margin:0;padding:24px;background:#f3f4f8;font:14px/1.3 Arial,sans-serif;color:#111}
    h1{margin:0 0 16px;font-size:22px}
    .grid{display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:18px}
    figure{margin:0;background:#fff;border:1px solid #ddd;border-radius:10px;padding:8px}
    .img{height:520px;display:flex;align-items:flex-start;justify-content:center;overflow:hidden;background:#eee;border-radius:6px}
    img{max-width:100%;max-height:520px;object-fit:contain}
    figcaption{margin-top:6px;font-weight:700;word-break:break-all}
  </style></head><body><h1>Toucan Bill capture pack: stills (${files.length})</h1><div class="grid">${cells}</div></body></html>`;
  const browser = await L.launch({ phone: false });
  const page = await browser.newPage({ viewport: { width: cols * (cellW + 18) + 48, height: 800 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
  await page.screenshot({ path: path.join(L.OUT, out), fullPage: true });
  await browser.close();
  console.log('wrote', out, files.length, 'images');
})();
