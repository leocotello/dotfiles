// The run layer: pending decisions (timed beats, expeditions, boons, crossroads, boss), outcomes, relics and per-turn beginnings.
// Everything here is deterministic given the state's RNG; timers are a presentation concern (the sim only knows the fallback choice).
import { BEATS, ROOMS, ROOM_KINDS, ROOM_WEIGHTS, THEMES, LOOT, BOONS, RELICS, SEASONS, CROSSROADS, BOSS_STAGES, HERO, AGE_BOUNDARIES, THREAT_CFG, THREAT_KINDS } from '../data/action.js';
import { DISCOVERIES, INSTITUTIONS, CFG } from '../data/content.js';
import { key, dist } from './hex.js';
import { rnd, rint, weightedPick } from './rng.js';
import { RES, civCities, fx, canPay, hasInst, tileAt } from './economy.js';
import { log, syncDiscoveries } from './state.js';
import { applyFx, addFragment } from './council.js';
import { instCost } from './commands.js';
import { installInstitution, applyCmd } from './apply.js';
import { heroStats, refreshHero, rollCheck, checkChance, heroTurnStart, heroAdjacentSite } from './hero.js';
import { worldMod, killThreat, threatList } from './threats.js';

const civ = (S) => S.civs.you;
export const pendingTop = (S) => S.pending[0] || null;
const push = (S, p) => { S.pending.push(p); return p; };

// ---------------- outcomes ----------------
export function damageHero(S, n, ctx) {
  const h = S.hero; h.hp -= n;
  if (h.hp <= 0) { h.hp = HERO.expulsionHp; h.frayed = HERO.frayedTurns; if (ctx) ctx.expelled = true; log(S, 'you', 'The Witness is driven back, Frayed: she moves a step shorter for two turns.', 2); S.chronicle.push({ turn: S.turn, text: 'The Witness was driven out of a place she was not ready for.', tag: 'sacrifice' }); }
}
export function lootRoll(S, tier, ctx) {
  const bonus = fx(S, civ(S), 'lootBonus') + (worldMod(S).lootBonus || 0); const t = Math.min(2, tier + (bonus > 0 ? 1 : 0)); const base = LOOT[t]; const keys = RES.slice().sort(() => 0); const picks = [];
  const pool = [...RES]; for (let i = 0; i < 2; i++) { const k = pool.splice(rint(S, pool.length), 1)[0]; picks.push(k); }
  const got = {}; for (const k of picks) { civ(S).res[k] += base[k]; got[k] = base[k]; }
  if (rnd(S) < 0.05 * worldMod(S).relicMult * (tier + 1)) grantRelic(S, ctx);
  return got;
}
export function grantRelic(S, ctx) {
  const c = civ(S); const owned = new Set(c.mods.filter(m => m.kind === 'relic').map(m => m.relicId));
  const cand = Object.keys(RELICS).filter(id => !owned.has(id));
  if (owned.size >= HERO.relicSlots || !cand.length) { c.res.mem += 4; log(S, 'you', 'Your hands are full of relics; the new one was traded for 4 Memory.', 1); return null; }
  const id = cand[rint(S, cand.length)]; const R = RELICS[id];
  c.mods.push({ id: 'relic_' + id, relicId: id, kind: 'relic', label: R.name, fx: R.fx }); refreshHero(S);
  log(S, 'you', `Relic found: ${R.name}. ${R.desc} Catch: ${R.catch}`, 2); S.chronicle.push({ turn: S.turn, text: `Found the relic ${R.name}.`, tag: 'relic' });
  if (ctx) (ctx.gained = ctx.gained || []).push('relic:' + id); return id;
}
export function rollBoonOptions(S, n = 3) {
  const c = civ(S); const owned = new Set(c.mods.filter(m => m.kind === 'boon').map(m => m.boonId)); const tagN = {}; for (const id of owned) tagN[BOONS[id].tag] = (tagN[BOONS[id].tag] || 0) + 1;
  const pool = Object.keys(BOONS).filter(id => !owned.has(id)); const out = [];
  for (let i = 0; i < n && pool.length; i++) { const pick = weightedPick(S, pool, id => 1 + (tagN[BOONS[id].tag] || 0) * 0.6); out.push(pick); pool.splice(pool.indexOf(pick), 1); }
  return out;
}
export function gainBoon(S, id) {
  const B = BOONS[id]; civ(S).mods.push({ id: 'boon_' + id, boonId: id, kind: 'boon', label: B.name, fx: B.fx }); refreshHero(S);
  log(S, 'you', `Boon chosen: ${B.name}. ${B.desc}`, 2); S.chronicle.push({ turn: S.turn, text: `Took the boon ${B.name}.`, tag: 'boon' });
}
export function applyOutcome(S, list, ctx = {}) {
  const c = civ(S);
  applyFx(S, c, list, { title: ctx.title || 'Outcome', id: ctx.id }, (f) => {
    switch (f.op) {
      case 'hp': if (f.n < 0) damageHero(S, -f.n, ctx); else S.hero.hp = Math.min(heroStats(S).maxHp, S.hero.hp + f.n); return true;
      case 'relic': for (let i = 0; i < (f.n || 1); i++) grantRelic(S, ctx); return true;
      case 'boon': for (let i = 0; i < (f.n || 1); i++) push(S, { type: 'boon', options: rollBoonOptions(S), reason: ctx.title || 'A gift' }); return true;
      case 'frayed': S.hero.frayed = Math.max(S.hero.frayed, f.n || HERO.frayedTurns); return true;
      case 'loot': { const got = lootRoll(S, f.tier || 1, ctx); ctx.loot = got; return true; }
      case 'threatKill': if (ctx.threatId) killThreat(S, ctx.threatId); return true;
      case 'wit': { const n = c.mods.filter(m => m.kind === 'gain').length; if (n < 3) { c.mods.push({ id: 'wit_' + (n + 1), kind: 'gain', label: 'Hard-won Wit', fx: { heroWit: 1 } }); refreshHero(S); } return true; }
    }
    return false;
  });
}

