// Canvas renderer: elevated three-quarter hex map. Reads simulation state, never changes it.
// Stotkal vocabulary: warm ivory ground, chrome, glass, wirelines, pale blue (#89A8FF) & rose (#FFC1DF) used with restraint.
import { TERRAIN, DISTRICTS, INSTITUTIONS, FACTIONS } from '../data/content.js';
import { key, neighbors, DIRS } from '../sim/hex.js';
import { hashStr } from '../sim/rng.js';
import { forecastLevel } from '../sim/quieting.js';
import { components, civCities } from '../sim/economy.js';

export const OWN = {
  you: { color: '#FFC1DF', dark: '#b8567f', glyph: '✦', dash: [], name: 'You' },
  conservatory: { color: '#89A8FF', dark: '#3f5fc0', glyph: '◇', dash: [9, 5], name: 'Conservatory' },
  signal: { color: '#E873B0', dark: '#962f6c', glyph: '▥', dash: [2, 4], name: 'Signal' },
  veil: { color: '#aeb6ca', dark: '#586280', glyph: '◐', dash: [14, 4, 2, 4], name: 'Veil' },
  ind: { color: '#d9d1c1', dark: '#857d6b', glyph: '○', dash: [1, 6], name: 'Independent' },
};
const YS = 0.62;
const H = { desert: 6, garden: 7, coast: 4, ridge: 17, infra: 6, lake: 0 };
const TOP = { desert: '#e8dec6', garden: '#c9d6ab', coast: '#d9dfe2', ridge: '#bccbdf', infra: '#d9d3de' };
const WALL = { desert: '#b8aa88', garden: '#8c9e6f', coast: '#a5b1b8', ridge: '#7b91ab', infra: '#968fa5' };
const h2 = (a, b, k = 0) => (hashStr(a + ',' + b + ',' + k) % 1000) / 1000;

