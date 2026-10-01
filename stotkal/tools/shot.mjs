// Usage: node tools/shot.mjs  -> drives the real UI in headless Chromium, reports console errors and saves screenshots.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch (e) { pw = require(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright'); }
const { chromium } = pw;
export async function launch(w = 1440, h = 900, extra = {}) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, ...extra }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push('PAGEERROR ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n'))); page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
  return { browser, page, errors };
}
if (process.argv[1].endsWith('shot.mjs')) {
  const { browser, page, errors } = await launch();
  await page.goto('http://localhost:8765/'); await page.waitForTimeout(600);
  await page.screenshot({ path: 'screenshots/00-setup.png' });
  await page.click('[data-act="beginrun"]'); await page.waitForTimeout(800);
  await page.screenshot({ path: 'screenshots/01-start.png' });
  console.log(errors.join('\n') || 'no errors'); await browser.close();
}