// ---------------- generic choice resolution (beats, rooms, boss stages) ----------------
export function choiceView(S, ch, adj = 0) {
  const have = { ...civ(S).res }; const afford = !ch.cost || canPay(have, ch.cost); const chance = ch.check ? checkChance(S, ch.check.stat, ch.check.diff + adj) : null;
  return { id: ch.id, label: ch.label, hint: ch.hint || '', chance, stat: ch.check && ch.check.stat, diff: ch.check ? ch.check.diff + adj : null, cost: ch.cost || null, afford };
}
function resolveChoice(S, ch, ctx, adj = 0, ignoreCost = false) {
  const c = civ(S); let text = '';
  if (ch.cost && !ignoreCost) { for (const k of RES) c.res[k] -= ch.cost[k] || 0; }
  let outcome = ch.win || [];
  if (ch.check) { const r = rollCheck(S, ch.check.stat, ch.check.diff + adj); ctx.roll = r; outcome = r.ok ? (ch.win || []) : (ch.lose || []); text = `${ch.label}: ${r.ok ? 'success' : 'failure'} (${Math.round(r.chance * 100)}% chance, rolled ${r.roll}).`; ctx.success = r.ok; }
  else { text = `${ch.label}.`; ctx.success = true; }
  applyOutcome(S, outcome, ctx); return text;
}

