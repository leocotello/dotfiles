import { mulberry, hashStr } from './rng.js';
import { key, parse, dist, neighbors, inRadius, within, DIRS } from './hex.js';
import { CFG, TERRAIN, REGION_NAMES } from '../data/content.js';

const passable = (t) => TERRAIN[t.t].passable;

export function regionOf(q, r) {
  const anchors = [{ q: 0, r: 0 }, ...DIRS.map(([a, b]) => ({ q: a * 3, r: b * 3 }))];
  let best = 0, bd = 1e9;
  anchors.forEach((a, i) => { const d = dist(a, { q, r }); if (d < bd) { bd = d; best = i; } });
  return best;
}

function connectedPassable(tiles) {
  const ks = Object.keys(tiles).filter(k => passable(tiles[k]));
  if (!ks.length) return false;
  const seen = new Set([ks[0]]); const st = [ks[0]];
  while (st.length) {
    const { q, r } = parse(st.pop());
    for (const n of neighbors(q, r)) { const k = key(n.q, n.r); const t = tiles[k]; if (t && passable(t) && !seen.has(k)) { seen.add(k); st.push(k); } }
  }
  return seen.size === ks.length;
}

function tryGenerate(seed, attempt) {
  const rng = mulberry(hashStr(seed + ':map:' + attempt));
  const R = CFG.radius;
  const tiles = {};
  for (const h of inRadius(R)) tiles[key(h.q, h.r)] = { q: h.q, r: h.r, t: 'desert', owner: null, city: null, outpost: null, site: null, region: regionOf(h.q, h.r) };
  const all = Object.values(tiles);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const setBlob = (c, rad, t, only) => within(c, rad).forEach(h => { const tt = tiles[key(h.q, h.r)]; if (tt && (!only || only.includes(tt.t))) tt.t = t; });
  // lakes: inner 2 + edge water
  for (let i = 0; i < 2; i++) { const c = pick(all.filter(x => dist({ q: 0, r: 0 }, x) >= 2 && dist({ q: 0, r: 0 }, x) <= 3)); setBlob(c, rng() < 0.5 ? 1 : 0, 'lake'); }
  all.filter(x => dist({ q: 0, r: 0 }, x) === R).forEach(x => { if (rng() < 0.42) x.t = 'lake'; });
  // gardens
  for (let i = 0; i < 6; i++) { const c = pick(all.filter(x => x.t !== 'lake')); setBlob(c, rng() < 0.55 ? 1 : 0, 'garden', ['desert']); }
  // ridges (random walks)
  for (let i = 0; i < 2; i++) { let c = pick(all.filter(x => x.t === 'desert')); for (let s = 0; s < 4; s++) { if (tiles[key(c.q, c.r)].t === 'desert') tiles[key(c.q, c.r)].t = 'ridge'; const n = neighbors(c.q, c.r).filter(h => tiles[key(h.q, h.r)]); c = pick(n); } }
  // buried infrastructure
  for (let i = 0; i < 8; i++) { const c = pick(all.filter(x => x.t === 'desert' || x.t === 'garden')); c.t = 'infra'; }
  // coast
  all.forEach(x => { if (x.t === 'desert' && neighbors(x.q, x.r).some(n => tiles[key(n.q, n.r)] && tiles[key(n.q, n.r)].t === 'lake')) x.t = 'coast'; });

  // ----- capitals -----
  const th = rng() * Math.PI * 2;
  const wanted = [0, 1, 2, 3].map(i => th + i * Math.PI / 2 + (rng() - 0.5) * 0.3);
  const caps = [];
  for (const a of wanted) {
    const target = { x: Math.cos(a) * 3.6, y: Math.sin(a) * 3.6 };
    const cand = all.filter(x => dist({ q: 0, r: 0 }, x) >= 3 && dist({ q: 0, r: 0 }, x) <= 4 && !caps.some(c => dist(c, x) < 5))
      .sort((p, q2) => { const f = (h) => { const px = h.q + h.r / 2, py = h.r * 0.866; return (px - target.x) ** 2 + (py - target.y) ** 2; }; return f(p) - f(q2); });
    if (!cand.length) return null;
    caps.push(cand[0]);
  }
  for (const c of caps) {
    tiles[key(c.q, c.r)].t = 'garden';
    const ns = neighbors(c.q, c.r).map(n => tiles[key(n.q, n.r)]).filter(Boolean);
    ns.filter(n => n.t === 'lake').slice(1).forEach(n => { n.t = 'coast'; }); // keep a lake or two for variety, never a wall
    if (ns.filter(n => n.t === 'garden').length < 1) { const d = ns.find(n => n.t !== 'lake'); if (d) d.t = 'garden'; }
    const r2 = within(c, 2).map(h => tiles[key(h.q, h.r)]).filter(Boolean);
    if (!r2.some(n => n.t === 'ridge' || n.t === 'infra')) { const d = r2.filter(n => n.t === 'desert' || n.t === 'coast')[0]; if (d) d.t = 'infra'; }
    if (r2.filter(n => n.t === 'garden').length < 3) { for (const n of r2) { if (n.t === 'desert' && r2.filter(x => x.t === 'garden').length < 3) n.t = 'garden'; } }
  }
  // ----- independents -----
  const indep = [];
  for (let i = 0; i < 4; i++) {
    const cand = all.filter(x => passable(x) && !caps.some(c => dist(c, x) < 3) && !indep.some(c => dist(c, x) < 3) && !caps.some(c => c === x));
    if (!cand.length) return null;
    const score = (x) => Math.min(...caps.map(c => dist(c, x))) * 1.0 - Math.abs(dist({ q: 0, r: 0 }, x) - 2.5) * 0.4 + rng() * 0.8;
    cand.sort((a, b) => score(b) - score(a));
    indep.push(cand[0]);
  }
  indep[0].t = 'infra'; // an independent settlement controlling a conduit
  // ----- sites -----
  const sites = [];
  const used = [...caps, ...indep];
  const place = (type, opts = {}) => {
    const cand = all.filter(x => passable(x) && !used.includes(x) && !sites.some(s => s.tile === x)
      && caps.every((c, i) => dist(c, x) >= (opts.minCap || 2)) && sites.every(s => dist(s.tile, x) >= 2) && indep.every(c => dist(c, x) >= 2)
      && (!opts.nearPlayer || dist(caps[0], x) <= opts.nearPlayer) && (!opts.minCenter || dist({ q: 0, r: 0 }, x) <= opts.minCenter));
    if (!cand.length) return false;
    const t = cand[Math.floor(rng() * cand.length)];
    sites.push({ type, tile: t });
    return true;
  };
  const plan = [['meridian_spire', { minCenter: 3, minCap: 3 }], ['monolith', { minCenter: 4, minCap: 3 }], ['choir_engine', { nearPlayer: 4, minCap: 2 }], ['sleeping_orchard', {}], ['mirror_well', {}],
    ['weather_loom', {}], ['weather_loom', {}], ['glass_cradle', {}], ['glass_cradle', {}], ['anomaly', { minCap: 2 }], ['anomaly', { minCap: 2 }], ['anomaly', { minCap: 2 }]];
  for (const [t, o] of plan) { if (!place(t, o)) { if (globalThis.DBG) globalThis.DBG[t] = (globalThis.DBG[t] || 0) + 1; return null; } }
  // ----- validation -----
  const pass = all.filter(passable).length;
  if (pass < 65 || pass > 80) return null;
  if (!connectedPassable(tiles)) return null;
  // every capital needs at least two legal city sites within 3-4 hexes (spacing >= 3 from every settlement, not on a site) so early expansion exists
  const siteTiles = new Set(sites.map(x => key(x.tile.q, x.tile.r))); const settlements = [...caps, ...indep];
  for (const [ci, c] of caps.entries()) { const need = ci === 0 ? 2 : 1; const n = all.filter(t => passable(t) && dist(c, t) >= 3 && dist(c, t) <= 5 && !siteTiles.has(key(t.q, t.r)) && settlements.every(o => o === c || dist(o, t) >= 3)).length; if (n < need) return null; }
  // early discovery accessible; viability around player start
  const pc = caps[0];
  if (!sites.some(s => dist(s.tile, pc) <= 4)) return null;
  const r2 = within(pc, 2).map(h => tiles[key(h.q, h.r)]).filter(Boolean);
  if (r2.filter(passable).length < 10) return null;
  return { R, tiles, caps: caps.map(c => ({ q: c.q, r: c.r })), indep: indep.map(c => ({ q: c.q, r: c.r })), sites: sites.map(s => ({ type: s.type, q: s.tile.q, r: s.tile.r })) };
}

export function generateMap(seed) {
  for (let a = 0; a < 400; a++) { const m = tryGenerate(seed, a); if (m) { m.attempt = a; return m; } }
  throw new Error('map generation failed for seed ' + seed);
}

export function regionName(i) { return REGION_NAMES[i]; }
