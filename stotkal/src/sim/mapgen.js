// World generation: a larger island world (radius CFG.radius) shaped by seeded noise so that landforms are continuous
// (the renderer hides the hex grid). Connected, viable starts, guaranteed anomaly/spire access and early discoveries.
import { mulberry, hashStr } from './rng.js';
import { key, parse, dist, neighbors, inRadius, within, DIRS } from './hex.js';
import { CFG, TERRAIN, REGION_NAMES } from '../data/content.js';

const passable = (t) => TERRAIN[t.t].passable;

export function regionOf(q, r, R = CFG.radius) {
  const d = Math.round(R * 0.62);
  const anchors = [{ q: 0, r: 0 }, ...DIRS.map(([a, b]) => ({ q: a * d, r: b * d }))];
  let best = 0, bd = 1e9;
  anchors.forEach((a, i) => { const dd = dist(a, { q, r }); if (dd < bd) { bd = dd; best = i; } });
  return best;
}

// smooth value noise
function makeNoise(seed) {
  const h = (x, y) => (hashStr(seed + ':' + x + ',' + y) % 100000) / 100000;
  const smooth = (t) => t * t * (3 - 2 * t);
  const n = (x, y) => { const x0 = Math.floor(x), y0 = Math.floor(y); const fx = smooth(x - x0), fy = smooth(y - y0); const a = h(x0, y0), b = h(x0 + 1, y0), c = h(x0, y0 + 1), d = h(x0 + 1, y0 + 1); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; };
  return (x, y) => (n(x, y) * 0.55 + n(x * 2.1 + 7.3, y * 2.1 + 3.1) * 0.3 + n(x * 4.3 + 1.7, y * 4.3 + 9.2) * 0.15);
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
// keep only the largest connected landmass (drop stray islands by turning them into water)
function keepMainland(tiles) {
  const seen = new Set(); let best = [];
  for (const k of Object.keys(tiles)) {
    if (seen.has(k) || !passable(tiles[k])) continue;
    const comp = [k]; seen.add(k); const st = [k];
    while (st.length) { const { q, r } = parse(st.pop()); for (const n of neighbors(q, r)) { const nk = key(n.q, n.r); const t = tiles[nk]; if (t && passable(t) && !seen.has(nk)) { seen.add(nk); comp.push(nk); st.push(nk); } } }
    if (comp.length > best.length) best = comp;
  }
  const keep = new Set(best); for (const k of Object.keys(tiles)) if (passable(tiles[k]) && !keep.has(k)) tiles[k].t = 'lake';
}

const SITE_PLAN = [ // [type, opts]
  ['meridian_spire', { maxCenter: 0.38, minCap: 5 }], ['monolith', { maxCenter: 0.55, minCap: 4 }], ['choir_engine', { nearPlayer: 5, minCap: 3 }],
  ['sleeping_orchard', { minCap: 3 }], ['mirror_well', { minCap: 3 }], ['weather_loom', { minCap: 3 }], ['weather_loom', { minCap: 3 }], ['glass_cradle', { minCap: 3 }], ['glass_cradle', { minCap: 3 }],
  ['anomaly', { minCap: 3 }], ['anomaly', { minCap: 3 }], ['anomaly', { minCap: 3 }],
  ['ruin', { minCap: 2, nearPlayer: 7 }], ['ruin', { minCap: 2 }], ['ruin', { minCap: 2 }], ['ruin', { minCap: 2 }], ['ruin', { minCap: 2 }], ['ruin', { minCap: 2 }], ['ruin', { minCap: 2 }], ['ruin', { minCap: 2 }],
];

function tryGenerate(seed, attempt) {
  const rng = mulberry(hashStr(seed + ':map:' + attempt));
  const R = CFG.radius; const noise = makeNoise(seed + ':' + attempt + ':n'); const moist = makeNoise(seed + ':' + attempt + ':m');
  const tiles = {};
  for (const h of inRadius(R)) tiles[key(h.q, h.r)] = { q: h.q, r: h.r, t: 'desert', owner: null, city: null, outpost: null, site: null, region: regionOf(h.q, h.r, R) };
  const all = Object.values(tiles); const O = { q: 0, r: 0 };
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const ox = rng() * 100, oy = rng() * 100;
  for (const t of all) {
    const x = (t.q + t.r / 2) * 0.55 + ox, y = t.r * 0.48 + oy; const edge = dist(O, t) / R;
    const e = noise(x * 0.62, y * 0.62) - Math.pow(edge, 3) * 0.42; const m = moist(x * 0.7 + 40, y * 0.7 + 40);
    t.e = e;
    if (e < 0.17) t.t = "lake"; else if (e > 0.575) t.t = "ridge"; else t.t = m > 0.5 ? 'garden' : 'desert';
  }
  keepMainland(tiles);
  // buried infrastructure: long conduit lines plus scatter
  for (let i = 0; i < 4; i++) {
    let c = pick(all.filter(x => passable(x))); let dir = Math.floor(rng() * 6);
    for (let s = 0; s < 7; s++) { const t = tiles[key(c.q, c.r)]; if (t.t === 'desert' || t.t === 'garden') t.t = 'infra'; if (rng() < 0.35) dir = (dir + (rng() < 0.5 ? 1 : 5)) % 6; const n = tiles[key(c.q + DIRS[dir][0], c.r + DIRS[dir][1])]; if (!n || !passable(n)) break; c = n; }
  }
  for (let i = 0; i < 4; i++) { const c = pick(all.filter(x => x.t === 'desert' || x.t === 'garden')); if (c) c.t = 'infra'; }
  all.forEach(x => { if ((x.t === 'desert' || x.t === 'garden') && neighbors(x.q, x.r).some(n => tiles[key(n.q, n.r)] && tiles[key(n.q, n.r)].t === 'lake') && rng() < 0.75) x.t = 'coast'; });

  // ----- capitals -----
  const th = rng() * Math.PI * 2; const caps = []; const ringD = R * 0.66;
  for (let i = 0; i < 4; i++) {
    const a = th + i * Math.PI / 2 + (rng() - 0.5) * 0.35; const target = { x: Math.cos(a) * ringD, y: Math.sin(a) * ringD };
    const cand = all.filter(x => passable(x) && dist(O, x) >= R * 0.45 && dist(O, x) <= R * 0.85 && !caps.some(c => dist(c, x) < R * 0.72))
      .sort((p, q2) => { const f = (h) => { const px = h.q + h.r / 2, py = h.r * 0.866; return (px - target.x) ** 2 + (py - target.y) ** 2; }; return f(p) - f(q2); });
    if (!cand.length) return null; caps.push(cand[0]);
  }
  for (const c of caps) {
    tiles[key(c.q, c.r)].t = 'garden';
    const ns = neighbors(c.q, c.r).map(n => tiles[key(n.q, n.r)]).filter(Boolean);
    ns.filter(n => n.t === 'lake').slice(1).forEach(n => { n.t = 'coast'; });
    const r2 = within(c, 2).map(h => tiles[key(h.q, h.r)]).filter(Boolean);
    if (!r2.some(n => n.t === 'ridge' || n.t === 'infra')) { const d = r2.find(n => n.t === 'desert' || n.t === 'coast'); if (d) d.t = 'infra'; }
    for (const n of r2) { if (n.t === 'desert' && r2.filter(x => x.t === 'garden').length < 3) n.t = 'garden'; }
    if (ns.filter(n => passable(n)).length < 4) return null;
  }
  // ----- independents -----
  const indep = [];
  for (let i = 0; i < 6; i++) {
    const cand = all.filter(x => passable(x) && !caps.some(c => dist(c, x) < 4) && !indep.some(c => dist(c, x) < 4));
    if (!cand.length) return null;
    const score = (x) => Math.min(...caps.map(c => dist(c, x))) * 0.6 + rng() * 2.5 - Math.abs(dist(O, x) - R * 0.45) * 0.3;
    cand.sort((a, b) => score(b) - score(a)); indep.push(cand[0]);
  }
  indep[0].t = 'infra';
  // ----- sites -----
  const sites = []; const used = [...caps, ...indep];
  const place = (type, o) => {
    const cand = all.filter(x => passable(x) && !used.includes(x) && sites.every(s => s.tile !== x && dist(s.tile, x) >= (type === "ruin" ? 2 : 3)) && caps.every(c => dist(c, x) >= (o.minCap || 2)) && indep.every(c => dist(c, x) >= 2)
      && (!o.nearPlayer || dist(caps[0], x) <= o.nearPlayer) && (!o.maxCenter || dist(O, x) <= R * o.maxCenter));
    if (!cand.length) return false;
    const t = cand[Math.floor(rng() * cand.length)]; sites.push({ type, tile: t }); return true;
  };
  for (const [t, o] of SITE_PLAN) if (!place(t, o)) return null;
  // ----- validation -----
  const pass = all.filter(passable).length; const total = all.length;
  if (pass < total * 0.66 || pass > total * 0.9) return null;
  if (!connectedPassable(tiles)) return null;
  const siteTiles = new Set(sites.map(x => key(x.tile.q, x.tile.r))); const settlements = [...caps, ...indep];
  for (const [ci, c] of caps.entries()) { const need = ci === 0 ? 3 : 1; const n = all.filter(t => passable(t) && dist(c, t) >= 3 && dist(c, t) <= 6 && !siteTiles.has(key(t.q, t.r)) && settlements.every(o => o === c || dist(o, t) >= 3)).length; if (n < need) return null; }
  const pc = caps[0];
  if (!sites.some(s => dist(s.tile, pc) <= 5 && s.type !== 'meridian_spire' && s.type !== 'ruin')) return null;
  return { R, tiles, caps: caps.map(c => ({ q: c.q, r: c.r })), indep: indep.map(c => ({ q: c.q, r: c.r })), sites: sites.map(s => ({ type: s.type, q: s.tile.q, r: s.tile.r })) };
}

export function generateMap(seed) {
  for (let a = 0; a < 600; a++) { const m = tryGenerate(seed, a); if (m) { m.attempt = a; for (const t of Object.values(m.tiles)) delete t.e; return m; } }
  throw new Error('map generation failed for seed ' + seed);
}
export function regionName(i) { return REGION_NAMES[i]; }
