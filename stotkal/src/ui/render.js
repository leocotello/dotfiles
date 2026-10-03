// Canvas renderer v2: a scrolling world camera over a painted, continuous map (the hex grid is only rules).
// Reads simulation state, never changes it. Layers: sky, painted terrain (cached), territory, network, entities, hero, soft fog, overlays, minimap.
import { TERRAIN, DISTRICTS, INSTITUTIONS, FACTIONS } from '../data/content.js';
import { THREAT_KINDS } from '../data/action.js';
import { key, neighbors, DIRS, dist } from '../sim/hex.js';
import { hashStr } from '../sim/rng.js';
import { forecastLevel } from '../sim/quieting.js';
import { components, civCities } from '../sim/economy.js';
import { paintTerrain, worldBounds, tileWorld } from './terrain.js';

export const OWN = {
  you: { color: '#FFC1DF', dark: '#b8567f', glyph: '✦', dash: [], name: 'You' },
  conservatory: { color: '#89A8FF', dark: '#3f5fc0', glyph: '◇', dash: [9, 5], name: 'Conservatory' },
  signal: { color: '#E873B0', dark: '#962f6c', glyph: '▥', dash: [2, 4], name: 'Signal' },
  veil: { color: '#aeb6ca', dark: '#586280', glyph: '◐', dash: [14, 4, 2, 4], name: 'Veil' },
  ind: { color: '#d9d1c1', dark: '#857d6b', glyph: '○', dash: [1, 6], name: 'Independent' },
};
const YS = 0.62; const Rb = 34;
const h2 = (a, b, k = 0) => (hashStr(a + ',' + b + ',' + k) % 1000) / 1000;
const SQ3 = Math.sqrt(3);

