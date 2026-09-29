// Renders video.html frame by frame with headless Chromium and encodes an H.264 MP4.
// Usage: node render.mjs [out.mp4] [--fps 30] [--stills]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const out = args.find(a => a.endsWith('.mp4')) || path.join(dir, 'marsh-energy-upstream-ago2026.mp4');
const fps = Number(args[args.indexOf('--fps') + 1]) || 30;
const stills = args.includes('--stills');
const ffmpeg = process.env.FFMPEG || 'ffmpeg';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.addInitScript(() => { window.__RENDERING__ = true; });
await page.goto('file://' + path.join(dir, 'video.html'));
await page.evaluate(() => document.fonts.ready);
const duration = await page.evaluate(() => window.DURATION);

if (stills) {
  for (const t of [2.2, 6.5, 11, 15.5, 20, 23.8, 26.4, 29.4]) {
    await page.evaluate(t => window.render(t), t);
    await page.screenshot({ path: path.join(dir, `still-${String(t).replace('.', '_')}.png`) });
  }
  await browser.close();
  process.exit(0);
}

const enc = spawn(ffmpeg, [
  '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', out,
], { stdio: ['pipe', 'inherit', 'inherit'] });

const frames = Math.round(duration * fps);
for (let i = 0; i < frames; i++) {
  await page.evaluate(t => window.render(t), i / fps);
  const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
  if (!enc.stdin.write(buf)) await new Promise(r => enc.stdin.once('drain', r));
  if (i % 150 === 0) console.log(`frame ${i}/${frames}`);
}
enc.stdin.end();
await new Promise(r => enc.on('close', r));
await browser.close();
console.log('wrote', out);
