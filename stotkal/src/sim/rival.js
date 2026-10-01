// Rival planner: utility-based, same economy/orders/fog/validators as the player. Motives are logged for debugging
// and surfaced concisely when a rival makes a major demand or breaks a pact.
import { CFG, FACTIONS, DISTRICTS, WORKS, TECHS, INSTITUTIONS, DISCOVERIES, AMBITIONS, FALLBACK_OFFER, OPPORTUNITIES } from '../data/content.js';
import { key, dist, neighbors } from './hex.js';
import { stable, rnd } from './rng.js';
import { RES, canPay, tileAt, civCities, civArmies, fx, hasTech, hasInst, computeEconomy, cityHousing, civResonance, totalResonance, effExposure, cityTiles, slotCount, components } from './economy.js';
import { atWar, RIVALS, pairKey } from './state.js';
import { stage, validate, available, projectCost, instCost, techReq, reachableFrom, ordersLeft, offerCost } from './commands.js';
import { drawOffers, offerView, isCouncilTurn } from './council.js';
import { relation, evaluateTreaty, power, contact } from './diplomacy.js';
import { evaluate } from './ambitions.js';
import { armyPath } from './army.js';
import { forecast } from './combat.js';

const jit = (S, id, k) => 0.9 + 0.2 * stable(S.seed, 'ai', S.turn, id, k);

function techPriority(S, civ) {
  const f = FACTIONS[civ.faction]; const want = []; const visit = (t) => { if (civ.techs[t] || want.includes(t)) return; for (const p of TECHS[t].pre) visit(p); want.push(t); };
  const amb = civ.ambition ? civ.ambition.id : f.ambition; for (const t of AMBITIONS[amb].techs) visit(t);
  for (const t of ['cultivation', 'conduit_repair', 'fortification', 'testimony', 'cartography', 'body_restoration']) visit(t);
  const rest = Object.keys(TECHS).sort((a, b) => TECHS[a].age - TECHS[b].age).filter(t => !want.includes(t));
  return [...want, ...rest].filter(t => !civ.techs[t] && TECHS[t].pre.every(p => civ.techs[p]));
}

export function planRivals(S) {
  for (const id of RIVALS) {
    const civ = S.civs[id]; if (civ.eliminated) continue;
    try { planOne(S, civ); } catch (e) { S.aiLog.push({ turn: S.turn, civ: id, error: String(e && e.stack || e) }); if (S.debugThrow) throw e; }
  }
  if (S.aiLog.length > 400) S.aiLog.splice(0, 200);
}

