// Constant threats: raiders and wandering Echoes spawn from the fog, walk toward a settlement and test its defence.
// They threaten every society (rivals defend with the same formula), so the world is never quiet.
import { THREAT_CFG, THREAT_KINDS, SEASONS } from '../data/action.js';
import { TERRAIN } from '../data/content.js';
import { key, dist, neighbors } from './hex.js';
import { rnd, rint } from './rng.js';
import { nid, log } from './state.js';
import { civArmies, fx, hasTech, tileAt, effExposure, RES } from './economy.js';

export const worldMod = (S) => SEASONS[S.worldId] || { threat: 1, beatRate: 1, boonDelta: 0, relicMult: 1, quietShift: 0, civFx: {} };
export const threatLevel = (S) => worldMod(S).threat * ((S.ageMod && S.ageMod.threat) || 1);

export function cityDefense(S, city) {
  const T = THREAT_CFG; let d = T.cityBase;
  if (city.districts.some(x => x.type === 'bulwark')) d += T.bulwark;
  let str = 0; for (const a of civArmies(S, city.owner)) if (a.q === city.q && a.r === city.r) str += a.regs.reduce((s, r) => s + r.str, 0);
  d += Math.floor(str / T.armyDiv);
  const civ = S.civs[city.owner];
  if (civ) { d += fx(S, civ, 'cityDefense'); if (hasTech(civ, 'fortification')) d += 1; }
  if (city.owner === 'you' && S.hero && S.hero.q === city.q && S.hero.r === city.r) d += 2; // the Witness stands with her people
  return d;
}
export function threatForecast(S, th) {
  const city = S.cities[th.target]; if (!city) return null; const def = cityDefense(S, city);
  const outcome = def >= th.power ? 'holds' : def >= th.power * THREAT_CFG.repelRatio ? 'hurt' : 'breach';
  return { target: city, defense: def, power: th.power, outcome, eta: Math.max(0, dist(th, city) - 1) };
}
export function killThreat(S, id) { delete S.threats[id]; }
export const threatList = (S) => Object.values(S.threats).sort((a, b) => a.id.localeCompare(b.id));

function threatPath(S, from, goalTile) {
  const start = key(from.q, from.r); const goal = key(goalTile.q, goalTile.r); const prev = new Map([[start, null]]); const q = [start];
  while (q.length) {
    const k = q.shift(); if (k === goal) break; const [a, b] = k.split(',').map(Number);
    for (const n of neighbors(a, b)) { const nk = key(n.q, n.r); const t = S.map.tiles[nk]; if (!t || prev.has(nk) || !TERRAIN[t.t].passable) continue; if (t.city && nk !== goal) continue; prev.set(nk, k); q.push(nk); }
  }
  if (!prev.has(goal)) return null; const path = []; let c = goal; while (c !== start) { const [a, b] = c.split(',').map(Number); path.unshift({ q: a, r: b }); c = prev.get(c); } return path;
}

function spawn(S) {
  const T = THREAT_CFG; const lvl = threatLevel(S);
  const p = Math.min(T.spawnMax, (T.spawnBase + T.spawnPerTurn * S.turn) * lvl); const cap = Math.max(1, Math.floor((T.activeBase + S.turn / T.activePerTurns) * Math.max(0.5, lvl)));
  if (Object.keys(S.threats).length >= cap || rnd(S) >= p) return;
  const targets = Object.values(S.cities).filter(c => c.owner && !S.civs[c.owner].eliminated); if (!targets.length) return;
  const weighted = targets.flatMap(c => (c.owner === 'you' ? [c, c] : [c])); const target = weighted[rint(S, weighted.length)];
  const cand = Object.values(S.map.tiles).filter(t => TERRAIN[t.t].passable && !t.city && dist(t, target) >= T.minDist && dist(t, target) <= T.maxDist && !Object.values(S.threats).some(o => o.q === t.q && o.r === t.r) && !(S.hero && S.hero.q === t.q && S.hero.r === t.r));
  if (!cand.length) return; const tile = cand[rint(S, cand.length)];
  const exposed = effExposure(S, target) > 0; const kind = exposed && rnd(S) < 0.6 ? 'echo' : 'raiders'; const K = THREAT_KINDS[kind];
  const power = Math.max(2, Math.round((K.basePower + K.perTurn * S.turn) * Math.sqrt(lvl)));
  const id = nid(S, 'th'); S.threats[id] = { id, kind, q: tile.q, r: tile.r, power, target: target.id, born: S.turn, attacks: 0 };
  const you = S.civs.you; if (you.obs[key(tile.q, tile.r)]) log(S, 'you', `${K.name} (power ${power}) appear near ${S.cities[target.id].name}.`, 2);
}

function attack(S, th) {
  const city = S.cities[th.target]; const K = THREAT_KINDS[th.kind]; const T = THREAT_CFG; const forecast = threatForecast(S, th); const mine = city.owner === 'you'; th.attacks++;
  const msg = (t, imp = 2) => { if (mine || S.civs.you.obs[key(city.q, city.r)]) log(S, 'you', t, imp, { pub: !mine }); };
  if (forecast.outcome === 'holds') { // destroyed: the defenders keep the spoils
    const civ = S.civs[city.owner]; for (const [k, v] of Object.entries(K.loot)) civ.res[k] += v; delete S.threats[th.id]; msg(`${city.name} held against ${K.name} (defence ${forecast.defense} vs power ${th.power}); they were driven off.`, mine ? 1 : 0); return;
  }
  const civ = S.civs[city.owner];
  if (forecast.outcome === 'hurt') { city.coh = Math.max(0, city.coh - T.repelCoh); msg(`${K.name} tested ${city.name} (defence ${forecast.defense} vs ${th.power}): it held, but frightened people lost ${T.repelCoh} Coherence.`); }
  else {
    city.integrity = Math.max(1, city.integrity - T.breachDamage); city.coh = Math.max(0, city.coh - T.breachCoh);
    const mat = Math.min(3, civ.res.mat), ene = Math.min(3, civ.res.ene); civ.res.mat -= mat; civ.res.ene -= ene;
    msg(`${K.name} breached ${city.name} (defence ${forecast.defense} vs power ${th.power}): −${T.breachCoh} Coherence, integrity −${T.breachDamage}, ${mat + ene} goods taken.`);
    if (mine) S.chronicle.push({ turn: S.turn, text: `${K.name} broke into ${city.name}.`, tag: 'sacrifice' });
  }
  if (th.attacks >= T.attackLimit) { delete S.threats[th.id]; }
}

export function threatPhase(S) {
  const T = THREAT_CFG;
  if (S.turn >= T.startTurn) spawn(S);
  for (const th of threatList(S)) {
    const city = S.cities[th.target];
    if (!city || !city.owner) { // target lost: pick the nearest settlement
      const near = Object.values(S.cities).filter(c => c.owner).sort((a, b) => dist(th, a) - dist(th, b))[0]; if (!near) { delete S.threats[th.id]; continue; } th.target = near.id; continue;
    }
    if (dist(th, city) <= 1) { attack(S, th); continue; }
    const path = threatPath(S, th, city); if (!path) { delete S.threats[th.id]; continue; }
    for (let i = 0; i < T.moveRate && path.length > 1; i++) { const nx = path.shift(); if (S.hero && S.hero.q === nx.q && S.hero.r === nx.r) break; th.q = nx.q; th.r = nx.r; }
    if (dist(th, S.cities[th.target]) <= 1 && th.attacks === 0 && false) attack(S, th);
  }
}
