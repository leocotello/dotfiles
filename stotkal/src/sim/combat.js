// Strategic combat: deterministic, simultaneous damage, forecast == resolution (same functions).
// See docs/COMBAT.md for the specification.
import { CFG, ROLES, APPROACH, TERRAIN } from '../data/content.js';
import { key, dist, neighbors } from './hex.js';
import { civCities, civArmies, hasTech, fx, tileAt } from './economy.js';
import { atWar } from './state.js';
import { supplyMap, isSupplied } from './army.js';

export const K_DAMAGE = 0.30;
export const armyStr = (a) => a.regs.reduce((s, r) => s + r.str, 0);

export function regPower(S, reg, tile, mode) { // mode: 'attack' | 'defend'
  let m = 1; const R = ROLES[reg.role];
  if (R.terr && R.terr[tile.t]) m *= R.terr[tile.t];
  if (mode === 'defend' && R.def) m *= R.def;
  if (mode === 'attack' && tile.city && R.siege) m *= R.siege;
  if (mode === 'defend' && TERRAIN[tile.t].def) m *= 1 + TERRAIN[tile.t].def;
  return reg.str * m;
}
export function fortMult(S, city) {
  if (!city) return 1; const civ = city.owner ? S.civs[city.owner] : null;
  let f = 1.25; if (city.districts.some(d => d.type === 'bulwark')) f += 0.25; if (civ && hasTech(civ, 'fortification')) f += 0.1; return f;
}
export function maxIntegrity(S, city) { const civ = city.owner ? S.civs[city.owner] : null; return 10 + (city.districts.some(d => d.type === 'bulwark') ? 4 : 0) + (civ && hasTech(civ, 'fortification') ? 2 : 0); }

// power of one side. armies = [{army, approach, supplied}], tile where the fight happens.
export function sidePower(S, armies, tile, mode, approachOf) {
  let p = 0; const parts = [];
  for (const a of armies) {
    const ap = approachOf ? approachOf(a) : (mode === 'defend' ? 'guard' : (a.obj && a.obj.approach) || 'assault');
    const A = APPROACH[ap]; const sup = isSuppliedCached(S, a);
    let ap0 = a.regs.reduce((s, r) => s + regPower(S, r, tile, mode), 0);
    let m = (sup ? 1 : CFG.army.unsuppliedMult) * (mode === 'attack' ? A.att : (A.def || 1));
    p += ap0 * m; parts.push({ army: a.id, base: Math.round(ap0 * 10) / 10, supply: sup ? 1 : CFG.army.unsuppliedMult, approach: ap });
  }
  return { power: p, parts };
}
const supCache = { turn: -1, maps: {} };
function isSuppliedCached(S, a) {
  const k = S.turn + ':' + S.seed;
  if (supCache.k !== k || supCache.tick !== S._tick) { supCache.k = k; supCache.tick = S._tick; supCache.maps = {}; }
  const m = supCache.maps[a.owner] || (supCache.maps[a.owner] = supplyMap(S, a.owner));
  return isSupplied(S, a.owner, a.q, a.r, m);
}
export function invalidateSupplyCache(S) { S._tick = (S._tick || 0) + 1; }

export function defendersAt(S, tile, attackerOwner) {
  const out = [];
  for (const a of Object.values(S.armies)) if (a.q === tile.q && a.r === tile.r && a.owner !== attackerOwner && (atWar(S, a.owner, attackerOwner))) out.push(a);
  // independent settlement's army-less garrison handled via city
  return out;
}
export function cityDefence(S, city, attackerOwner) {
  // garrison pseudo-force for a city: independents use their garrison pool, civ cities a small home guard
  if (!city) return { strength: 0, power: 0 };
  if (city.ind) return { strength: city.garrison, power: city.garrison };
  return { strength: 0, power: 6 + city.pop * 0.5 };
}

