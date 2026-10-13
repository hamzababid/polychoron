import { start, B, W } from './common.mjs';
import fs from 'fs';
const { browser, page, errs, txt, settle, login, shot, box } = await start({ scale: 2 });
const boxes = {};
const INCOMPLETE = fs.readFileSync(W + 'incomplete_case.txt', 'utf8').trim().split('\n')[0];
const hideToasts = () => page.addStyleTag({ content: '.toast, [class*="toast"] { display:none !important }' });

// --- S2 dashboard + S8 governance + typology + kill switch (MLRO)
await login('Fatima Noor');
await page.goto(B + '/dashboard'); await settle(1200); await shot('s2-dashboard');
await page.goto(B + '/governance'); await settle(1500);
await shot('s8-governance-full', { fullPage: true });
for (const [k, t] of [['sampling', 'Sampling & drift check'], ['consistency', 'Consistency check'], ['versions', 'Model version in production'], ['guardrails', 'Guardrail violations']]) {
  const h = page.getByText(t, { exact: false }).first();
  boxes['gov_' + k] = await h.evaluate(el => { let p = el; for (let i = 0; i < 6 && p.parentElement; i++) { p = p.parentElement; if (p.getBoundingClientRect().height > 180) break; } const r = p.getBoundingClientRect(); return { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; });
}
console.log('GOV text', (await txt()).slice(0, 600));
await page.goto(B + '/typologies'); await settle(1000);
await page.getByRole('button', { name: /Disable entire feature/ }).click(); await page.waitForTimeout(600);
await shot('s6-killswitch');
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
const cancel = page.getByRole('button', { name: /Cancel/ }); if (await cancel.count()) await cancel.first().click();
await page.goto(B + '/typologies/deposit_velocity_shift/edit'); await settle(1200);
await shot('s5-typ-edit-0');
const ta = page.locator('main textarea').first();
boxes.typ_textarea = await box('main textarea');
const addition = ' Weight sustained rises above 150% of declared turnover for three or more consecutive weeks.';
await ta.click(); await page.keyboard.press('End');
fs.mkdirSync(W + 'shots/typing', { recursive: true });
let i = 0;
for (let k = 0; k < addition.length; k++) {
  await page.keyboard.type(addition[k]);
  if (k % 2 === 1 || k === addition.length - 1) { await ta.screenshot({ path: W + `shots/typing/t${String(i).padStart(3, '0')}.png` }); i++; }
}
boxes.typ_frames = i;
const reason = page.locator('main input:not([type=checkbox]):not([type=search])').last();
await reason.click(); await reason.type('Tighten escalation for sustained multi-week increases (MLRO review, Sep 2026).');
await page.mouse.click(5, 5); await page.waitForTimeout(300);
await shot('s5-typ-edit-typed');
await shot('s5-typ-edit-full', { fullPage: true });
boxes.typ_checklist = await page.getByText('PROMOTION CHECKLIST', { exact: false }).first().evaluate(el => { let p = el; for (let i = 0; i < 5 && p.parentElement; i++) { p = p.parentElement; if (p.getBoundingClientRect().height > 200) break; } const r = p.getBoundingClientRect(); return { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; });
// leave without saving
await page.goto(B + '/dashboard'); await settle();
await page.getByText('Log out').click();

// --- Alert queue, cases, guardrails, filing (senior officer)
await login('Bilal Siddiqui');
await page.goto(B + '/alerts'); await settle(1200); await hideToasts();
await shot('s3-queue');
boxes.queue_rows = await page.locator('.qrow').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }));
console.log('QUEUE first rows', (await page.locator('.qrow').nth(1).innerText()).replace(/\s+/g, ' '), '|', (await page.locator('.qrow').nth(2).innerText()).replace(/\s+/g, ' '));
// evidence incomplete
await page.goto(B + '/cases/' + INCOMPLETE); await settle(1200); await hideToasts();
await shot('s6-incomplete');
boxes.incomplete = await box('.case-workspace__warning');
// case B override panel
await page.goto(B + '/alerts'); await settle();
const rowB = page.locator('.qrow').filter({ hasText: 'TMS-26-092857' });
if (await rowB.getByRole('button', { name: 'Claim' }).count()) { await rowB.getByRole('button', { name: 'Claim' }).click(); await settle(); }
await rowB.getByText('open case').click(); await settle(1200);
await page.locator('.case-workspace__dispositionCard').filter({ hasText: /^Clear/ }).click();
await page.getByPlaceholder(/Officer notes/).fill('Wholesale dry-goods trader; the rise matches seasonal restocking.');
await page.getByPlaceholder(/State why/).fill('Seasonal pattern verified against prior-year deposits and supplier invoices.');
await page.locator('.case-workspace__dispositionPanel').scrollIntoViewIfNeeded(); await page.waitForTimeout(400); await hideToasts();
await shot('s6-override');
boxes.override = await box('.case-workspace__dispositionPanel');
// case A: claim, workspace, file
await page.goto(B + '/alerts'); await settle();
const rowA = page.locator('.qrow').filter({ hasText: 'TMS-26-092841' });
if (await rowA.getByRole('button', { name: 'Claim' }).count()) { await rowA.getByRole('button', { name: 'Claim' }).click(); await settle(); }
await rowA.getByText('open case').click(); await settle(1500); await hideToasts();
await page.waitForTimeout(3500);
await shot('s4-case');
boxes.case_timeline = await box('table');
boxes.case_ai = await box('.aml-source-ai');
boxes.case_cite = await page.getByText('AI-CITED REGULATIONS', { exact: false }).first().evaluate(el => { let p = el; for (let i = 0; i < 4 && p.parentElement; i++) { p = p.parentElement; if (p.getBoundingClientRect().height > 150) break; } const r = p.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
await page.locator('.case-workspace__dispositionCard').filter({ hasText: 'File STR' }).click();
await page.getByPlaceholder(/Officer notes/).fill('Three same-day cash deposits just under the PKR 2M threshold across two branches, far above declared turnover.');
await page.getByRole('button', { name: /Confirm/ }).click();
await page.waitForURL(/\/filing$/); await settle(1500); await hideToasts(); await page.waitForTimeout(3500);
await shot('s7-filing-0');
boxes.attest = await box('.filing-console__actionBar');
boxes.attest_panel = await page.getByText('TIPPING-OFF CHECK', { exact: false }).first().evaluate(el => { let p = el; for (let i = 0; i < 4 && p.parentElement; i++) { p = p.parentElement; if (p.getBoundingClientRect().height > 300) break; } const r = p.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
const cbs = await page.locator('.filing-console__check input[type=checkbox]').all();
for (const [k, cb] of cbs.entries()) { await cb.check(); await page.waitForTimeout(250); await shot('s7-filing-' + (k + 1)); }
await page.getByRole('button', { name: 'Submit to goAML' }).click();
await page.waitForURL(/\/filings/); await settle(1500); await hideToasts(); await page.waitForTimeout(3500);
await shot('s7-submitted');
boxes.submitted = await page.locator('.tag.tag-outline').first().evaluate(el => { let p = el; for (let i = 0; i < 4 && p.parentElement; i++) { p = p.parentElement; if (p.getBoundingClientRect().height > 120) break; } const r = p.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
fs.writeFileSync(W + 'boxes.json', JSON.stringify(boxes, null, 1));
console.log(JSON.stringify(boxes));
console.log('ERRS', errs);
await browser.close();
