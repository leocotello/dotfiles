import { launch } from './shot.mjs';
const { browser, page, errors } = await launch(1440, 900);
const log = (m) => console.log(m);
await page.goto('http://localhost:8765/?seed=demo&auto=1'); await page.waitForTimeout(700);
// 1. Survey: pick the observed tile with the most unexplored tiles around it, select it and press S
const best = await page.evaluate(() => { const a = window.__stotkal; const S = a.S; const you = S.civs.you; let b = null; for (const k of Object.keys(you.obs)) { const t = S.map.tiles[k]; let g = 0; for (const h of Object.values(S.map.tiles)) { if (!you.seen[h.q + ',' + h.r] && Math.abs(h.q - t.q) <= 2 && Math.abs(h.r - t.r) <= 2) g++; } if (!b || g > b.g) b = { q: t.q, r: t.r, g }; } a.ui.sel = { q: b.q, r: b.r }; return b; });
log('best survey tile ' + JSON.stringify(best)); await page.keyboard.press('s'); await page.waitForTimeout(200);
log('staged after S: ' + await page.evaluate(() => JSON.stringify(window.__stotkal.S.staged.you.map(c => c.type))));
await page.evaluate(() => { const a = window.__stotkal; const c = a.S.cities[a.S.civs.you.cap]; a.ui.sel = { q: c.q, r: c.r }; }); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight');
// 2. develop in capital
await page.click('[data-act="devtoggle"]'); await page.waitForTimeout(200);
await page.screenshot({ path: 'screenshots/03-develop.png' });
const startBtns = await page.$$('[data-act="stage"]:not([disabled])'); log('startable buttons ' + startBtns.length);
await page.evaluate(() => { const b = [...document.querySelectorAll('[data-act="stage"]')].find(x => /garden/i.test(JSON.stringify(x.dataset.cmd)) && !x.disabled); b && b.click(); });
await page.waitForTimeout(200);
log('staged ' + await page.evaluate(() => window.__stotkal.S.staged.you.length));
// survey stage via data
await page.evaluate(() => { const a = window.__stotkal; const t = Object.values(a.S.map.tiles).find(t => a.S.civs.you.obs[t.q + ',' + t.r] && t.q === a.S.cities[a.S.civs.you.cap].q + 2); });
await page.click('[data-act="endturn"]'); await page.waitForTimeout(250); await page.screenshot({ path: 'screenshots/04-commit.png' });
await page.keyboard.press('Enter'); await page.waitForTimeout(500);
await page.screenshot({ path: 'screenshots/05-summary.png' });
await page.keyboard.press('Enter'); await page.waitForTimeout(200);
log('turn ' + await page.evaluate(() => window.__stotkal.S.turn));
// advance to council turn 3 (summary -> council chain)
for (let i = 0; i < 1; i++) { await page.click('[data-act="endturn"]'); await page.waitForTimeout(150); await page.keyboard.press('Enter'); await page.waitForTimeout(250); await page.keyboard.press('Enter'); await page.waitForTimeout(200); }
log('turn ' + await page.evaluate(() => window.__stotkal.S.turn) + ' modal ' + await page.evaluate(() => window.__stotkal.ui.modal && window.__stotkal.ui.modal.type));
await page.waitForTimeout(300); await page.screenshot({ path: 'screenshots/06-council.png' });
console.log(errors.join('\n') || 'no errors'); await browser.close();
