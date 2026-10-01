// Command staging, validation, reservation and application. Orders are staged (free to inspect/revise) and applied at resolution.
import { CFG, TERRAIN, DISTRICTS, WORKS, INSTITUTIONS, DISCOVERIES, TECHS, ROLES, OPPORTUNITIES, AMBITIONS, FALLBACK_OFFER } from '../data/content.js';
import { key, dist, neighbors } from './hex.js';
import { RES, zero, add, canPay, tileAt, civCities, civArmies, fx, sources, cityHousing, hasInst, hasTech, components, connectedToCapital, slotCount, cityTiles, nearestCity, hasTreaty } from './economy.js';
import { log, nid, makeCity, atWar, revealRange, updateVision, syncDiscoveries, pairKey } from './state.js';
import { armyPath } from './army.js';
import { passableForNetwork } from './economy.js';
import { evaluateTreaty, stdTreaty, breakTreaty, declareWar, makePeace, relMemAdd, power, relation } from './diplomacy.js';

// ------------- cost helpers (shared by UI, AI and resolution) -------------
export function projectDef(what) {
  if (what.startsWith('district:')) { const id = what.slice(9); return { id, kind: 'district', def: DISTRICTS[id] }; }
  const id = what.slice(5); return { id, kind: 'work', def: WORKS[id] };
}
export function projectCost(S, civ, city, what) {
  const { id, kind, def } = projectDef(what); const c = { ...zero(), ...def.cost };
  if (id === 'foundry') c.mat += fx(S, civ, 'foundryMat');
  if (kind === 'work') { c.mat = Math.max(1, c.mat - fx(S, civ, 'workDisc')); }
  if (id === 'stabilization') { c.mat = Math.max(1, c.mat - fx(S, civ, 'stabDiscMat')); c.ene = Math.max(1, c.ene - fx(S, civ, 'stabDiscEne')); }
  if (id === 'conduit' && civ.tradition === 'circuit' && !civCities(S, civ.id).some(x => x.districts.some(d => d.type === 'conduit'))) c.mat = Math.max(1, c.mat - 2);
  return c;
}
export function projectTurns(S, civ, city, what) {
  const { id, def } = projectDef(what); let t = def.turns; const notes = [];
  if (id === 'foundry') { const f = fx(S, civ, 'foundryTime'); if (f) { t += f; notes.push('Garden Custodians +1'); } }
  if (t >= 3) { const a = fx(S, civ, 'projTimeLong'); if (a) { t += a; notes.push('Architect -1'); } }
  if (t >= 2 && city.districts.some(d => d.type === 'foundry')) { t -= 1; notes.push('Local industry -1'); }
  const net = ['conduit', 'exchange', 'anchor'].includes(id);
  if (net && fx(S, civ, 'netSpeed') > 0 && connectedToCapital(S, civ.id, city.id)) { t -= 1; notes.push('Choir network -1'); }
  return { turns: Math.max(CFG.projectMinTurns, t), notes };
}
export function recruitCost(S, civ) { const m = 1 + fx(S, civ, 'regCost'); return { ...zero(), mat: Math.round(CFG.cost.recruit.mat * m), ene: Math.round(CFG.cost.recruit.ene * m) }; }
export function instCost(S, civ, instId) {
  const c = { ...zero(), ...INSTITUTIONS[instId].cost };
  if (civ.flags.echo && !civ.flags.echoUsed) for (const k of RES) c[k] = Math.ceil(c[k] * 0.7);
  const mult = 1 + fx(S, civ, 'councilCostMult') * 0; return c; // council leverage only affects council offers
}
export function techReq(S, civ, id) {
  const base = CFG.research.cost[TECHS[id].age]; const disc = TECHS[id].civil ? fx(S, civ, 'techDisc') : 0;
  return Math.max(1, Math.ceil(base * (1 - disc) - 1e-9));
}
export function restoreEvery(S, civ) { return fx(S, civ, 'restoreFast') > 0 ? CFG.restore.everyFast : CFG.restore.everyBase; }
export function isUnlocked(S, civ, id) {
  for (const t of Object.keys(civ.techs)) if ((TECHS[t].unlock || []).includes(id)) return true; return false;
}
export function offerCost(S, civ, offer) { const c = { ...zero(), ...(offer.cost || {}) }; const m = 1 + fx(S, civ, 'councilCostMult'); for (const k of RES) c[k] = Math.max(0, Math.ceil(c[k] * m - 1e-9)); return c; }