export function planAs(S, civId, factionId, ambition) { const civ = S.civs[civId]; const old = civ.faction; civ.faction = factionId; try { planOne(S, civ, { ambition }); } finally { civ.faction = old; } }
function planOne(S, civ, opts = {}) {
  const id = civ.id; const f = FACTIONS[civ.faction]; const W = f.weights; const cities = civCities(S, id);
  const econ = computeEconomy(S, id); const net = econ.net; const cands = [];
  const T = S.turn; const amb = opts.ambition || (civ.ambition ? civ.ambition.id : f.ambition);
  const add = (u, cmd, why) => cands.push({ u: u * jit(S, id, cmd.type + JSON.stringify(cmd).slice(0, 40)), cmd, why });
  // free settings
  civ.research.alloc = civ.res.mem >= 14 ? 4 : civ.res.mem >= 6 ? 2 : 1;
  if (econ.deficit > 0 && civ.res.sus < 3) civ.emergency = 'ration'; else if (civ.emergency === 'ration' && civ.res.sus > 8) civ.emergency = null;
  if (T >= 16 && T <= 21 && !civ.ambition) stage(S, id, { type: 'ambition', amb: opts.ambition || f.ambition });
  // council
  if (isCouncilTurn(T)) {
    const ids = civ.human ? (S.council.offers || []).map(o => o.id) : drawOffers(S, civ); let best = null, bu = -1;
    for (const oid of ids) { if (!OPPORTUNITIES[oid]) continue; const o = OPPORTUNITIES[oid]; const cost = offerCost(S, civ, o); if (!canPay(available(S, id), cost)) continue; let u = 20 + (W[o.cat] || 0) * 5; if (o.cat === 'preparation' && T >= 12) u += 20; if (o.cat === 'cohesion' && cities.some(c => c.coh < 60)) u += 15; u *= jit(S, id, oid); if (u > bu) { bu = u; best = oid; } }
    if (best) { const r = stage(S, id, { type: 'council', offer: best, view: civ.human ? undefined : offerView(S, civ, best) }); if (r.ok) S.aiLog.push({ turn: T, civ: id, why: 'council: ' + best }); else S.aiLog.push({ turn: T, civ: id, error: 'council stage failed: ' + r.error }); }
  }
  // ---- discoveries ----
  for (const [sid, d] of Object.entries(civ.disc)) {
    if (d.state !== 'pending') continue; const s = S.sites[sid]; if (s.state !== 'open') continue; const D = DISCOVERIES[s.type];
    if (D.anomaly) { if (amb === 'break' || T > 10) add(55, { type: 'investigate', site: sid }, 'anomaly data for Break the Recurrence'); continue; }
    if (!D.interps.length) { stage(S, id, { type: 'salvage', site: sid }); continue; }
    let best = null, bu = -99;
    for (const ip of D.interps) { const I = INSTITUTIONS[ip]; let u = 40; if (f.prefers.includes(ip)) u += 25; if (f.dislikes.includes(ip)) u -= 40; if (I.tags.some(t => AMBITIONS[amb] && ambTag(amb, t))) u += 12; u *= jit(S, id, ip); if (u > bu) { bu = u; best = ip; } }
    const slot = civ.inst.findIndex(x => !x); const cost = instCost(S, civ, best);
    if (slot >= 0 && bu > 10) add(70, { type: 'reform', kind: 'install', site: sid, interp: best, slot }, `interpret ${s.name} as ${INSTITUTIONS[best].name} (faction-compatible)`);
    else if (T - d.turn >= 3) stage(S, id, { type: 'salvage', site: sid });
  }
  // ---- research ----
  if (!civ.research.target) { const t = techPriority(S, civ)[0]; if (t) add(82, { type: 'reform', kind: 'research', tech: t }, 'research ' + TECHS[t].name + ' (ambition/baseline)'); }
  // ---- develop ----
  const chosen = new Set();
  for (const c of cities) {
    if (c.project) continue; const opts = [];
    const full = c.districts.length >= slotCount(c); const has = (t) => c.districts.some(d => d.type === t);
    const tryD = (type, u, why) => { if (!full) { const cmd = { type: 'develop', city: c.id, what: 'district:' + type }; opts.push({ u, cmd, why }); } };
    const tryW = (w, u, why) => { opts.push({ u, cmd: { type: 'develop', city: c.id, what: 'work:' + w }, why }); };
    if (net.sus < 2 || (econ.deficit > 0)) tryD('garden', 85, 'food bottleneck'); else if (!has('garden')) tryD('garden', 45 * (W.garden || 1), 'growth');
    if (c.pop >= cityHousing(S, civ, c) - 1) tryD('reservoir', 55, 'housing');
    if (net.ene < 1) { if (cityTiles(S, c).some(t => t.t === 'infra')) tryD('conduit', 80 * (W.conduit || 1), 'energy bottleneck'); }
    else if (!has('conduit') && cityTiles(S, c).some(t => t.t === 'infra')) tryD('conduit', 40 * (W.conduit || 1), 'infra source held');
    if (net.mat < 4 || civ.res.mat < 8) { const resMod = totalResonance(S) > 24 ? 0.3 : 1; tryD('foundry', 55 * (W.foundry || 1) * resMod, 'matter bottleneck'); }
    if (net.mem < 3) tryD('archive', 50 * (W.archive || 1), 'memory bottleneck'); else if (amb === 'record' && c.districts.filter(d => d.type === 'archive').length < 1) tryD('archive', 60 * (W.archive || 1), 'ambition: archives');
    if (c.coh < 62) tryD('sanctuary', 62 * (W.sanctuary || 1), 'coherence'); else if (!has('sanctuary')) tryD('sanctuary', 28 * (W.sanctuary || 1), 'coherence reserve');
    if (S.wars && Object.keys(S.wars).some(k => k.split('|').includes(id)) && !has('bulwark')) tryD('bulwark', 55, 'at war');
    if (cities.length > 1 && !has('exchange') && T > 6) tryD('exchange', 25, 'trade');
    const exp = effExposure(S, c);
    if (T >= 13 && exp > 0 && !c.works.stabilization) tryW('stabilization', T >= 16 ? 95 : 70, 'Quieting exposure');
    if (T >= 14 && c.works.stabilization === undefined && amb === 'break' && (civ.stabDone || 0) + cities.filter(x => x.project && x.project.what === 'work:stabilization').length < 2) tryW('stabilization', 78, 'ambition: stabilization x2');
    if (hasTech(civ, 'continuity_vessels') && !c.works.vessel && amb === 'embodied') tryW('vessel', 80, 'ambition: vessels');
    if (hasTech(civ, 'distributed_embodiment') && !c.works.anchor && amb === 'shared') tryW('anchor', 80, 'ambition: anchor');
    if (hasTech(civ, 'archive_sealing') && has('archive') && !c.works.seal && amb === 'record') tryW('seal', 82, 'ambition: sealed archive');
    for (const o of opts) add(o.u, o.cmd, o.why);
  }
  // ---- expansion ----
  const seenUnseen = surveyTarget(S, civ);
  if (seenUnseen) add(T <= 8 ? 56 : 30, { type: 'survey', q: seenUnseen.q, r: seenUnseen.r }, 'explore: ' + seenUnseen.gain + ' unexplored tiles');
  const claim = claimTarget(S, civ, amb); if (claim) add(32 * (W.expand || 1) + claim.s * 4, { type: 'claim', q: claim.t.q, r: claim.t.r }, 'claim tile (score ' + claim.s + ')');
  if (cities.length < (T < 12 ? 3 : 4) && T >= 2) { const site = citySite(S, civ); if (site && site.claim) add(66 * (W.expand || 1), { type: 'claim', q: site.claim.q, r: site.claim.r }, 'claim a bridge tile toward a city site'); else if (site) add(74 * (W.expand || 1), { type: 'city', q: site.t.q, r: site.t.r, source: site.src.id }, 'found a city at ' + TERR(site.t)); }
  if (hasInst(civ, 'voluntary_network') === false && amb === 'shared' && cities.length >= 2 && civ.inst.some(x => !x)) add(66, { type: 'reform', kind: 'install_baseline', slot: civ.inst.findIndex(x => !x) }, 'ambition: voluntary network');
  // connectivity: claim bridging tiles so that every city shares territory with the capital (supply, networks, Shared Continuity)
  if (cities.length > 1 && S.cities[civ.cap]) {
    const capReach = reachableFrom(S, id, S.cities[civ.cap]); const lost = cities.filter(c => !capReach.has(key(c.q, c.r)));
    for (const far of lost.slice(0, 1)) {
      const prev = new Map([[key(far.q, far.r), null]]); const q = [key(far.q, far.r)]; let end = null;
      while (q.length && !end) { const k = q.shift(); const [a, b] = k.split(',').map(Number); for (const n of neighbors(a, b)) { const nk = key(n.q, n.r); const t = S.map.tiles[nk]; if (!t || prev.has(nk) || !TERRAIN_PASS(t) || (t.owner && t.owner !== id && t.owner !== null)) continue; prev.set(nk, k); if (capReach.has(nk)) { end = nk; break; } q.push(nk); } }
      if (end) { let k = prev.get(end); const path = []; while (k) { path.push(k); k = prev.get(k); } const cand = path.map(k => S.map.tiles[k]).filter(t => !t.owner && !validate(S, id, { type: 'claim', q: t.q, r: t.r }))[0]; const cand2 = (end && !S.map.tiles[end].owner) ? null : null; if (cand) add(68, { type: 'claim', q: cand.q, r: cand.r }, 'claim a bridging tile to reconnect ' + far.name); }
    }
  }
  // outposts: reach anomaly sites and the Meridian Spire without conquest (Break the Recurrence)
  if (amb === 'break') {
    for (const st of Object.values(S.sites)) {
      if (!civ.seen[key(st.q, st.r)]) continue;
      if (st.type === 'anomaly' && !st.invest[id] && !validate(S, id, { type: 'investigate', site: st.id }) === false) { /* investigate handled above */ }
      if (st.type === 'anomaly' && !st.invest[id] && validate(S, id, { type: 'investigate', site: st.id })) {
        const spot = neighbors(st.q, st.r).map(n => S.map.tiles[key(n.q, n.r)]).filter(t => t && !validate(S, id, { type: 'outpost', q: t.q, r: t.r })).sort((a, b) => dist(a, nearestOwn(S, civ, a) || a) - dist(b, nearestOwn(S, civ, b) || b))[0];
        if (spot) add(62, { type: 'outpost', q: spot.q, r: spot.r }, 'outpost beside ' + st.name + ' to investigate it without conquest');
      }
      if (st.type === 'meridian_spire') { const sp = S.map.tiles[key(st.q, st.r)]; if (sp.owner !== id && !validate(S, id, { type: 'outpost', q: st.q, r: st.r })) add(58, { type: 'outpost', q: st.q, r: st.r }, 'secure access to the Meridian Spire'); }
    }
  }
  // influence independent settlements (peaceful routes)
  for (const c of Object.values(S.cities)) if (c.ind && !c.notice && civ.seen[key(c.q, c.r)] && cities.length < CFG.maxCities && dist(c, nearestOwn(S, civ, c) || c) <= 6) add(46 * (f.weights.sanctuary > 1 || W.expand > 1 ? 1.2 : 0.9), { type: 'influence', city: c.id }, 'peaceful integration of ' + c.name);
  // ---- reconcile ----
  for (const c of cities) if (c.coh < 45 && !c.reconcile) add(66, { type: 'reform', kind: 'reconcile', city: c.id }, 'low Coherence in ' + c.name);
  for (const c of cities) if (c.request) stage(S, id, { type: 'answer', city: c.id, honor: civ.res.mem >= 3 });
  if (hasInst(civ, 'voices')) add(55, { type: 'reform', kind: 'restore' }, 'restoration');
  // ---- diplomacy & war ----
  diplomacy(S, civ, add, econ, amb);
  // ---- military ----
  military(S, civ, add, econ, amb);
  // pick top feasible (distinct categories not required; stage handles caps and reservations)
  cands.sort((a, b) => b.u - a.u);
  for (const c of cands) { if (ordersLeft(S, id) <= 0) break; if (c.u < 20) break; const r = stage(S, id, c.cmd); if (r.ok) S.aiLog.push({ turn: T, civ: id, u: Math.round(c.u), cmd: c.cmd.type + (c.cmd.kind ? ':' + c.cmd.kind : ''), why: c.why }); }
}
const TERR = (t) => t.t;
function ambTag(amb, tag) { return ({ embodied: ['embodied', 'restore', 'protective'], shared: ['network', 'collective', 'voluntary'], record: ['record', 'testimony'], break: ['protective', 'testimony'] }[amb] || []).includes(tag); }
const TERRAIN_PASS = (t) => t.t !== 'lake';
function nearestOwn(S, civ, pos) { let b = null, bd = 99; for (const c of civCities(S, civ.id)) { const d = dist(c, pos); if (d < bd) { bd = d; b = c; } } return b; }

