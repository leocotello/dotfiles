import { launch } from './shot.mjs';
const { browser, page, errors } = await launch(1440, 900);
await page.goto('http://localhost:8765/?seed=demo&auto=1'); await page.waitForTimeout(900);
await page.screenshot({ path: 'screenshots/01-start.png' });
console.log(errors.join('\n') || 'no errors'); await browser.close();