// Forecast for attackers engaging `tile`. Returns numbers identical to what resolveEngagement will apply.
export function forecast(S, attackers, tile, approach) {
  const att = attackers; const attOwner = att[0].owner; const city = tile.city ? S.cities[tile.city] : null;
  const defArmies = defendersAt(S, tile, attOwner);
  const ap = APPROACH[approach];
  const aP = sidePower(S, att, tile, 'attack', () => approach);
  const dP = sidePower(S, defArmies, tile, 'defend');
  const cd = city && city.owner !== attOwner ? cityDefence(S, city, attOwner) : { strength: 0, power: 0 };
  const fm = city ? fortMult(S, city) : 1;
  const defPower = (dP.power + cd.power) * fm;
  const attPower = aP.power;
  const siegeReady = approach !== 'siege' || att.every(a => (a.entrench || 0) >= 1);
  let attLoss = Math.round(defPower * K_DAMAGE * ap.taken);
  let defLoss = approach === 'withdraw' ? 0 : Math.round(attPower * K_DAMAGE);
  if (approach === 'siege' && !siegeReady) { defLoss = 0; attLoss = Math.round(attLoss * 0.5); }
  const attTotal = att.reduce((s, a) => s + armyStr(a), 0);
  const defTotal = defArmies.reduce((s, a) => s + armyStr(a), 0) + cd.strength;
  attLoss = Math.min(attLoss, attTotal); defLoss = Math.min(defLoss, Math.max(defTotal, 0) + (city && !city.ind ? 0 : 0));
  if (!defTotal && !city) defLoss = 0;
  let integrityDmg = 0;
  if (city && city.owner !== attOwner && approach !== 'raid' && approach !== 'withdraw') {
    if (approach === 'assault') integrityDmg = Math.floor(attPower / 8);
    else if (approach === 'siege' && siegeReady) integrityDmg = Math.floor(attPower / 5);
  }
  // conditional: unseen hostile armies that could intervene within 3 tiles
  const civ = S.civs[attOwner]; const conditional = [];
  for (const [aid, lk] of Object.entries(civ.lastKnown || {})) if (lk.owner !== attOwner && atWar(S, lk.owner, attOwner) && dist(lk, tile) <= 3 && !civ.obs[key(lk.q, lk.r)] && !defArmies.some(d => d.id === aid)) conditional.push({ id: aid, ...lk, age: S.turn - lk.turn });
  for (const o of S.civOrder) if (o !== attOwner && atWar(S, o, attOwner) && !civ.obs[key(tile.q, tile.r)]) { if (!conditional.length) conditional.push({ note: 'Tile not currently observed' }); break; }
  const notes = [];
  const terr = TERRAIN[tile.t]; notes.push(`Terrain: ${terr.name}${terr.def ? ' (+' + terr.def * 100 + '% defence)' : ''}`);
  if (city) notes.push(`Fortification x${fm.toFixed(2)}; integrity ${city.integrity}/${maxIntegrity(S, city)}`);
  if (aP.parts.some(p => p.supply < 1)) notes.push('Attacker out of supply: -20% power, cannot heal');
  if (approach === 'siege' && !siegeReady) notes.push('Entrenching this turn: no integrity damage yet');
  return { attPower: Math.round(attPower * 10) / 10, defPower: Math.round(defPower * 10) / 10, attLoss, defLoss, integrityDmg, defenders: defArmies, city, conditional, notes, siegeReady, defTotal, attTotal };
}

function applyLoss(armies, total, extra) {
  // spread proportionally across regiments, remainder to the strongest; deterministic order
  const regs = armies.flatMap(a => a.regs.map(r => ({ a, r }))); const strTot = regs.reduce((s, x) => s + x.r.str, 0);
  if (strTot <= 0 || total <= 0) return 0; let left = Math.min(total, strTot); const applied = left;
  const share = regs.map(x => ({ x, v: Math.min(x.r.str, Math.floor(total * x.r.str / strTot)) }));
  for (const s of share) { s.x.r.str -= s.v; left -= s.v; }
  const order = regs.slice().sort((p, q) => q.r.str - p.r.str || p.r.id.localeCompare(q.r.id));
  let i = 0; while (left > 0 && order.some(x => x.r.str > 0)) { const x = order[i % order.length]; if (x.r.str > 0) { x.r.str--; left--; } i++; }
  for (const a of armies) a.regs = a.regs.filter(r => r.str > 0);
  return applied;
}

export function resolveEngagement(S, tile, attackers, approach, report) {
  const f = forecast(S, attackers, tile, approach); const city = f.city; const attOwner = attackers[0].owner;
  const defArmies = f.defenders;
  const attBefore = f.attTotal;
  const lost = applyLoss(attackers, f.attLoss);
  let defLost = 0;
  if (f.defLoss > 0) {
    let rem = f.defLoss;
    // city garrison absorbs after armies at the tile
    const armyTotal = defArmies.reduce((s, a) => s + armyStr(a), 0);
    const toArmies = Math.min(rem, armyTotal); defLost += applyLoss(defArmies, toArmies); rem -= toArmies;
    if (rem > 0 && city && city.ind) { const g = Math.min(city.garrison, rem); city.garrison -= g; defLost += g; }
  }
  for (const a of defArmies) if (!a.regs.length) delete S.armies[a.id];
  for (const a of attackers) if (!a.regs.length) delete S.armies[a.id];
  let captured = false, raided = null;
  if (city && city.owner !== attOwner) {
    if (approach === 'raid') {
      const owner = city.owner ? S.civs[city.owner] : null; const cd = city.raidCd[attOwner] || 0;
      if (S.turn >= cd && owner) { const mat = Math.min(CFG.raid.cap, owner.res.mat), ene = Math.min(CFG.raid.cap, owner.res.ene); owner.res.mat -= mat; owner.res.ene -= ene; S.civs[attOwner].res.mat += mat; S.civs[attOwner].res.ene += ene; city.raidCd[attOwner] = S.turn + CFG.raid.cooldown; raided = { mat, ene }; }
      else raided = { cooldown: true };
    } else if (f.integrityDmg > 0) {
      city.integrity = Math.max(0, city.integrity - f.integrityDmg);
    }
    const defendersLeft = defArmies.some(a => S.armies[a.id] && a.regs.length) || (city.ind && city.garrison > 0);
    if (approach !== 'raid' && city.integrity <= 0 && !defendersLeft && attackers.some(a => S.armies[a.id])) captured = true;
  }
  const r = { tile: { q: tile.q, r: tile.r }, attOwner, defOwner: defArmies[0] ? defArmies[0].owner : (city ? city.owner : null), attLoss: lost, defLoss: defLost, captured, raided, approach, forecast: f };
  if (report) report.push(r); return r;
}
