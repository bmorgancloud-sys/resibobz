// Shared capture helpers: browser/context setup, frozen clock, seed import, capture-only CSS/JS,
// human-like input, CDP screencast -> MP4, PDF -> PNG. Nothing here touches the app's files.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const ffmpegPath = require('ffmpeg-static');

const OUT = __dirname;
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// Wednesday 18 Nov 2026, 10:41 AM in Belize (UTC-6, no DST).
const FROZEN = new Date('2026-11-18T10:41:00-06:00');
const TZ = 'America/Belize';
const PHONE = { width: 393, height: 852, dpr: 3 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pause = (a = 400, b = 700) => sleep(rand(a, b));

/** Capture-only page script: CSS via a constructable stylesheet (CSP-safe), share stub, tap indicator. */
function initScript({ taps }) {
  // Runs in the page before any app script.
  const CSS = `
    html { scrollbar-width: none; }
    ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
    *:focus, *:focus-visible { outline: none !important; }
    html.cap-still * { caret-color: transparent !important; }
  `;
  const addCss = () => {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch (e) {}
  };
  if (document.documentElement) addCss(); else document.addEventListener('DOMContentLoaded', addCss);

  // Capture-only: headless Chrome never grants persistent storage, which an installed app on a phone
  // normally has. Without this, Settings > Backup would say "Storage: not protected". Disclosed in shots.json.
  try {
    if (navigator.storage) {
      Object.defineProperty(navigator.storage, 'persisted', { configurable: true, value: async () => true });
      Object.defineProperty(navigator.storage, 'persist', { configurable: true, value: async () => true });
    }
  } catch (e) {}

  // Share stub: log the payload (and keep the shared file's bytes) instead of opening a share sheet.
  window.__shares = [];
  const toB64 = (buf) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); };
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d) => !!d });
  Object.defineProperty(navigator, 'share', { configurable: true, value: async (data) => {
    const files = [];
    for (const f of (data && data.files) || []) files.push({ name: f.name, type: f.type, size: f.size, lastModified: f.lastModified, base64: toB64(await f.arrayBuffer()) });
    window.__shares.push({ at: new Date().toISOString(), title: data.title, text: data.text, url: data.url, files });
  } });

  {
    document.addEventListener('pointerdown', (e) => {
      if (!taps && !document.documentElement.classList.contains('cap-taps')) return; // recordings only
      const d = document.createElement('div');
      const size = 46;
      Object.assign(d.style, { position: 'fixed', left: (e.clientX - size / 2) + 'px', top: (e.clientY - size / 2) + 'px',
        width: size + 'px', height: size + 'px', borderRadius: '50%', background: 'rgba(60,60,60,0.28)',
        pointerEvents: 'none', zIndex: '2147483647' });
      document.documentElement.append(d);
      const a = d.animate([{ transform: 'scale(0.6)', opacity: 0.9 }, { transform: 'scale(1.25)', opacity: 0 }],
        { duration: 520, easing: 'ease-out', fill: 'forwards' });
      a.onfinish = () => d.remove();
    }, true);
  }
}

async function launch({ phone = true } = {}) {
  // The forced scale factor makes CDP screencast frames full device resolution (1179x2556), not CSS size.
  const args = ['--hide-scrollbars', '--font-render-hinting=none'];
  if (phone) args.push('--force-device-scale-factor=' + PHONE.dpr);
  return chromium.launch({ executablePath: CHROME, headless: true, args });
}

/** A phone (default) or desktop context with the frozen clock and capture scripts. */
async function newContext(browser, { desktop = false, taps = false, offline = false } = {}) {
  const ctx = await browser.newContext(desktop
    ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light', timezoneId: TZ, locale: 'en-US', acceptDownloads: true }
    : { viewport: { width: PHONE.width, height: PHONE.height }, screen: { width: PHONE.width, height: PHONE.height },
        deviceScaleFactor: PHONE.dpr, isMobile: true, hasTouch: true, colorScheme: 'light', timezoneId: TZ, locale: 'en-US',
        acceptDownloads: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.0.0 Mobile/15E148 Safari/604.1' });
  await ctx.clock.setFixedTime(FROZEN);
  await ctx.addInitScript(initScript, { taps });
  if (offline) await ctx.setOffline(true);
  return ctx;
}

/** Track console errors / page errors so every shot can be checked clean. */
function watchConsole(page, log) {
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => log.push('[pageerror] ' + e.message));
}

async function waitApp(page) {
  await page.waitForFunction(() => typeof db === 'object' && !!document.querySelector('#view > div'));
}

/** Import seed.json through the app's own backup code (same as Settings > Import), then reload. */
async function importSeed(page, base) {
  await page.goto(base + '#/new');
  await waitApp(page);
  const text = fs.readFileSync(path.join(OUT, 'seed.json'), 'utf8');
  await page.evaluate(async (t) => { await backup.restore(backup.parse(t)); }, text);
  await page.goto(base + '#/new');
  await page.reload();
  await waitApp(page);
}

/** Go to a route and wait for the view to settle. */
async function go(page, hash, settle = 700) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForFunction(() => !!document.querySelector('#view > div'));
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(settle);
}

