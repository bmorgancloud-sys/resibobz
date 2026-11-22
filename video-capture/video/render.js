// Renders the Toucan Bill feature videos from video/compose.html, frame by frame, into MP4 (H.264).
//   node video/render.js main|short [--preview t1,t2,...]
// --preview writes PNG frames at those seconds to video/out/preview-<cut>-<t>.png instead of a video.
// If manual/M1-whatsapp-share.mov (or .mp4) exists, its frames are used; otherwise a labelled placeholder.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const L = require('../lib.js');
const { start } = require('../server.js');

const ROOT = path.resolve(__dirname, '..');
const OUTDIR = path.join(__dirname, 'out');
const FPS = 30;
const cut = process.argv[2] || 'main';
const pIdx = process.argv.indexOf('--preview');
const preview = pIdx > 0 ? process.argv[pIdx + 1].split(',').map(Number) : null;

function prepareM1() {
  const src = ['M1-whatsapp-share.mov', 'M1-whatsapp-share.mp4'].map((f) => path.join(ROOT, 'manual', f)).find((f) => fs.existsSync(f));
  if (!src) return null;
  const dir = path.join(__dirname, 'frames', 'm1');
  if (!fs.existsSync(path.join(dir, '00001.jpg'))) {
    fs.mkdirSync(dir, { recursive: true });
    const r = spawnSync(L.ffmpegPath, ['-loglevel', 'error', '-y', '-i', src, '-vf', 'fps=30,scale=900:-2', '-q:v', '2', path.join(dir, '%05d.jpg')]);
    if (r.status !== 0) throw new Error('could not read ' + src);
  }
  return { frames: fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).length, fps: 30 };
}

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const m1 = prepareM1();
  const m2 = fs.existsSync(path.join(ROOT, 'manual', 'M2-home-screen.png'));
  const srv = await start(0);
  const browser = await L.launch({ phone: false });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
  const q = new URLSearchParams({ cut, ...(m1 ? { m1: JSON.stringify(m1) } : {}), ...(m2 ? { m2: '1' } : {}) });
  await page.goto(srv.url + '__capture/video/compose.html?' + q);
  await page.waitForFunction(() => window.composerReady === true);
  const total = await page.evaluate(() => window.TOTAL);
  const cdp = await page.context().newCDPSession(page);
  const shot = async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1080, height: 1920, scale: 1 } })).data, 'base64');

  if (preview) {
    for (const t of preview) {
      await page.evaluate((x) => window.renderAt(x), t);
      fs.writeFileSync(path.join(OUTDIR, `preview-${cut}-${String(t).replace('.', '_')}.png`), await shot());
    }
    console.log('previews written', preview.join(', '), errors.length ? errors : '');
  } else {
    const name = cut === 'short' ? 'toucan-bill-short-20s.mp4' : 'toucan-bill-main-60s.mp4';
    const out = path.join(OUTDIR, name);
    const ff = spawn(L.ffmpegPath, ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', out],
      { stdio: ['pipe', 'inherit', 'inherit'] });
    const frames = Math.round(total * FPS);
    const t0 = Date.now();
    for (let i = 0; i < frames; i++) {
      await page.evaluate((x) => window.renderAt(x), i / FPS);
      const buf = await shot();
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (i % 150 === 0) console.log(`  ${cut}: frame ${i}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    console.log(`wrote video/out/${name}: ${frames} frames, ${total}s, M1 ${m1 ? 'used' : 'placeholder'}, M2 ${m2 ? 'used' : 'not supplied'}`, errors.length ? errors : '');
  }
  await browser.close();
  srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