export class Renderer {
  constructor(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.cam = { x: 0, y: 0, zoom: 1.5 }; this.follow = true; this.panelW = 0; this.topH = 0; this.botH = 0; this.W = 0; this.H = 0; this.t = 0;
    this.terrain = null; this.terrainKey = null; this.fog = null; this.fogSig = ''; this.terr = null; this.terrSig = ''; this.haze = null; this.hazeSig = ''; this.borders = []; this.heroVis = null; this.lastHeroKey = null; this.mm = null; this.dragging = false;
  }
  get R() { return Rb * this.cam.zoom; }
  resize(panelW, topH, botH) {
    const dpr = Math.min(2, window.devicePixelRatio || 1); const w = this.c.clientWidth, h = this.c.clientHeight;
    if (this.c.width !== Math.round(w * dpr) || this.c.height !== Math.round(h * dpr)) { this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr); }
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0); this.W = w; this.H = h; this.panelW = panelW; this.topH = topH; this.botH = botH;
  }
  get cx() { return (this.W - this.panelW) / 2; } get cy() { return this.topH + (this.H - this.topH - this.botH) / 2; }
  w2s(wx, wy) { return { x: this.cx + (wx - this.cam.x) * this.cam.zoom, y: this.cy + (wy - this.cam.y) * this.cam.zoom }; }
  s2w(sx, sy) { return { x: this.cam.x + (sx - this.cx) / this.cam.zoom, y: this.cam.y + (sy - this.cy) / this.cam.zoom }; }
  xy(q, r) { const w = tileWorld(q, r, Rb, YS); return this.w2s(w.x, w.y); }
  focusOn(q, r, zoom) { const w = tileWorld(q, r, Rb, YS); this.cam.x = w.x; this.cam.y = w.y; if (zoom) this.cam.zoom = zoom; this.follow = true; }
  zoomBy(f) { this.cam.zoom = Math.max(0.7, Math.min(2.6, this.cam.zoom * f)); }
  pan(dx, dy) { this.cam.x -= dx / this.cam.zoom; this.cam.y -= dy / this.cam.zoom; this.follow = false; }
  ensureVisible(q, r) { const p = this.xy(q, r); const m = this.R * 1.4; const x0 = m, x1 = this.W - this.panelW - m, y0 = this.topH + m, y1 = this.H - this.botH - m; let dx = 0, dy = 0; if (p.x < x0) dx = x0 - p.x; else if (p.x > x1) dx = x1 - p.x; if (p.y < y0) dy = y0 - p.y; else if (p.y > y1) dy = y1 - p.y; if (dx || dy) { this.cam.x -= dx / this.cam.zoom; this.cam.y -= dy / this.cam.zoom; this.follow = false; } }
  pick(mx, my, tiles) {
    const w = this.s2w(mx, my); const yy = w.y / YS; const qf = (SQ3 / 3 * w.x - yy / 3) / Rb, rf = (2 / 3 * yy) / Rb; let q = Math.round(qf), r = Math.round(rf), s = Math.round(-qf - rf);
    const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s + qf + rf); if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s; return tiles[key(q, r)] || null;
  }
  hexPath(g, cx, cy, R) { g.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i - 30); const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a) * YS; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); }

  // ---------------------------------------------------------------- cached layers
  setWorld(S) {
    this.terrain = paintTerrain(S, Rb, YS, 1.5); this.terrainKey = S.seed + ':' + S.mapAttempt; this.fogSig = ''; this.terrSig = ''; this.hazeSig = ''; this.heroVis = null; this.lastHeroKey = null;
    const B = this.terrain.bounds; this.fog = document.createElement('canvas'); this.fog.width = Math.ceil(B.w / 8); this.fog.height = Math.ceil(B.h / 8);
    this.terr = document.createElement('canvas'); this.terr.width = Math.ceil(B.w / 2); this.terr.height = Math.ceil(B.h / 2); this.haze = document.createElement('canvas'); this.haze.width = Math.ceil(B.w / 4); this.haze.height = Math.ceil(B.h / 4);
  }
  layerHexes(S, canvas, div, fn) { // run fn(ctx, x, y, R, tile) for every tile in canvas coordinates
    const B = this.terrain.bounds; const g = canvas.getContext('2d'); for (const t of Object.values(S.map.tiles)) { const w = tileWorld(t.q, t.r, Rb, YS); fn(g, (w.x - B.minX) / div, (w.y - B.minY) / div, Rb / div, t); } return g;
  }
  updateFog(S) {
    const you = S.civs.you; const sig = Object.keys(you.seen).length + ':' + Object.keys(you.obs).length; if (sig === this.fogSig) return; this.fogSig = sig;
    const g = this.fog.getContext('2d'); g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, this.fog.width, this.fog.height); g.fillStyle = 'rgba(46,51,80,0.93)'; g.fillRect(0, 0, this.fog.width, this.fog.height);
    g.globalCompositeOperation = 'destination-out';
    this.layerHexes(S, this.fog, 8, (c, x, y, R, t) => { const k = key(t.q, t.r); if (you.seen[k]) { c.fillStyle = 'rgba(0,0,0,0.55)'; this.hexPath(c, x, y, R * 1.7); c.fill(); } });
    this.layerHexes(S, this.fog, 8, (c, x, y, R, t) => { const k = key(t.q, t.r); if (you.obs[k]) { c.fillStyle = 'rgba(0,0,0,0.4)'; this.hexPath(c, x, y, R * 1.7); c.fill(); } });
    g.globalCompositeOperation = 'source-over';
  }
  updateTerritory(S) {
    let sig = ''; for (const t of Object.values(S.map.tiles)) sig += (t.owner ? t.owner[0] : '.'); sig += S.turn; if (sig === this.terrSig) return; this.terrSig = sig;
    const g = this.terr.getContext('2d'); g.clearRect(0, 0, this.terr.width, this.terr.height);
    this.layerHexes(S, this.terr, 2, (c, x, y, R, t) => { if (t.owner && OWN[t.owner]) { c.fillStyle = OWN[t.owner].color + '55'; this.hexPath(c, x, y, R * 1.05); c.fill(); } });
    // organic border segments: each shared edge becomes a jittered 3-point polyline
    this.borders = []; const edgeDirs = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
    for (const t of Object.values(S.map.tiles)) { if (!t.owner || !OWN[t.owner]) continue; const w = tileWorld(t.q, t.r, Rb, YS);
      for (let i = 0; i < 6; i++) { const [dq, dr] = edgeDirs[i]; const n = S.map.tiles[key(t.q + dq, t.r + dr)]; if (n && n.owner === t.owner) continue;
        const a1 = Math.PI / 180 * (60 * i - 30), a2 = Math.PI / 180 * (60 * (i + 1) - 30); const ax = w.x + Rb * Math.cos(a1), ay = w.y + Rb * Math.sin(a1) * YS, bx = w.x + Rb * Math.cos(a2), by = w.y + Rb * Math.sin(a2) * YS;
        const j = (h2(t.q, t.r, i) - 0.5) * Rb * 0.5; this.borders.push({ ax, ay, bx, by, mx: (ax + bx) / 2 + j * 0.8, my: (ay + by) / 2 + j * 0.5 * YS, owner: t.owner, q: t.q, r: t.r }); } }
  }
  updateHaze(S, fl) {
    const sig = fl + ':' + S.turn + ':' + S.quiet.stage; if (sig === this.hazeSig) return; this.hazeSig = sig; const g = this.haze.getContext('2d'); g.clearRect(0, 0, this.haze.width, this.haze.height); if (fl < 1) return;
    this.layerHexes(S, this.haze, 4, (c, x, y, R, t) => { if (!TERRAIN[t.t].passable && t.t === 'lake') return; const reg = S.regions[t.region]; const lvl = fl >= 2 ? reg.exposure : (reg.exposure > 0 ? 1 : 0); if (!lvl) return; c.fillStyle = lvl >= 2 ? 'rgba(232,115,176,0.30)' : 'rgba(137,168,255,0.26)'; this.hexPath(c, x, y, R * 1.15); c.fill(); });
  }

  // ---------------------------------------------------------------- frame
  draw(S, ui) {
    if (!this.W) return; const g = this.g; this.t = ui.time || 0; const anim = !ui.settings.reducedMotion; const you = S.civs.you;
    if (this.terrainKey !== S.seed + ':' + S.mapAttempt || !this.terrain) this.setWorld(S);
    // camera: follow the Witness unless the player is looking around
    const hw = tileWorld(S.hero.q, S.hero.r, Rb, YS);
    if (this.follow) { this.cam.x += (hw.x - this.cam.x) * (anim ? 0.12 : 1); this.cam.y += (hw.y - this.cam.y) * (anim ? 0.12 : 1); }
    const B = this.terrain.bounds; { const Zc = this.cam.zoom; const clampAx = (v, lo, hi, mid) => lo > hi ? mid : Math.max(lo, Math.min(hi, v)); const vx = this.cx / Zc, vy = (this.H - this.topH - this.botH) / 2 / Zc; this.cam.x = clampAx(this.cam.x, B.minX + vx, B.minX + B.w - vx, B.minX + B.w / 2); this.cam.y = clampAx(this.cam.y, B.minY + vy, B.minY + B.h - vy, B.minY + B.h / 2); }
    g.clearRect(0, 0, this.W, this.H); this.drawSky(g, S, anim);
    const Z = this.cam.zoom; const o = this.w2s(B.minX, B.minY); const iw = this.terrain.canvas.width / this.terrain.scale * Z, ih = this.terrain.canvas.height / this.terrain.scale * Z;
    g.save(); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(this.terrain.shadow, o.x, o.y + 12 * Z, iw, ih); g.drawImage(this.terrain.shadow, o.x, o.y + 6 * Z, iw, ih); g.drawImage(this.terrain.canvas, o.x, o.y, iw, ih);
    this.updateTerritory(S); g.drawImage(this.terr, o.x, o.y, iw, ih);
    const fl = forecastLevel(S, 'you'); this.updateHaze(S, fl); if (ui.settings.quietLayer !== false && fl >= 1) { g.globalAlpha = anim ? 0.85 + 0.15 * Math.sin(this.t * 0.0015) : 0.9; g.drawImage(this.haze, o.x, o.y, iw, ih); g.globalAlpha = 1; }
    g.restore();
    this.drawBorders(g); this.drawNetwork(g, S, you, anim);
    if (anim) this.drawCloudShadows(g, B);
    // entities in painter's order (by screen y)
    const items = [];
    const seenT = (t) => you.seen[key(t.q, t.r)] || ui.debugReveal; const obsT = (t) => you.obs[key(t.q, t.r)] || ui.debugReveal;
    for (const t of Object.values(S.map.tiles)) { if (!seenT(t)) continue; const p = this.xy(t.q, t.r); if (p.x < -80 || p.x > this.W + 80 || p.y < -120 || p.y > this.H + 80) continue;
      if (t.site) items.push({ y: p.y, f: () => this.drawSite(g, S, S.sites[t.site], p.x, p.y, you, anim) });
      if (t.outpost && !t.city) items.push({ y: p.y, f: () => this.drawOutpost(g, p.x, p.y, t.outpost) });
      if (t.city) items.push({ y: p.y, f: () => this.drawCity(g, S, S.cities[t.city], p.x, p.y, anim, obsT(t)) }); }
    for (const a of Object.values(S.armies)) { const t = S.map.tiles[key(a.q, a.r)]; if (!obsT(t)) continue; const p = this.xy(a.q, a.r); items.push({ y: p.y + 2, f: () => this.drawArmy(g, S, a, p.x + (t.city ? this.R * 0.55 : 0), p.y + (t.city ? this.R * 0.18 : this.R * 0.12), a.id === (ui.sel && ui.sel.army)) }); }
    for (const th of Object.values(S.threats)) { const t = S.map.tiles[key(th.q, th.r)]; if (!obsT(t)) continue; const p = this.xy(th.q, th.r); items.push({ y: p.y + 3, f: () => this.drawThreat(g, S, th, p.x, p.y, anim, ui) }); }
    this.updateHeroVis(S, hw); items.push({ y: this.w2s(this.heroVis.x, this.heroVis.y).y + 4, f: () => this.drawHero(g, S, anim, ui) });
    items.sort((a, b) => a.y - b.y); for (const it of items) it.f();
    for (const [id, m] of Object.entries(you.lastKnown)) { const k = key(m.q, m.r); if (you.obs[k]) continue; const p = this.xy(m.q, m.r); this.drawLastKnown(g, p.x, p.y, m, S.turn); }
    // soft fog over everything the Witness cannot currently see
    if (!ui.debugReveal) { this.updateFog(S); g.save(); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(this.fog, o.x, o.y, iw, ih); g.restore(); }
    if (ui.path) this.drawPath(g, ui.path); if (ui.heroPath) this.drawHeroPath(g, S, ui.heroPath);
    for (const t of Object.values(S.map.tiles)) { if (!seenT(t) && !(ui.targeting && ui.targeting.targets && ui.targeting.targets.has(key(t.q, t.r)))) continue; if (this.inView(t)) this.drawOverlay(g, S, t, you, ui); }
    for (const t of Object.values(S.map.tiles)) if (t.city && seenT(t) && this.inView(t)) { const p = this.xy(t.q, t.r); this.drawCityLabel(g, S, S.cities[t.city], p.x, p.y, !!obsT(t)); }
    this.drawMinimap(g, S, you, ui);
  }
  inView(t) { const p = this.xy(t.q, t.r); return p.x > -60 && p.x < this.W + 60 && p.y > -80 && p.y < this.H + 60; }

  drawSky(g, S, anim) {
    const age = S.turn <= 10 ? 0 : S.turn <= 20 ? 1 : 2; const W = this.W, Hh = this.H; const t = this.t;
    const tops = ['#b7ccff', '#c4cffa', '#cdd5ec'], mids = ['#e3ebff', '#f1e6f4', '#ece8ee'], bots = ['#f7f1ea', '#f9ece9', '#f1eeee'];
    const gr = g.createLinearGradient(0, 0, 0, Hh); gr.addColorStop(0, tops[age]); gr.addColorStop(0.55, mids[age]); gr.addColorStop(1, bots[age]); g.fillStyle = gr; g.fillRect(0, 0, W, Hh);
    const rg = g.createRadialGradient(W * 0.3, Hh * 0.98, 10, W * 0.3, Hh * 0.98, Hh * 0.95); rg.addColorStop(0, `rgba(255,193,223,${0.34 + age * 0.06})`); rg.addColorStop(1, 'rgba(255,193,223,0)'); g.fillStyle = rg; g.fillRect(0, 0, W, Hh);
    g.save(); g.globalAlpha = 0.10; this.drawChrome(g, W * 0.1 - this.cam.x * 0.02, Hh * 0.7, Hh * 0.6, false); g.restore();
    for (let i = 0; i < 8; i++) { const sp = 0.004 + i * 0.0012; const x = ((i * 0.17 + (anim ? t * sp * 0.001 : 0) - this.cam.x * 0.00006) % 1.3 + 1.3) % 1.3 - 0.15; const y = Hh * (0.06 + (i % 4) * 0.07); g.save(); g.globalAlpha = 0.5 - (i % 3) * 0.1; g.fillStyle = '#fff'; for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(x * W + k * 34 - 50, y + (k % 2) * 6, 56 - k * 7, 17 - k * 2, 0, 0, Math.PI * 2); g.fill(); } g.restore(); }
    if (S.quiet.stage >= 1) { g.save(); g.globalAlpha = 0.07 + 0.03 * S.quiet.stage; g.strokeStyle = '#E873B0'; g.lineWidth = 1; for (let i = 0; i < 8; i++) { const y = Hh * (0.1 + i * 0.045) + (anim ? Math.sin(t * 0.0003 + i) * 3 : 0); g.beginPath(); g.moveTo(0, y); g.lineTo(W * (0.25 + 0.1 * (i % 3)), y); g.stroke(); } g.restore(); }
  }
  drawCloudShadows(g, B) {
    g.save(); g.fillStyle = 'rgba(40,50,90,0.07)'; for (let i = 0; i < 4; i++) { const wx = B.minX + ((i * 0.31 + this.t * 0.000012) % 1.2) * B.w - B.w * 0.1; const wy = B.minY + B.h * (0.2 + i * 0.2); const p = this.w2s(wx, wy); g.beginPath(); g.ellipse(p.x, p.y, 150 * this.cam.zoom, 40 * this.cam.zoom, 0, 0, 7); g.fill(); } g.restore();
  }
  drawBorders(g) {
    g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
    for (const b of this.borders) { const o = OWN[b.owner]; const a = this.w2s(b.ax, b.ay), m = this.w2s(b.mx, b.my), c = this.w2s(b.bx, b.by);
      g.strokeStyle = o.dark; g.lineWidth = 3.4; g.setLineDash([]); g.beginPath(); g.moveTo(a.x, a.y); g.quadraticCurveTo(m.x, m.y, c.x, c.y); g.stroke();
      g.strokeStyle = o.color; g.lineWidth = 1.8; g.setLineDash(o.dash.length ? o.dash : []); g.stroke(); }
    g.restore();
  }
  drawNetwork(g, S, you, anim) {
    for (const civId of S.civOrder) { const civ = S.civs[civId]; if (civ.eliminated) continue; const cs = civCities(S, civId); if (cs.length < 2) continue; const comp = components(S, civId); const cap = S.cities[civ.cap]; if (!cap) continue;
      for (const c of cs) { if (c === cap || !you.seen[key(c.q, c.r)] || !you.seen[key(cap.q, cap.r)]) continue; const a = this.xy(cap.q, cap.r), b = this.xy(c.q, c.r); const conn = comp[c.id] === comp[cap.id]; const o = OWN[civId]; const lift = this.R * 0.9;
        g.save(); g.lineWidth = 1.6; g.strokeStyle = conn ? o.color + 'cc' : 'rgba(80,60,90,0.55)'; g.setLineDash(conn ? [] : [4, 7]); g.beginPath(); g.moveTo(a.x, a.y - 14); g.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 - lift, b.x, b.y - 14); g.stroke();
        if (conn && anim) { const f = (this.t * 0.0003 + (c.q * 7 + c.r) * 0.13) % 1; const mx = (1 - f) * (1 - f) * a.x + 2 * (1 - f) * f * ((a.x + b.x) / 2) + f * f * b.x, my = (1 - f) * (1 - f) * (a.y - 14) + 2 * (1 - f) * f * ((a.y + b.y) / 2 - lift) + f * f * (b.y - 14); g.fillStyle = '#fff'; g.beginPath(); g.arc(mx, my, 2.4, 0, 7); g.fill(); }
        if (!conn) { g.setLineDash([]); g.fillStyle = '#9b3b72'; g.font = `bold ${Math.max(10, this.R * 0.28)}px system-ui`; g.fillText('✕ link', (a.x + b.x) / 2 - 12, (a.y + b.y) / 2 - lift * 0.5); } g.restore(); } }
  }
  drawOutpost(g, x, y, owner) { const R = this.R; const o = OWN[owner]; g.save(); g.fillStyle = o.dark; g.beginPath(); g.moveTo(x, y - R * 0.7); g.lineTo(x - R * 0.12, y); g.lineTo(x + R * 0.12, y); g.closePath(); g.fill(); g.fillStyle = o.color; g.beginPath(); g.moveTo(x, y - R * 0.7); g.lineTo(x + R * 0.28, y - R * 0.6); g.lineTo(x, y - R * 0.5); g.fill(); g.restore(); }
  drawPath(g, path) {
    g.save(); g.lineWidth = 3; g.strokeStyle = 'rgba(34,37,46,0.75)'; g.setLineDash([6, 5]); g.beginPath(); let first = true;
    for (const p of [path.from, ...path.steps]) { const { x, y } = this.xy(p.q, p.r); first ? g.moveTo(x, y) : g.lineTo(x, y); first = false; } g.stroke(); g.setLineDash([]);
    path.steps.forEach((p) => { const { x, y } = this.xy(p.q, p.r); const br = path.breaks.some(b => b.q === p.q && b.r === p.r); g.fillStyle = br ? '#b0345f' : '#222'; g.beginPath(); g.arc(x, y - 6, 8, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 10px system-ui'; g.textAlign = 'center'; g.fillText(br ? '✕' : p.turn, x, y - 2.5); });
    g.restore();
  }

  // ---------------------------------------------------------------- the Witness
  updateHeroVis(S, hw) {
    const h = S.hero; const k = key(h.q, h.r);
    if (!this.heroVis) { this.heroVis = { x: hw.x, y: hw.y, queue: [], moving: false }; this.lastHeroKey = k; }
    if (k !== this.lastHeroKey) { // enqueue the steps taken since the last frame (the hero trail keeps the last twelve)
      const idx = h.trail.findIndex(p => key(p.q, p.r) === this.lastHeroKey); const steps = idx >= 0 ? h.trail.slice(idx + 1) : [{ q: h.q, r: h.r }];
      for (const s of steps) this.heroVis.queue.push(tileWorld(s.q, s.r, Rb, YS)); this.lastHeroKey = k;
    }
    const v = this.heroVis; const speed = 0.2; // world units per ms scaled
    if (v.queue.length) { const nx = v.queue[0]; const dx = nx.x - v.x, dy = nx.y - v.y; const d = Math.hypot(dx, dy); const step = Math.max(2.6, speed * 16 * 1.5); if (d <= step) { v.x = nx.x; v.y = nx.y; v.queue.shift(); } else { v.x += dx / d * step; v.y += dy / d * step; } v.moving = true; } else { v.moving = false; if (Math.hypot(hw.x - v.x, hw.y - v.y) > 1) { v.x = hw.x; v.y = hw.y; } }
  }
  drawHero(g, S, anim, ui) {
    const v = this.heroVis; const p = this.w2s(v.x, v.y); const R = this.R; const bob = anim && v.moving ? Math.abs(Math.sin(this.t * 0.02)) * R * 0.1 : (anim ? Math.sin(this.t * 0.003) * R * 0.02 : 0);
    // lantern glow showing how far she sees, then shadow and a chrome figure
    const gl = g.createRadialGradient(p.x, p.y - R * 0.4, 2, p.x, p.y - R * 0.4, R * 1.5); gl.addColorStop(0, 'rgba(255,230,242,0.55)'); gl.addColorStop(1, 'rgba(255,193,223,0)'); g.fillStyle = gl; g.beginPath(); g.arc(p.x, p.y - R * 0.4, R * 1.5, 0, 7); g.fill();
    g.fillStyle = 'rgba(30,34,52,0.28)'; g.beginPath(); g.ellipse(p.x, p.y + 2, R * 0.28, R * 0.1, 0, 0, 7); g.fill();
    if (anim && v.moving) { for (let i = 0; i < S.hero.trail.length && i < 6; i++) { const tp = this.xy(S.hero.trail[S.hero.trail.length - 1 - i].q, S.hero.trail[S.hero.trail.length - 1 - i].r); g.fillStyle = `rgba(255,193,223,${0.35 - i * 0.05})`; g.beginPath(); g.arc(tp.x, tp.y, 3 - i * 0.3, 0, 7); g.fill(); } }
    g.save(); g.globalAlpha = S.hero.frayed > 0 && anim ? 0.6 + 0.4 * Math.sin(this.t * 0.02) : 1; this.drawChrome(g, p.x, p.y - bob, R * 0.95, false); g.restore();
    g.save(); g.fillStyle = '#FFC1DF'; g.strokeStyle = '#b8567f'; g.lineWidth = 1.6; g.beginPath(); g.arc(p.x + R * 0.16, p.y - R * 0.5 - bob, R * 0.07, 0, 7); g.fill(); g.stroke(); g.restore();
    const hs = S.hero; const w = R * 0.7; g.fillStyle = 'rgba(34,37,46,0.6)'; g.fillRect(p.x - w / 2, p.y - R * 1.12 - bob, w, 4); g.fillStyle = '#b8567f'; g.fillRect(p.x - w / 2, p.y - R * 1.12 - bob, w * Math.max(0, hs.hp) / Math.max(1, ui.heroMax || 10), 4);
  }
  drawHeroPath(g, S, hp) {
    g.save(); g.lineWidth = 3; g.setLineDash([2, 6]); g.lineCap = 'round'; g.strokeStyle = 'rgba(184,86,127,0.9)'; g.beginPath(); const start = this.xy(S.hero.q, S.hero.r); g.moveTo(start.x, start.y); for (const s of hp.steps) { const p = this.xy(s.q, s.r); g.lineTo(p.x, p.y); } g.stroke(); g.setLineDash([]);
    let lastTurn = 0; hp.steps.forEach((s, i) => { const p = this.xy(s.q, s.r); const last = i === hp.steps.length - 1; if (s.turn !== lastTurn || last) { g.fillStyle = s.turn === 0 ? '#b8567f' : '#586280'; g.beginPath(); g.arc(p.x, p.y, last ? 9 : 6, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = `bold ${last ? 11 : 9}px system-ui`; g.textAlign = 'center'; g.fillText(last ? (s.turn === 0 ? '➜' : '+' + s.turn) : '|', p.x, p.y + 3.5); lastTurn = s.turn; } });
    g.restore();
  }
  drawThreat(g, S, th, x, y, anim, ui) {
    const R = this.R; const K = THREAT_KINDS[th.kind]; const fl = anim ? Math.sin(this.t * 0.006 + th.born) : 0; const city = S.cities[th.target];
    if (city) { const c = this.xy(city.q, city.r); g.save(); g.strokeStyle = 'rgba(120,40,70,0.45)'; g.lineWidth = 1.6; g.setLineDash([3, 6]); g.beginPath(); g.moveTo(x, y); g.lineTo(c.x, c.y); g.stroke(); g.restore(); }
    g.save(); g.fillStyle = 'rgba(30,20,40,0.3)'; g.beginPath(); g.ellipse(x, y + 2, R * 0.3, R * 0.1, 0, 0, 7); g.fill();
    if (th.kind === 'raiders') { g.fillStyle = '#3b3d52'; g.strokeStyle = '#f4efe4'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x - R * 0.2, y); g.lineTo(x, y - R * 0.62); g.lineTo(x + R * 0.2, y); g.closePath(); g.fill(); g.stroke(); g.fillStyle = '#f4efe4'; g.beginPath(); g.arc(x, y - R * 0.64, R * 0.1, 0, 7); g.fill(); }
    else { for (let i = 0; i < 3; i++) { g.globalAlpha = 0.35 + 0.2 * (i === 0 ? 1 : 0); this.drawChrome(g, x + (i - 1) * R * 0.1 + fl * R * 0.05 * i, y, R * 0.85, false); } g.globalAlpha = 1; }
    g.fillStyle = '#7b1f45'; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.roundRect(x - R * 0.26, y - R * 0.98, R * 0.52, R * 0.26, 4); g.fill(); g.stroke(); g.fillStyle = '#fff'; g.font = `bold ${Math.max(9, R * 0.2)}px system-ui`; g.textAlign = 'center'; g.fillText(`${K.glyph} ${th.power}`, x, y - R * 0.79);
    g.restore();
  }

  // ---------------------------------------------------------------- overlays
  drawOverlay(g, S, t, you, ui) {
    const k = key(t.q, t.r); const { x, y } = this.xy(t.q, t.r); const R = this.R;
    if (ui.targeting) { const tg = ui.targeting;
      if (tg.potential && tg.potential.has(k)) { g.save(); g.fillStyle = 'rgba(34,37,46,0.75)'; g.font = `bold ${Math.max(11, R * 0.34)}px system-ui`; g.textAlign = 'center'; g.fillText('⌂', x, y + R * 0.1); g.restore(); }
      if (tg.opens && tg.opens.has(k)) { g.save(); g.fillStyle = '#b8567f'; g.strokeStyle = '#fff'; g.lineWidth = 3; g.font = `bold ${Math.max(12, R * 0.4)}px system-ui`; g.textAlign = 'center'; g.strokeText('⌂+', x, y + R * 0.12); g.fillText('⌂+', x, y + R * 0.12); g.restore(); }
      if (tg.targets && tg.targets.has(k)) { this.hexPath(g, x, y, R * 0.94); g.strokeStyle = '#222'; g.lineWidth = 2.4; g.setLineDash([5, 3]); g.stroke(); g.setLineDash([]); g.fillStyle = 'rgba(255,255,255,0.22)'; g.fill(); } }
    if (ui.sel && ui.sel.q === t.q && ui.sel.r === t.r) { this.hexPath(g, x, y, R * 0.98); g.strokeStyle = '#22252e'; g.lineWidth = 3; g.stroke(); this.hexPath(g, x, y, R * 0.92); g.strokeStyle = '#FFC1DF'; g.lineWidth = 2; g.stroke(); }
    if (ui.hover && ui.hover.q === t.q && ui.hover.r === t.r) { this.hexPath(g, x, y, R * 0.98); g.strokeStyle = 'rgba(34,37,46,0.5)'; g.lineWidth = 1.6; g.stroke(); }
    if (ui.reach && ui.reach.has(k) && !(ui.sel && ui.sel.q === t.q && ui.sel.r === t.r)) { g.fillStyle = 'rgba(255,193,223,0.55)'; g.beginPath(); g.arc(x, y, R * 0.07, 0, 7); g.fill(); }
  }
  // minimap: orientation in a larger world; click it to look elsewhere
  drawMinimap(g, S, you, ui) {
    const B = this.terrain.bounds; const w = 188, h = Math.round(w * B.h / B.w); const x0 = 12, y0 = this.topH + 12; this.mm = { x: x0, y: y0, w, h };
    g.save(); g.fillStyle = 'rgba(247,242,232,0.9)'; g.strokeStyle = 'rgba(34,37,46,0.35)'; g.lineWidth = 1; g.beginPath(); g.roundRect(x0 - 5, y0 - 5, w + 10, h + 10, 9); g.fill(); g.stroke();
    g.beginPath(); g.roundRect(x0, y0, w, h, 6); g.clip(); g.fillStyle = '#c9d4ee'; g.fillRect(x0, y0, w, h); g.drawImage(this.terrain.canvas, x0, y0, w, h); if (this.fog) g.drawImage(this.fog, x0, y0, w, h);
    const sx = (wx) => x0 + (wx - B.minX) / B.w * w, sy = (wy) => y0 + (wy - B.minY) / B.h * h;
    for (const c of Object.values(S.cities)) { if (!you.seen[key(c.q, c.r)]) continue; const wp = tileWorld(c.q, c.r, Rb, YS); const o = OWN[c.owner || 'ind']; g.fillStyle = o.color; g.strokeStyle = o.dark; g.lineWidth = 1.2; g.beginPath(); g.arc(sx(wp.x), sy(wp.y), c.capital ? 3.6 : 2.6, 0, 7); g.fill(); g.stroke(); }
    for (const s of Object.values(S.sites)) { if (!you.seen[key(s.q, s.r)] || s.state !== 'open') continue; const wp = tileWorld(s.q, s.r, Rb, YS); g.fillStyle = '#b8567f'; g.fillRect(sx(wp.x) - 1.5, sy(wp.y) - 1.5, 3, 3); }
    for (const th of Object.values(S.threats)) { if (!you.obs[key(th.q, th.r)]) continue; const wp = tileWorld(th.q, th.r, Rb, YS); g.fillStyle = '#7b1f45'; g.beginPath(); g.arc(sx(wp.x), sy(wp.y), 2.4, 0, 7); g.fill(); }
    const hw = tileWorld(S.hero.q, S.hero.r, Rb, YS); g.fillStyle = '#fff'; g.strokeStyle = '#b8567f'; g.lineWidth = 2; g.beginPath(); g.arc(sx(hw.x), sy(hw.y), 4, 0, 7); g.fill(); g.stroke();
    const tl = this.s2w(0, this.topH), br = this.s2w(this.W - this.panelW, this.H - this.botH); g.strokeStyle = 'rgba(34,37,46,0.85)'; g.lineWidth = 1.2; g.strokeRect(sx(tl.x), sy(tl.y), (br.x - tl.x) / B.w * w, (br.y - tl.y) / B.h * h);
    g.restore();
  }
  minimapHit(mx, my) { const m = this.mm; if (!m || mx < m.x || mx > m.x + m.w || my < m.y || my > m.y + m.h) return null; const B = this.terrain.bounds; return { x: B.minX + (mx - m.x) / m.w * B.w, y: B.minY + (my - m.y) / m.h * B.h }; }
  lookAt(wx, wy) { this.cam.x = wx; this.cam.y = wy; this.follow = false; }

  drawChrome(g, x, y, h, anim, giant) { // reflective chrome humanoid silhouette
    const w = h * 0.24; const gr = g.createLinearGradient(x - w, y - h, x + w, y); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, '#aebbd0'); gr.addColorStop(0.6, '#5b6682'); gr.addColorStop(1, '#e8ecf5');
    g.save(); g.fillStyle = gr; g.strokeStyle = 'rgba(30,34,52,0.45)'; g.lineWidth = 0.8;
    g.beginPath(); g.ellipse(x, y - h * 0.9, w * 0.42, h * 0.075, 0, 0, Math.PI * 2); g.fill(); g.stroke(); // head
    g.beginPath(); g.moveTo(x - w * 0.15, y - h * 0.82); g.lineTo(x + w * 0.15, y - h * 0.82); g.lineTo(x + w * 0.55, y - h * 0.7); g.lineTo(x + w * 0.4, y - h * 0.33); g.lineTo(x + w * 0.28, y); g.lineTo(x + w * 0.04, y); g.lineTo(x, y - h * 0.3); g.lineTo(x - w * 0.04, y); g.lineTo(x - w * 0.28, y); g.lineTo(x - w * 0.4, y - h * 0.33); g.lineTo(x - w * 0.55, y - h * 0.7); g.closePath(); g.fill(); g.stroke();
    g.globalAlpha *= 0.8; g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(x - w * 0.08, y - h * 0.78, w * 0.06, h * 0.4); // specular
    g.restore();
  }

  drawLastKnown(g, x, y, m, turn) { const o = OWN[m.owner] || OWN.ind; g.save(); g.globalAlpha = 0.7; g.strokeStyle = o.dark; g.setLineDash([3, 3]); g.lineWidth = 1.5; g.beginPath(); g.arc(x, y - 8, this.R * 0.3, 0, 7); g.stroke(); g.setLineDash([]); g.fillStyle = o.dark; g.font = `${Math.max(9, this.R * 0.26)}px system-ui`; g.textAlign = 'center'; g.fillText(o.glyph + '?', x, y - 5); g.fillText(`${turn - m.turn}t old`, x, y + this.R * 0.36); g.restore(); }

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

  shade(hex, amt) { const n = parseInt(hex.slice(1), 16); let r = n >> 16, gg = (n >> 8) & 255, b = n & 255; const f = (v) => Math.max(0, Math.min(255, Math.round(v + (amt > 0 ? (255 - v) * amt : v * amt)))); return `rgb(${f(r)},${f(gg)},${f(b)})`; }
}
