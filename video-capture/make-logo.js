// Renders assets/glow-nails-logo.svg to a 400x400 PNG (transparent corners) with headless Chrome.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./lib.js');

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 400 }, deviceScaleFactor: 1 });
  const svg = fs.readFileSync(path.join(__dirname, 'assets', 'glow-nails-logo.svg'), 'utf8');
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: path.join(__dirname, 'assets', 'glow-nails-logo.png'), omitBackground: true, clip: { x: 0, y: 0, width: 400, height: 400 } });
  await browser.close();
  console.log('logo written', fs.statSync(path.join(__dirname, 'assets', 'glow-nails-logo.png')).size, 'bytes');
})();
