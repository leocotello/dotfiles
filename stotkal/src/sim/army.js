// Supply and pathing for armies.
import { CFG, TERRAIN } from '../data/content.js';
import { key, neighbors } from './hex.js';
import { atWar } from './state.js';
import { fx, hasTech, civCities, hasTreaty } from './economy.js';

export function supplyRange(S, civ) { return CFG.army.supplyRange + fx(S, civ, 'supplyRange'); }
export function supplySources(S, civId) {
  const civ = S.civs[civId]; const out = [];
  for (const c of civCities(S, civId)) out.push({ q: c.q, r: c.r, bonus: c.districts.some(d => d.type === 'bulwark') ? 1 : 0 });
  for (const t of Object.values(S.map.tiles)) if (t.outpost === civId && !t.city) out.push({ q: t.q, r: t.r, bonus: fx(S, civ, 'outpostSupply') ? 1 : 0, outpost: true });
  // treaty-access infrastructure: partner cities under a passage treaty
  for (const o of S.civOrder) if (o !== civId && hasTreaty(S, civId, o, 'passage')) for (const c of civCities(S, o)) out.push({ q: c.q, r: c.r, bonus: -1 });
  return out;
}
export function enterable(S, civId, t, finalTarget) {
  if (!t || !TERRAIN[t.t].passable) return false;
  if (t.owner && t.owner !== civId && t.owner !== 'ind') {
    if (atWar(S, civId, t.owner)) return true;
    if (hasTreaty(S, civId, t.owner, 'passage') && !t.city) return true;
    return false;
  }
  return true;
}
// distance (in tiles) from nearest supply source along passable tiles. Returns Map key->dist, up to maxD.
export function supplyMap(S, civId) {
  const civ = S.civs[civId]; const base = supplyRange(S, civ); const m = new Map(); let frontier = [];
  for (const s of supplySources(S, civId)) { const k = key(s.q, s.r); const range = base + s.bonus; const cur = m.get(k); if (cur === undefined) { m.set(k, -range); } else m.set(k, Math.min(cur, -range)); }
  // store negative range as "remaining reach"; do a BFS where reach decreases per step.
  const reach = new Map(); const q = [];
  for (const [k, v] of m) { reach.set(k, -v); q.push(k); }
  while (q.length) {
    const k = q.shift(); const r0 = reach.get(k); if (r0 <= 0) continue;
    const [a, b] = k.split(',').map(Number);
    for (const n of neighbors(a, b)) {
      const nk = key(n.q, n.r); const t = S.map.tiles[nk]; if (!t || !TERRAIN[t.t].passable) continue;
      if ((reach.get(nk) ?? -1) < r0 - 1) { reach.set(nk, r0 - 1); q.push(nk); }
    }
  }
  return reach; // tile is supplied if reach.has(key) (reach >= 0)
}
export const isSupplied = (S, civId, q, r, map) => { map = map || supplyMap(S, civId); const v = map.get(key(q, r)); return v !== undefined && v >= 0; };

export function armyPath(S, army, target) {
  const civId = army.owner; const start = key(army.q, army.r); const goal = key(target.q, target.r);
  const dist = new Map([[start, 0]]); const prev = new Map(); const open = [[0, start]];
  while (open.length) {
    open.sort((a, b) => a[0] - b[0]); const [d, k] = open.shift();
    if (k === goal) break; if (d > dist.get(k)) continue;
    const [q, r] = k.split(',').map(Number);
    for (const n of neighbors(q, r)) {
      const nk = key(n.q, n.r); const t = S.map.tiles[nk];
      if (!t) continue;
      const hostileCity = t.city && S.cities[t.city].owner !== civId;
      if (nk !== goal && hostileCity) continue; // do not path *through* foreign cities
      if (!enterable(S, civId, t, nk === goal)) continue;
      const nd = d + TERRAIN[t.t].move;
      if (nd < (dist.get(nk) ?? 1e9)) { dist.set(nk, nd); prev.set(nk, k); open.push([nd, nk]); }
    }
  }
  if (!dist.has(goal)) return null;
  const path = []; let c = goal; while (c !== start) { const [q, r] = c.split(',').map(Number); path.unshift({ q, r }); c = prev.get(c); }
  // ETA with movement points
  let turns = 0, mp = CFG.army.move; const steps = [];
  for (const p of path) { const cost = TERRAIN[S.map.tiles[key(p.q, p.r)].t].move; if (mp < cost) { turns++; mp = CFG.army.move; } mp -= cost; steps.push({ ...p, turn: turns + 1 }); }
  const sm = supplyMap(S, civId); const breaks = steps.filter(s => !isSupplied(S, civId, s.q, s.r, sm));
  return { path, steps, cost: dist.get(goal), eta: turns + 1, breaks };
}