// ---------------- beats ----------------
const beatOk = (S, cond = {}) => {
  if (cond.minTurn && S.turn < cond.minTurn) return false; if (cond.maxTurn && S.turn > cond.maxTurn) return false;
  if (cond.cities && !civCities(S, 'you').length) return false;
  if (cond.contact && !S.civOrder.some(o => o !== 'you' && civCities(S, o).some(ct => civ(S).seen[key(ct.q, ct.r)]))) return false; return true;
};
export function rollBeat(S) {
  const recent = S.beatHistory.slice(-3);
  const pool = Object.keys(BEATS).filter(id => beatOk(S, BEATS[id].cond) && !recent.includes(id));
  const pick = weightedPick(S, pool, id => BEATS[id].weight); if (!pick) return null;
  S.beatHistory.push(pick); return push(S, { type: 'beat', id: pick, timed: true });
}
export function beatDef(S, p) {
  if (p.id === 'skirmish') return skirmishDef(S, p);
  return BEATS[p.id];
}
function skirmishDef(S, p) {
  const th = S.threats[p.threatId] || { kind: 'raiders', power: p.power || 3 }; const K = THREAT_KINDS[th.kind]; const pw = th.power;
  return { kind: 'threat', title: `${K.name} (power ${pw})`, text: p.text || `${K.blurb} They have seen you.`, fallback: 'fall_back',
    choices: [
      { id: 'strike', label: 'Strike', check: { stat: 'atk', diff: pw }, win: [{ op: 'threatKill' }, { op: 'loot', tier: pw >= 6 ? 2 : 1 }], lose: [{ op: 'hp', n: -Math.ceil(pw / 2) }], hint: `Mettle vs ${pw}` },
      { id: 'lure', label: 'Lure it away', check: { stat: 'moves', diff: pw }, win: [{ op: 'threatKill' }], lose: [{ op: 'hp', n: -1 }], hint: `Stride vs ${pw}` },
      { id: 'parley', label: th.kind === 'echo' ? 'Listen to it' : 'Parley', check: { stat: 'wit', diff: pw + 1 }, win: [{ op: 'threatKill' }, { op: 'fragment', cat: th.kind === 'echo' ? 'echo' : 'foreign', name: th.kind === 'echo' ? 'What the Echo Was Saying' : 'A Raider\'s Bargain' }], lose: [{ op: 'hp', n: -2 }], hint: `Wit vs ${pw + 1}` },
      { id: 'fall_back', label: 'Fall back', win: [], hint: 'It remains' },
    ] };
}
export function engageThreat(S, id) {
  if (S.pending.length) return { ok: false, error: 'Resolve the pending decision first.' };
  const th = S.threats[id]; if (!th || dist(S.hero, th) > 1) return { ok: false, error: 'Move next to it first.' };
  push(S, { type: 'beat', id: 'skirmish', threatId: id, timed: false }); return { ok: true };
}

// ---------------- expeditions ----------------
export function expeditionSites(S) {
  return heroAdjacentSite(S).filter(s => { const D = DISCOVERIES[s.type]; if (!D) return false; return s.state === 'open' && (!D.anomaly) && s.type !== 'meridian_spire' && (D.expedition || D.interps.length || s.type === 'legacy_ruin') && !(s.cd && s.cd > S.turn); });
}
export function startExpedition(S, siteId) {
  if (S.pending.length) return { ok: false, error: 'Resolve the pending decision first.' };
  const s = expeditionSites(S).find(x => x.id === siteId); if (!s) return { ok: false, error: 'Stand next to an unexplored ruin or wonder.' };
  const wonder = !!DISCOVERIES[s.type].interps.length; const theme = THEMES[s.type] ? s.type : 'ruin';
  S.exped = { site: s.id, theme, nLayers: wonder ? 4 : 3, layer: 0, doors: null, room: null, log: [], loot: [], hpLost: 0, wonder };
  rollDoors(S); push(S, { type: 'exped' }); log(S, 'you', `The Witness enters ${s.name}.`, 2); return { ok: true };
}
function rollDoors(S) {
  const E = S.exped; const w = ROOM_WEIGHTS[Math.min(E.layer, ROOM_WEIGHTS.length - 1)]; const kinds = Object.keys(w);
  const a = weightedPick(S, kinds, k => w[k]); const rest = kinds.filter(k => k !== a); const b = weightedPick(S, rest, k => w[k]); E.doors = [a, b]; E.room = null;
}
export function expedView(S) {
  const E = S.exped; if (!E) return null; const s = S.sites[E.site]; const th = THEMES[E.theme];
  const out = { site: s, theme: th.name, layer: E.layer, nLayers: E.nLayers, log: E.log, doors: E.doors && E.doors.map(k => ({ kind: k, ...ROOM_KINDS[k] })), room: null, heart: E.heart || null, wonder: E.wonder };
  if (E.room) out.room = { kind: E.room.kind, ...ROOM_KINDS[E.room.kind], text: E.room.text, choices: E.room.choices.map(ch => choiceView(S, ch, E.layer)) };
  return out;
}
function enterRoom(S, i) {
  const E = S.exped; const kind = E.doors[i]; const R = ROOMS[kind]; E.room = { kind, text: R.text(THEMES[E.theme]), choices: R.choices.map(c => ({ ...c })) };
}
function nextLayer(S) {
  const E = S.exped; E.layer++; E.room = null;
  if (E.layer >= E.nLayers) { E.doors = null; E.heart = { wonder: E.wonder }; } else rollDoors(S);
}
function finishExpedition(S, how) {
  const E = S.exped; const s = S.sites[E.site]; S.exped = null; if (pendingTop(S) && pendingTop(S).type === 'exped') S.pending.shift();
  if (how === 'expelled') { s.cd = S.turn + 3; } syncDiscoveries(S);
}
// the heart: interpret a wonder, or claim a ruin's treasure
export function heartOptions(S) {
  const E = S.exped; if (!E || !E.heart) return null; const s = S.sites[E.site]; const D = DISCOVERIES[s.type]; const c = civ(S); const out = [];
  if (D.interps.length) for (const id of D.interps) { const I = INSTITUTIONS[id]; const cost = instCost(S, c, id); out.push({ id, kind: 'interp', name: I.name, style: I.style, gain: I.gain, risk: I.risk, tags: I.tags, cost, afford: canPay(c.res, cost) }); }
  else { out.push({ id: 'relic', kind: 'ruin', name: 'A Relic', gain: 'Carry something out of the dark, with a catch.', risk: '' }, { id: 'boon', kind: 'ruin', name: 'A Boon', gain: 'Choose one of three perks.', risk: '' }, { id: 'cache', kind: 'ruin', name: 'The Hoard', gain: 'A rich store of goods and the ruin\'s fragment.', risk: '' }); }
  out.push({ id: 'salvage', kind: 'salvage', name: 'Take only what is easy', gain: 'A modest reward and the named fragment.', risk: '' });
  return out;
}
function claimFragment(S, s) { if (s.fragment) addFragment(S, civ(S), DISCOVERIES[s.type].cat, s.fragment, s.id); }

