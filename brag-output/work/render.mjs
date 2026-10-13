// node render.mjs stills 1.2 5 9.5 ...   |  node render.mjs frames <out-dir> <fps> [cutdown]
import { chromium } from 'playwright';
import fs from 'fs';
const ROOT = '/Users/hamzabinabid/Developer/Polychoron/polychoron/brag-output/';
const [mode, ...args] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('requestfailed', r => errs.push('failed ' + r.url()));
await page.goto('file://' + ROOT + 'composition/index.html');
await page.evaluate(() => window.ready);
const draw = async (t) => { await page.evaluate(async (t) => { render(t); await Promise.all([...document.images].map(i => i.decode().catch(() => {}))); }, t); };
// cutdown: [from, to] ranges of the main timeline, played back to back
const CUT = [[0, 4], [13.2, 21], [32, 40], [45, 48.5]];
const cutTime = (T) => { let acc = 0; for (const [a, b] of CUT) { if (T < acc + (b - a)) return a + (T - acc); acc += b - a; } return CUT.at(-1)[1]; };
if (mode === 'stills') {
  fs.mkdirSync(ROOT + 'work/stills', { recursive: true });
  for (const t of args.map(Number)) { await draw(t); await page.screenshot({ path: ROOT + `work/stills/t${t.toFixed(2)}.png` }); }
} else {
  const [out, fps, cut] = [args[0], Number(args[1] || 30), args[2] === 'cutdown'];
  const dur = cut ? CUT.reduce((s, [a, b]) => s + b - a, 0) : 48.5;
  fs.mkdirSync(out, { recursive: true });
  const n = Math.round(dur * fps);
  const [r0, r1] = (process.env.RANGE || `0-${n}`).split('-').map(Number);
  for (let i = r0; i < Math.min(n, r1); i++) {
    const T = i / fps; await draw(cut ? cutTime(T) : T);
    await page.screenshot({ path: `${out}/f${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 94 });
    if (i % 150 === 0) console.log('frame', i, '/', n);
  }
}
console.log('ERRS', JSON.stringify(errs.slice(0, 5)));
await browser.close();