// ------------- staging -------------
export const PHASE_OF = { council: 'political', ambition: 'political', respond: 'political', reform: 'political', treaty: 'political', influence: 'political', demand: 'political', cancel: 'political', claim: 'political', city: 'political', develop: 'political', salvage: 'political', answer: 'political', survey: 'exploration', outpost: 'exploration', investigate: 'exploration', recruit: 'exploration', objective: 'exploration' };
export const CATEGORY_OF = { develop: 'Develop', survey: 'Expand', claim: 'Expand', outpost: 'Expand', city: 'Expand', investigate: 'Expand', recruit: 'Mobilize', objective: 'Mobilize', treaty: 'Negotiate', influence: 'Negotiate', demand: 'Negotiate', cancel: 'Negotiate', reform: 'Reform' };
const FREE_TYPES = new Set(['council', 'ambition', 'respond', 'salvage', 'answer']);

export function reserved(S, civId) { const r = zero(); for (const c of S.staged[civId]) add(r, c.cost || {}); return r; }
export function available(S, civId) { const r = { ...S.civs[civId].res }; const rs = reserved(S, civId); for (const k of RES) r[k] -= rs[k]; return r; }
export function freeNegInterval(S, civ) { const v = sources(S, civ).map(x => x.fx.freeNeg || 0).filter(x => x > 0); return v.length ? Math.min(...v) : 0; }
export const ordersUsed = (S, civId) => S.staged[civId].filter(c => c.order).length;
export const ordersLeft = (S, civId) => CFG.orders - ordersUsed(S, civId);
export const conflictKey = (c) => {
  switch (c.type) {
    case 'develop': return 'dev:' + c.city; case 'survey': return 'sv:' + c.q + ',' + c.r; case 'claim': return 'cl:' + c.q + ',' + c.r; case 'outpost': return 'op:' + c.q + ',' + c.r;
    case 'city': return 'ct:' + c.q + ',' + c.r; case 'investigate': return 'inv:' + c.site; case 'recruit': return 'rc:' + c.city; case 'objective': return 'ob:' + c.army;
    case 'treaty': return 'tr:' + c.to + c.kind; case 'influence': return 'inf:' + c.city; case 'demand': return 'dm:' + c.to; case 'cancel': return 'cn:' + c.treaty;
    case 'council': return 'council'; case 'ambition': return 'amb'; case 'respond': return 'rs:' + c.proposal; case 'salvage': return 'sal:' + c.site;
    case 'answer': return 'an:' + c.city;
    case 'reform': return 'rf:' + c.kind + (c.kind === 'install' ? (c.site) : c.kind === 'reconcile' ? c.city : '');
  }
  return JSON.stringify(c);
};

export function validate(S, civId, cmd, ignoreStaged = false) {
  const civ = S.civs[civId]; if (!civ || civ.eliminated) return 'No such civilization.';
  if (S.over) return 'The run has ended.';
  const V = VALIDATE[cmd.type]; if (!V) return 'Unknown command.';
  const err = V(S, civ, cmd); if (err) return err;
  return null;
}

export function costOf(S, civId, cmd) { const f = COST[cmd.type]; return f ? f(S, S.civs[civId], cmd) : zero(); }

