import { launch } from './shot.mjs';
const { browser, page, errors } = await launch(1440, 900);
await page.goto('http://localhost:8765/?seed=demo2&auto=1'); await page.waitForTimeout(700);
const ff = async (n) => page.evaluate(async (n) => { const a = window.__stotkal; const R = await import('/src/sim/rival.js'); const E = await import('/src/sim/resolve.js'); while (!a.S.over && a.S.turn < n) { R.planAs(a.S, 'you', 'conservatory', 'record'); E.endTurn(a.S); } a.ui.modal = null; a.ui.queue = []; a.ui.guideOff = true; return a.S.turn; }, n);
await ff(30);
await page.evaluate(() => { const a = window.__stotkal; a.ui.sheet = 'ambition'; a.ui.modal = null; document.querySelector('[data-act="sheet"][data-s="ambition"]').click(); });
await page.waitForTimeout(300); await page.screenshot({ path: 'screenshots/12-turn29-ambition.png' });
// play the last turn through the UI
await page.click('[data-act="endturn"]'); await page.waitForTimeout(200); await page.keyboard.press('Enter'); await page.waitForTimeout(600);
await page.screenshot({ path: 'screenshots/13-ending.png' });
console.log('modal', await page.evaluate(() => window.__stotkal.ui.modal && window.__stotkal.ui.modal.type), 'success', await page.evaluate(() => window.__stotkal.S.ending.success));
// choose a legacy and begin another cycle
await page.evaluate(() => document.querySelector('.opt [data-act="legacy"]:not([disabled])').click()); await page.waitForTimeout(200);
await page.screenshot({ path: 'screenshots/14-legacy-chosen.png' });
await page.click('[data-act="nextrun"]'); await page.waitForTimeout(400); await page.screenshot({ path: 'screenshots/15-setup-with-legacy.png' });
await page.click('[data-act="beginrun"]'); await page.waitForTimeout(600);
console.log('legacy', JSON.stringify(await page.evaluate(() => window.__stotkal.S.legacy)), 'sites', await page.evaluate(() => Object.values(window.__stotkal.S.sites).filter(s => s.type === 'legacy_ruin').length), 'mods', await page.evaluate(() => JSON.stringify(window.__stotkal.S.civs.you.mods)));
await page.screenshot({ path: 'screenshots/16-second-run.png' });
console.log(errors.join('\n') || 'no errors'); await browser.close();
