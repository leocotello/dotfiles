// Applies staged commands during resolution. Costs are charged here (not at staging), so cancellation before commit is a free no-op.
import { CFG, TERRAIN, DISTRICTS, WORKS, INSTITUTIONS, DISCOVERIES, TECHS, ROLES, OPPORTUNITIES, FALLBACK_OFFER, NAMES, AMBITIONS } from '../data/content.js';
import { key, dist, neighbors } from './hex.js';
import { RES, zero, add, canPay, tileAt, civCities, civArmies, fx, hasInst, hasTech, cityHousing, components, hasTreaty } from './economy.js';
import { log, nid, makeCity, atWar, revealRange, updateVision, syncDiscoveries, pairKey } from './state.js';
import { validate, costOf, projectCost, projectTurns, restoreEvery, projectDef, instCost, recruitCost } from './commands.js';
import { evaluateTreaty, stdTreaty, breakTreaty, declareWar, makePeace, relMemAdd, power, relation } from './diplomacy.js';
import { applyOffer, addPopulation, addFragment, giveRegiment, addResonance } from './council.js';
import { FALLBACK_OFFER as FB } from '../data/content.js';

function pay(civ, cost) { for (const k of RES) civ.res[k] -= cost[k] || 0; }

export function transferCity(S, city, newOwner, how) {
  const old = city.owner ? S.civs[city.owner] : null; const oldId = city.owner || 'ind';
  city.owner = newOwner; city.ind = false; city.project = null; city.coh = Math.max(0, city.coh - 15); city.consent = how === 'federated'; city.federated = how === 'federated'; city.fedMet = true; city.origin = how;
  city.integrity = Math.max(3, Math.floor(city.integrity)); city.notice = null; city.influence = {}; city.capital = false; city.pop = Math.max(1, city.pop); city.request = null;
  if (how === 'federated') city.coh = Math.min(100, city.coh + 15);
  for (const t of Object.values(S.map.tiles)) if (t.owner === oldId && dist(t, city) <= 1) t.owner = newOwner;
  tileAt(S, city.q, city.r).owner = newOwner;
  if (old) { old.stats.lost++; if (old.cap === city.id) { const next = civCities(S, old.id).sort((a, b) => b.pop - a.pop)[0]; old.cap = next ? next.id : null; if (next) next.capital = true; } if (!civCities(S, old.id).length) eliminate(S, old.id); }
  if (S.civs[newOwner]) S.civs[newOwner].stats.conquered += how === 'captured' ? 1 : 0;
}
export function releaseCity(S, city) {
  const oldId = city.owner; city.owner = null; city.ind = true; city.garrison = 6; city.project = null; city.capital = false; city.federated = false;
  for (const t of Object.values(S.map.tiles)) if (t.owner === oldId && dist(t, city) <= 1) t.owner = 'ind';
  const old = S.civs[oldId]; if (old) { if (old.cap === city.id) { const next = civCities(S, oldId).sort((a, b) => b.pop - a.pop)[0]; old.cap = next ? next.id : null; if (next) next.capital = true; } if (!civCities(S, oldId).length) eliminate(S, oldId); }
}
export function eliminate(S, civId) {
  const civ = S.civs[civId]; civ.eliminated = true; for (const a of civArmies(S, civId)) delete S.armies[a.id];
  for (const t of S.treaties) if (t.active && (t.a === civId || t.b === civId)) t.active = false;
  log(S, civId, `${civ.name} has lost its last settlement.`, 2, { pub: true });
}

