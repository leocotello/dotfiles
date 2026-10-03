// The Witness as a walking hero: stats (from boons/relics via the shared modifier system), movement, checks, healing.
import { HERO, CHECK } from '../data/action.js';
import { TERRAIN } from '../data/content.js';
import { key, dist, neighbors } from './hex.js';
import { rnd } from './rng.js';
import { fx, civCities, tileAt } from './economy.js';
import { updateVision, syncDiscoveries } from './state.js';

export function heroStats(S) {
  const civ = S.civs.you; const h = S.hero; const f = (k) => fx(S, civ, k);
  return {
    maxHp: Math.max(3, HERO.hp + f('heroHp')), atk: Math.max(0, HERO.atk + f('heroAtk')), def: Math.max(0, HERO.def + f('heroDef')),
    moves: Math.max(1, HERO.moves + f('heroMoves') - (h && h.frayed > 0 ? 1 : 0)), sight: Math.max(2, HERO.sight + f('heroSight')),
    wit: Math.max(0, HERO.wit + f('heroWit') + Math.floor((civ.fragments.length) / 3)),
  };
}
export function refreshHero(S) { const st = heroStats(S); S.hero.sight = st.sight; S.hero.hp = Math.min(S.hero.hp, st.maxHp); return st; }
export function initHero(S) {
  const cap = S.cities[S.civs.you.cap];
  S.hero = { q: cap.q, r: cap.r, hp: HERO.hp, frayed: 0, movesLeft: HERO.moves, sight: HERO.sight, trail: [], steps: 0 };
  const st = heroStats(S); S.hero.hp = st.maxHp; S.hero.movesLeft = st.moves; S.hero.sight = st.sight;
}
export const statValue = (S, stat) => { const st = heroStats(S); return stat === 'moves' ? st.moves : st[stat]; };
export function checkChance(S, stat, diff) { const v = statValue(S, stat); return Math.round(Math.max(CHECK.min, Math.min(CHECK.max, CHECK.base + CHECK.perPoint * (v - diff))) * 20) / 20; }
export function rollCheck(S, stat, diff) { const chance = checkChance(S, stat, diff); const roll = rnd(S); return { ok: roll < chance, chance, roll: Math.round(roll * 100) }; }

// Dijkstra over passable tiles. Own and independent cities and foreign cities are not enterable; foreign territory is.
export function heroPath(S, to) {
  const h = S.hero; const goal = key(to.q, to.r); const start = key(h.q, h.r); if (goal === start) return { path: [], cost: 0 };
  const dst = new Map([[start, 0]]); const prev = new Map(); const open = [[0, start]];
  while (open.length) {
    open.sort((a, b) => a[0] - b[0]); const [d, k] = open.shift(); if (k === goal) break; if (d > dst.get(k)) continue;
    const [q, r] = k.split(',').map(Number);
    for (const n of neighbors(q, r)) {
      const nk = key(n.q, n.r); const t = S.map.tiles[nk]; if (!t || !TERRAIN[t.t].passable) continue;
      if (t.city && S.cities[t.city].owner !== 'you') continue;
      const nd = d + TERRAIN[t.t].move; if (nd < (dst.get(nk) ?? 1e9)) { dst.set(nk, nd); prev.set(nk, k); open.push([nd, nk]); }
    }
  }
  if (!dst.has(goal)) return null;
  const path = []; let c = goal; while (c !== start) { const [q, r] = c.split(',').map(Number); path.unshift({ q, r, cost: TERRAIN[S.map.tiles[c].t].move }); c = prev.get(c); }
  // annotate with the turn on which each step would be taken, given movement left this turn and full movement afterwards
  const st = heroStats(S); let left = h.movesLeft, turn = 0; for (const p of path) { if (p.cost > left) { turn++; left = st.moves; } left -= p.cost; p.turn = turn; }
  return { path, cost: dst.get(goal), turns: (path[path.length - 1] || { turn: 0 }).turn };
}
// One Dijkstra from the hero to every reachable tile (costs are small integers; bucketed queue). Used by the UI and bots.
export function heroDistMap(S) {
  const h = S.hero; const start = key(h.q, h.r); const dst = new Map([[start, 0]]); const prev = new Map(); const buckets = [[start]];
  for (let d = 0; d < buckets.length; d++) {
    for (const k of (buckets[d] || [])) {
      if (dst.get(k) !== d) continue; const [q, r] = k.split(',').map(Number);
      for (const n of neighbors(q, r)) { const nk = key(n.q, n.r); const t = S.map.tiles[nk]; if (!t || !TERRAIN[t.t].passable) continue; if (t.city && S.cities[t.city].owner !== 'you') continue;
        const nd = d + TERRAIN[t.t].move; if (nd < (dst.get(nk) ?? 1e9)) { dst.set(nk, nd); prev.set(nk, k); (buckets[nd] = buckets[nd] || []).push(nk); } }
    }
  }
  return { dst, prev };
}
// Walk toward a tile, spending movement; stops when movement runs out. Immediate and irreversible (it is an action, not an order).
export function heroMove(S, q, r) {
  if (S.over) return { ok: false, error: 'The run has ended.' };
  if (S.pending.length) return { ok: false, error: 'Resolve the pending decision first.' };
  const h = S.hero; const p = heroPath(S, { q, r }); if (!p) return { ok: false, error: 'No route there.' };
  if (!p.path.length) return { ok: true, moved: 0 };
  let moved = 0;
  for (const step of p.path) {
    if (step.cost > h.movesLeft) break;
    h.q = step.q; h.r = step.r; h.movesLeft -= step.cost; moved++; h.steps++; h.trail.push({ q: step.q, r: step.r }); if (h.trail.length > 12) h.trail.shift();
    updateVision(S); syncDiscoveries(S);
  }
  return { ok: true, moved, done: moved === p.path.length };
}
// Per-turn upkeep of the hero (called by the run layer at the start of each turn).
export function heroTurnStart(S) {
  const st = refreshHero(S); const h = S.hero; if (h.frayed > 0) h.frayed--;
  const stats = heroStats(S); h.movesLeft = stats.moves;
  const here = tileAt(S, h.q, h.r); const home = here.owner === 'you';
  const city = here.city && S.cities[here.city] && S.cities[here.city].owner === 'you';
  h.hp = Math.min(stats.maxHp, h.hp + (city ? HERO.healHome : home ? HERO.healTurn : 0));
}
export const heroAdjacentSite = (S) => { const out = []; for (const s of Object.values(S.sites)) if (dist(S.hero, s) <= 1) out.push(s); return out; };