function surveyTarget(S, civ) {
  let best = null;
  for (const k of Object.keys(civ.obs)) {
    const t = S.map.tiles[k]; if (!t) continue; let gain = 0;
    for (let dq = -2; dq <= 2; dq++) for (let dr = -2; dr <= 2; dr++) { const h = S.map.tiles[key(t.q + dq, t.r + dr)]; if (h && dist(t, h) <= 2 && !civ.seen[key(h.q, h.r)]) gain++; }
    if (gain > 2 && (!best || gain > best.gain || (gain === best.gain && key(t.q, t.r) < key(best.q, best.r)))) best = { q: t.q, r: t.r, gain };
  }
  return best;
}
function claimTarget(S, civ, amb) {
  let best = null;
  for (const t of Object.values(S.map.tiles)) {
    if (t.owner || t.city || !civ.seen[key(t.q, t.r)]) continue; if (!neighbors(t.q, t.r).some(n => { const o = S.map.tiles[key(n.q, n.r)]; return o && o.owner === civ.id; })) continue;
    let s = 0; const y = { desert: 1, garden: 2, lake: 0, coast: 1, ridge: 1, infra: 3 }[t.t]; s += y; if (t.site) s += 2; const sites = neighbors(t.q, t.r).some(n => { const o = S.map.tiles[key(n.q, n.r)]; return o && o.site && S.sites[o.site].type === 'anomaly'; }); if (sites && amb === 'break') s += 3;
    const sp = Object.values(S.sites).find(x => x.type === 'meridian_spire'); if (amb === 'break' && sp && dist(t, sp) <= 1) s += 3; if (t.q === sp.q && t.r === sp.r && amb === 'break') s += 5;
    if (!best || s > best.s || (s === best.s && key(t.q, t.r) < key(best.t.q, best.t.r))) best = { t, s };
  }
  return best && best.s >= 2 ? best : null;
}
function siteScore(S, t) { let s = 0; for (const h of [t, ...neighbors(t.q, t.r).map(n => S.map.tiles[key(n.q, n.r)]).filter(Boolean)]) s += { desert: 1, garden: 2, lake: 0.5, coast: 1, ridge: 1, infra: 2.5 }[h.t]; return s; }
function citySite(S, civ) {
  const srcs = civCities(S, civ.id).filter(c => c.pop >= 4).sort((a, b) => b.pop - a.pop); if (!srcs.length) return null; const src = srcs[0];
  let best = null, bestClaim = null;
  for (const t of Object.values(S.map.tiles)) {
    if (!civ.seen[key(t.q, t.r)]) continue;
    const err = validate(S, civ.id, { type: 'city', q: t.q, r: t.r, source: src.id });
    const s = siteScore(S, t);
    if (!err) { if (!best || s > best.s || (s === best.s && key(t.q, t.r) < key(best.t.q, best.t.r))) best = { t, s, src }; continue; }
    if (!/touch territory/.test(err)) continue;
    // needs a bridging claim: find an unowned neighbour adjacent to our border
    const bridge = neighbors(t.q, t.r).map(n => S.map.tiles[key(n.q, n.r)]).filter(n => n && !validate(S, civ.id, { type: 'claim', q: n.q, r: n.r })).sort((a, b) => key(a.q, a.r) < key(b.q, b.r) ? -1 : 1)[0];
    if (bridge && (!bestClaim || s > bestClaim.s)) bestClaim = { t: bridge, s, target: t };
  }
  if (best) return best; if (bestClaim) return { claim: bestClaim.t, s: bestClaim.s };
  return null;
}

