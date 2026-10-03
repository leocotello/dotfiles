// Generates screenshots of the v2 game in headless Chromium.  node tools/serve.js &  node tools/screenshots.mjs
import { launch } from './browser.mjs';
const BASE = 'http://localhost:8765/';
const { browser, page, errors } = await launch(1440, 900);
const shot = async (name) => { await page.waitForTimeout(450); await page.screenshot({ path: `screenshots/${name}.png` }); console.log('saved', name); };
const ev = (fn, arg) => page.evaluate(fn, arg);
await page.goto(BASE); await page.waitForTimeout(600); await shot('01-setup-traditions-and-seasons');
await page.goto(BASE + '?seed=demo&auto=1&world=ember_year'); await page.waitForTimeout(900); await shot('02-turn1-painted-world-hero');
await page.mouse.click(600, 330); await shot('03-radial-menu-and-walk-preview');
// a timed beat
await ev(async () => { const a = window.__stotkal; const R = await import('/src/sim/run.js'); R.rollBeat(a.S); a.refresh(); }); await shot('04-timed-beat');
await ev(async () => { const a = window.__stotkal; const R = await import('/src/sim/run.js'); R.autoResolve(a.S); a.ui.modal = null; a.refresh(); });
// expedition
await ev(async () => { const a = window.__stotkal; const S = a.S; const St = await import('/src/sim/state.js'); const site = Object.values(S.sites).find(s => s.type === 'ruin'); const nb = Object.values(S.map.tiles).find(t => Math.max(Math.abs(t.q - site.q), Math.abs(t.r - site.r), Math.abs(t.q + t.r - site.q - site.r)) === 1 && !t.site && !t.city); S.hero.q = nb.q; S.hero.r = nb.r; St.revealRange(S, S.civs.you, nb, 4, true); St.syncDiscoveries(S); a.ui.sel = { q: site.q, r: site.r }; a.ui.sheet = 'context'; a.renderer.focusOn(site.q, site.r); a.refresh(); });
await shot('05-ruin-beside-the-witness');
await page.click('[data-act="enter"]'); await shot('06-expedition-doors');
await page.click('[data-act="pdoor"]'); await shot('07-expedition-room');
await ev(async () => { const a = window.__stotkal; const R = await import('/src/sim/run.js'); R.autoResolve(a.S); a.ui.modal = null; a.refresh(); });
// later game: fast-forward with the bot player
await ev(async () => { const a = window.__stotkal; const B = await import('/src/sim/bot.js'); const E = await import('/src/sim/resolve.js'); a.S.manual = false; while (a.S.turn < 13 && !a.S.over) { B.botTurn(a.S, 'veil', 'embodied'); E.endTurn(a.S); } a.S.manual = true; a.ui.modal = null; a.ui.sel = null; a.renderer.follow = true; a.refresh(); });
await shot('08-turn13-cities-borders-quieting');
await page.click('[data-act="sheet"][data-s="quiet"]').catch(() => {}); await shot('09-quieting-sheet');
await ev(async () => { const a = window.__stotkal; const R = await import('/src/sim/run.js'); const S = a.S; S.pending.length = 0; S.pending.push({ type: 'crossroads', options: ['haven', 'front', 'mystery'] }); a.refresh(); }); await shot('10-crossroads');
await ev(async () => { const a = window.__stotkal; a.S.pending.length = 0; a.ui.modal = null; const B = await import('/src/sim/bot.js'); const E = await import('/src/sim/resolve.js'); a.S.manual = false; while (a.S.turn < 30 && !a.S.over) { B.botTurn(a.S, 'veil', 'embodied'); E.endTurn(a.S); } E.endTurn(a.S); a.S.manual = true; a.refresh(); });
await shot('11-chronicle-ending');
console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'no console errors'); await browser.close();
