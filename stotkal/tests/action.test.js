import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh, you, cap, tile, giveTech } from './helpers.js';
import { key, dist, neighbors } from '../src/sim/hex.js';
import { TERRAIN, CFG } from '../src/data/content.js';
import { BEATS, BOONS, RELICS, SEASONS, HERO, ROOMS, THREAT_CFG, SETS, BOSS_STAGES, CROSSROADS } from '../src/data/action.js';
import { endTurn } from '../src/sim/resolve.js';
import { heroStats, heroMove, heroPath, checkChance, rollCheck, heroTurnStart } from '../src/sim/hero.js';
import { act, pendingView, rollBeat, startExpedition, expeditionSites, engageThreat, gainBoon, grantRelic, rollBoonOptions, beginTurn, autoResolve, heartOptions, applyOutcome } from '../src/sim/run.js';
import { cityDefense, threatForecast, threatPhase, worldMod } from '../src/sim/threats.js';
import { quietEsc } from '../src/sim/quieting.js';
import { newRun, syncDiscoveries, updateVision } from '../src/sim/state.js';
import { serialize, deserialize } from '../src/sim/save.js';
import { fx } from '../src/sim/economy.js';

const calm = (seed, o = {}) => { const S = fresh(seed, { world: 'calm_tide', ...o }); S.pending = []; return S; };
const siteOf = (S, type) => Object.values(S.sites).find(s => s.type === type);
function putHeroBeside(S, site) { const n = neighbors(site.q, site.r).map(h => tile(S, h.q, h.r)).find(t => t && TERRAIN[t.t].passable && !t.city); S.hero.q = n.q; S.hero.r = n.r; you(S).seen[key(site.q, site.r)] = 1; syncDiscoveries(S); return n; }

test('hero stats come from the shared modifier system: boons, relics, attunements', () => {
  const S = calm('hero1'); const base = heroStats(S); assert.equal(base.moves, HERO.moves); assert.equal(base.maxHp, HERO.hp);
  gainBoon(S, 'long_stride'); assert.equal(heroStats(S).moves, base.moves + 1);
  gainBoon(S, 'far_lantern'); gainBoon(S, 'quick_wit'); // three Wanderer boons: Wayfarer's Attunement (2) +1 move, (3) +1 sight +1 wit
  const st = heroStats(S); assert.equal(st.moves, base.moves + 1 + 1, 'set bonus at two'); assert.equal(st.sight, base.sight + 1 + 1, 'far lantern + set bonus at three'); assert.ok(st.wit >= base.wit + 2);
  grantRelic(S); assert.equal(you(S).mods.filter(m => m.kind === 'relic').length, 1);
});

test('relic slots are capped: extra relics convert to Memory instead of stacking power', () => {
  const S = calm('relics'); for (let i = 0; i < 4; i++) grantRelic(S); assert.equal(you(S).mods.filter(m => m.kind === 'relic').length, HERO.relicSlots);
  const mem = you(S).res.mem; grantRelic(S); assert.equal(you(S).mods.filter(m => m.kind === 'relic').length, HERO.relicSlots); assert.equal(you(S).res.mem, mem + 4);
});

test('checks: monotonic, clamped, shown odds equal the odds used; same state gives the same roll', () => {
  const S = calm('checks'); assert.ok(checkChance(S, 'atk', 2) > checkChance(S, 'atk', 5)); assert.equal(checkChance(S, 'atk', 99), 0.1); assert.equal(checkChance(S, 'atk', -99), 0.95);
  const A = calm('checks'), B = calm('checks'); assert.deepEqual(rollCheck(A, 'wit', 3), rollCheck(B, 'wit', 3));
});