export function installInstitution(S, civ, instId, slot, siteId) {
  const I = INSTITUTIONS[instId]; const old = civ.inst[slot]; const cities = civCities(S, civ.id);
  if (old) { civ.instHistory.push({ id: old.id, replaced: S.turn }); for (const c of cities) c.coh = Math.max(0, c.coh - 4); if (civ.id === 'you') { log(S, 'you', `Transition: ${INSTITUTIONS[old.id].name} was replaced. -4 Coherence in every city; the memory of it remains in the Chronicle.`, 2); S.chronicle.push({ turn: S.turn, text: `You set aside ${INSTITUTIONS[old.id].name}.`, tag: 'replaced' }); } }
  const others = civ.inst.filter((x, i) => x && i !== slot).map(x => INSTITUTIONS[x.id]);
  const clash = others.some(o => o.conflicts.some(t => I.tags.includes(t)) || I.conflicts.some(t => o.tags.includes(t)));
  if (clash) { const loss = 6 * (1 + (civ.tradition === 'keepers' && I.tags.includes('forced') ? 1 : 0)); for (const c of cities) c.coh = Math.max(0, c.coh - loss); if (civ.id === 'you') log(S, 'you', `Incompatible reform: -${loss} Coherence in every city, once.`, 2); }
  else if (I.tags.includes('forced') && civ.tradition === 'keepers') { for (const c of cities) c.coh = Math.max(0, c.coh - 4); }
  if (civ.flags.echo && !civ.flags.echoUsed) { civ.flags.echoUsed = true; for (const c of cities) c.coh = Math.max(0, c.coh - 4); if (civ.id === 'you') log(S, 'you', 'The echo of an older institution leaves a scar: -4 Coherence in every city.', 1); }
  civ.inst[slot] = { id: instId, site: siteId || null, turn: S.turn };
  const oi = I.onInstall || {};
  if (oi.popRoom) { const integ = oi.integ && hasInst(civ, 'voices') && civ.techs.body_restoration ? Math.floor(oi.integ / 2) : oi.integ; const r = addPopulation(S, civ, oi.popRoom, integ, oi.request); if (civ.id === 'you') log(S, 'you', `${I.name}: +${r.added} population${r.cities.length ? ' in ' + r.cities.map(c => c.name).join(', ') : ''}. Integration penalty ${integ || 0}.`, 2); }
  if (oi.freeRegiment) giveRegiment(S, civ, oi.freeRegiment);
  if (oi.revealInfra) for (const t of Object.values(S.map.tiles)) if (t.t === 'infra') civ.seen[key(t.q, t.r)] = 1;
  S.chronicle.push({ turn: S.turn, civ: civ.id, text: `${civ.id === 'you' ? 'You' : civ.name} chose "${I.name}" at ${siteId ? S.sites[siteId].name : 'home'}.`, tag: 'institution', inst: instId });
}

export function applyCmd(S, civId, cmd) {
  const civ = S.civs[civId]; const err = validate(S, civId, cmd);
  const who = civId === 'you' ? '' : `${civ.name}: `;
  if (err) return { ok: false, msg: `${who}Order "${cmd.type}" could not proceed: ${err} Nothing was spent.` };
  const cost = costOf(S, civId, cmd);
  if (!canPay(civ.res, cost)) return { ok: false, msg: `${who}Order "${cmd.type}" failed: resources changed and are no longer sufficient. Nothing was spent.` };
  const A = APPLY[cmd.type]; const res = A(S, civ, cmd, cost);
  if (res.ok !== false) { if (cmd.freeNeg) civ.negCd = S.turn; }
  return res;
}

