// Paints the whole world once into an offscreen canvas as continuous terrain: the hex grid exists only as rules.
// Technique: every pixel samples the tile map several times through a noise-warped lookup, so boundaries wobble and blend,
// then relief is lit from a height field. No external assets: everything is procedural.
import { hashStr } from '../sim/rng.js';
import { key } from '../sim/hex.js';

const CODE = { desert: 1, garden: 2, lake: 3, coast: 4, ridge: 5, infra: 6 };
const ALB = { 1: [233, 223, 199], 2: [184, 207, 148], 3: [40, 56, 96], 4: [216, 223, 226], 5: [172, 188, 212], 6: [217, 210, 224] };
const HGT = { 1: 0.10, 2: 0.13, 3: -0.2, 4: 0.04, 5: 0.62, 6: 0.10 };

function makeNoise(seed) {
  const N = 256; const tab = new Float32Array(N * N); for (let i = 0; i < N * N; i++) tab[i] = (hashStr(seed + ':' + i) % 10000) / 10000;
  const at = (x, y) => tab[((y & 255) << 8) | (x & 255)];
  const sm = (t) => t * t * (3 - 2 * t);
  const n1 = (x, y) => { const x0 = Math.floor(x), y0 = Math.floor(y); const fx = sm(x - x0), fy = sm(y - y0); const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; };
  return { n1, fbm: (x, y) => n1(x, y) * 0.55 + n1(x * 2.03 + 11, y * 2.03 + 5) * 0.3 + n1(x * 4.1 + 3, y * 4.1 + 17) * 0.15 };
}

export function worldBounds(R, Rb, YS) {
  const w = Rb * Math.sqrt(3) * (2 * R + 1) + Rb * 2, h = Rb * 1.5 * YS * (2 * R) + Rb * 3.2;
  return { minX: -w / 2, minY: -h / 2, w, h };
}
export const tileWorld = (q, r, Rb, YS) => ({ x: Rb * Math.sqrt(3) * (q + r / 2), y: Rb * 1.5 * r * YS });