export function stage(S, civId, cmd) {
  const civ = S.civs[civId]; cmd = { ...cmd };
  const err = validate(S, civId, cmd); if (err) return { ok: false, error: err };
  cmd.cost = costOf(S, civId, cmd);
  // free negotiation (Listener / Mirrored Intermediaries): one Negotiate every N turns
  cmd.order = !FREE_TYPES.has(cmd.type);
  if (cmd.order && CATEGORY_OF[cmd.type] === 'Negotiate') {
    const n = freeNegInterval(S, civ);
    if (n && S.turn - civ.negCd >= n && !S.staged[civId].some(c => c.freeNeg)) { cmd.order = false; cmd.freeNeg = true; }
  }
  const ck = conflictKey(cmd);
  const dupe = S.staged[civId].findIndex(c => conflictKey(c) === ck);
  const list = S.staged[civId].slice(); // replace an equivalent staged order (revising)
  if (dupe >= 0) list.splice(dupe, 1);
  if (cmd.order && list.filter(c => c.order).length >= CFG.orders) return { ok: false, error: 'No orders left this turn (3 per turn). Unstage one first.' };
  const avail = { ...civ.res }; for (const c of list) add(avail, c.cost || {}, -1);
  if (!canPay(avail, cmd.cost)) return { ok: false, error: 'Not enough resources after reservations: need ' + fmtCost(cmd.cost) + '.' };
  // extra structural exclusivity: one council decision, one recruit per city, one ambition decision
  if (cmd.type === 'council' && list.some(c => c.type === 'council')) { const i = list.findIndex(c => c.type === 'council'); list.splice(i, 1); }
  list.push(cmd); S.staged[civId] = list; cmd.id = nid(S, 'o');
  return { ok: true, cmd };
}
export function unstage(S, civId, id) { const i = S.staged[civId].findIndex(c => c.id === id); if (i >= 0) { const [c] = S.staged[civId].splice(i, 1); return c; } return null; }
export function clearStaged(S, civId) { S.staged[civId] = []; }
export function fmtCost(c) { const p = []; for (const k of RES) if (c[k]) p.push(c[k] + ' ' + { sus: 'Sustenance', mat: 'Matter', ene: 'Energy', mem: 'Memory' }[k]); return p.join(', ') || 'free'; }

const myCity = (S, civ, id) => { const c = S.cities[id]; return c && c.owner === civ.id ? c : null; };
const observed = (civ, q, r) => !!civ.obs[key(q, r)];
const seenTile = (civ, q, r) => !!civ.seen[key(q, r)];
function ownBorder(S, civ, q, r) { return neighbors(q, r).some(n => { const t = tileAt(S, n.q, n.r); return t && t.owner === civ.id; }); }
function stagedCost(S, civ, exceptType) { return zero(); }