function diplomacy(S, civ, add, econ, amb) {
  const id = civ.id; const T = S.turn; const f = FACTIONS[civ.faction];
  for (const other of S.civOrder) {
    if (other === id || S.civs[other].eliminated) continue; if (!contact(S, id, other)) continue;
    const O = S.civs[other]; const rel = relation(S, id, other).score; const pw = power(S, id) / Math.max(1, power(S, other));
    const has = (k) => S.treaties.some(t => t.active && t.kind === k && ((t.a === id && t.b === other) || (t.a === other && t.b === id)));
    const war = atWar(S, id, other);
    if (war) { const weary = T - S.wars[pairKey(id, other)]; if (pw < 0.8 || weary >= 6) add(60, { type: 'demand', to: other, kind: 'peace' }, `ceasefire: ${pw < 0.8 ? 'outmatched' : 'long war'}`); continue; }
    if (!has('trade') && rel >= -5 && T >= 4) add(34, { type: 'treaty', to: other, kind: 'trade' }, `trade with ${O.name} (relations ${rel})`);
    if (!has('nonaggression') && (pw < 0.9 || rel < 0) && rel >= -10) add(44, { type: 'treaty', to: other, kind: 'nonaggression' }, `security: ${O.name} looks stronger or tense`);
    if (!has('research') && rel >= 4 && T >= 6) add(30, { type: 'treaty', to: other, kind: 'research' }, 'research exchange');
    if (!has('passage') && rel >= 4 && (civCities(S, id).length > 1) && T >= 8) add(26, { type: 'treaty', to: other, kind: 'passage' }, 'passage for supply lines');
    if (!has('preservation') && hasTech(civ, 'testimony') && rel >= 6) add(35 * (f.weights.archive || 1), { type: 'treaty', to: other, kind: 'preservation' }, 'preservation agreement');
    if (!has('shutdown') && hasTech(civ, 'cycle_interruption') && amb === 'break' && civResonance(S, other) > 0) add(70, { type: 'treaty', to: other, kind: 'shutdown' }, 'mutually beneficial Resonance shutdown (Break the Recurrence)');
    // war: opportunistic and philosophical
    const aggressive = (f.weights.war || 0.6) * (rel < -12 ? 1.4 : 0.6);
    const pact = S.treaties.some(t => t.active && t.kind === 'nonaggression' && ((t.a === other && t.b === id) || (t.a === id && t.b === other)));
    const wantWar = T >= 8 && pw >= 1.6 && rel < -12 && aggressive > 0.55 && civArmies(S, id).length;
    if (wantWar && (!pact || (pw >= 2.2 && rel < -18 && T >= 12))) add(52 * aggressive, { type: 'demand', to: other, kind: 'war', why: `${O.name} is weak and relations are poor (${rel})${pact ? '; the non-aggression pact is no longer worth keeping' : ''}` }, pact ? 'break pact to exploit advantage' : 'exploit advantage');
    const dk = id + '>' + other + ':tribute'; S.aiMem = S.aiMem || {}; const pending = S.proposals.some(p => p.from === id && p.to === other && p.kind === 'tribute');
    if (T >= 7 && pw >= 1.6 && rel < 5 && !war && !pending && T - (S.aiMem[dk] ?? -99) >= 8) { add(26, { type: 'demand', to: other, kind: 'tribute', why: `tribute from a weaker neighbour (power ${power(S, id)} vs ${power(S, other)})` }, 'tribute demand'); }
  }
}

