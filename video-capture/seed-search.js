// One-off helper: find a PRNG seed whose weekly sales rise steadily (deterministic choice for make-seed.js).
'use strict';
const { execFileSync } = require('node:child_process');
let best = null;
for (let s = 1; s <= 300; s++) {
  const out = execFileSync(process.execPath, ['make-seed.js'], { env: { ...process.env, SEED: String(s), DRY: '1' }, encoding: 'utf8' });
  const weeks = [...out.matchAll(/'\$([\d,.]+)'/g)].map((m) => Number(m[1].replace(/,/g, ''))).slice(1, 9);
  const full = weeks.slice(0, 8);
  let score = 0;
  for (let i = 1; i < 8; i++) if (full[i] < full[i - 1] * 0.97) score += 1 + (full[i - 1] - full[i]) / 300;
  score += Math.max(0, 1.5 - full[7] / full[0]);
  if (!best || score < best.score) best = { s, score, full };
}
console.log(best);