const VALIDATE = {
  develop(S, civ, c) {
    const city = myCity(S, civ, c.city); if (!city) return 'Not your city.';
    const { id, kind, def } = c.what ? projectDef(c.what) : {}; if (!def) return 'Unknown project.';
    if (kind === 'district') {
      if (def.needsInfra && !cityTiles(S, city).some(t => t.t === 'infra')) return 'Conduits need a buried-infrastructure source tile within this city\'s territory.';
      if (city.districts.length >= slotCount(city) && c.replace === undefined) return 'All district slots are full: choose a district to replace.';
      if (c.replace !== undefined && (c.replace < 0 || c.replace >= city.districts.length)) return 'Invalid slot.';
      if (city.districts.length < slotCount(city) && c.replace !== undefined) return 'There is an empty slot; no need to replace.';
    } else {
      if (def.needsTech && !hasTech(civ, def.needsTech)) return `Requires ${TECHS[def.needsTech].name}.`;
      if (city.works[id]) return 'This city already has that work.';
      if (def.needsDistrict && !city.districts.some(d => d.type === def.needsDistrict)) return `Requires a ${DISTRICTS[def.needsDistrict].name} in this city.`;
      if (id === 'stabilization' && city.works.stabilization) return 'Limit: one Stabilization project per city.';
    }
    return null;
  },
  survey(S, civ, c) {
    const t = tileAt(S, c.q, c.r); if (!t) return 'No such tile.'; if (!observed(civ, c.q, c.r)) return 'Survey from a tile you currently observe.';
    return null;
  },
  claim(S, civ, c) {
    const t = tileAt(S, c.q, c.r); if (!t) return 'No such tile.'; if (t.owner) return 'Already owned.'; if (t.city) return 'Occupied.';
    if (!seenTile(civ, c.q, c.r)) return 'Unexplored.'; if (!ownBorder(S, civ, c.q, c.r)) return 'Must be adjacent to your border.';
    return null;
  },
  outpost(S, civ, c) {
    const t = tileAt(S, c.q, c.r); if (!t) return 'No such tile.'; if (!TERRAIN[t.t].passable) return 'Cannot build on water.'; if (t.city || t.outpost) return 'Occupied.';
    if (!observed(civ, c.q, c.r)) return 'Needs a currently observed tile.'; if (t.owner && t.owner !== civ.id) return 'Foreign territory.';
    for (const n of neighbors(c.q, c.r)) { const nt = tileAt(S, n.q, n.r); if (nt && nt.city && S.cities[nt.city].owner !== civ.id) return 'Too close to a foreign settlement.'; }
    return null;
  },
  city(S, civ, c) {
    const t = tileAt(S, c.q, c.r); if (!t) return 'No such tile.'; if (!TERRAIN[t.t].passable) return 'Cannot settle water.';
    if (t.city) return 'Occupied.'; if (t.site) return 'A discovery site occupies this tile.'; if (!seenTile(civ, c.q, c.r)) return 'Survey or explore this tile first.';
    if (t.owner && t.owner !== civ.id) return 'Foreign territory.';
    if (civCities(S, civ.id).length >= CFG.maxCities) return 'City cap reached (5).';
    for (const o of Object.values(S.cities)) if (dist(o, c) < CFG.citySpacing) return `Too close to ${o.name} (needs ${CFG.citySpacing}+ hexes).`;
    const src = myCity(S, civ, c.source); if (!src) return 'Choose a connected source city.'; if (src.pop - 2 < 2) return 'Source city must keep at least 2 population (needs 4).';
    const reach = reachableFrom(S, civ.id, src);
    const ok = reach.has(key(c.q, c.r)) || neighbors(c.q, c.r).some(n => reach.has(key(n.q, n.r)));
    if (!ok) return 'The site must touch territory connected to the source city (use Claim or Outpost to bridge the gap).';
    return null;
  },
  investigate(S, civ, c) {
    const s = S.sites[c.site]; if (!s || s.type !== 'anomaly') return 'Not an anomaly.'; if (s.invest[civ.id]) return 'Already investigated.';
    if (!seenTile(civ, s.q, s.r)) return 'Not yet explored.';
    const near = [{ q: s.q, r: s.q }]; const own = tileAt(S, s.q, s.r).owner === civ.id || neighbors(s.q, s.r).some(n => { const t = tileAt(S, n.q, n.r); return t && (t.owner === civ.id) ; }) || civArmies(S, civ.id).some(a => dist(a, s) <= 1);
    if (!own) return 'Needs a claimed tile, outpost or army adjacent to the site.'; return null;
  },
  recruit(S, civ, c) {
    const city = myCity(S, civ, c.city); if (!city) return 'Not your city.'; if (!ROLES[c.role]) return 'Unknown role.';
    const here = civArmies(S, civ.id).find(a => a.q === city.q && a.r === city.r);
    if (here && here.regs.length >= CFG.army.maxRegs) return 'The army here is full (3 regiments).';
    if (!here && civArmies(S, civ.id).length >= CFG.army.maxArmies) return 'Army cap reached (3).';
    return null;
  },
  objective(S, civ, c) {
    const a = S.armies[c.army]; if (!a || a.owner !== civ.id) return 'Not your army.';
    if (!['guard', 'travel', 'raid', 'besiege'].includes(c.obj)) return 'Unknown objective.';
    if (c.obj === 'guard') return null;
    const t = tileAt(S, c.q, c.r); if (!t) return 'No such tile.'; if (!seenTile(civ, c.q, c.r)) return 'Unexplored destination.';
    if (c.obj === 'travel' && t.city && S.cities[t.city].owner !== civ.id) return 'Use besiege or raid on foreign settlements.';
    if (c.obj === 'raid' || c.obj === 'besiege') {
      if (!t.city) return 'Target must be a settlement.'; const city = S.cities[t.city]; if (city.owner === civ.id) return 'That is your own city.';
      if (city.owner && !atWar(S, civ.id, city.owner)) return 'Not at war. Declare war first (a Negotiate order).';
    }
    if (!armyPath(S, a, c)) return 'No route (blocked by water or closed borders).';
    return null;
  },
  treaty(S, civ, c) {
    const o = S.civs[c.to]; if (!o || o.eliminated || c.to === civ.id) return 'No such civilization.';
    if (!['trade', 'nonaggression', 'research', 'passage', 'preservation', 'shutdown'].includes(c.kind)) return 'Unknown treaty.';
    if (c.kind === 'preservation' && !hasTech(civ, 'testimony') && !hasTech(o, 'testimony')) return 'Preservation agreements need Testimony.';
    if (c.kind === 'shutdown' && !hasTech(civ, 'cycle_interruption')) return 'Shutdown accords need Cycle Interruption.';
    if (S.treaties.some(t => t.active && t.kind === c.kind && ((t.a === civ.id && t.b === c.to) || (t.b === civ.id && t.a === c.to)))) return 'Already in force.';
    if (!S.civs[civ.id].seen || !civCities(S, c.to).some(ct => civ.seen[key(ct.q, ct.r)])) return 'You have not met them (explore their territory).';
    return null;
  },
  influence(S, civ, c) {
    const city = S.cities[c.city]; if (!city || !city.ind) return 'Not an independent settlement.'; if (!civ.seen[key(city.q, city.r)]) return 'Unexplored.';
    if (city.notice) return 'A federation is already pending.'; if (civCities(S, civ.id).length >= CFG.maxCities) return 'City cap reached.';
    return null;
  },
  demand(S, civ, c) {
    const o = S.civs[c.to]; if (!o || o.eliminated) return 'No such civilization.';
    if (c.kind === 'war' && S.treaties.some(t => t.active && t.kind === 'nonaggression' && ((t.a === civ.id && t.b === c.to) || (t.b === civ.id && t.a === c.to))) && fx(S, o, 'verifiedTreaties') > 0) return `${o.name}'s treaties are verified (Testimony + Consult the Ancestors): the non-aggression pact cannot be broken before it expires.`;
    if (!['tribute', 'war', 'peace'].includes(c.kind)) return 'Unknown demand.';
    if (c.kind === 'peace' && !atWar(S, civ.id, c.to)) return 'Not at war.'; if (c.kind !== 'peace' && atWar(S, civ.id, c.to)) return 'Already at war.';
    if (!civCities(S, c.to).some(ct => civ.seen[key(ct.q, ct.r)])) return 'You have not met them.'; return null;
  },
  cancel(S, civ, c) {
    const t = S.treaties.find(t => t.id === c.treaty); if (!t || !t.active || (t.a !== civ.id && t.b !== civ.id)) return 'No such treaty.';
    return null;
  },
  reform(S, civ, c) {
    if (c.kind === 'install') {
      const s = S.sites[c.site]; const d = civ.disc[c.site]; if (!s || !d || d.state !== 'pending') return 'That discovery is not available to interpret.';
      if (s.state !== 'open') return 'Already interpreted by another society.';
      const id = c.interp; if (c.interp === 'voluntary_network') { if (civ.inst.some(x => x && x.id === id)) return 'Already installed.'; return c.slot >= 0 && c.slot < 3 ? null : 'Pick a slot.'; }
      if (!DISCOVERIES[s.type].interps.includes(id)) return 'Not an interpretation of this discovery.';
      if (!(c.slot >= 0 && c.slot < 3)) return 'Pick an institution slot.'; return null;
    }
    if (c.kind === 'install_baseline') { if (civ.inst.some(x => x && x.id === 'voluntary_network')) return 'Already installed.'; if (!(c.slot >= 0 && c.slot < 3)) return 'Pick a slot.'; return null; }
    if (c.kind === 'research') { const t = TECHS[c.tech]; if (!t) return 'Unknown technology.'; if (civ.techs[c.tech]) return 'Already known.'; if (civ.research.target === c.tech) return 'Already the active program.'; for (const p of t.pre) if (!civ.techs[p]) return `Requires ${TECHS[p].name}.`; return null; }
    if (c.kind === 'reconcile') { const city = myCity(S, civ, c.city); if (!city) return 'Not your city.'; if (city.reconcile) return 'A reconciliation is already underway.'; return null; }
    if (c.kind === 'restore') {
      if (!(fx(S, civ, 'restoreAction') > 0)) return 'Requires Release the Voices.'; if (S.turn - civ.restoreCd < restoreEvery(S, civ)) return `Restoration needs ${restoreEvery(S, civ) - (S.turn - civ.restoreCd)} more turn(s) to recover.`;
      if (!civCities(S, civ.id).some(x => x.pop < cityHousing(S, civ, x))) return 'No city has room.'; return null;
    }
    if (c.kind === 'ambition_change') { if (!civ.ambition) return 'No ambition committed.'; if (civ.ambitionChanged) return 'Already changed once.'; if (S.turn > 23) return 'Too late to change (through turn 23).'; if (!AMBITIONS[c.amb] || c.amb === civ.ambition.id) return 'Choose a different ambition.'; return null; }
    return 'Unknown reform.';
  },
  council(S, civ, c) {
    const cs = S.council; if (!cs.offers || cs.turn !== S.turn) return 'No council session this turn.';
    const o = civ.human ? cs.offers.find(x => x.id === c.offer) : c.view; if (!o || o.id !== c.offer) return 'No such offer.'; return null;
  },
  ambition(S, civ, c) {
    if (S.turn < 16 || S.turn > 21) return 'Ambitions are committed between turns 16 and 21.'; if (civ.ambition) return 'Already committed.'; if (!AMBITIONS[c.amb]) return 'Unknown ambition.'; return null;
  },
  respond(S, civ, c) { const p = S.proposals.find(p => p.id === c.proposal && p.to === civ.id); return p ? null : 'No such proposal.'; },
  answer(S, civ, c) { const city = myCity(S, civ, c.city); return city && city.request ? null : 'No request to answer.'; },
  salvage(S, civ, c) { const d = civ.disc[c.site]; const s = S.sites[c.site]; if (!d || d.state !== 'pending' || s.state !== 'open') return 'Nothing to salvage.'; if (DISCOVERIES[s.type].anomaly) return 'Anomalies are investigated, not salvaged.'; return null; },
};