// ---------------- crossroads / boss ----------------
function boonPicksAtCrossroads(S) { return Math.max(0, 1 + worldMod(S).boonDelta); }
function openCrossroads(S) {
  const keys = Object.keys(CROSSROADS).filter(k => k !== 'haven'); const picks = []; const pool = keys.slice(); for (let i = 0; i < 2; i++) picks.push(pool.splice(rint(S, pool.length), 1)[0]);
  push(S, { type: 'crossroads', options: ['haven', ...picks] });
}
function pickCrossroads(S, id) {
  const P = CROSSROADS[id]; const c = civ(S); S.ageMod = { id, threat: P.threat }; S.chronicle.push({ turn: S.turn, text: `Took ${P.name}.`, tag: 'crossroads' });
  log(S, 'you', `You take ${P.name}. ${P.gain}`, 2);
  if (id === 'haven') { S.hero.hp = heroStats(S).maxHp; for (const ct of civCities(S, 'you')) ct.coh = Math.min(100, ct.coh + 5); }
  if (id === 'front') { applyOutcome(S, [{ op: 'relic', n: 1 }, { op: 'res', mat: 6 }], { title: P.name }); }
  if (id === 'mystery') { if (rnd(S) < 0.5) applyOutcome(S, [{ op: 'relic', n: 1 }, { op: 'boon', n: 1 }], { title: P.name }); else { applyOutcome(S, [{ op: 'hp', n: -3 }, { op: 'relic', n: 1 }], { title: P.name }); log(S, 'you', 'The unmarked road was unkind. You carry something home anyway.', 2); } }
  if (id === 'warden') { push(S, { type: 'boss', stage: 0, wins: 0 }); }
  for (let i = 0; i < boonPicksAtCrossroads(S); i++) push(S, { type: 'boon', options: rollBoonOptions(S), reason: P.name });
}