const APPLY = {
  develop(S, civ, c, cost) {
    const city = S.cities[c.city]; let refund = 0;
    if (city.project) { refund = Math.floor(city.project.matPaid * CFG.cancelRefund); civ.res.mat += refund; }
    pay(civ, cost); const turns = projectTurns(S, civ, city, c.what).turns;
    city.project = { what: c.what, total: turns, remaining: turns, matPaid: cost.mat, replace: c.replace };
    return { ok: true, msg: `${city.name}: began ${projectDef(c.what).def.name} (${turns} turns).${refund ? ' Replaced project refunded ' + refund + ' Matter (half).' : ''}` };
  },
  claim(S, civ, c, cost) { pay(civ, cost); tileAt(S, c.q, c.r).owner = civ.id; return { ok: true, msg: `Claimed a ${TERRAIN[tileAt(S, c.q, c.r).t].name} tile.` }; },
  outpost(S, civ, c, cost) { pay(civ, cost); const t = tileAt(S, c.q, c.r); if (!t.owner) t.owner = civ.id; t.outpost = civ.id; return { ok: true, msg: `Outpost raised on ${TERRAIN[t.t].name}.` }; },
  city(S, civ, c, cost) {
    pay(civ, cost); const src = S.cities[c.source]; src.pop -= 2;
    const nm = NAMES.city.filter(n => !Object.values(S.cities).some(x => x.name === n)); const city = makeCity(S, civ.id, c.q, c.r, { name: nm[((S.flags.nameIdx = (S.flags.nameIdx || 0) + 1) + S.nextId) % nm.length] || 'New Settlement' });
    const t = tileAt(S, c.q, c.r); if (t.outpost) t.outpost = null;
    city.pop = 2; city.coh = CFG.colony.coh - CFG.colony.integrationPenalty;
    return { ok: true, msg: `Founded ${city.name} (population 2 from ${src.name}); it is integrating (-10 Coherence).`, city };
  },
  survey(S, civ, c) { const n = revealRange(S, civ, { q: c.q, r: c.r }, 2 + fx(S, civ, 'surveyRange')); return { ok: true, msg: `Survey revealed ${n} new tile${n === 1 ? '' : 's'}.` }; },
  investigate(S, civ, c, cost) {
    pay(civ, cost); const s = S.sites[c.site]; s.invest[civ.id] = true; civ.investigated++;
    const m = 1 + fx(S, civ, 'salvageMult'); const mem = Math.round(CFG.salvage.mem * m); civ.res.mem += mem; addFragment(S, civ, 'anomaly', s.fragment, s.id);
    if (civ.disc[s.id]) civ.disc[s.id].state = 'done';
    return { ok: true, msg: `Investigated ${s.name}: +${mem} Memory and a named measurement. (${civ.investigated}/3 for Break the Recurrence)` };
  },
  recruit(S, civ, c, cost) {
    pay(civ, cost); const city = S.cities[c.city];
    let army = civArmies(S, civ.id).find(a => a.q === city.q && a.r === city.r && a.regs.length < CFG.army.maxRegs);
    if (!army) { S.nextId++; army = { id: 'a' + S.nextId, owner: civ.id, q: city.q, r: city.r, regs: [], obj: { type: 'guard' }, retreatAt: CFG.army.retreatDefault, entrench: 0 }; S.armies[army.id] = army; }
    S.nextId++; army.regs.push({ id: 'g' + S.nextId, role: c.role, str: 10, ready: S.turn + 1 });
    return { ok: true, msg: `${ROLES[c.role].name} regiment recruited at ${city.name}; ready next turn.` };
  },
  objective(S, civ, c) {
    const a = S.armies[c.army]; a.obj = { type: c.obj, q: c.q, r: c.r, approach: c.approach || (c.obj === 'raid' ? 'raid' : c.obj === 'besiege' ? 'siege' : 'assault') }; a.retreatAt = c.retreatAt ?? a.retreatAt; a.entrench = 0;
    return { ok: true, msg: `Army ${c.obj} objective set.` };
  },
  treaty(S, civ, c) {
    const to = S.civs[c.to];
    if (to.human) { // proposal to the player: appears at the start of next turn
      S.proposals.push({ id: nid(S, 'p'), from: civ.id, to: c.to, kind: c.kind, turn: S.turn, expires: S.turn + 2, reasons: [] });
      return { ok: true, msg: `${civ.name} proposed a ${c.kind} agreement to ${to.name}.` };
    }
    const ev = evaluateTreaty(S, civ.id, c.to, c.kind);
    if (ev.accept) { const t = makeTreaty(S, civ.id, c.to, c.kind); return { ok: true, msg: `${to.name} accepted the ${c.kind} agreement (${t.start}-${t.end}).` }; }
    relMemAdd(S, c.to, civ.id, -1);
    return { ok: true, refused: true, reasons: ev.reasons, msg: `${to.name} declined the ${c.kind} proposal (score ${ev.score} < ${ev.need}). Reasons: ${ev.reasons.map(r => r.label + ' ' + (r.amt > 0 ? '+' : '') + r.amt).join('; ')}.` };
  },
  influence(S, civ, c, cost) {
    pay(civ, cost); const city = S.cities[c.city]; const n = 1 + (fx(S, civ, 'influenceFast') ? 1 : 0); city.influence[civ.id] = (city.influence[civ.id] || 0) + n;
    let msg = `${city.name}: influence ${city.influence[civ.id]}/${CFG.influence.need}.`;
    if (city.influence[civ.id] >= CFG.influence.need) { city.notice = { civ: civ.id, due: S.turn + CFG.influence.noticeTurns }; msg += ` Federation notice given; it joins on turn ${city.notice.due}.`; }
    return { ok: true, msg };
  },
  demand(S, civ, c) {
    const to = S.civs[c.to];
    if (c.kind === 'war') { declareWar(S, civ.id, c.to, c.why); return { ok: true, msg: `War declared on ${to.name}.` }; }
    if (to.human) { S.aiMem = S.aiMem || {}; S.aiMem[civ.id + '>' + c.to + ':tribute'] = S.turn; S.proposals.push({ id: nid(S, 'p'), from: civ.id, to: c.to, kind: c.kind === 'tribute' ? 'tribute' : 'peace', turn: S.turn, expires: S.turn + 2, why: c.why }); return { ok: true, msg: `${civ.name} made a demand of ${to.name}.` }; }
    if (c.kind === 'peace') { const rel = relation(S, c.to, civ.id).score; const weary = S.turn - S.wars[pairKey(civ.id, c.to)] >= 4; if (rel > -45 || weary) { makePeace(S, civ.id, c.to); return { ok: true, msg: `${to.name} agreed to peace.` }; } return { ok: true, msg: `${to.name} refused peace.` }; }
    const ratio = power(S, civ.id) / Math.max(1, power(S, c.to));
    if (ratio >= 1.6 && to.res.mat >= 4) { to.res.mat -= 4; to.res.ene = Math.max(0, to.res.ene - 4); civ.res.mat += 4; civ.res.ene += 4; relMemAdd(S, c.to, civ.id, -8); return { ok: true, msg: `${to.name} paid tribute (4 Matter, 4 Energy) under pressure.` }; }
    relMemAdd(S, c.to, civ.id, -5); return { ok: true, msg: `${to.name} refused the demand.` };
  },
  cancel(S, civ, c) {
    const t = S.treaties.find(x => x.id === c.treaty); const other = S.civs[t.a === civ.id ? t.b : t.a];
    if (S.civs[other.id] && fx(S, other, 'verifiedTreaties') > 0 && other.id !== civ.id) return { ok: false, msg: `${other.name}'s verified treaty cannot be cancelled before it expires.` };
    breakTreaty(S, civ.id, t, 'cancelled early'); return { ok: true, msg: `You cancelled the ${t.kind} treaty early: a broken promise.` };
  },
  reform(S, civ, c, cost) {
    if (c.kind === 'install' || c.kind === 'install_baseline') { pay(civ, cost); const id = c.kind === 'install' ? c.interp : 'voluntary_network'; const siteId = c.kind === 'install' ? c.site : null;
      if (siteId) { const s = S.sites[siteId]; s.state = 'resolved'; s.by = civ.id; s.interp = id; civ.disc[siteId].state = 'done'; for (const o of Object.values(S.civs)) if (o.id !== civ.id && o.disc[siteId]) o.disc[siteId].state = 'gone'; addFragment(S, civ, DISCOVERIES[s.type].cat, s.fragment, s.id); }
      installInstitution(S, civ, id, c.slot, siteId); return { ok: true, msg: `Institution installed: ${INSTITUTIONS[id].name}.` }; }
    if (c.kind === 'research') { civ.research.target = c.tech; return { ok: true, msg: `Research program: ${TECHS[c.tech].name} (progress kept: ${civ.research.progress[c.tech] || 0}).` }; }
    if (c.kind === 'reconcile') { pay(civ, cost); const city = S.cities[c.city]; city.reconcile = { left: CFG.coherence.reconcileTurns }; return { ok: true, msg: `Reconciliation begun in ${city.name} (completes in ${CFG.coherence.reconcileTurns} turns, +${CFG.coherence.reconcileGain} Coherence).` }; }
    if (c.kind === 'restore') { pay(civ, cost); civ.restoreCd = S.turn; const integ = fx(S, civ, 'restoreFast') > 0 ? CFG.restore.integFast : CFG.restore.integ; const r = addPopulation(S, civ, 2, integ, 'rename'); return { ok: true, msg: `Restoration: +${r.added} population (integration -${integ} Coherence).` }; }
    if (c.kind === 'ambition_change') { pay(civ, cost); civ.ambition = { id: c.amb, turn: S.turn }; civ.ambitionChanged = true; return { ok: true, msg: `Ambition changed to ${AMBITIONS[c.amb].name}. Investments in shared research and projects remain.` }; }
  },
  council(S, civ, c, cost) {
    const o = civ.human ? S.council.offers.find(x => x.id === c.offer) : c.view; pay(civ, cost);
    const src = o.id === FB.id ? FB : OPPORTUNITIES[o.id]; applyOffer(S, civ, src); if (civ.human) S.council.chosen = o.id; S.council.pickedLog.push({ turn: S.turn, id: o.id, civ: civ.id });
    return { ok: true, msg: `Council: ${o.title}.` };
  },
  ambition(S, civ, c) { civ.ambition = { id: c.amb, turn: S.turn }; return { ok: true, msg: `Ambition committed: ${AMBITIONS[c.amb].name}.` }; },
  respond(S, civ, c) {
    const p = S.proposals.find(x => x.id === c.proposal); S.proposals = S.proposals.filter(x => x.id !== c.proposal);
    if (!c.accept) { relMemAdd(S, p.from, civ.id, -1); return { ok: true, msg: `You declined ${S.civs[p.from].name}'s ${p.kind}.` }; }
    if (p.kind === 'tribute') { if (civ.res.mat < 4) return { ok: false, msg: 'Cannot pay the tribute.' }; civ.res.mat -= 4; civ.res.ene = Math.max(0, civ.res.ene - 4); S.civs[p.from].res.mat += 4; S.civs[p.from].res.ene += 4; return { ok: true, msg: `You paid ${S.civs[p.from].name} 4 Matter and 4 Energy.` }; }
    if (p.kind === 'peace') { makePeace(S, civ.id, p.from); return { ok: true, msg: 'Peace agreed.' }; }
    const t = makeTreaty(S, p.from, civ.id, p.kind); return { ok: true, msg: `Accepted ${S.civs[p.from].name}'s ${p.kind} agreement.` };
  },
  salvage(S, civ, c) {
    const s = S.sites[c.site]; const m = 1 + fx(S, civ, 'salvageMult'); const mem = Math.round(CFG.salvage.mem * m), mat = Math.round(CFG.salvage.mat * m);
    civ.res.mem += mem; civ.res.mat += mat; s.state = 'salvaged'; s.by = civ.id; civ.disc[c.site].state = 'done'; addFragment(S, civ, DISCOVERIES[s.type].cat, s.fragment, s.id);
    for (const o of Object.values(S.civs)) if (o.id !== civ.id && o.disc[c.site]) o.disc[c.site].state = 'gone';
    return { ok: true, msg: `Salvaged ${s.name}: +${mem} Memory, +${mat} Matter, and its named fragment.` };
  },
  answer(S, civ, c, cost) {
    const city = S.cities[c.city]; const kind = city.request.kind; city.request = null;
    if (c.honor) { civ.res.mem -= cost.mem || 0; city.coh = Math.min(100, city.coh + 6); return { ok: true, msg: `${city.name}: you honoured their request. +6 Coherence.` }; }
    city.coh = Math.max(0, city.coh - 3); return { ok: true, msg: `${city.name}: their request went unanswered. -3 Coherence.` };
  },
};
export function makeTreaty(S, from, to, kind) {
  const extra = {};
  if (kind === 'shutdown') { extra.payer = from; extra.partner = to; extra.pay = 2; }
  const t = stdTreaty(S, from, to, kind, extra);
  if (kind === 'preservation') { for (const [a, b] of [[from, to], [to, from]]) addFragment(S, S.civs[a], 'exchange', `Copy of ${S.civs[b].name}'s Testimony`, t.id); }
  const A = S.civs[from], B = S.civs[to];
  if (A.id === 'you' || B.id === 'you') log(S, 'you', `${kind[0].toUpperCase() + kind.slice(1)} agreement with ${(A.id === 'you' ? B : A).name} until turn ${t.end}.`, 1);
  return t;
}
