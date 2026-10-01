// UI robustness fuzz: clicks random enabled controls (seeded) through a whole run, looking for console errors and dead ends.
//   node tools/serve.js &   node tools/fuzz-ui.mjs [seed] [steps]
import { launch } from './shot.mjs';
const seed = process.argv[2] || 'fuzz1'; const steps = +(process.argv[3] || 600);
const { browser, page, errors } = await launch(1366, 800);
page.on('console', m => { if (m.text().startsWith('progress')) console.log(m.text()); });
await page.goto('http://localhost:8765/?seed=' + seed + '&auto=1'); await page.waitForTimeout(600);
// the whole fuzz loop runs inside the page (fast); randomness is a seeded PRNG
const result = await page.evaluate(async ({ seed, steps }) => {
  let a = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7); const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const app = window.__stotkal; const SKIP = new Set(['newrun', 'exportsave', 'dbg', 'scrim', 'savenow', 'nextrun']);
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  let clicks = 0, commits = 0, mapclicks = 0; const turns = new Set(); const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < steps; i++) {
    if (i % 100 === 0) console.log('progress', i, 'turn', app.S.turn, 'modal', app.ui.modal && app.ui.modal.type);
    turns.add(app.S.turn); if (app.ui.modal && app.ui.modal.type === 'ending') break;
    if (i % 12 === 11) { const b = document.querySelector('[data-act="endturn"]'); if (!app.ui.modal && b) b.click(); if (app.ui.modal && app.ui.modal.type === 'commit') { document.querySelector('[data-act="commit"]').click(); commits++; } else if (app.ui.modal && app.ui.modal.type === 'summary') document.querySelector('[data-act="closemodal"]').click(); await sleep(5); continue; }
    if (app.ui.modal && app.ui.modal.type === 'commit') { document.querySelector('[data-act="commit"]').click(); commits++; await sleep(5); continue; }
    const cands = [...document.querySelectorAll('[data-act]')].filter(el => !el.disabled && !SKIP.has(el.dataset.act) && visible(el) && !(el.tagName === 'INPUT'));
    if (app.ui.modal && app.ui.modal.type !== 'ending' && rnd() < 0.3) { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await sleep(2); continue; }
    if (cands.length) { cands[Math.floor(rnd() * cands.length)].click(); clicks++; }
    if (!app.ui.modal && rnd() < 0.3) { const ts = Object.values(app.S.map.tiles); const t = ts[Math.floor(rnd() * ts.length)]; const p = app.renderer.xy(t.q, t.r); const r = document.getElementById('map').getBoundingClientRect(); const ev = (type) => new MouseEvent(type, { clientX: r.left + p.x, clientY: r.top + p.y - 4, bubbles: true }); const cv = document.getElementById('map'); cv.dispatchEvent(ev('mousedown')); window.dispatchEvent(ev('mouseup')); mapclicks++; }
    if (rnd() < 0.1) { const keys = ['s', 'x', 'o', 'f', 'e', 'd', 'q', 'a', 'l', 'g', 'u', 'c', 'm', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight', 'Escape']; window.dispatchEvent(new KeyboardEvent('keydown', { key: keys[Math.floor(rnd() * keys.length)], bubbles: true })); }
    await sleep(2);
  }
  return { clicks, commits, mapclicks, turns: turns.size, finalTurn: app.S.turn, over: app.S.over, modal: app.ui.modal && app.ui.modal.type };
}, { seed, steps });
console.log(JSON.stringify(result)); console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'no console errors'); await browser.close();