// ---------------- the player-facing action dispatcher ----------------
export function act(S, a) {
  const p = pendingTop(S); if (!p) return { ok: false, error: 'Nothing to decide.' }; const c = civ(S);
  if (p.type === 'beat' && a.type === 'beat') {
    const def = beatDef(S, p); const ch = def.choices.find(x => x.id === a.id); if (!ch) return { ok: false, error: 'No such choice.' };
    const fb = a.timeout; if (ch.cost && !canPay(c.res, ch.cost) && !fb) return { ok: false, error: 'You cannot afford that.' };
    const ctx = { title: def.title, id: p.id, threatId: p.threatId }; const text = resolveChoice(S, ch, ctx, 0, fb && ch.cost && !canPay(c.res, ch.cost));
    S.pending.shift(); log(S, 'you', `${def.title}: ${text}${a.timeout ? ' (the moment passed)' : ''}`, 2); S.beatLog.push({ turn: S.turn, id: p.id, choice: ch.id, ok: ctx.success }); return { ok: true, text, ctx };
  }
  if (p.type === 'exped') {
    const E = S.exped;
    if (a.type === 'door' && E.doors && !E.room) { if (!(a.i === 0 || a.i === 1)) return { ok: false, error: 'Choose a door.' }; enterRoom(S, a.i); return { ok: true }; }
    if (a.type === 'room' && E.room) {
      const ch = E.room.choices.find(x => x.id === a.id); if (!ch) return { ok: false, error: 'No such choice.' }; if (ch.cost && !canPay(c.res, ch.cost)) return { ok: false, error: 'You cannot afford that.' };
      const ctx = { title: THEMES[E.theme].name, id: 'room' }; const text = resolveChoice(S, ch, ctx, E.layer); E.log.push(text);
      if (ctx.expelled) { log(S, 'you', `${THEMES[E.theme].name}: the Witness was forced out.`, 2); finishExpedition(S, 'expelled'); return { ok: true, text, expelled: true }; }
      nextLayer(S); return { ok: true, text };
    }
    if (a.type === 'leave' && !E.heart) { log(S, 'you', `The Witness leaves ${S.sites[E.site].name} for now.`, 1); finishExpedition(S, 'left'); return { ok: true }; }
    if (a.type === 'heart' && E.heart) {
      const opts = heartOptions(S); const o = opts.find(x => x.id === a.id); if (!o) return { ok: false, error: 'No such choice.' }; const s = S.sites[E.site];
      if (o.kind === 'interp') {
        if (!o.afford) return { ok: false, error: 'You cannot afford that yet.' }; const slot = a.slot; if (!(slot >= 0 && slot < 3)) return { ok: false, error: 'Choose an institution slot.' };
        for (const k of RES) c.res[k] -= o.cost[k] || 0; s.state = 'resolved'; s.by = 'you'; s.interp = o.id; if (c.disc[s.id]) c.disc[s.id].state = 'done'; for (const x of Object.values(S.civs)) if (x.id !== 'you' && x.disc[s.id]) x.disc[s.id].state = 'gone';
        claimFragment(S, s); installInstitution(S, c, o.id, slot, s.id); log(S, 'you', `${s.name}: interpreted as ${o.name}.`, 2);
      } else if (o.id === 'salvage') { c.res.mem += 3; c.res.mat += 4; s.state = 'salvaged'; s.by = 'you'; if (c.disc[s.id]) c.disc[s.id].state = 'done'; claimFragment(S, s); log(S, 'you', `${s.name}: salvaged.`, 1); }
      else { s.state = 'resolved'; s.by = 'you'; s.interp = 'looted'; if (c.disc[s.id]) c.disc[s.id].state = 'done'; claimFragment(S, s); if (o.id === 'relic') grantRelic(S); else if (o.id === 'boon') push(S, { type: 'boon', options: rollBoonOptions(S), reason: s.name }); else applyOutcome(S, [{ op: 'loot', tier: 2 }, { op: 'res', mem: 2 }], { title: s.name }); log(S, 'you', `${s.name}: the ruin gave up its treasure.`, 2); }
      finishExpedition(S, 'done'); return { ok: true };
    }
    return { ok: false, error: 'Not available now.' };
  }
  if (p.type === 'boon' && a.type === 'boon') { if (!p.options.includes(a.id)) return { ok: false, error: 'Not offered.' }; gainBoon(S, a.id); S.pending.shift(); return { ok: true }; }
  if (p.type === 'crossroads' && a.type === 'cross') { if (!p.options.includes(a.id)) return { ok: false, error: 'Not offered.' }; S.pending.shift(); pickCrossroads(S, a.id); return { ok: true }; }
  if (p.type === 'boss' && a.type === 'boss') {
    const st = BOSS_STAGES[p.stage]; const ch = st.choices.find(x => x.id === a.id); if (!ch) return { ok: false, error: 'No such choice.' };
    const r = rollCheck(S, ch.check.stat, ch.check.diff); log(S, 'you', `${st.title}: ${ch.label}: ${r.ok ? 'success' : 'failure'} (${Math.round(r.chance * 100)}%).`, 2);
    if (!r.ok) damageHero(S, 2, {}); S.pending.shift(); const wins = p.wins + (r.ok ? 1 : 0);
    if (p.stage + 1 < BOSS_STAGES.length) { S.pending.unshift({ type: 'boss', stage: p.stage + 1, wins }); return { ok: true, ok2: r.ok }; }
    if (wins >= 2) { log(S, 'you', 'The Warden of Silence yields. The door stays open behind you.', 2); S.chronicle.push({ turn: S.turn, text: 'The Warden of Silence was answered.', tag: 'boss' }); applyOutcome(S, [{ op: 'relic', n: 1 }, { op: 'boon', n: 1 }, { op: 'res', mat: 8 }], { title: 'The Warden of Silence' }); }
    else { log(S, 'you', 'The Warden did not yield. You come away Frayed.', 2); S.hero.frayed = HERO.frayedTurns; for (const ct of civCities(S, 'you')) ct.coh = Math.max(0, ct.coh - 6); S.chronicle.push({ turn: S.turn, text: 'The Warden of Silence turned you back.', tag: 'sacrifice' }); }
    return { ok: true, final: true, wins };
  }
  return { ok: false, error: 'Wrong decision type.' };
}
export function pendingView(S) {
  const p = pendingTop(S); if (!p) return null;
  if (p.type === 'beat') { const d = beatDef(S, p); return { type: 'beat', id: p.id, timed: p.timed, kind: d.kind, title: d.title, text: d.text, fallback: d.fallback, choices: d.choices.map(ch => choiceView(S, ch)) }; }
  if (p.type === 'exped') return { type: 'exped', ...expedView(S), heartOptions: heartOptions(S) };
  if (p.type === 'boon') return { type: 'boon', reason: p.reason, options: p.options.map(id => ({ id, ...BOONS[id] })) };
  if (p.type === 'crossroads') return { type: 'crossroads', options: p.options.map(id => ({ id, ...CROSSROADS[id] })) };
  if (p.type === 'boss') return { type: 'boss', stage: p.stage, wins: p.wins, ...BOSS_STAGES[p.stage], choices: BOSS_STAGES[p.stage].choices.map(ch => choiceView(S, ch)), total: BOSS_STAGES.length };
  return null;
}

// What happens if the timer runs out (or the pending decision is simply ended): always the cautious default, never a free win.
export function autoResolve(S) {
  let guard = 0;
  while (S.pending.length && guard++ < 40) {
    const p = pendingTop(S);
    if (p.type === 'beat') { const d = beatDef(S, p); act(S, { type: 'beat', id: d.fallback, timeout: true }); }
    else if (p.type === 'exped') { if (S.exped.heart) act(S, { type: 'heart', id: 'salvage' }); else act(S, { type: 'leave' }); }
    else if (p.type === 'boon') act(S, { type: 'boon', id: p.options[0] });
    else if (p.type === 'crossroads') act(S, { type: 'cross', id: 'haven' });
    else if (p.type === 'boss') act(S, { type: 'boss', id: BOSS_STAGES[p.stage].choices[0].id });
    else S.pending.shift();
  }
}

// ---------------- beginning of each turn ----------------
export function beginTurn(S) {
  heroTurnStart(S);
  if (AGE_BOUNDARIES.includes(S.turn)) { openCrossroads(S); return; }
  const wm = worldMod(S); if (S.turn >= THREAT_CFG.beatMinTurn && rnd(S) < THREAT_CFG.beatChance * wm.beatRate) rollBeat(S);
}
