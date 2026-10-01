import { launch } from './shot.mjs';
async function run(w, h, scale, name, motion) {
  const { browser, page, errors } = await launch(w, h, motion ? { reducedMotion: 'reduce' } : {});
  await page.goto('http://localhost:8765/?seed=demo&auto=1'); await page.waitForTimeout(500);
  await page.evaluate(async (scale) => { const a = window.__stotkal; a.settings.textScale = scale; document.documentElement.style.setProperty('--scale', scale); const R = await import('/src/sim/rival.js'); const E = await import('/src/sim/resolve.js'); while (a.S.turn < 13) { R.planAs(a.S, 'you', 'veil', 'embodied'); E.endTurn(a.S); } a.ui.modal = null; a.ui.guideOff = false; window.dispatchEvent(new Event('resize')); document.querySelector('[data-act="sheet"][data-s="quiet"]').click(); }, scale);
  await page.waitForTimeout(400); await page.screenshot({ path: `screenshots/${name}.png` });
  // overflow checks: any essential control outside the viewport?
  const issues = await page.evaluate(() => { const out = []; const vw = innerWidth, vh = innerHeight; for (const sel of ['[data-act="endturn"]', '#top .res', '#top .orders', '.qchip']) { const el = document.querySelector(sel); if (!el) { out.push('missing ' + sel); continue; } const r = el.getBoundingClientRect(); if (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1) out.push(`${sel} offscreen ${JSON.stringify([r.left, r.top, r.right, r.bottom].map(Math.round))}`); } if (document.documentElement.scrollWidth > innerWidth + 1) out.push('horizontal scroll ' + document.documentElement.scrollWidth); return out; });
  console.log(name, errors.length ? errors.join('|') : 'no errors', issues.length ? issues.join('; ') : 'layout ok');
  await browser.close();
}
await run(1024, 640, 1, '20-small-1024x640');
await run(800, 600, 1, '21-small-800x600');
await run(1440, 900, 1.4, '22-text-140pct');
await run(1280, 720, 1, '23-reduced-motion', true);
