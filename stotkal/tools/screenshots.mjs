// Regenerates the representative screenshots by driving the real UI in headless Chromium.
//   node tools/serve.js &   node tools/screenshots.mjs
import { launch } from './shot.mjs';
const BASE = process.env.BASE || 'http://localhost:8765/';
const shot = async (page, name) => { await page.waitForTimeout(350); await page.screenshot({ path: `screenshots/${name}.png` }); console.log('saved', name); };
const ff = (page, n, fac = 'conservatory', amb = 'record') => page.evaluate(async ([n, fac, amb]) => { const a = window.__stotkal; const R = await import('/src/sim/rival.js'); const E = await import('/src/sim/resolve.js'); while (!a.S.over && a.S.turn < n) { R.planAs(a.S, 'you', fac, amb); E.endTurn(a.S); } a.ui.modal = null; a.ui.queue = []; a.ui.guideOff = true; a.ui.sel = { q: a.S.cities[a.S.civs.you.cap].q, r: a.S.cities[a.S.civs.you.cap].r }; document.querySelector('[data-act="sheet"][data-s="context"]')?.click(); }, [n, fac, amb]);
const click = (page, sel) => page.evaluate((sel) => document.querySelector(sel).click(), sel);
const { browser, page, errors } = await launch(1440, 900);
await page.goto(BASE); await page.waitForTimeout(500); await shot(page, '01-founding-choices');
await page.goto(BASE + '?seed=demo&auto=1'); await page.waitForTimeout(700); await shot(page, '02-awakening-turn1');
// stage a survey and a garden through the UI, then review the commitment summary
await page.evaluate(() => { const a = window.__stotkal; const S = a.S, you = S.civs.you; let b = null; for (const k of Object.keys(you.obs)) { const t = S.map.tiles[k]; let g = 0; for (const h of Object.values(S.map.tiles)) if (!you.seen[h.q + ',' + h.r] && Math.abs(h.q - t.q) <= 2 && Math.abs(h.r - t.r) <= 2) g++; if (!b || g > b.g) b = { q: t.q, r: t.r, g }; } a.ui.sel = { q: b.q, r: b.r }; });
await page.keyboard.press('s'); await page.waitForTimeout(200);
await page.evaluate(() => { const a = window.__stotkal; const c = a.S.cities[a.S.civs.you.cap]; a.ui.sel = { q: c.q, r: c.r }; }); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowLeft');
await click(page, '[data-act="devtoggle"]'); await shot(page, '03-develop-projects');
await page.evaluate(() => { const b = [...document.querySelectorAll('[data-act="stage"]')].find(x => /district:garden/.test(x.dataset.cmd) && !x.disabled); b && b.click(); });
await click(page, '[data-act="endturn"]'); await shot(page, '04-commitment-summary');
await page.keyboard.press('Enter'); await page.waitForTimeout(500); await shot(page, '05-resolution-summary');
await page.keyboard.press('Enter'); await page.waitForTimeout(100);
await page.evaluate(() => { const a = window.__stotkal; a.ui.guideOff = false; const c = a.S.cities[a.S.civs.you.cap]; a.ui.sel = { q: c.q, r: c.r }; }); await page.keyboard.press('x'); await shot(page, '05b-claim-targeting-city-site-hints'); await page.keyboard.press('Escape');
await click(page, '[data-act="endturn"]'); await page.waitForTimeout(150); await page.keyboard.press('Enter'); await page.waitForTimeout(300); await page.keyboard.press('Enter'); await shot(page, '06-council-turn3');
await page.keyboard.press('Escape');
// discovery
const sid = await page.evaluate(async () => { const a = window.__stotkal; const s = Object.values(a.S.sites).find(s => s.state === 'open' && ['choir_engine', 'mirror_well', 'monolith', 'weather_loom', 'glass_cradle', 'sleeping_orchard'].includes(s.type) && !Object.values(a.S.civs).some(c => c.id !== 'you' && c.disc[s.id] && c.disc[s.id].state === 'done')); a.S.civs.you.seen[s.q + ',' + s.r] = 1; const St = await import('/src/sim/state.js'); St.syncDiscoveries(a.S); a.ui.modal = { type: 'discovery', site: s.id }; a.ui.guideOff = true; document.querySelector('[data-act="sheet"][data-s="empire"]').click(); return s.id; });
await shot(page, '07-discovery-interpretation');
await page.keyboard.press('Escape');
await ff(page, 8); await page.keyboard.press('Home'); await shot(page, '08-map-turn8-cities-borders');
await ff(page, 14); await click(page, '[data-act="sheet"][data-s="quiet"]'); await page.keyboard.press('Home'); await shot(page, '09-quieting-forecast-turn14');
await click(page, '[data-act="sheet"][data-s="empire"]'); await shot(page, '10-empire-institutions-research');
await click(page, '[data-act="sheet"][data-s="diplo"]'); await shot(page, '11-diplomacy');
await click(page, '[data-act="sheet"][data-s="ambition"]'); await shot(page, '12-ambitions');
// army / forecast
await page.evaluate(async () => { const a = window.__stotkal; const S = a.S; const c = S.cities[S.civs.you.cap]; S.civs.you.res.mat += 40; S.civs.you.res.ene += 40; const C = await import('/src/sim/commands.js'); C.stage(S, 'you', { type: 'recruit', city: c.id, role: 'lancer' }); });
await page.evaluate(async () => { const a = window.__stotkal; const R = await import('/src/sim/rival.js'); const E = await import('/src/sim/resolve.js'); E.endTurn(a.S); a.ui.modal = null; });
await page.evaluate(async () => { const a = window.__stotkal; const S = a.S; const arm = Object.values(S.armies).find(x => x.owner === 'you'); const ind = Object.values(S.cities).find(c => c.ind) || Object.values(S.cities).find(c => c.owner && c.owner !== 'you'); if (arm && ind) { if (ind.owner) { const D = await import('/src/sim/diplomacy.js'); D.declareWar(S, 'you', ind.owner, 'screenshot scenario'); } S.civs.you.seen[ind.q + ',' + ind.r] = 1; a.ui.sel = { q: arm.q, r: arm.r, army: arm.id }; a.ui.sheet = 'context'; a.ui.targeting = { kind: 'objective', army: arm.id, obj: 'besiege', approach: 'assault', targets: new Set([ind.q + ',' + ind.r]) }; const T = S.map.tiles[ind.q + ',' + ind.r]; const AP = await import('/src/sim/army.js'); const CB = await import('/src/sim/combat.js'); const p = AP.armyPath(S, arm, T); if (p) { a.ui.path = { from: { q: arm.q, r: arm.r }, steps: p.steps, breaks: p.breaks }; const fc = CB.forecast(S, [arm], T, 'assault'); fc.path = p; a.ui.hoverFc = fc; } document.querySelector('[data-act="sheet"][data-s="context"]').click(); a.renderer.focusOn((arm.q + ind.q) / 2, (arm.r + ind.r) / 2, 1.1); const sb = document.getElementById('sidebody'); sb.scrollTop = sb.scrollHeight; } });
await shot(page, '13-army-path-and-forecast');
await page.evaluate(() => { const a = window.__stotkal; a.ui.targeting = null; a.ui.path = null; a.ui.hoverFc = null; });
await ff(page, 30); await click(page, '[data-act="endturn"]'); await page.waitForTimeout(150); await page.keyboard.press('Enter'); await page.waitForTimeout(500); await shot(page, '14-chronicle-and-legacy');
// choose the first legacy, begin another cycle and check that it took effect
await page.evaluate(() => document.querySelector('.opt [data-act="legacy"]:not([disabled])').click()); await page.waitForTimeout(150);
await page.click('[data-act="nextrun"]'); await page.waitForTimeout(300); await page.click('[data-act="beginrun"]'); await page.waitForTimeout(500);
console.log('next cycle legacy:', JSON.stringify(await page.evaluate(() => window.__stotkal.S.legacy)), '| legacy ruin sites:', await page.evaluate(() => Object.values(window.__stotkal.S.sites).filter(s => s.type === 'legacy_ruin').length));
await browser.close();
// responsive / accessibility variants
for (const [w, h, scale, name, rm] of [[1024, 640, 1, '15-window-1024x640', false], [800, 600, 1, '16-window-800x600', false], [1440, 900, 1.4, '17-text-scale-140', false], [1280, 720, 1, '18-reduced-motion', true]]) {
  const L = await launch(w, h, rm ? { reducedMotion: 'reduce' } : {}); await L.page.goto(BASE + '?seed=demo&auto=1'); await L.page.waitForTimeout(500);
  await L.page.evaluate((scale) => { const a = window.__stotkal; a.settings.textScale = scale; document.documentElement.style.setProperty('--scale', scale); window.dispatchEvent(new Event('resize')); }, scale);
  await ff(L.page, 13, 'veil', 'embodied'); await L.page.evaluate(() => { window.__stotkal.ui.guideOff = false; document.querySelector('[data-act="sheet"][data-s="context"]').click(); window.dispatchEvent(new Event('resize')); });
  await shot(L.page, name);
  const issues = await L.page.evaluate(() => { const out = []; for (const sel of ['[data-act="endturn"]', '#top .res', '.qchip']) { const el = document.querySelector(sel); const r = el.getBoundingClientRect(); if (r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1 || r.top < -1) out.push(sel + ' offscreen'); } if (document.documentElement.scrollWidth > innerWidth + 1) out.push('horizontal scroll'); return out; });
  console.log(name, issues.length ? issues.join(', ') : 'essential controls on-screen'); errors.push(...L.errors); await L.browser.close();
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
