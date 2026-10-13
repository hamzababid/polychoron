import { chromium } from 'playwright';
export const W = '/Users/hamzabinabid/Developer/Polychoron/polychoron/brag-output/work/';
export const B = 'http://localhost:5173/bfsi/aml_detection';
export async function start({ scale = 2 } = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: scale });
  const errs = []; page.on('pageerror', e => errs.push('pageerror ' + e.message));
  page.on('response', r => r.status() >= 400 && errs.push(r.status() + ' ' + r.request().method() + ' ' + r.url()));
  const txt = async () => (await page.locator('main').first().innerText()).replace(/\s+/g, ' ');
  const settle = async (ms = 700) => { await page.waitForLoadState('networkidle'); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(ms); };
  const login = async (name) => { await page.goto('http://localhost:5173/login'); await page.getByText(name).click(); await page.waitForURL(/aml_detection/); await settle(); };
  const shot = (n, opts = {}) => page.screenshot({ path: W + 'shots/' + n + '.png', ...opts });
  const box = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  return { browser, page, errs, txt, settle, login, shot, box };
}
