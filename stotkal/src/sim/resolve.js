// Turn resolution. The order below is explicit and documented (docs/SYSTEMS.md).
import { CFG, TERRAIN, DISTRICTS, WORKS, TECHS, INSTITUTIONS, AMBITIONS, APPROACH } from '../data/content.js';
import { key, dist, neighbors } from './hex.js';
import { stable, rnd } from './rng.js';
import { RES, zero, add, tileAt, civCities, civArmies, fx, hasTech, hasInst, computeEconomy, cohBreakdown, cityHousing, components, connectedToCapital, totalResonance, civResonance, severity, effExposure, protectionBands } from './economy.js';
import { log, updateVision, syncDiscoveries, atWar, pairKey, ageOf } from './state.js';
import { PHASE_OF, clearStaged, techReq } from './commands.js';
import { applyCmd, transferCity, releaseCity, eliminate } from './apply.js';
import { armyPath, supplyMap, isSupplied } from './army.js';
import { resolveEngagement, armyStr, forecast, invalidateSupplyCache, maxIntegrity } from './combat.js';
import { expireTreaties, declareWar } from './diplomacy.js';
import { openCouncil, addResonance, addFragment } from './council.js';
import { quietingPhase } from './quieting.js';
import { evaluate } from './ambitions.js';
import { planRivals } from './rival.js';
import { buildEnding } from './chronicle.js';

export const PHASES = ['political', 'exploration', 'movement', 'conflict', 'production', 'construction', 'population', 'quieting'];

// Initiative: a seeded, stable tie-breaker re-drawn each turn. It is not a faction advantage: it only orders simultaneous actions.
export function initiative(S, turn = S.turn) {
  return S.civOrder.slice().sort((a, b) => stable(S.seed, 'init', turn, a) - stable(S.seed, 'init', turn, b));
}

function runStaged(S, phase, out) {
  for (const civId of initiative(S)) {
    const list = S.staged[civId].filter(c => PHASE_OF[c.type] === phase);
    for (const cmd of list) { const r = applyCmd(S, civId, cmd); out.push({ civ: civId, cmd, ...r }); if (r.msg && (civId === 'you' || r.ok === false)) log(S, civId, r.msg, r.ok === false ? 1 : 0, { order: true }); }
  }
}