function military(S, civ, add, econ, amb) {
  const id = civ.id; const f = FACTIONS[civ.faction]; const T = S.turn; const cities = civCities(S, id); const armies = civArmies(S, id);
  const wars = Object.keys(S.wars).filter(k => k.split('|').includes(id)); const regs = armies.reduce((a, x) => a + x.regs.length, 0);
  const cap = S.cities[civ.cap]; if (!cap) return;
  const threatened = Object.values(S.armies).some(a => a.owner !== id && atWar(S, a.owner, id) && dist(a, cap) <= 5);
  const want = Math.min(6, 1 + Math.floor(T / 6) + (wars.length ? 2 : 0) + Math.round((f.weights.war || 0.5) * 2));
  if (regs < want && T >= 4) { const role = regs % 3 === 0 ? 'warden' : regs % 3 === 1 ? 'lancer' : 'disruptor'; add(wars.length || threatened ? 70 : 20 + 16 * (f.weights.war || 0.5) - regs * 4, { type: 'recruit', city: cap.id, role }, threatened ? 'defence' : 'garrison'); }
  // scouts: reach anomaly sites and the Spire by army (sight + adjacency), never by conquest
  if (amb === 'break') {
    const idle = armies.filter(a => a.obj.type === 'guard' && !a.regs.some(r => r.ready > S.turn) && !(a.q === cap.q && a.r === cap.r && armies.length === 1 && wars.length));
    const targets = Object.values(S.sites).filter(st => st.type === 'anomaly' && civ.seen[key(st.q, st.r)] && !st.invest[id] && validate(S, id, { type: 'investigate', site: st.id }));
    for (const a of idle) {
      let tgt = null;
      for (const st of targets) { const spot = neighbors(st.q, st.r).map(n => S.map.tiles[key(n.q, n.r)]).filter(t => t && civ.seen[key(t.q, t.r)] && !validate(S, id, { type: 'objective', army: a.id, obj: 'travel', q: t.q, r: t.r })).sort((p, q2) => dist(p, a) - dist(q2, a))[0]; if (spot && (!tgt || dist(spot, a) < dist(tgt, a))) tgt = spot; }
      if (!tgt) { const unseen = Object.values(S.map.tiles).some(t => !civ.seen[key(t.q, t.r)]); if (unseen) { const frontier = Object.values(S.map.tiles).filter(t => civ.seen[key(t.q, t.r)] && !validate(S, id, { type: 'objective', army: a.id, obj: 'travel', q: t.q, r: t.r }) && dist(t, { q: 0, r: 0 }) <= 2).sort((p, q2) => dist(p, { q: 0, r: 0 }) - dist(q2, { q: 0, r: 0 }))[0]; if (frontier && dist(frontier, a) > 0) tgt = frontier; } }
      if (tgt) add(63, { type: 'objective', army: a.id, obj: 'travel', q: tgt.q, r: tgt.r }, 'scout toward ' + (targets.length ? 'an anomaly site' : 'the unexplored centre'));
    }
    if (!armies.length && T >= 5 && T <= 20) add(60, { type: 'recruit', city: cap.id, role: 'lancer' }, 'recruit a scout');
  }
  for (const a of armies) {
    if (a.regs.some(r => r.ready > S.turn)) continue; const str = a.regs.reduce((s, r) => s + r.str, 0);
    if (a.obj.type !== 'guard') continue;
    // war target: nearest known enemy city
    let tgt = null, bd = 99;
    for (const k of wars) { const other = k.split('|').find(x => x !== id); for (const c of civCities(S, other)) if (civ.seen[key(c.q, c.r)]) { const d = dist(a, c); if (d < bd) { bd = d; tgt = c; } } }
    if (tgt && str >= 18) { const path = armyPath(S, a, tgt); if (path) { const fc = forecast(S, [a], tileAt(S, tgt.q, tgt.r), 'assault'); if (fc.attLoss < str * 0.6) add(64, { type: 'objective', army: a.id, obj: 'besiege', q: tgt.q, r: tgt.r, approach: path.breaks.length ? 'assault' : 'siege' }, `besiege ${tgt.name}: forecast loses ${fc.attLoss}, deals ${fc.defLoss}`); } }
    else if (!wars.length && str >= 24 && (f.weights.war || 0) >= 0.6 && T >= 10) { // independents
      for (const c of Object.values(S.cities)) if (c.ind && civ.seen[key(c.q, c.r)] && dist(a, c) <= 5 && !c.notice) { const path = armyPath(S, a, c); if (path && forecast(S, [a], tileAt(S, c.q, c.r), 'assault').attLoss < str * 0.5) { add(48, { type: 'objective', army: a.id, obj: 'besiege', q: c.q, r: c.r, approach: 'assault' }, 'conquer ' + c.name); break; } }
    }
  }
}
