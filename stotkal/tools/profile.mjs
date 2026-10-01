import { launch } from './browser.mjs';
const { browser, page, errors } = await launch(1440, 900);
await page.goto('http://localhost:8765/?seed=perf&auto=1'); await page.waitForTimeout(500);
const r = await page.evaluate(async () => {
  const a = window.__stotkal; const R = await import('/src/sim/rival.js'); const E = await import('/src/sim/resolve.js');
  const turns = []; while (a.S.turn < 22) { R.planAs(a.S, 'you', 'veil', 'embodied'); const t0 = performance.now(); E.endTurn(a.S); turns.push(performance.now() - t0); }
  a.ui.modal = null; const ui = { ...a.ui, settings: a.settings }; const N = 200; const t0 = performance.now(); for (let i = 0; i < N; i++) { ui.time = i * 33; a.renderer.draw(a.S, ui); } const draw = (performance.now() - t0) / N;
  a.settings.reducedMotion = true; const ui2 = { ...a.ui, settings: a.settings }; const t1 = performance.now(); for (let i = 0; i < N; i++) a.renderer.draw(a.S, ui2); const draw2 = (performance.now() - t1) / N;
  const t2 = performance.now(); for (let i = 0; i < 20; i++) { const P = a; } 
  const h0 = performance.now(); const m = await import('/src/ui/panels.js'); for (let i = 0; i < 50; i++) m.sidePanel(a); const panel = (performance.now() - h0) / 50;
  return { endTurnMs: +(turns.reduce((x, y) => x + y, 0) / turns.length).toFixed(2), endTurnMax: +Math.max(...turns).toFixed(2), drawMsAnimated: +draw.toFixed(2), drawMsStatic: +draw2.toFixed(2), sidePanelMs: +panel.toFixed(2) };
});
console.log(JSON.stringify(r)); console.log(errors.join('\n') || 'no errors'); await browser.close();