const COST = {
  develop(S, civ, c) {
    const city = S.cities[c.city]; const cost = projectCost(S, civ, city, c.what);
    if (c.replace !== undefined) cost.mat += CFG.cost.rebuildDistrict.mat; return cost;
  },
  claim: () => ({ ...zero(), ...CFG.cost.claim }), outpost: () => ({ ...zero(), ...CFG.cost.outpost }), city: () => ({ ...zero(), ...CFG.cost.city }),
  investigate: () => ({ ...zero(), ...CFG.cost.investigate }),
  recruit: (S, civ) => recruitCost(S, civ),
  answer: (S, civ, c) => (c.honor ? { ...zero(), mem: 1 } : zero()),
  influence: () => ({ ...zero(), ...CFG.influence.commit }),
  reform(S, civ, c) {
    if (c.kind === 'install') return instCost(S, civ, c.interp);
    if (c.kind === 'install_baseline') return instCost(S, civ, 'voluntary_network');
    if (c.kind === 'reconcile') return { ...zero(), ...CFG.cost.reconcile };
    if (c.kind === 'restore') return { ...zero(), ...CFG.restore.cost };
    if (c.kind === 'ambition_change') return { ...zero(), ...CFG.cost.ambitionChange };
    return zero();
  },
  council(S, civ, c) { const o = civ.human ? S.council.offers.find(x => x.id === c.offer) : c.view; return { ...zero(), ...o.cost }; },
};

export function setEmergency(S, civId, mode) { S.civs[civId].emergency = mode || null; }
export function setAlloc(S, civId, n) { if (CFG.research.allocOptions.includes(n)) S.civs[civId].research.alloc = n; }
export function setPolicy(S, civId, p) { S.civs[civId].rationPolicy = p; }

export function reachableFrom(S, civId, city) {
  const seen = new Set([key(city.q, city.r)]); const st = [key(city.q, city.r)];
  while (st.length) { const k = st.pop(); const [q, r] = k.split(',').map(Number);
    for (const n of neighbors(q, r)) { const nk = key(n.q, n.r); const t = S.map.tiles[nk]; if (t && !seen.has(nk) && passableForNetwork(S, civId, t)) { seen.add(nk); st.push(nk); } } }
  return seen;
}