/** Wait for fonts, images and running animations to finish. */
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })));
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})));
  });
  await sleep(250);
}

/** Full-DPR PNG of the viewport (or fullPage). Blurs focus and hides the caret first. */
async function still(page, name, { fullPage = false, keepFocus = false } = {}) {
  await page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 8000 }).catch(() => {});
  if (!keepFocus) await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await page.evaluate(() => document.documentElement.classList.add('cap-still'));
  await settle(page);
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage, animations: 'disabled', caret: 'hide' });
  await page.evaluate(() => document.documentElement.classList.remove('cap-still'));
  console.log('  still ' + name);
  return file;
}

/** Field (input/textarea) by its visible label text, optionally the nth match. */
function field(page, label, nth = 0) {
  return page.locator('.field').filter({ has: page.locator('label, .field-label', { hasText: new RegExp('^\\s*' + label.replace(/[()$]/g, '\\$&') + '\\s*$') }) })
    .nth(nth).locator('input, textarea, select').first();
}

async function humanType(locator, text) {
  await locator.tap();
  await sleep(rand(150, 300));
  await locator.pressSequentially(text, { delay: Math.round(rand(60, 90)) });
}

/** Smoothly scroll so `locator` sits about `offset` px from the top of the viewport. */
async function smoothScrollTo(page, locator, offset = 120) {
  const top = await locator.evaluate((el, off) => el.getBoundingClientRect().top + window.scrollY - off, offset);
  await page.evaluate((y) => window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' }), top);
  await sleep(700);
}

// ---- Screencast -> MP4 ----

async function startRecording(page, name) {
  const cdp = await page.context().newCDPSession(page);
  const dir = path.join(OUT, '.frames', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    const i = frames.length;
    const file = path.join(dir, String(i).padStart(5, '0') + '.png');
    frames.push({ file, ts: f.metadata.timestamp });
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: PHONE.width * PHONE.dpr, maxHeight: PHONE.height * PHONE.dpr, everyNthFrame: 1 });
  return { cdp, frames, dir, name };
}

async function stopRecording(rec, { tailMs = 600 } = {}) {
  await sleep(tailMs);
  await rec.cdp.send('Page.stopScreencast');
  await sleep(300);
  const { frames } = rec;
  if (!frames.length) throw new Error('no frames recorded for ' + rec.name);
  const list = [];
  for (let i = 0; i < frames.length; i++) {
    const dur = i < frames.length - 1 ? Math.max(0.001, frames[i + 1].ts - frames[i].ts) : 0.5;
    list.push(`file '${frames[i].file.replace(/\\/g, '/')}'`, `duration ${dur.toFixed(4)}`);
  }
  list.push(`file '${frames[frames.length - 1].file.replace(/\\/g, '/')}'`);
  const listFile = path.join(rec.dir, 'list.txt');
  fs.writeFileSync(listFile, list.join('\n'));
  const out = path.join(OUT, rec.name + '.mp4');
  // H.264 4:2:0 needs even sizes: crop 1px of plain page background off the right edge (1179 -> 1178).
  const W = PHONE.width * PHONE.dpr - 1, H = PHONE.height * PHONE.dpr;
  const r = spawnSync(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-vf', `fps=30,crop=${W}:${H}:0:0,format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16',
    '-movflags', '+faststart', '-r', '30', out], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + r.stderr.slice(-2000));
  const secs = frames[frames.length - 1].ts - frames[0].ts + 0.5;
  console.log(`  video ${rec.name}.mp4 (${frames.length} frames, ${secs.toFixed(1)}s)`);
  return { out, secs, frames: frames.length };
}

/** Extract frames at given seconds to PNGs for checking. */
function extractFrames(mp4, times, prefix) {
  const files = [];
  for (const t of times) {
    const f = `${prefix}-${String(t).replace('.', '_')}s.png`;
    spawnSync(ffmpegPath, ['-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', f]);
    files.push(f);
  }
  return files;
}

// ---- PDF -> PNG ----

let pdfPage = null;
async function pdfToPng(browser, base, b64, outPng, { dpi = 300, pageNo = 1 } = {}) {
  if (!pdfPage) {
    const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
    pdfPage = await ctx.newPage();
    await pdfPage.goto(base + '__capture/pdf.html');
    await pdfPage.waitForFunction(() => window.pdfReady === true);
  }
  const r = await pdfPage.evaluate(([b, d, p]) => window.renderPdf(b, d, p), [b64, dpi, pageNo]);
  fs.writeFileSync(outPng, Buffer.from(r.png.split(',')[1], 'base64'));
  console.log(`  pdf->png ${path.basename(outPng)} ${r.width}x${r.height} (${r.pages} page${r.pages > 1 ? 's' : ''})`);
  return r;
}

function resetPdfPage() { pdfPage = null; }

module.exports = { OUT, CHROME, FROZEN, TZ, PHONE, sleep, pause, rand, launch, newContext, watchConsole, waitApp, importSeed, go, settle,
  still, field, humanType, smoothScrollTo, startRecording, stopRecording, extractFrames, pdfToPng, resetPdfPage, ffmpegPath };