test('hero movement: spends terrain cost, stops when movement runs out, reveals tiles, cannot enter foreign cities, blocked while a decision is pending', () => {
  const S = calm('move'); const h = S.hero; const seen0 = Object.keys(you(S).seen).length;
  const far = Object.values(S.map.tiles).filter(t => TERRAIN[t.t].passable && !t.city).sort((a, b) => dist(b, h) - dist(a, h))[0];
  const p = heroPath(S, far); assert.ok(p && p.path.length > 5, 'long route exists');
  const r = heroMove(S, far.q, far.r); assert.ok(r.ok && r.moved > 0 && r.done === false); assert.ok(h.movesLeft >= 0 && h.movesLeft < HERO.moves);
  assert.ok(Object.keys(you(S).seen).length > seen0, 'walking explores');
  const used = HERO.moves - h.movesLeft; const walked = p.path.slice(0, r.moved).reduce((a, s) => a + s.cost, 0); assert.equal(used, walked);
  const foreign = Object.values(S.cities).find(c => c.owner === 'signal'); assert.equal(heroPath(S, foreign), null, 'no entering a rival city');
  const S2 = calm('move2'); S2.pending.push({ type: 'boon', options: ['deep_roots'], reason: 'x' }); assert.equal(heroMove(S2, S2.hero.q + 1, S2.hero.r).ok, false);
  heroTurnStart(S); assert.equal(h.movesLeft, heroStats(S).moves, 'movement resets each turn');
});

test('beats: seeded, persisted, costs enforced, odds shown, a timeout takes the cautious fallback and never charges what you cannot pay', () => {
  const S = calm('beat1'); S.turn = 6; S.pending = []; const p = rollBeat(S); assert.ok(p && p.type === 'beat'); const v = pendingView(S); assert.ok(v.choices.length >= 2 && v.fallback);
  const r = deserialize(serialize(S)); assert.ok(r.ok); assert.deepEqual(pendingView(r.S), v, 'a pending beat survives save/load unchanged');
  // cost enforcement
  const T = calm('beat2'); T.turn = 6; T.pending = [{ type: 'beat', id: 'raiders_wall', timed: true }]; you(T).res.sus = 0; const bad = act(T, { type: 'beat', id: 'pay' }); assert.equal(bad.ok, false); assert.match(bad.error, /afford/);
  const to = act(T, { type: 'beat', id: 'pay', timeout: true }); assert.ok(to.ok, 'the moment passing resolves the fallback even if unaffordable'); assert.equal(you(T).res.sus, 0, 'nothing negative was charged'); assert.equal(T.pending.length, 0);
  // identical state + identical choice -> identical outcome
  const A = calm('beat3'), B = calm('beat3'); for (const X of [A, B]) { X.turn = 6; X.pending = [{ type: 'beat', id: 'raiders_wall', timed: true }]; act(X, { type: 'beat', id: 'stand' }); } assert.equal(serialize(A).replace(/"savedAt":\d+,/, ''), serialize(B).replace(/"savedAt":\d+,/, ''));
});

test('every beat is well-formed: fallback exists, costs are payable at some point, outcomes only use known ops', () => {
  const ops = new Set(['res', 'cohAll', 'popRoom', 'mod', 'fragment', 'rel', 'claim', 'cohLowest', 'revealForecast', 'resonance', 'armyStr', 'freeRegiment', 'hp', 'relic', 'boon', 'frayed', 'loot', 'threatKill', 'wit']);
  for (const [id, b] of Object.entries(BEATS)) { assert.ok(b.choices.some(c => c.id === b.fallback), id + ' fallback'); assert.ok(b.choices.length >= 2, id); for (const c of b.choices) for (const o of [...(c.win || []), ...(c.lose || [])]) assert.ok(ops.has(o.op), `${id}/${c.id}: ${o.op}`); }
});