const PH = {
  political(S) {
    S.proposals = S.proposals.filter(p => p.expires >= S.turn);
    for (const c of Object.values(S.cities)) if (c.ind && c.notice && c.notice.due <= S.turn) {
      const civ = S.civs[c.notice.civ]; if (civ && !civ.eliminated && civCities(S, civ.id).length < CFG.maxCities) { transferCity(S, c, civ.id, 'federated'); log(S, civ.id, `${c.name} joined ${civ.name} as a federation partner (obligation: 1 Sustenance per turn).`, 2, { pub: true }); S.chronicle.push({ turn: S.turn, civ: civ.id, text: `${c.name} joined ${civ.id === 'you' ? 'your' : civ.name + "'s"} federation.`, tag: 'federation' }); }
      else c.notice = null;
    }
    const out = []; runStaged(S, 'political', out); S._outcomes = (S._outcomes || []).concat(out);
  },
  exploration(S) {
    const out = []; runStaged(S, 'exploration', out); S._outcomes = (S._outcomes || []).concat(out);
    updateVision(S); syncDiscoveries(S);
  },
  movement(S) {
    S._engage = []; invalidateSupplyCache(S);
    for (const civId of initiative(S)) {
      for (const a of civArmies(S, civId).sort((x, y) => x.id.localeCompare(y.id))) moveArmy(S, a);
    }
    updateVision(S);
  },
  conflict(S) {
    S._battles = [];
    // group engagements by tile, resolve in initiative order of the tile's first attacker (simultaneous per tile)
    const groups = new Map();
    for (const e of S._engage) { const k = key(e.tile.q, e.tile.r); if (!groups.has(k)) groups.set(k, { tile: e.tile, atts: [] }); if (S.armies[e.army] && !groups.get(k).atts.includes(e.army)) groups.get(k).atts.push(e.army); }
    const order = initiative(S);
    const gs = [...groups.values()].sort((a, b) => { const oa = order.indexOf(S.armies[a.atts[0]]?.owner), ob = order.indexOf(S.armies[b.atts[0]]?.owner); return oa - ob || a.tile.q - b.tile.q || a.tile.r - b.tile.r; });
    for (const g of gs) {
      const atts = g.atts.map(id => S.armies[id]).filter(Boolean); if (!atts.length) continue;
      const tile = tileAt(S, g.tile.q, g.tile.r); const approach = (atts[0].obj && atts[0].obj.approach) || 'assault';
      const startStr = new Map(atts.map(a => [a.id, a.regs.length * 10]));
      const defs = Object.values(S.armies).filter(a => a.q === tile.q && a.r === tile.r && a.owner !== atts[0].owner && atWar(S, a.owner, atts[0].owner));
      const defStart = new Map(defs.map(a => [a.id, a.regs.length * 10]));
      invalidateSupplyCache(S);
      const city = tile.city ? S.cities[tile.city] : null; if (city) city.attacked = true;
      for (const a of atts) a.entrench = approach === 'siege' ? (a.entrench || 0) + 1 : 0;
      const rep = resolveEngagement(S, tile, atts, approach, S._battles);
      const desc = describeBattle(S, rep, tile, city);
      log(S, atts[0].owner, desc, 2, { pub: true, battle: true });
      for (const a of atts) { const cur = S.armies[a.id]; if (cur && (cur.obj.approach === 'withdraw' || armyStr(cur) < cur.retreatAt * (startStr.get(a.id) || 10))) retreat(S, cur, 'attacker'); }
      for (const d of defs) { const cur = S.armies[d.id]; if (cur && !tile.city && armyStr(cur) < cur.retreatAt * (defStart.get(d.id) || 10)) retreat(S, cur, 'defender'); }
      if (rep.captured) {
        const att = atts.find(a => S.armies[a.id]); const prevOwner = city.owner;
        if (att) { att.q = tile.q; att.r = tile.r; att.obj = { type: 'guard' };
          const hadDisruptor = att.regs.some(r => r.role === 'disruptor');
          transferCity(S, city, att.owner, 'captured');
          if (hadDisruptor) { const i = city.districts.findIndex(d => d.type === 'archive'); if (i >= 0) { city.districts.splice(i, 1); log(S, att.owner, `${city.name}'s Archive was damaged in the capture.`, 2, { pub: true }); } }
          const civ = S.civs[att.owner]; for (const c of civCities(S, civ.id)) if (c.id !== city.id && fx(S, civ, 'forcedCohMult')) { /* keepers resent conquest */ }
          if (S.civs[att.owner].tradition === 'keepers') for (const c of civCities(S, att.owner)) c.coh = Math.max(0, c.coh - 4);
          log(S, att.owner, `${S.civs[att.owner].name} captured ${city.name}.`, 2, { pub: true });
          if (att.owner === 'you' || prevOwner === 'you') S.chronicle.push({ turn: S.turn, text: `${city.name} ${att.owner === 'you' ? 'was taken by your regiments' : 'fell to ' + S.civs[att.owner].name}.`, tag: 'conquest' });
        }
      } else if (!tile.city || (city && city.owner === atts[0].owner)) {
        // open-field victory: attacker occupies the tile if it is empty and the approach is not a raid
        const stillDef = Object.values(S.armies).some(a => a.q === tile.q && a.r === tile.r && a.owner !== atts[0].owner);
        if (!stillDef && !tile.city) for (const a of atts) { const cur = S.armies[a.id]; if (cur && approach !== 'raid' && approach !== 'withdraw') { cur.q = tile.q; cur.r = tile.r; } }
      }
    }
    for (const a of Object.values(S.armies)) if (!a.regs.length) delete S.armies[a.id];
    updateVision(S);
  },
  production(S) {
    for (const civId of S.civOrder) {
      const civ = S.civs[civId]; if (civ.eliminated) continue;
      civ.mods = civ.mods.filter(m => !m.expires || S.turn < m.expires);
      const econ = computeEconomy(S, civId); S._econ = S._econ || {}; S._econ[civId] = { net: econ.net, deficit: econ.deficit, paused: econ.paused.length };
      for (const k of RES) civ.res[k] = Math.max(0, civ.res[k] + econ.net[k]);
      // federation obligations
      for (const c of civCities(S, civId)) if (c.federated) { c.fedMet = (civ.res.sus + (econ.net.sus < 0 ? 0 : 0)) >= 0 && !econ.shortCities[c.id]; if (!c.fedMet) { c.fedUnmet = (c.fedUnmet || 0) + 1; if (c.fedUnmet >= 2) { log(S, civId, `${c.name} left the federation: its stipend went unpaid.`, 2); c.federated = false; releaseCity(S, c); } } else c.fedUnmet = 0; }
      for (const c of civCities(S, civId)) { c.shortTurns = econ.shortCities[c.id] ? c.shortTurns + 1 : 0; if (c.disabled.conduit > 0) c.disabled.conduit--; }
      // preservation: +1 Memory each
      const pres = S.treaties.filter(t => t.active && t.kind === 'preservation' && (t.a === civId || t.b === civId)).length; if (pres) civ.res.mem += pres;
      // Resonance accumulation (foundries, institutions) and Garden damping with a visible cap
      for (const [cid, v] of Object.entries(econ.resonance)) addResonance(S, civId, v, tileAt(S, S.cities[cid].q, S.cities[cid].r).region);
      const flat = fx(S, civ, 'resonanceFlat'); if (flat > 0) addResonance(S, civId, flat);
      const gardens = civCities(S, civId).reduce((a, c) => a + c.districts.filter(d => d.type === 'garden').length, 0);
      const damp = Math.min(3, gardens); if (damp > 0 && civResonance(S, civId) > 0) addResonance(S, civId, -Math.min(damp, Math.max(0, civResonance(S, civId) > 0 ? 1 : 0)));
      if (econ.deficit > 0 && civId === 'you') log(S, 'you', `Sustenance shortage of ${econ.deficit}: ${Object.keys(econ.shortCities).map(id => S.cities[id].name).join(', ')} are affected.`, 2);
      if (econ.paused.length && civId === 'you') log(S, 'you', `Energy shortage: ${econ.paused.length} optional powered structure(s) paused.`, 2);
      if (civ.emergency === 'ration' && civ.res.sus > 12) civ.emergency = null;
    }
    // armies heal when supplied and not engaged; cities recover integrity
    for (const a of Object.values(S.armies)) { invalidateSupplyCache(S); if (!a.engaged && isSupplied(S, a.owner, a.q, a.r)) for (const r of a.regs) r.str = Math.min(10, r.str + CFG.army.heal); a.engaged = false; }
    for (const c of Object.values(S.cities)) { if (!c.attacked) { c.integrity = Math.min(maxIntegrity(S, c), c.integrity + 2); if (c.ind) c.garrison = Math.min(12, c.garrison + 2); } c.attacked = false; c.integrityMax = maxIntegrity(S, c); }
  },
  construction(S) {
    for (const civId of S.civOrder) {
      const civ = S.civs[civId]; if (civ.eliminated) continue;
      for (const c of civCities(S, civId)) {
        const p = c.project; if (!p) continue; p.remaining--;
        if (p.remaining > 0) continue;
        c.project = null; const { id, kind } = projectOf(p.what);
        if (kind === 'district') { if (p.replace !== undefined && c.districts[p.replace]) c.districts.splice(p.replace, 1); c.districts.push({ type: id, built: S.turn }); }
        else { c.works[id] = true; if (id === 'stabilization') { addResonance(S, civId, -CFG.quieting.stabRemoves); civ.stabDone = (civ.stabDone || 0) + 1; } if (id === 'vessel') civ.vessels++; }
        if (civId === 'you') { log(S, 'you', `${c.name}: ${p.what.startsWith('district:') ? DISTRICTS[id].name : WORKS[id].name} complete.`, 2); S.chronicle.push({ turn: S.turn, text: `${c.name} completed ${p.what.startsWith('district:') ? 'a ' + DISTRICTS[id].name : WORKS[id].name}.`, tag: 'build' }); }
      }
      // research accounting: Memory spent from the stockpile, plus shared findings (free, shown separately)
      const R = civ.research; const t = R.target;
      if (t) {
        const need = techReq(S, civ, t); const have = R.progress[t] || 0;
        const spend = Math.max(0, Math.min(R.alloc, civ.res.mem, need - have));
        civ.res.mem -= spend; R.progress[t] = have + spend;
        const shared = S.treaties.filter(x => x.active && x.kind === 'research' && (x.a === civId || x.b === civId)).length;
        if (shared && R.progress[t] < need) R.progress[t] = Math.min(need, R.progress[t] + shared);
        if (R.progress[t] >= need) { civ.techs[t] = true; R.target = null; if (civId === 'you') { log(S, 'you', `Research complete: ${TECHS[t].name}.`, 2); S.chronicle.push({ turn: S.turn, text: `Learned ${TECHS[t].name}.`, tag: 'tech' }); } }
      }
    }
  },
  population(S) {
    for (const civId of S.civOrder) {
      const civ = S.civs[civId]; if (civ.eliminated) continue;
      const econ = computeEconomy(S, civId);
      for (const c of civCities(S, civId).slice()) {
        // growth
        const cr = econ.cityRes[c.id] || zero(); const interval = Math.max(1, CFG.growth.interval + fx(S, civ, 'growthInterval'));
        c.growthWait = Math.max(0, (c.growthWait ?? 0) - 1);
        const need = Math.max(1, CFG.growth.surplus + fx(S, civ, 'growthSurplus'));
        if (c.growthWait === 0 && c.pop < cityHousing(S, civ, c) && cr.sus >= need && c.coh >= CFG.growth.minCoh && !econ.shortCities[c.id]) { c.pop++; c.growthWait = interval; if (civId === 'you') log(S, 'you', `${c.name} grew to population ${c.pop}.`, 0); }
        if (c.shortTurns >= 2 && c.pop > 1) { c.pop--; if (civId === 'you') log(S, 'you', `${c.name} lost population to hunger.`, 2); }
        // coherence
        const bd = cohBreakdown(S, c, econ); c.coh = Math.max(0, Math.min(100, c.coh + bd.delta));
        if (c.reconcile) { c.reconcile.left--; if (c.reconcile.left <= 0) { c.coh = Math.min(100, c.coh + CFG.coherence.reconcileGain + fx(S, civ, 'reconcileBonus')); c.reconcile = null; if (civId === 'you') log(S, 'you', `${c.name}: reconciliation complete (+${CFG.coherence.reconcileGain} Coherence).`, 1); } }
        c.lowTurns = c.coh < CFG.coherence.low ? c.lowTurns + 1 : 0;
        if (c.lowTurns >= CFG.coherence.crisisTurns && !c.crisis) { c.crisis = true; if (civId === 'you') log(S, 'you', `Local crisis in ${c.name}: output halved until Coherence recovers to 40. Reconcile or build a Sanctuary.`, 2); }
        if (c.crisis && c.coh >= 40) { c.crisis = false; if (civId === 'you') log(S, 'you', `${c.name} has recovered from its crisis.`, 1); }
        if (c.coh <= 0) { if (civId === 'you') { log(S, 'you', `${c.name} lost all Coherence and became an autonomous settlement; its people and buildings remain.`, 2); S.chronicle.push({ turn: S.turn, text: `${c.name} went its own way.`, tag: 'sacrifice' }); } releaseCity(S, c); }
      }
    }
    expireTreaties(S);
  },
  quieting(S) {
    quietingPhase(S);
    S.resHistory = (S.resHistory || []).concat(totalResonance(S));
    for (const civ of Object.values(S.civs)) {
      if (!civ.ambition && S.turn === 20 && !civ.eliminated && civ.id === 'you') { // auto-commit to the nearest path so no one is locked out by inaction
        const best = Object.keys(AMBITIONS).map(id => ({ id, f: evaluate(S, 'you', id).frac })).sort((a, b) => b.f - a.f)[0]; civ.ambition = { id: best.id, turn: S.turn, auto: true };
        log(S, 'you', `The council committed you to ${AMBITIONS[best.id].name}, your nearest path. You may change once through turn 23.`, 2);
      }
    }
  },
};
const projectOf = (what) => what.startsWith('district:') ? { id: what.slice(9), kind: 'district' } : { id: what.slice(5), kind: 'work' };