export class Renderer {
  constructor(canvas) { this.c = canvas; this.g = canvas.getContext('2d'); this.view = { zoom: 1, px: 0, py: 0 }; this.panelW = 0; this.R = 40; this.ox = 0; this.oy = 0; this.t = 0; this.sky = null; }
  resize(panelW, topH, botH) {
    const dpr = Math.min(2, window.devicePixelRatio || 1); const w = this.c.clientWidth, h = this.c.clientHeight;
    if (this.c.width !== Math.round(w * dpr) || this.c.height !== Math.round(h * dpr)) { this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr); }
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0); this.W = w; this.H = h; this.panelW = panelW; this.topH = topH; this.botH = botH; this.fit();
  }
  fit() {
    const aw = this.W - this.panelW - 24, ah = this.H - this.topH - this.botH - 20;
    const base = Math.min(aw / (Math.sqrt(3) * 11.4), ah / (1.5 * 10.4 * YS + 2.4));
    this.R = Math.max(18, base) * this.view.zoom; this.ox = (this.W - this.panelW) / 2 + this.view.px; this.oy = this.topH + (ah / 2) + 10 + this.view.py;
  }
  focusOn(q, r, zoom = 1.45) { this.view.zoom = zoom; this.view.px = 0; this.view.py = 0; this.fit(); const p = this.xy(q, r); const cx = (this.W - this.panelW) / 2, cy = this.topH + (this.H - this.topH - this.botH) / 2; this.view.px = cx - p.x; this.view.py = cy - p.y; this.fit(); }
  xy(q, r) { return { x: this.ox + this.R * Math.sqrt(3) * (q + r / 2), y: this.oy + this.R * 1.5 * r * YS }; }
  pick(mx, my, tiles) {
    let best = null, bd = 1e9;
    for (const t of Object.values(tiles)) { const p = this.xy(t.q, t.r); const e = (H[t.t] || 0) * this.R / 40; const dx = mx - p.x, dy = my - (p.y - e); const d = dx * dx + (dy / YS) * (dy / YS); if (d < bd && d < (this.R * 0.95) ** 2) { bd = d; best = t; } }
    return best;
  }
  hexPath(g, cx, cy, R, lift = 0) { g.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i - 30); const x = cx + R * Math.cos(a), y = cy - lift + R * Math.sin(a) * YS; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); }

  draw(S, ui) {
    const g = this.g; this.t = ui.time || 0; const anim = !ui.settings.reducedMotion;
    this.fit(); g.clearRect(0, 0, this.W, this.H);
    this.drawSky(g, S, anim);
    const you = S.civs.you; const R = this.R; const tiles = S.map.tiles;
    const order = Object.values(tiles).sort((a, b) => a.r - b.r || a.q - b.q);
    const fl = forecastLevel(S, 'you');
    // ground plate shadow
    g.save(); g.fillStyle = 'rgba(40,44,64,0.07)'; g.beginPath(); g.ellipse(this.ox, this.oy + R * 1.6, R * 9.6, R * 3.8, 0, 0, Math.PI * 2); g.fill(); g.restore();
    for (const t of order) this.drawTile(g, S, t, you, ui, anim, fl);
    for (const t of order) this.drawBorders(g, S, t, you);
    this.drawNetwork(g, S, you, anim);
    if (ui.path) this.drawPath(g, S, ui.path);
    for (const t of order) { if (you.seen[key(t.q, t.r)] || ui.debugReveal) this.drawEntities(g, S, t, you, ui, anim); }
    // lingering last-known enemy markers
    for (const lk of Object.entries(you.lastKnown)) { const [id, m] = lk; const k = key(m.q, m.r); if (you.obs[k]) continue; const p = this.xy(m.q, m.r); this.drawLastKnown(g, p.x, p.y - H[tiles[k].t] * R / 40, m, S.turn); }
    for (const t of order) this.drawTileOverlay(g, S, t, you, ui);
    for (const t of order) { if (t.city && (you.seen[key(t.q, t.r)] || ui.debugReveal)) { const p = this.xy(t.q, t.r); const e = (H[t.t] || 0) * R / 40; this.drawCityLabel(g, S, S.cities[t.city], p.x, p.y - e, !!you.obs[key(t.q, t.r)] || ui.debugReveal); } }
    // chrome witness figure beside the capital
    const cap = S.cities[you.cap]; if (cap) { const p = this.xy(cap.q, cap.r); this.drawChrome(g, p.x + R * 0.7, p.y - R * 0.05, R * 0.55, anim); }
  }

  drawSky(g, S, anim) {
    const age = S.turn <= 10 ? 0 : S.turn <= 20 ? 1 : 2; const W = this.W, Hh = this.H; const t = this.t;
    const tops = ['#bcd0ff', '#c4cffa', '#cfd6ec'], mids = ['#e3ebff', '#f1e6f4', '#ece8ee'], bots = ['#f7f1ea', '#f9ece9', '#f1eeee'];
    const gr = g.createLinearGradient(0, 0, 0, Hh); gr.addColorStop(0, tops[age]); gr.addColorStop(0.5, mids[age]); gr.addColorStop(1, bots[age]); g.fillStyle = gr; g.fillRect(0, 0, W, Hh);
    // rose horizon light
    const rg = g.createRadialGradient(W * 0.3, Hh * 0.95, 10, W * 0.3, Hh * 0.95, Hh * 0.9); rg.addColorStop(0, `rgba(255,193,223,${0.34 + age * 0.06})`); rg.addColorStop(1, 'rgba(255,193,223,0)'); g.fillStyle = rg; g.fillRect(0, 0, W, Hh);
    // giant, faint chrome sleeper far behind the map: scale creates strangeness
    g.save(); g.globalAlpha = 0.10; this.drawChrome(g, W * 0.12, Hh * 0.62, Hh * 0.55, false, true); g.restore();
    // clouds
    for (let i = 0; i < 7; i++) {
      const sp = 0.004 + i * 0.0012; const x = ((i * 0.19 + (anim ? t * sp : 0)) % 1.3 - 0.15) * W; const y = Hh * (0.07 + (i % 4) * 0.075);
      g.save(); g.globalAlpha = 0.55 - (i % 3) * 0.1; g.fillStyle = '#fff'; for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(x + k * 34 - 50, y + (k % 2) * 6, 56 - k * 7, 17 - k * 2, 0, 0, Math.PI * 2); g.fill(); } g.restore();
    }
    // Reckoning: desynchronised light bands (readable, not screen-filling)
    if (S.quiet.stage >= 1) { g.save(); g.globalAlpha = 0.07 + 0.03 * S.quiet.stage; g.strokeStyle = '#E873B0'; g.lineWidth = 1; for (let i = 0; i < 8; i++) { const y = Hh * (0.1 + i * 0.045) + (anim ? Math.sin(t * 0.0003 + i) * 3 : 0); g.beginPath(); g.moveTo(0, y); g.lineTo(W * (0.25 + 0.1 * (i % 3)), y); g.stroke(); } g.restore(); }
  }

  drawChrome(g, x, y, h, anim, giant) { // reflective chrome humanoid silhouette
    const w = h * 0.24; const gr = g.createLinearGradient(x - w, y - h, x + w, y); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, '#aebbd0'); gr.addColorStop(0.6, '#5b6682'); gr.addColorStop(1, '#e8ecf5');
    g.save(); g.fillStyle = gr; g.strokeStyle = 'rgba(30,34,52,0.45)'; g.lineWidth = 0.8;
    g.beginPath(); g.ellipse(x, y - h * 0.9, w * 0.42, h * 0.075, 0, 0, Math.PI * 2); g.fill(); g.stroke(); // head
    g.beginPath(); g.moveTo(x - w * 0.15, y - h * 0.82); g.lineTo(x + w * 0.15, y - h * 0.82); g.lineTo(x + w * 0.55, y - h * 0.7); g.lineTo(x + w * 0.4, y - h * 0.33); g.lineTo(x + w * 0.28, y); g.lineTo(x + w * 0.04, y); g.lineTo(x, y - h * 0.3); g.lineTo(x - w * 0.04, y); g.lineTo(x - w * 0.28, y); g.lineTo(x - w * 0.4, y - h * 0.33); g.lineTo(x - w * 0.55, y - h * 0.7); g.closePath(); g.fill(); g.stroke();
    g.globalAlpha *= 0.8; g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(x - w * 0.08, y - h * 0.78, w * 0.06, h * 0.4); // specular
    g.restore();
  }

  drawTile(g, S, t, you, ui, anim, fl) {
    const k = key(t.q, t.r); const seen = !!you.seen[k] || ui.debugReveal; const obs = !!you.obs[k] || ui.debugReveal; const { x, y } = this.xy(t.q, t.r); const R = this.R; const e = (H[t.t] || 0) * R / 40;
    if (!seen) { // unexplored: a dark neutral void with a thin plate edge
      this.hexPath(g, x, y, R * 0.97, 0); g.fillStyle = 'rgba(52,56,78,0.64)'; g.fill(); g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 1; g.stroke(); return;
    }
    const T = t.t; const isLake = T === 'lake';
    if (!isLake) { // side walls
      const pts = []; for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i - 30); pts.push([x + R * Math.cos(a), y + R * Math.sin(a) * YS]); }
      g.fillStyle = WALL[T]; for (const [i, j] of [[0, 1], [1, 2], [2, 3]]) { g.beginPath(); g.moveTo(pts[i][0], pts[i][1] - e); g.lineTo(pts[j][0], pts[j][1] - e); g.lineTo(pts[j][0], pts[j][1] + 1); g.lineTo(pts[i][0], pts[i][1] + 1); g.closePath(); g.fillStyle = i === 1 ? this.shade(WALL[T], -0.12) : WALL[T]; g.fill(); }
    }
    this.hexPath(g, x, y, R, e);
    if (isLake) { const gr = g.createLinearGradient(x, y - R * YS, x, y + R * YS); gr.addColorStop(0, '#46557a'); gr.addColorStop(1, '#1b2239'); g.fillStyle = gr; }
    else { const v = (h2(t.q, t.r) - 0.5) * 0.06; g.fillStyle = this.shade(TOP[T], v); }
    g.fill(); g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 1; g.stroke();
    // material details
    g.save(); this.hexPath(g, x, y, R, e); g.clip();
    const cy = y - e;
    if (T === 'desert') { g.strokeStyle = 'rgba(150,130,90,0.22)'; g.lineWidth = 1; for (let i = -2; i <= 2; i++) { const yy = cy + i * R * 0.16 * YS * 2; g.beginPath(); g.moveTo(x - R, yy + h2(t.q, t.r, i) * 4); g.lineTo(x + R, yy - h2(t.r, t.q, i) * 4); g.stroke(); } }
    if (T === 'garden') { for (let i = 0; i < 7; i++) { const px = x + (h2(t.q, t.r, i) - 0.5) * R * 1.4, py = cy + (h2(t.r, t.q, i + 9) - 0.5) * R * 0.9; g.fillStyle = i % 3 === 0 ? '#ffc1df' : i % 3 === 1 ? '#7fa06a' : '#a9c48a'; g.beginPath(); g.arc(px, py, R * 0.05 + h2(i, t.q) * R * 0.04, 0, 7); g.fill(); } }
    if (T === 'coast') { g.strokeStyle = 'rgba(137,168,255,0.35)'; g.lineWidth = 1.2; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(x + R * 0.1, cy + R * 0.1, R * (0.3 + i * 0.18), Math.PI * 0.1, Math.PI * 0.9); g.stroke(); } }
    if (T === 'ridge') { for (let i = 0; i < 5; i++) { const px = x + (h2(t.q, t.r, i) - 0.5) * R * 1.1, py = cy + (h2(t.r, t.q, i) - 0.4) * R * 0.5; g.beginPath(); g.moveTo(px, py - R * 0.5); g.lineTo(px - R * 0.16, py + R * 0.12); g.lineTo(px + R * 0.14, py + R * 0.12); g.closePath(); const gr = g.createLinearGradient(px - R * 0.1, py - R * 0.5, px + R * 0.1, py); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.5, 'rgba(137,168,255,0.6)'); gr.addColorStop(1, 'rgba(90,110,160,0.7)'); g.fillStyle = gr; g.fill(); g.strokeStyle = 'rgba(40,50,90,0.35)'; g.stroke(); } }
    if (T === 'infra') { // wirelines in pink and blue, pulsing light along them
      g.lineWidth = 1.2; const ph = anim ? (this.t * 0.0004) % 1 : 0.3;
      for (let i = 0; i < 3; i++) { const a = h2(t.q, t.r, i) * Math.PI; const dx = Math.cos(a) * R, dy = Math.sin(a) * R * YS; g.strokeStyle = i === 1 ? 'rgba(232,115,176,0.55)' : 'rgba(110,140,230,0.6)'; g.beginPath(); g.moveTo(x - dx, cy - dy); g.lineTo(x + dx, cy + dy); g.stroke(); const px = x - dx + 2 * dx * ((ph + i * 0.3) % 1), py = cy - dy + 2 * dy * ((ph + i * 0.3) % 1); g.fillStyle = i === 1 ? '#ffc1df' : '#cfe0ff'; g.beginPath(); g.arc(px, py, 1.8, 0, 7); g.fill(); }
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(x, cy, R * 0.07, 0, 7); g.fill();
    }
    if (isLake) { const sh = anim ? Math.sin(this.t * 0.0007 + t.q) * R * 0.1 : 0; const gr = g.createLinearGradient(x - R, y, x + R, y); gr.addColorStop(0, 'rgba(255,193,223,0)'); gr.addColorStop(0.5, 'rgba(255,193,223,0.35)'); gr.addColorStop(1, 'rgba(137,168,255,0)'); g.fillStyle = gr; g.fillRect(x - R, y - R * 0.15 + sh, R * 2, R * 0.07); g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(x - R * 0.6, y + R * 0.18 - sh, R * 1.2, R * 0.04); }
    g.restore();
    // ownership tint
    if (t.owner && OWN[t.owner]) { this.hexPath(g, x, y, R, e); g.fillStyle = OWN[t.owner].color + '26'; g.fill(); }
    // Quieting exposure: desynchronised hatch (shown from forecast level 1; exact bands from level 2)
    if (fl >= 1 && ui.settings.quietLayer !== false && !isLake) {
      const reg = S.regions[t.region]; const lvl = fl >= 2 ? reg.exposure : (reg.exposure > 0 ? 1 : 0);
      if (lvl > 0) { g.save(); this.hexPath(g, x, y, R * 0.98, e); g.clip(); g.strokeStyle = lvl >= 2 ? 'rgba(232,115,176,0.5)' : 'rgba(137,168,255,0.45)'; g.lineWidth = 1; const n = lvl * 3; for (let i = -n; i <= n; i++) { const off = anim ? Math.sin(this.t * 0.001 + t.q * 2 + i) * 1.5 : 0; g.beginPath(); g.moveTo(x - R + i * R / n * 0.9, y - e - R * 0.7 + off); g.lineTo(x - R * 0.2 + i * R / n * 0.9, y - e + R * 0.7); g.stroke(); } g.restore(); }
    }
    if (!obs) { this.hexPath(g, x, y, R, e); g.fillStyle = 'rgba(70,74,96,0.30)'; g.fill(); }
  }
  shade(hex, amt) { const n = parseInt(hex.slice(1), 16); let r = n >> 16, gg = (n >> 8) & 255, b = n & 255; const f = (v) => Math.max(0, Math.min(255, Math.round(v + (amt > 0 ? (255 - v) * amt : v * amt)))); return `rgb(${f(r)},${f(gg)},${f(b)})`; }

  drawBorders(g, S, t, you) {
    if (!t.owner || !OWN[t.owner] || (!you.seen[key(t.q, t.r)])) return; const R = this.R; const { x, y } = this.xy(t.q, t.r); const e = (H[t.t] || 0) * R / 40; const o = OWN[t.owner];
    for (let i = 0; i < 6; i++) {
      const [dq, dr] = DIRS[(i + 5) % 6]; // edge i faces direction mapping below
    }
    const edgeDirs = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]]; // pointy-top: edge between vertex i-30deg.. ; i=0 right-bottom
    for (let i = 0; i < 6; i++) {
      const [dq, dr] = edgeDirs[i]; const nt = S.map.tiles[key(t.q + dq, t.r + dr)];
      if (nt && nt.owner === t.owner) continue;
      const a1 = Math.PI / 180 * (60 * i - 30), a2 = Math.PI / 180 * (60 * (i + 1) - 30);
      g.save(); g.strokeStyle = o.dark; g.lineWidth = 4; g.setLineDash([]); g.beginPath(); g.moveTo(x + R * Math.cos(a1), y - e + R * Math.sin(a1) * YS); g.lineTo(x + R * Math.cos(a2), y - e + R * Math.sin(a2) * YS); g.stroke();
      g.strokeStyle = o.color; g.lineWidth = 2.2; g.setLineDash(o.dash.length ? o.dash : []); g.stroke(); g.restore();
    }
  }
  drawNetwork(g, S, you, anim) { // luminous cables between connected cities; severed links drawn broken
    for (const civId of S.civOrder) {
      const civ = S.civs[civId]; if (civ.eliminated) continue; const cs = civCities(S, civId); if (cs.length < 2) continue; const comp = components(S, civId); const cap = S.cities[civ.cap]; if (!cap) continue;
      for (const c of cs) { if (c === cap) continue; if (!you.seen[key(c.q, c.r)] || !you.seen[key(cap.q, cap.r)]) continue; const a = this.xy(cap.q, cap.r), b = this.xy(c.q, c.r); const conn = comp[c.id] === comp[cap.id]; const o = OWN[civId];
        g.save(); g.lineWidth = 1.6; g.strokeStyle = conn ? o.color + 'cc' : 'rgba(80,60,90,0.55)'; g.setLineDash(conn ? [] : [4, 7]); g.beginPath(); g.moveTo(a.x, a.y - 14); g.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 - this.R * 0.9, b.x, b.y - 14); g.stroke();
        if (conn && anim) { const f = (this.t * 0.0003 + (c.q * 7 + c.r) * 0.13) % 1; const mx = (1 - f) * (1 - f) * a.x + 2 * (1 - f) * f * ((a.x + b.x) / 2) + f * f * b.x, my = (1 - f) * (1 - f) * (a.y - 14) + 2 * (1 - f) * f * ((a.y + b.y) / 2 - this.R * 0.9) + f * f * (b.y - 14); g.fillStyle = '#fff'; g.beginPath(); g.arc(mx, my, 2.4, 0, 7); g.fill(); }
        if (!conn) { g.setLineDash([]); g.fillStyle = '#9b3b72'; g.font = `bold ${Math.max(10, this.R * 0.28)}px system-ui`; g.fillText('✕ link', (a.x + b.x) / 2 - 12, (a.y + b.y) / 2 - this.R * 0.5); }
        g.restore(); }
    }
  }
  drawPath(g, S, path) {
    const R = this.R; g.save(); g.lineWidth = 3; g.strokeStyle = 'rgba(34,37,46,0.75)'; g.setLineDash([6, 5]); g.beginPath(); let first = true;
    for (const p of [path.from, ...path.steps]) { const { x, y } = this.xy(p.q, p.r); const e = (H[S.map.tiles[key(p.q, p.r)].t] || 0) * R / 40; first ? g.moveTo(x, y - e) : g.lineTo(x, y - e); first = false; } g.stroke(); g.setLineDash([]);
    path.steps.forEach((p, i) => { const { x, y } = this.xy(p.q, p.r); const br = path.breaks.some(b => b.q === p.q && b.r === p.r); g.fillStyle = br ? '#b0345f' : '#222'; g.beginPath(); g.arc(x, y - 6, 8, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = `bold 10px system-ui`; g.textAlign = 'center'; g.fillText(br ? '✕' : p.turn, x, y - 2.5); });
    g.restore();
  }
  drawLastKnown(g, x, y, m, turn) { const o = OWN[m.owner] || OWN.ind; g.save(); g.globalAlpha = 0.7; g.strokeStyle = o.dark; g.setLineDash([3, 3]); g.lineWidth = 1.5; g.beginPath(); g.arc(x, y - 8, this.R * 0.3, 0, 7); g.stroke(); g.setLineDash([]); g.fillStyle = o.dark; g.font = `${Math.max(9, this.R * 0.26)}px system-ui`; g.textAlign = 'center'; g.fillText(o.glyph + '?', x, y - 5); g.fillText(`${turn - m.turn}t old`, x, y + this.R * 0.36); g.restore(); }

  drawEntities(g, S, t, you, ui, anim) {
    const k = key(t.q, t.r); const obs = !!you.obs[k] || ui.debugReveal; const R = this.R; const { x, y } = this.xy(t.q, t.r); const e = (H[t.t] || 0) * R / 40; const by = y - e;
    if (t.site) this.drawSite(g, S, S.sites[t.site], x, by, you, anim);
    if (t.outpost && !t.city) { const o = OWN[t.outpost]; g.save(); g.fillStyle = o.dark; g.beginPath(); g.moveTo(x, by - R * 0.7); g.lineTo(x - R * 0.12, by); g.lineTo(x + R * 0.12, by); g.closePath(); g.fill(); g.fillStyle = o.color; g.beginPath(); g.moveTo(x, by - R * 0.7); g.lineTo(x + R * 0.28, by - R * 0.6); g.lineTo(x, by - R * 0.5); g.fill(); g.restore(); }
    if (t.city) this.drawCity(g, S, S.cities[t.city], x, by, anim, obs);
    if (obs) { const here = Object.values(S.armies).filter(a => a.q === t.q && a.r === t.r); here.forEach((a, i) => this.drawArmy(g, S, a, x + (t.city ? R * 0.55 : (i - (here.length - 1) / 2) * R * 0.5), by + (t.city ? R * 0.18 : R * 0.12), a.id === (ui.sel && ui.sel.army))); }
  }
  drawSite(g, S, s, x, y, you, anim) {
    const R = this.R; const d = you.disc[s.id]; const pending = d && d.state === 'pending'; const done = s.state !== 'open' || (d && d.state === 'done');
    g.save(); g.translate(x, y - R * 0.05); const sc = R / 34; g.scale(sc, sc);
    if (pending) { const pulse = anim ? 1 + Math.sin(this.t * 0.004) * 0.15 : 1; g.strokeStyle = 'rgba(255,193,223,0.95)'; g.lineWidth = 2.2; g.beginPath(); g.ellipse(0, 2, 22 * pulse, 9 * pulse, 0, 0, 7); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.strokeStyle = done ? '#7b829b' : '#2b3150'; g.lineWidth = 1.6;
    switch (s.type) {
      case 'choir_engine': for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(i * 9, 0); g.lineTo(i * 9, -24 + Math.abs(i) * 6); g.stroke(); g.beginPath(); g.arc(i * 9, -26 + Math.abs(i) * 6, 3.4, 0, 7); g.fill(); g.stroke(); } break;
      case 'sleeping_orchard': g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -16); g.stroke(); for (const [dx, dy] of [[-8, -22], [8, -22], [0, -29]]) { g.beginPath(); g.arc(dx, dy, 7, 0, 7); g.fillStyle = 'rgba(190,225,170,0.95)'; g.fill(); g.stroke(); } break;
      case 'mirror_well': g.beginPath(); g.ellipse(0, -14, 10, 17, 0, 0, 7); const gr = g.createLinearGradient(-10, -30, 10, 2); gr.addColorStop(0, '#fff'); gr.addColorStop(0.5, '#a9bcff'); gr.addColorStop(1, '#ffc1df'); g.fillStyle = gr; g.fill(); g.stroke(); break;
      case 'monolith': g.beginPath(); g.moveTo(-8, 0); g.lineTo(-5, -36); g.lineTo(0, -42); g.lineTo(5, -36); g.lineTo(8, 0); g.closePath(); const g2 = g.createLinearGradient(-8, 0, 8, -40); g2.addColorStop(0, '#ccd6ee'); g2.addColorStop(1, '#fff'); g.fillStyle = g2; g.fill(); g.stroke(); g.fillStyle = '#ffc1df'; for (let i = 0; i < 4; i++) { g.fillRect(-2 + (i % 2) * 2, -10 - i * 7, 2.4, 2.4); } break;
      case 'weather_loom': g.beginPath(); g.rect(-13, -28, 26, 28); g.stroke(); for (let i = -9; i <= 9; i += 4.5) { g.beginPath(); g.moveTo(i, -28); g.lineTo(i + 3, 0); g.strokeStyle = 'rgba(137,168,255,0.9)'; g.stroke(); } g.strokeStyle = '#2b3150'; break;
      case 'glass_cradle': g.beginPath(); g.roundRect(-15, -16, 30, 16, 8); g.fillStyle = 'rgba(210,228,255,0.85)'; g.fill(); g.stroke(); g.fillStyle = '#ffc1df'; for (const dx of [-8, 0, 8]) { g.beginPath(); g.ellipse(dx, -8, 2.4, 4, 0, 0, 7); g.fill(); } break;
      case 'anomaly': g.beginPath(); g.arc(0, -14, 12, 0.35, Math.PI * 2 - 0.9); g.stroke(); g.beginPath(); g.arc(0, -14, 5, 0, 7); g.fillStyle = '#E873B0'; g.fill(); if (s.invest.you) { g.strokeStyle = '#4a7c59'; g.beginPath(); g.moveTo(-6, -14); g.lineTo(-2, -9); g.lineTo(7, -20); g.stroke(); } break;
      case 'meridian_spire': g.beginPath(); g.moveTo(-5, 0); g.lineTo(0, -52); g.lineTo(5, 0); g.closePath(); const g3 = g.createLinearGradient(0, 0, 0, -52); g3.addColorStop(0, '#9aaad8'); g3.addColorStop(1, '#fff'); g.fillStyle = g3; g.fill(); g.stroke(); g.beginPath(); g.ellipse(0, -30, 14, 4, 0, 0, 7); g.strokeStyle = '#E873B0'; g.stroke(); break;
      case 'legacy_ruin': g.beginPath(); g.moveTo(-12, 0); g.lineTo(-12, -14); g.lineTo(-6, -20); g.lineTo(-2, -12); g.lineTo(4, -22); g.lineTo(12, -8); g.lineTo(12, 0); g.closePath(); g.fillStyle = 'rgba(230,224,210,0.95)'; g.fill(); g.stroke(); break;
    }
    if (done && s.type !== 'meridian_spire') { g.fillStyle = '#4a7c59'; g.font = 'bold 14px system-ui'; g.fillText('✓', 10, -28); }
    g.restore();
  }
  drawCity(g, S, c, x, y, anim, obs) {
    const R = this.R; const sc = R / 40; const owner = c.owner || 'ind'; const o = OWN[owner]; const civ = S.civs[owner]; g.save(); g.translate(x, y); g.scale(sc, sc);
    g.fillStyle = 'rgba(30,34,52,0.18)'; g.beginPath(); g.ellipse(0, 3, 24, 9, 0, 0, 7); g.fill();
    const plinth = (w) => { const gr = g.createLinearGradient(-w, 0, w, 0); gr.addColorStop(0, '#f4efe4'); gr.addColorStop(1, '#cfc7b4'); g.fillStyle = gr; g.beginPath(); g.moveTo(-w, 0); g.lineTo(-w + 3, -7); g.lineTo(w - 3, -7); g.lineTo(w, 0); g.closePath(); g.fill(); g.strokeStyle = 'rgba(40,44,64,0.4)'; g.lineWidth = 1; g.stroke(); };
    const chrome = (x0, y0, w, h) => { const gr = g.createLinearGradient(x0 - w, 0, x0 + w, 0); gr.addColorStop(0, '#fff'); gr.addColorStop(0.4, '#aab7cf'); gr.addColorStop(0.7, '#5d6985'); gr.addColorStop(1, '#dfe5f2'); g.fillStyle = gr; g.beginPath(); g.moveTo(x0 - w, y0); g.lineTo(x0 - w * 0.55, y0 - h); g.lineTo(x0, y0 - h - w * 0.8); g.lineTo(x0 + w * 0.55, y0 - h); g.lineTo(x0 + w, y0); g.closePath(); g.fill(); g.strokeStyle = 'rgba(30,34,52,0.5)'; g.lineWidth = 1; g.stroke(); };
    const pulse = anim ? (Math.sin(this.t * 0.003) + 1) / 2 : 0.5;
    if (owner === 'you') {
      plinth(22); chrome(0, -6, 6, 30); chrome(-12, -7, 3.5, 16); chrome(11, -7, 3.5, 20);
      const insts = civ.inst.filter(Boolean).map(s => INSTITUTIONS[s.id].visual);
      let slot = 0; for (const v of insts) { const bx = -26 + slot * 9; slot++; g.save(); g.translate(0, 2); g.lineWidth = 1.2; g.strokeStyle = '#2b3150';
        if (v === 'amphitheatre') { for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(bx + 6, 0, 4 + i * 3, Math.PI, 0); g.stroke(); } }
        if (v === 'doorways') { for (let i = 0; i < 2; i++) { g.beginPath(); g.moveTo(bx + i * 7, 0); g.lineTo(bx + i * 7, -12); g.arc(bx + i * 7 + 3, -12, 3, Math.PI, 0); g.lineTo(bx + i * 7 + 6, 0); g.strokeStyle = '#E873B0'; g.stroke(); } }
        if (v === 'cables') { g.strokeStyle = '#6e8ce6'; g.beginPath(); g.moveTo(bx, 0); g.lineTo(bx + 4, -22); g.lineTo(bx + 14, -16); g.stroke(); g.fillStyle = '#fff'; g.beginPath(); g.arc(bx + 4, -22, 2 + pulse * 1.5, 0, 7); g.fill(); }
        if (v === 'orchard') { for (let i = 0; i < 2; i++) { g.fillStyle = '#9fc48a'; g.beginPath(); g.arc(bx + i * 7, -10 - i * 2, 4.5, 0, 7); g.fill(); g.beginPath(); g.moveTo(bx + i * 7, 0); g.lineTo(bx + i * 7, -6); g.stroke(); } }
        if (v === 'mirrors') { const gr = g.createLinearGradient(bx, -18, bx + 8, 0); gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#a9bcff'); g.fillStyle = gr; g.beginPath(); g.moveTo(bx, 0); g.lineTo(bx + 2, -18); g.lineTo(bx + 10, -18); g.lineTo(bx + 8, 0); g.closePath(); g.fill(); g.stroke(); }
        if (v === 'monolith') { g.fillStyle = '#ccd6ee'; g.beginPath(); g.moveTo(bx, 0); g.lineTo(bx + 1, -24); g.lineTo(bx + 5, -26); g.lineTo(bx + 7, 0); g.closePath(); g.fill(); g.stroke(); g.fillStyle = '#ffc1df'; g.fillRect(bx + 2, -12, 2, 2); }
        if (v === 'loom') { g.strokeRect(bx, -20, 10, 20); for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(bx + i * 2.5, -20); g.lineTo(bx + i * 2.5 + 1, 0); g.strokeStyle = '#89A8FF'; g.stroke(); } }
        g.restore(); }
    } else if (owner === 'conservatory') { plinth(20); g.fillStyle = 'rgba(205,225,255,0.55)'; g.strokeStyle = '#5a76c8'; g.lineWidth = 1.4; g.beginPath(); g.arc(0, -7, 17, Math.PI, 0); g.closePath(); g.fill(); g.stroke(); g.fillStyle = '#7fa06a'; for (const dx of [-7, 0, 6]) { g.beginPath(); g.arc(dx, -10, 4, 0, 7); g.fill(); } g.strokeStyle = '#2b3150'; g.beginPath(); g.moveTo(0, -7); g.lineTo(0, -18); g.stroke(); this.drawChrome(g, 22, -2, 22, false); }
    else if (owner === 'signal') { plinth(22); for (const dx of [-14, -3, 9, 18]) { const hh = 22 + (Math.abs(dx) % 7) * 2; g.fillStyle = '#c9cfe0'; g.fillRect(dx - 2, -7 - hh, 4, hh); g.fillStyle = `rgba(232,115,176,${0.55 + pulse * 0.45})`; g.beginPath(); g.arc(dx, -9 - hh, 2.8, 0, 7); g.fill(); } g.strokeStyle = `rgba(232,115,176,${0.5 + pulse * 0.4})`; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-14, -35); for (const dx of [-3, 9, 18]) g.lineTo(dx, -35 - (dx % 3)); g.stroke(); }
    else if (owner === 'veil') { plinth(23); g.fillStyle = 'rgba(224,229,242,0.9)'; g.strokeStyle = '#586280'; g.lineWidth = 1.2; for (const [dx, w] of [[-12, 10], [12, 10]]) { g.beginPath(); g.moveTo(dx - w / 2, -7); g.lineTo(dx - w / 2, -20); g.arc(dx, -20, w / 2, Math.PI, 0); g.lineTo(dx + w / 2, -7); g.closePath(); g.fill(); g.stroke(); } const gr = g.createLinearGradient(-8, -8, 8, -24); gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#c9d2ee'); g.fillStyle = gr; g.fillRect(-7, -26, 14, 18); g.strokeRect(-7, -26, 14, 18); g.fillStyle = `rgba(255,193,223,${0.35 + pulse * 0.2})`; g.fillRect(-5, -24, 10, 5); }
    else { plinth(16); g.fillStyle = '#e9e0cf'; g.strokeStyle = '#857d6b'; g.lineWidth = 1.2; for (const dx of [-8, 6]) { g.beginPath(); g.moveTo(dx - 5, -7); g.lineTo(dx - 5, -16); g.lineTo(dx, -21); g.lineTo(dx + 5, -16); g.lineTo(dx + 5, -7); g.closePath(); g.fill(); g.stroke(); } }
    g.restore();
  }
  drawCityLabel(g, S, c, x, y, obs) {
    const R = this.R; const owner = c.owner || 'ind'; const o = OWN[owner];
    const nameY = y + R * 0.38; g.save(); const fs = Math.max(10, R * 0.27); g.font = `600 ${fs}px "Iowan Old Style", Palatino, Georgia, serif`; const label = `${o.glyph} ${c.name}`; const tw = g.measureText(label).width;
    g.fillStyle = 'rgba(250,247,240,0.92)'; g.strokeStyle = o.dark; g.lineWidth = 1.4; g.beginPath(); g.roundRect(x - tw / 2 - 8, nameY - fs * 0.85, tw + 16 + (obs ? fs * 2.8 : 0), fs * 1.5, 6); g.fill(); g.stroke();
    g.fillStyle = '#22252e'; g.textAlign = 'left'; g.fillText(label, x - tw / 2, nameY + fs * 0.1);
    if (obs) { g.font = `${fs * 0.85}px system-ui`; g.fillStyle = c.coh < 30 ? '#a42a54' : c.coh < 50 ? '#8a6a1a' : '#2b4a8a'; g.fillText(`${c.pop}♟ ${Math.round(c.coh)}`, x + tw / 2 + 12, nameY + fs * 0.1); }
    g.restore();
    if (obs && c.districts.length) { const w = R * 0.2; const x0 = x - (c.districts.length * (w + 2)) / 2; c.districts.forEach((d, i) => { g.fillStyle = '#fff'; g.strokeStyle = '#2b3150'; g.lineWidth = 1; g.fillRect(x0 + i * (w + 2), nameY + fs * 0.9, w, w); g.strokeRect(x0 + i * (w + 2), nameY + fs * 0.9, w, w); g.fillStyle = '#2b3150'; g.font = `bold ${w * 0.8}px system-ui`; g.textAlign = 'center'; g.fillText(DISTRICTS[d.type].icon, x0 + i * (w + 2) + w / 2, nameY + fs * 0.9 + w * 0.82); }); }
    if (c.project && c.owner === 'you') { g.save(); g.fillStyle = '#2b3150'; g.font = `${Math.max(9, R * 0.22)}px system-ui`; g.textAlign = 'center'; g.fillText('⚒ ' + c.project.remaining + 't', x, y - R * 1.15); g.restore(); }
    if (c.capital) { g.save(); g.fillStyle = o.dark; g.beginPath(); g.moveTo(x, y - R * 1.05); g.lineTo(x + 5, y - R * 1.2); g.lineTo(x, y - R * 1.35); g.lineTo(x - 5, y - R * 1.2); g.fill(); g.restore(); }
  }
  drawArmy(g, S, a, x, y, selected) {
    const R = this.R; const o = OWN[a.owner]; const str = a.regs.reduce((s, r) => s + r.str, 0); g.save();
    if (selected) { g.strokeStyle = '#222'; g.lineWidth = 2; g.beginPath(); g.ellipse(x, y, R * 0.34, R * 0.14, 0, 0, 7); g.stroke(); }
    g.fillStyle = 'rgba(30,34,52,0.2)'; g.beginPath(); g.ellipse(x, y + 1, R * 0.26, R * 0.09, 0, 0, 7); g.fill();
    const gr = g.createLinearGradient(x - 7, y - 24, x + 7, y); gr.addColorStop(0, '#fff'); gr.addColorStop(0.5, '#9aa8c4'); gr.addColorStop(1, '#4e5a78'); g.fillStyle = gr; g.strokeStyle = o.dark; g.lineWidth = 1.5;
    g.beginPath(); g.arc(x, y - R * 0.55, R * 0.1, 0, 7); g.fill(); g.stroke(); g.beginPath(); g.moveTo(x - R * 0.13, y - R * 0.42); g.lineTo(x + R * 0.13, y - R * 0.42); g.lineTo(x + R * 0.09, y); g.lineTo(x - R * 0.09, y); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = o.color; g.strokeStyle = o.dark; g.beginPath(); g.roundRect(x - R * 0.3, y - R * 0.95, R * 0.6, R * 0.28, 4); g.fill(); g.stroke(); g.fillStyle = '#22252e'; g.font = `bold ${Math.max(9, R * 0.22)}px system-ui`; g.textAlign = 'center'; g.fillText(`${o.glyph} ${str}`, x, y - R * 0.74);
    g.restore();
  }
  drawTileOverlay(g, S, t, you, ui) {
    const k = key(t.q, t.r); const { x, y } = this.xy(t.q, t.r); const R = this.R; const e = (H[t.t] || 0) * R / 40;
    if (ui.targeting && ui.targeting.potential && ui.targeting.potential.has(k)) { g.save(); g.fillStyle = 'rgba(34,37,46,0.75)'; g.font = `bold ${Math.max(11, R * 0.34)}px system-ui`; g.textAlign = 'center'; g.fillText('⌂', x, y - e + R * 0.1); g.restore(); }
    if (ui.targeting && ui.targeting.opens && ui.targeting.opens.has(k)) { g.save(); g.fillStyle = '#b8567f'; g.strokeStyle = '#fff'; g.lineWidth = 3; g.font = `bold ${Math.max(12, R * 0.4)}px system-ui`; g.textAlign = 'center'; g.strokeText('⌂+', x, y - e + R * 0.12); g.fillText('⌂+', x, y - e + R * 0.12); g.restore(); }
    if (ui.targeting) { const ok = ui.targeting.targets.has(k); this.hexPath(g, x, y, R * 0.94, e); if (ok) { g.strokeStyle = '#222'; g.lineWidth = 2.4; g.setLineDash([5, 3]); g.stroke(); g.setLineDash([]); g.fillStyle = 'rgba(255,255,255,0.22)'; g.fill(); } else if (you.seen[k]) { g.fillStyle = 'rgba(40,44,64,0.28)'; g.fill(); } }
    if (ui.sel && ui.sel.q === t.q && ui.sel.r === t.r) { this.hexPath(g, x, y, R * 0.98, e); g.strokeStyle = '#22252e'; g.lineWidth = 3; g.stroke(); this.hexPath(g, x, y, R * 0.92, e); g.strokeStyle = '#FFC1DF'; g.lineWidth = 2; g.stroke(); }
    if (ui.hover && ui.hover.q === t.q && ui.hover.r === t.r) { this.hexPath(g, x, y, R * 0.98, e); g.strokeStyle = 'rgba(34,37,46,0.55)'; g.lineWidth = 1.6; g.stroke(); }
  }
}
