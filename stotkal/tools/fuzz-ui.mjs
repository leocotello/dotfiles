// UI robustness fuzz: clicks random enabled controls (seeded) through a whole run, looking for console errors and dead ends.
//   node tools/serve.js &   node tools/fuzz-ui.mjs [seed] [steps]
import { launch } from './shot.mjs';
const seed = process.argv[2] || 'fuzz1'; const steps = +(process.argv[3] || 600);
let a = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7); const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const { browser, page, errors } = await launch(1366, 800);
await page.goto('http://localhost:8765/?seed=' + seed + '&auto=1'); await page.waitForTimeout(600);
const SKIP = new Set(['newrun', 'exportsave', 'dbg', 'scrim', 'savenow']); let clicks = 0, commits = 0, turnsSeen = new Set(), ended = false;
for (let i = 0; i < steps && !ended; i++) {
  const st = await page.evaluate(() => ({ turn: window.__stotkal.S && window.__stotkal.S.turn, over: window.__stotkal.S && window.__stotkal.S.over, modal: window.__stotkal.ui.modal && window.__stotkal.ui.modal.type }));
  turnsSeen.add(st.turn);
  if (st.modal === 'ending') { ended = true; break; }
  // every ~14 clicks, commit the turn so the run progresses
  if (i % 14 === 13) { if (st.modal === 'commit') { await page.keyboard.press('Enter'); commits++; await page.waitForTimeout(40); continue; } await page.evaluate(() => { const b = document.querySelector('[data-act="endturn"]'); b && b.click(); }); await page.waitForTimeout(30); if ((await page.evaluate(() => window.__stotkal.ui.modal && window.__stotkal.ui.modal.type)) === 'commit') { await page.keyboard.press('Enter'); commits++; } await page.waitForTimeout(40); continue; }
  const handles = await page.$$('[data-act]:not([disabled])'); const cands = [];
  for (const h of handles) { const act = await h.getAttribute('data-act'); if (SKIP.has(act)) continue; if (!(await h.isVisible())) continue; cands.push(h); }
  if (st.modal && st.modal !== 'ending' && rnd() < 0.3) { await page.keyboard.press('Escape'); await page.waitForTimeout(20); continue; }
  if (!cands.length) { await page.keyboard.press('Escape'); continue; }
  const pick = cands[Math.floor(rnd() * cands.length)]; try { await pick.click({ timeout: 800 }); clicks++; } catch (e) { /* element moved: fine */ }
  // occasionally click on the map
  if (rnd() < 0.25) { const q = await page.evaluate(() => { const a = window.__stotkal; const ts = Object.values(a.S.map.tiles); const t = ts[Math.floor(Math.random() * ts.length)]; const p = a.renderer.xy(t.q, t.r); const r = document.getElementById('map').getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y - 4 }; }); if (!(await page.evaluate(() => !!window.__stotkal.ui.modal))) await page.mouse.click(q.x, q.y); }
  await page.waitForTimeout(8);
}
const final = await page.evaluate(() => ({ turn: window.__stotkal.S.turn, over: window.__stotkal.S.over }));
console.log(`clicks ${clicks}, commits ${commits}, turns visited ${[...turnsSeen].filter(Boolean).length}, final turn ${final.turn}, over ${final.over}`);
console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'no console errors'); await browser.close();