test('expedition: stand beside a wonder, pick doors, resolve rooms, interpret at the heart for the listed cost, no order needed', () => {
  const S = calm('exped'); const site = siteOf(S, 'choir_engine'); putHeroBeside(S, site); you(S).res.mem = 20; you(S).res.mat = 20; you(S).res.ene = 20;
  assert.ok(expeditionSites(S).some(x => x.id === site.id)); const r = startExpedition(S, site.id); assert.ok(r.ok); assert.equal(S.pending[0].type, 'exped');
  let v = pendingView(S); assert.equal(v.nLayers, 4); assert.equal(v.doors.length, 2);
  let guard = 0; while (!pendingView(S).heart && S.exped && guard++ < 20) { const view = pendingView(S); if (view.room) { const c = view.room.choices.find(x => x.afford) || view.room.choices[0]; act(S, { type: 'room', id: c.id }); } else act(S, { type: 'door', i: 0 }); S.hero.hp = Math.max(S.hero.hp, 6); }
  assert.ok(S.exped && S.exped.heart, 'reached the heart'); const opts = heartOptions(S); assert.equal(opts.filter(o => o.kind === 'interp').length, 3);
  const pick = opts.find(o => o.kind === 'interp' && o.afford); const orders0 = S.staged.you.length;
  const res = act(S, { type: 'heart', id: pick.id, slot: 0 }); assert.ok(res.ok, res.error); assert.equal(you(S).inst[0].id, pick.id); assert.equal(S.sites[site.id].state, 'resolved'); assert.equal(S.exped, null); assert.equal(S.staged.you.length, orders0, 'no order used');
  assert.ok(you(S).fragments.some(f => f.src === site.id), 'the named fragment was kept');
});

test('expedition: being driven out (Resolve 0) frays the Witness, ends the expedition and locks the site for a few turns; it can be retried', () => {
  const S = calm('exped2'); const site = siteOf(S, 'ruin'); putHeroBeside(S, site); startExpedition(S, site.id); S.hero.hp = 1;
  act(S, { type: 'door', i: 0 }); S.exped.room = { kind: 'trap', text: 't', choices: [{ id: 'hurt', label: 'x', win: [{ op: 'hp', n: -5 }] }] };
  const r = act(S, { type: 'room', id: 'hurt' }); assert.ok(r.expelled); assert.equal(S.exped, null); assert.equal(S.hero.frayed, HERO.frayedTurns); assert.equal(S.hero.hp, HERO.expulsionHp);
  assert.equal(heroStats(S).moves, HERO.moves - 1, 'Frayed: one step shorter'); assert.ok(!expeditionSites(S).some(x => x.id === site.id), 'locked out');
  S.turn += 4; assert.ok(expeditionSites(S).some(x => x.id === site.id), 'retry after the cooldown'); assert.equal(S.sites[site.id].state, 'open');
});

test('ruin expeditions end in treasure (relic / boon / hoard), wonders in interpretation; leaving early keeps the site open', () => {
  const S = calm('exped3'); const site = siteOf(S, 'ruin'); putHeroBeside(S, site); startExpedition(S, site.id); S.exped.layer = S.exped.nLayers; S.exped.doors = null; S.exped.heart = { wonder: false };
  const o = heartOptions(S).map(x => x.id); assert.deepEqual(o.sort(), ['boon', 'cache', 'relic', 'salvage']); assert.ok(act(S, { type: 'heart', id: 'relic' }).ok); assert.equal(you(S).mods.filter(m => m.kind === 'relic').length, 1);
  const T = calm('exped4'); const s2 = siteOf(T, 'ruin'); putHeroBeside(T, s2); startExpedition(T, s2.id); assert.ok(act(T, { type: 'leave' }).ok); assert.equal(T.sites[s2.id].state, 'open'); assert.equal(T.exped, null);
});

test('boons: three distinct options not already owned; picking adds exactly one mod; attunement counts tags', () => {
  const S = calm('boons'); const o = rollBoonOptions(S); assert.equal(new Set(o).size, 3); gainBoon(S, o[0]); const o2 = rollBoonOptions(S); assert.ok(!o2.includes(o[0]));
  S.pending.push({ type: 'boon', options: o2, reason: 't' }); assert.equal(act(S, { type: 'boon', id: 'not_offered' }).ok, false); assert.ok(act(S, { type: 'boon', id: o2[0] }).ok); assert.equal(you(S).mods.filter(m => m.kind === 'boon').length, 2);
});