function describeBattle(S, rep, tile, city) {
  const a = S.civs[rep.attOwner].name; const d = rep.defOwner ? S.civs[rep.defOwner].name : (city ? city.name : 'defenders');
  return `Battle at ${city ? city.name : TERRAIN[tile.t].name}: ${a} (${APPROACH[rep.approach].name}) lost ${rep.attLoss}, ${d} lost ${rep.defLoss}${rep.captured ? '; the city fell' : ''}${rep.raided && rep.raided.mat !== undefined ? `; raid took ${rep.raided.mat} Matter and ${rep.raided.ene} Energy` : ''}${rep.raided && rep.raided.cooldown ? '; raid target on cooldown' : ''}.`;
}

function moveArmy(S, a) {
  const civ = S.civs[a.owner]; const obj = a.obj; if (!obj || obj.type === 'guard') return;
  if (a.regs.some(r => r.ready > S.turn)) return; // preparation turn
  const path = armyPath(S, a, { q: obj.q, r: obj.r });
  if (!path) { log(S, a.owner, `An army's route to (${obj.q},${obj.r}) is blocked; it holds position.`, 1); a.obj = { type: 'guard' }; return; }
  let mp = CFG.army.move;
  for (const step of path.path) {
    const t = tileAt(S, step.q, step.r); const cost = TERRAIN[t.t].move; if (mp < cost) break;
    const enemyArmy = Object.values(S.armies).find(x => x.q === t.q && x.r === t.r && x.owner !== a.owner);
    if (enemyArmy) { if (atWar(S, a.owner, enemyArmy.owner)) { S._engage.push({ army: a.id, tile: { q: t.q, r: t.r } }); a.engaged = true; } else if (a.owner) { /* cannot stack with a non-hostile army */ } break; }
    if (t.city && S.cities[t.city].owner !== a.owner) {
      const c = S.cities[t.city]; const hostile = c.ind ? (obj.type === 'raid' || obj.type === 'besiege') : atWar(S, a.owner, c.owner);
      if (hostile && step.q === obj.q && step.r === obj.r) { S._engage.push({ army: a.id, tile: { q: t.q, r: t.r } }); a.engaged = true; }
      break;
    }
    a.q = t.q; a.r = t.r; mp -= cost;
    if (step.q === obj.q && step.r === obj.r) { if (obj.type === 'travel') a.obj = { type: 'guard' }; break; }
  }
}
function retreat(S, a, role) {
  const civ = S.civs[a.owner]; const srcs = civCities(S, a.owner); if (!srcs.length) return;
  for (let i = 0; i < CFG.army.move; i++) {
    let best = null, bd = 1e9; const home = srcs.reduce((b, c) => (dist(c, a) < dist(b, a) ? c : b), srcs[0]);
    for (const n of neighbors(a.q, a.r)) { const t = tileAt(S, n.q, n.r); if (!t || !TERRAIN[t.t].passable) continue; if (Object.values(S.armies).some(x => x.q === n.q && x.r === n.r && x.owner !== a.owner)) continue; if (t.city && S.cities[t.city].owner !== a.owner) continue; const d = dist(home, n); if (d < bd) { bd = d; best = n; } }
    if (best && bd < dist(home, a) + 1) { a.q = best.q; a.r = best.r; }
  }
  a.obj = { type: 'guard' }; log(S, a.owner, `An army of ${civ.name} retreated after the battle (${role}).`, 1, { pub: true });
}

export function summarize(S, fromLen) {
  const ev = S.log.slice(fromLen);
  return { turn: S.turn, events: ev.filter(e => e.civ === 'you' || e.pub), routine: ev.filter(e => e.civ === 'you' && e.imp === 0).length };
}

export function endTurn(S) {
  if (S.over) return null;
  const logStart = S.log.length; S._outcomes = [];
  planRivals(S);
  for (const p of PHASES) { PH[p](S); }
  // final test & endings at turn 30; early collapse otherwise
  const you = S.civs.you; const finalTurn = S.turn >= CFG.turns;
  if (you.eliminated || !civCities(S, 'you').length) { S.over = true; S.ending = buildEnding(S, 'collapse'); }
  else if (finalTurn) { S.over = true; S.ending = buildEnding(S, 'final'); }
  const summary = summarize(S, logStart);
  S.lastSummary = summary;
  for (const id of S.civOrder) clearStaged(S, id);
  if (!S.over) {
    S.turn++;
    const prevIds = (S.council.offers || []).map(o => o.id);
    S.council.lastIds = prevIds.length ? prevIds : S.council.lastIds;
    openCouncil(S);
    updateVision(S); syncDiscoveries(S);
  }
  return summary;
}
