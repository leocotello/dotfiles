// Real-browser check: quit at the commitment stage (orders staged on a council turn) and resume; nothing may change.
import { launch } from './browser.mjs';
const { browser, page, errors } = await launch(1366, 800);
await page.goto('http://localhost:8765/?seed=resume1&auto=1'); await page.waitForTimeout(500);
await page.evaluate(async () => { const a = window.__stotkal; const R = await import('/src/sim/rival.js'); const E = await import('/src/sim/resolve.js'); while (a.S.turn < 6) { R.planAs(a.S, 'you', 'veil', 'embodied'); E.endTurn(a.S); } a.ui.modal = null; });
// stage a project and a council choice through the UI
await page.evaluate(async () => { const a = window.__stotkal; const C = await import('/src/sim/commands.js'); const c = a.S.cities[a.S.civs.you.cap]; const first = a.S.council.offers && a.S.council.offers[0]; C.stage(a.S, 'you', { type: 'reform', kind: 'research', tech: 'cultivation' }); if (first) C.stage(a.S, 'you', { type: 'council', offer: first.id }); });
await page.evaluate(() => document.querySelector('[data-act="sheet"][data-s="context"]').click()); await page.waitForTimeout(500); // let autosave debounce fire
const before = await page.evaluate(() => { const S = window.__stotkal.S; return { turn: S.turn, rng: S.rng, staged: S.staged.you.map(c => c.type + ':' + (c.kind || c.offer || '')), offers: S.council.offers && S.council.offers.map(o => o.id), res: S.civs.you.res }; });
await page.evaluate(() => window.__stotkal && window.dispatchEvent(new Event('beforeunload')));
await page.goto('http://localhost:8765/'); await page.waitForTimeout(500);
console.log('title offers Continue:', await page.evaluate(() => !!document.querySelector('[data-act="continue"]')));
await page.click('[data-act="continue"]'); await page.waitForTimeout(500);
const after = await page.evaluate(() => { const S = window.__stotkal.S; return { turn: S.turn, rng: S.rng, staged: S.staged.you.map(c => c.type + ':' + (c.kind || c.offer || '')), offers: S.council.offers && S.council.offers.map(o => o.id), res: S.civs.you.res }; });
console.log('before', JSON.stringify(before)); console.log('after ', JSON.stringify(after));
console.log('identical:', JSON.stringify(before) === JSON.stringify(after));
console.log(errors.join('\n') || 'no console errors'); await browser.close();