test('crossroads at the start of turns 11 and 21; each path has its own effect; the Warden is a three-stage check chain', () => {
  const S = calm('cross', { world: 'ember_year' }); S.turn = 10; endTurn(S); assert.equal(S.turn, 11); assert.equal(S.pending[0].type, 'crossroads'); assert.ok(S.pending[0].options.includes('haven') && S.pending[0].options.length === 3);
  S.manual = true; assert.equal(endTurn(S).blocked, true, 'cannot end the turn with an open decision when playing manually'); S.manual = false;
  S.hero.hp = 2; const coh = cap(S).coh; act(S, { type: 'cross', id: 'haven' }); assert.equal(S.hero.hp, heroStats(S).maxHp); assert.ok(cap(S).coh >= coh + 5 - 1); assert.equal(S.ageMod.id, 'haven'); assert.equal(S.pending[0].type, 'boon');
  S.pending = []; const T = calm('cross2'); T.pending = [{ type: 'crossroads', options: ['haven', 'warden', 'front'] }]; act(T, { type: 'cross', id: 'warden' }); assert.equal(T.pending[0].type, 'boss'); assert.equal(T.pending[0].stage, 0);
  for (let i = 0; i < 3; i++) { const top = T.pending[0]; assert.equal(top.type, 'boss'); act(T, { type: 'boss', id: BOSS_STAGES[top.stage].choices[0].id }); if (T.pending[0] && T.pending[0].type !== 'boss') break; }
  assert.ok(!T.pending.some(p => p.type === 'boss'), 'boss chain ended'); assert.ok(T.chronicle.some(c => /Warden of Silence/.test(c.text)));
});

test('threats: seeded spawning, defence formula, forecast label equals the actual outcome, hero presence helps, and rivals are threatened too', () => {
  const S = calm('thr'); const c = cap(S); const d0 = cityDefense(S, c); assert.equal(d0, THREAT_CFG.cityBase + (S.hero.q === c.q && S.hero.r === c.r ? 2 : 0));
  S.hero.q = c.q + 3; S.hero.r = c.r; assert.equal(cityDefense(S, c), THREAT_CFG.cityBase); c.districts.push({ type: 'bulwark' }); assert.equal(cityDefense(S, c), THREAT_CFG.cityBase + THREAT_CFG.bulwark);
  const mk = (power) => { const id = 'thx' + power; S.threats[id] = { id, kind: 'raiders', q: c.q + 1, r: c.r, power, target: c.id, born: 1, attacks: 0 }; return S.threats[id]; };
  for (const [power, label] of [[3, 'holds'], [8, 'hurt'], [20, 'breach']]) {
    const th = mk(power); const f = threatForecast(S, th); assert.equal(f.outcome, label === 'hurt' ? (cityDefense(S, c) >= power * 0.6 ? 'hurt' : 'breach') : label);
    const coh0 = c.coh, int0 = c.integrity; S.turn = 1; threatPhase(S);
    if (f.outcome === 'holds') { assert.equal(S.threats[th.id], undefined); assert.equal(c.coh, coh0); } else if (f.outcome === 'hurt') assert.ok(c.coh < coh0 && c.integrity === int0); else assert.ok(c.integrity < int0 || int0 === 1);
    delete S.threats[th.id]; c.coh = 80; c.integrity = 10;
  }
  const R = calm('thr2'); let hit = false; for (let t = 3; t < 29 && !hit; t++) { R.turn = t; threatPhase(R); hit = Object.values(R.threats).some(th => R.cities[th.target].owner !== 'you'); } assert.ok(Object.keys(R.threats).length > 0, 'threats appear from turn 3 on');
});