export function paintTerrain(S, Rb, YS, scale = 1.5) {
  const R = S.map.R; const side = 2 * R + 1; const grid = new Uint8Array(side * side);
  for (const t of Object.values(S.map.tiles)) grid[(t.q + R) + (t.r + R) * side] = CODE[t.t];
  const B = worldBounds(R, Rb, YS); const W = Math.ceil(B.w * scale), H = Math.ceil(B.h * scale);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d'); const img = g.createImageData(W, H); const px = img.data;
  const noise = makeNoise(S.seed + ':terrain'); const heights = new Float32Array(W * H); const wsum = new Float32Array(W * H); const SQ3 = Math.sqrt(3);
  const lookup = (x, y) => { // world -> tile code through cube rounding
    const yy = y / YS; const qf = (SQ3 / 3 * x - yy / 3) / Rb, rf = (2 / 3 * yy) / Rb; let q = Math.round(qf), r = Math.round(rf), s = Math.round(-qf - rf);
    const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s + qf + rf); if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
    if (q < -R || q > R || r < -R || r > R || Math.abs(q + r) > R) return 0; return grid[(q + R) + (r + R) * side];
  };
  const offs = [[0, 0], [0.55, 0.3], [-0.5, 0.45], [0.2, -0.6], [-0.4, -0.35]]; const wamp = Rb * 0.9;
  for (let py = 0; py < H; py++) {
    for (let pxx = 0; pxx < W; pxx++) {
      const wx = B.minX + pxx / scale, wy = B.minY + py / scale; const i = py * W + pxx;
      const wxn = (noise.fbm(wx * 0.045, wy * 0.07) - 0.5) * wamp, wyn = (noise.fbm(wx * 0.045 + 31, wy * 0.07 + 17) - 0.5) * wamp * YS;
      const cnt = [0, 0, 0, 0, 0, 0, 0]; let any = 0;
      for (const [ox, oy] of offs) { const c = lookup(wx + wxn + ox * Rb * 0.5, wy + wyn + oy * Rb * 0.5 * YS); cnt[c]++; if (c) any++; }
      const alpha = any / offs.length; if (alpha === 0) { px[i * 4 + 3] = 0; continue; }
      const nv = noise.fbm(wx * 0.11, wy * 0.16); const nv2 = noise.n1(wx * 0.5, wy * 0.7);
      let r = 0, gg = 0, b = 0, h = 0, wt = 0;
      for (let c = 1; c <= 6; c++) {
        const w8 = cnt[c]; if (!w8) continue; const a = ALB[c]; let cr = a[0], cg = a[1], cb = a[2]; let hh = HGT[c];
        const v = (nv - 0.5) * 0.28;
        if (c === 1) { const rip = Math.sin((wx * 0.22 + wy * 0.5) + nv * 9) * 0.035; cr += (v + rip) * 120; cg += (v + rip) * 110; cb += (v + rip) * 90; hh += rip * 0.4; }
        else if (c === 2) { cr += v * 100; cg += v * 120; cb += v * 90; if (nv2 > 0.93) { cr = 255; cg = 193; cb = 223; } else if (nv2 < 0.18) { cr -= 30; cg -= 22; cb -= 28; } hh += (nv - 0.5) * 0.1; }
        else if (c === 4) { cr += v * 70; cg += v * 70; cb += v * 70; if (nv2 > 0.9) { cr = 245; cg = 247; cb = 250; } }
        else if (c === 5) { hh += (nv - 0.4) * 0.9 + Math.abs(noise.n1(wx * 0.09, wy * 0.13) - 0.5) * 0.8; cr += v * 60; cg += v * 70; cb += v * 100; }
        else if (c === 6) { cr += v * 70; cg += v * 70; cb += v * 80; }
        else if (c === 3) { const dp = 1 - Math.min(1, w8 / offs.length * 1.2); cr = 30 + 26 * (1 - dp) + (nv - 0.5) * 40; cg = 44 + 36 * (1 - dp) + (nv - 0.5) * 30; cb = 84 + 44 * (1 - dp) + (nv - 0.5) * 30; hh += (nv - 0.5) * 0.03; }
        r += cr * w8; gg += cg * w8; b += cb * w8; h += hh * w8; wt += w8;
      }
      px[i * 4] = r / wt; px[i * 4 + 1] = gg / wt; px[i * 4 + 2] = b / wt; px[i * 4 + 3] = Math.min(255, alpha * 255 * 1.25); heights[i] = h / wt; wsum[i] = cnt[3] / offs.length;
    }
  }
  // relief shading from the height field; water gets sky-coloured specular streaks instead
  const L = [-0.55, -0.7, 0.45];
  for (let py = 1; py < H - 1; py++) {
    for (let pxx = 1; pxx < W - 1; pxx++) {
      const i = py * W + pxx; if (px[i * 4 + 3] === 0) continue;
      const dx = heights[i + 1] - heights[i - 1], dy = heights[i + W] - heights[i - W]; const nz = 0.05; const nl = Math.hypot(dx, dy, nz);
      const lit = Math.max(-0.4, Math.min(0.6, (-dx * L[0] - dy * L[1] + nz * L[2]) / nl - 0.4)); const water = wsum[i];
      const k = lit * (1 - water) * 150 + 0;
      px[i * 4] = Math.max(0, Math.min(255, px[i * 4] + k)); px[i * 4 + 1] = Math.max(0, Math.min(255, px[i * 4 + 1] + k)); px[i * 4 + 2] = Math.max(0, Math.min(255, px[i * 4 + 2] + k * 1.08));
      if (water > 0.6) { const wxs = B.minX + pxx / scale, wys = B.minY + py / scale; const streak = Math.sin(wys * 0.6 + noise.n1(wxs * 0.05, wys * 0.2) * 8); if (streak > 0.93) { px[i * 4] = Math.min(255, px[i * 4] + 90); px[i * 4 + 1] = Math.min(255, px[i * 4 + 1] + 60); px[i * 4 + 2] = Math.min(255, px[i * 4 + 2] + 110); } else if (streak < -0.96) { px[i * 4] += 70; px[i * 4 + 1] += 30; px[i * 4 + 2] += 40; } }
    }
  }
  g.putImageData(img, 0, 0);
  // luminous conduit lines between buried-infrastructure tiles (wirelines, rose and blue)
  const tiles = Object.values(S.map.tiles).filter(t => t.t === 'infra'); g.save(); g.scale(scale, scale); g.translate(-B.minX, -B.minY); g.lineCap = 'round';
  for (const a of tiles) for (const b2 of tiles) { if (a === b2 || key(a.q, a.r) > key(b2.q, b2.r)) continue; const d = (Math.abs(a.q - b2.q) + Math.abs(a.r - b2.r) + Math.abs(a.q + a.r - b2.q - b2.r)) / 2; if (d > 2) continue; const A = tileWorld(a.q, a.r, Rb, YS), Bq = tileWorld(b2.q, b2.r, Rb, YS);
    for (const [w, col] of [[3.5, 'rgba(137,168,255,0.18)'], [1.3, 'rgba(110,140,230,0.85)']]) { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(Bq.x, Bq.y); g.stroke(); } }
  for (const a of tiles) { const A = tileWorld(a.q, a.r, Rb, YS); g.fillStyle = '#fff'; g.beginPath(); g.arc(A.x, A.y, 2.2, 0, 7); g.fill(); g.fillStyle = 'rgba(255,193,223,0.9)'; g.beginPath(); g.arc(A.x, A.y, 4.2, 0, 7); g.globalAlpha = 0.35; g.fill(); g.globalAlpha = 1; }
  g.restore();
  // a dark offset silhouette gives the island thickness
  const sh = document.createElement('canvas'); sh.width = W; sh.height = H; const sg = sh.getContext('2d'); sg.drawImage(cv, 0, 0); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = 'rgba(30,34,60,0.55)'; sg.fillRect(0, 0, W, H);
  return { canvas: cv, shadow: sh, bounds: B, scale };
}