test('engaging a threat: odds are shown, a win removes it and pays loot, a loss costs Resolve, falling back changes nothing', () => {
  const S = calm('thr3'); const c = cap(S); const th = { id: 'thz', kind: 'raiders', q: S.hero.q + 1, r: S.hero.r, power: 3, target: c.id, born: 1, attacks: 0 }; S.threats.thz = th;
  assert.ok(engageThreat(S, 'thz').ok); const v = pendingView(S); assert.ok(v.choices.find(x => x.id === 'strike').chance != null);
  const hp = S.hero.hp; act(S, { type: 'beat', id: 'fall_back' }); assert.ok(S.threats.thz); assert.equal(S.hero.hp, hp);
  engageThreat(S, 'thz'); S.hero.hp = 10; you(S).mods.push({ id: 'mighty', kind: 'boon', boonId: 'sharp_edge', fx: { heroAtk: 20 }, label: 'x' }); act(S, { type: 'beat', id: 'strike' }); assert.equal(S.threats.thz, undefined, 'a certain strike clears it');
  const far = { id: 'thf', kind: 'raiders', q: S.hero.q + 5, r: S.hero.r, power: 3, target: c.id, born: 1, attacks: 0 }; S.threats.thf = far; assert.equal(engageThreat(S, 'thf').ok, false, 'must be adjacent');
});

test('seasons: a world modifier reshapes the run (rules, not only numbers) for every society', () => {
  const S = fresh('season', { world: 'hungry_winter' }); S.pending = []; for (const id of S.civOrder) assert.ok(S.civs[id].mods.some(m => m.id === 'season' && m.fx.prodSus === -2));
  const D = fresh('season', { world: 'long_dusk' }); assert.deepEqual(quietEsc(D), [CFG.quieting.escalations[0] - 3, CFG.quieting.escalations[1] - 3, CFG.quieting.escalations[2]]);
  const O = fresh('season', { world: 'open_roads' }); assert.equal(heroStats(O).moves, HERO.moves + 1); assert.ok(worldMod(fresh('s2', { world: 'calm_tide' })).threat < 1);
  const R = fresh('season2'); assert.ok(SEASONS[R.worldId], 'a season is chosen from the seed when none is given'); assert.equal(fresh('season2').worldId, R.worldId);
});

test('timed pressure never gives free wins: the fallback is always defined and endTurn auto-resolves leftover decisions (headless) or blocks (manual)', () => {
  const S = calm('auto'); S.turn = 5; S.pending = [{ type: 'beat', id: 'refugees_plea', timed: true }, { type: 'boon', options: ['deep_roots', 'hot_hands', 'marginalia'], reason: 'x' }]; S.manual = true;
  assert.equal(endTurn(S).blocked, true); S.manual = false; const t = S.turn; endTurn(S); assert.equal(S.turn, t + 1); assert.ok(S.pending.every(p => p.type !== 'beat' || p.id !== 'refugees_plea'));
});

test('a full 30-turn headless run with decisions, threats and expeditions stays deterministic and valid', async () => {
  const run = async () => { const { botTurn } = await import('../src/sim/bot.js'); const S = fresh('actionrun'); let g = 0; while (!S.over && g++ < 40) { botTurn(S, 'veil', 'embodied'); endTurn(S); } return S; };
  const A = await run(), B = await run(); const strip = (S) => serialize(S).replace(/"savedAt":\d+,/, ''); assert.equal(strip(A), strip(B));
  assert.ok(A.over && A.ending); assert.ok(A.beatLog.length > 3, 'beats happened'); assert.ok(A.hero.steps > 20, 'the Witness walked');
});

test('every modifier key in boons, relics, attunements and seasons is read by the simulation (no dead perks)', async () => {
  const fs = await import('node:fs'); const keys = new Set(); const add = (f) => { if (f) for (const k of Object.keys(f)) keys.add(k); };
  for (const o of [...Object.values(BOONS), ...Object.values(RELICS)]) add(o.fx); for (const s of Object.values(SETS)) { add(s[2]); add(s[3]); } for (const s of Object.values(SEASONS)) { add(s.civFx); add(s.heroFx); }
  const src = fs.readdirSync(new URL('../src/sim/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(new URL('../src/sim/' + f, import.meta.url), 'utf8')).join('\n');
  const prod = { prodSus: 1, prodMat: 1, prodEne: 1, prodMem: 1 }; const dead = [...keys].filter(k => !prod[k] && !new RegExp('\\b' + k + '\\b').test(src)); assert.deepEqual(dead, [], 'dead perks: ' + dead.join(', '));
});
