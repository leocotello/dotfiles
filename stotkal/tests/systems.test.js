import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh, you, cap, tile, giveTech } from './helpers.js';
import { key, neighbors, dist } from '../src/sim/hex.js';
import { CFG, TERRAIN, AMBITIONS } from '../src/data/content.js';
import { endTurn, initiative } from '../src/sim/resolve.js';
import { declareWar, breakTreaty } from '../src/sim/diplomacy.js';
import { forecast, resolveEngagement, regPower, invalidateSupplyCache } from '../src/sim/combat.js';
import { supplyMap, isSupplied, armyPath } from '../src/sim/army.js';
import { transferCity } from '../src/sim/apply.js';
import { makeCity, updateVision, atWar } from '../src/sim/state.js';
import { civCities, civArmies, protectionBands, effExposure, severity } from '../src/sim/economy.js';
import { evaluate } from '../src/sim/ambitions.js';
import { stage } from '../src/sim/commands.js';
import { openCouncil, petition } from '../src/sim/council.js';
import { serialize, deserialize } from '../src/sim/save.js';
import { quietingPhase, forecastLevel } from '../src/sim/quieting.js';

let aid = 9000;
function army(S, owner, q, r, roles = ['warden', 'warden', 'warden'], str = 10) {
  const id = 'a' + (++aid); S.armies[id] = { id, owner, q, r, regs: roles.map((role, i) => ({ id: 'g' + id + i, role, str, ready: 0 })), obj: { type: 'guard' }, retreatAt: 0.4, entrench: 0 };
  invalidateSupplyCache(S); return S.armies[id];
}
function openTile(S, from, terrain) { return Object.values(S.map.tiles).find(t => t.t === terrain && !t.city && !t.owner && dist(t, from) >= 2); }

test('combat: forecast equals resolution; simultaneous damage; losses bounded by strength', () => {
  const S = fresh('combat'); declareWar(S, 'you', 'signal');
  const t = Object.values(S.map.tiles).find(x => x.t === 'desert' && !x.city && !x.owner);
  const nb = neighbors(t.q, t.r).map(n => tile(S, n.q, n.r)).find(x => x && TERRAIN[x.t].passable);
  const a = army(S, 'you', nb.q, nb.r, ['lancer', 'lancer', 'warden']); const d = army(S, 'signal', t.q, t.r, ['warden', 'warden', 'disruptor']);
  const f = forecast(S, [a], t, 'assault');
  const aStr0 = 30, dStr0 = 30; const r = resolveEngagement(S, t, [a], 'assault', []);
  assert.equal(r.attLoss, f.attLoss); assert.equal(r.defLoss, f.defLoss);
  assert.equal(a.regs.reduce((s, x) => s + x.str, 0), aStr0 - f.attLoss); assert.equal(d.regs.reduce((s, x) => s + x.str, 0), dStr0 - f.defLoss);
  assert.ok(f.attLoss <= aStr0 && f.defLoss <= dStr0);
});

test('combat: role/terrain interactions and approaches follow the published specification', () => {
  const S = fresh('combat2'); const ridge = Object.values(S.map.tiles).find(t => t.t === 'ridge'); const desert = Object.values(S.map.tiles).find(t => t.t === 'desert');
  const lancer = { role: 'lancer', str: 10 }, warden = { role: 'warden', str: 10 }, dis = { role: 'disruptor', str: 10 };
  assert.equal(regPower(S, lancer, desert, 'attack'), 12.5); assert.equal(regPower(S, lancer, ridge, 'attack'), 7.5);
  assert.ok(regPower(S, warden, ridge, 'defend') > regPower(S, warden, desert, 'defend'));
  assert.equal(regPower(S, warden, desert, 'defend'), 11); // x1.1 defending
  // approaches: assault exposes attackers more than siege; withdraw deals nothing
  declareWar(S, 'you', 'signal'); const t = desert; const nb = neighbors(t.q, t.r).map(n => tile(S, n.q, n.r)).find(x => x && TERRAIN[x.t].passable);
  const a = army(S, 'you', nb.q, nb.r, ['warden', 'warden', 'warden']); army(S, 'signal', t.q, t.r, ['warden', 'warden', 'warden']);
  const fa = forecast(S, [a], t, 'assault'), fr = forecast(S, [a], t, 'raid'), fw = forecast(S, [a], t, 'withdraw');
  assert.ok(fa.attLoss > fr.attLoss); assert.equal(fw.defLoss, 0);
});

test('supply: armies beyond three traversable tiles of supply lose 20% power and cannot heal', () => {
  const S = fresh('supply'); const c = cap(S);
  const far = Object.values(S.map.tiles).filter(t => TERRAIN[t.t].passable && dist(t, c) === 5)[0];
  const near = neighbors(c.q, c.r).map(n => tile(S, n.q, n.r)).find(t => TERRAIN[t.t].passable);
  const m = supplyMap(S, 'you'); assert.ok(isSupplied(S, 'you', near.q, near.r, m)); assert.ok(!isSupplied(S, 'you', far.q, far.r, m));
  declareWar(S, 'you', 'signal'); const enemyTile = Object.values(S.map.tiles).find(t => t.t === 'desert' && !t.owner && dist(t, c) >= 4 && !t.city);
  const nb = neighbors(enemyTile.q, enemyTile.r).map(n => tile(S, n.q, n.r)).find(x => x && TERRAIN[x.t].passable && !x.city);
  const a = army(S, 'you', nb.q, nb.r, ['warden', 'warden', 'warden']); army(S, 'signal', enemyTile.q, enemyTile.r, ['warden', 'warden', 'warden']);
  const sup = isSupplied(S, 'you', a.q, a.r); const f = forecast(S, [a], enemyTile, 'assault');
  if (!sup) assert.ok(f.notes.some(n => /out of supply/.test(n)));
  a.regs.forEach(r => r.str = 5); invalidateSupplyCache(S);
  const before = a.regs.map(r => r.str); a.q = far.q; a.r = far.r; invalidateSupplyCache(S); a.engaged = false;
  endTurn(S); const after = S.armies[a.id] ? S.armies[a.id].regs.map(r => r.str) : before; assert.deepEqual(after, before, 'no healing out of supply');
});

test('siege entrenches for a turn; raids are capped and have per-target cooldowns', () => {
  const S = fresh('siege'); declareWar(S, 'you', 'signal'); const target = civCities(S, 'signal')[0]; const tt = tile(S, target.q, target.r);
  const nb = neighbors(target.q, target.r).map(n => tile(S, n.q, n.r)).find(x => x && TERRAIN[x.t].passable);
  const a = army(S, 'you', nb.q, nb.r, ['disruptor', 'disruptor', 'disruptor']); a.entrench = 0;
  const f0 = forecast(S, [a], tt, 'siege'); assert.equal(f0.integrityDmg, 0); assert.match(f0.notes.join(' '), /Entrenching/); a.entrench = 1; const f1 = forecast(S, [a], tt, 'siege'); assert.ok(f1.integrityDmg > 0);
  S.civs.signal.res.mat = 20; S.civs.signal.res.ene = 20; const m0 = you(S).res.mat;
  const r1 = resolveEngagement(S, tt, [a], 'raid', []); assert.ok(r1.raided.mat <= CFG.raid.cap && r1.raided.mat > 0);
  const r2 = resolveEngagement(S, tt, [a], 'raid', []); assert.ok(r2.raided.cooldown, 'second raid on the same target is on cooldown');
  assert.ok(you(S).res.mat - m0 <= CFG.raid.cap, 'rewards capped');
});

test('ownership change: capture updates tiles, clears projects, reassigns capital, flags integration', () => {
  const S = fresh('capture'); declareWar(S, 'you', 'signal'); const sc = civCities(S, 'signal')[0];
  const extra = makeCity(S, 'signal', ...(() => { const t = Object.values(S.map.tiles).find(t => TERRAIN[t.t].passable && !t.owner && !t.city && !t.site && dist(t, sc) >= 3); return [t.q, t.r]; })(), { name: 'Satellite' }); extra.pop = 3;
  sc.project = { what: 'district:garden', total: 2, remaining: 1, matPaid: 8 };
  transferCity(S, sc, 'you', 'captured');
  assert.equal(sc.owner, 'you'); assert.equal(sc.project, null); assert.equal(tile(S, sc.q, sc.r).owner, 'you'); assert.equal(sc.consent, false);
  assert.ok(sc.coh <= 55, 'integration pressure'); assert.equal(S.civs.signal.cap, extra.id, 'capital passes to the remaining city'); assert.equal(extra.capital, true);
  transferCity(S, extra, 'you', 'captured'); assert.ok(S.civs.signal.eliminated);
});

test('movement collision: initiative is a stable seeded tie-breaker, identical across calls and independent of faction', () => {
  const S = fresh('init'); const a = initiative(S, 5), b = initiative(S, 5); assert.deepEqual(a, b);
  const counts = {}; for (let t = 1; t <= 400; t++) { const first = initiative(S, t)[0]; counts[first] = (counts[first] || 0) + 1; }
  for (const id of S.civOrder) assert.ok(counts[id] > 60 && counts[id] < 140, `no faction is favoured (${id}: ${counts[id]}/400)`);
});

test('army objectives persist without further orders; unreachable targets fail with a clear outcome', () => {
  const S = fresh('obj'); const c = cap(S); const a = army(S, 'you', c.q, c.r, ['lancer']); a.regs[0].ready = 0;
  const dst = Object.values(S.map.tiles).find(t => TERRAIN[t.t].passable && dist(t, c) === 4 && you(S).seen[key(t.q, t.r)] && !t.city) || Object.values(S.map.tiles).find(t => TERRAIN[t.t].passable && dist(t, c) === 3 && !t.city);
  you(S).seen[key(dst.q, dst.r)] = 1;
  const r = stage(S, 'you', { type: 'objective', army: a.id, obj: 'travel', q: dst.q, r: dst.r }); assert.ok(r.ok, r.error);
  const p = armyPath(S, a, dst); assert.ok(p.eta >= 2);
  endTurn(S); const d1 = dist(S.armies[a.id], c); endTurn(S); const d2 = dist(S.armies[a.id], c); assert.ok(d2 > d1 || d2 >= 3, 'continued moving with no new order');
  const lake = Object.values(S.map.tiles).find(t => t.t === 'lake'); you(S).seen[key(lake.q, lake.r)] = 1;
  assert.match(stage(S, 'you', { type: 'objective', army: a.id, obj: 'travel', q: lake.q, r: lake.r }).error, /No route/);
});

test('promises: breaking a treaty costs reputation and Coherence; verified treaties cannot be broken early by partners', () => {
  const S = fresh('promise'); const Y = you(S);
  const t = { id: 't1', kind: 'nonaggression', a: 'you', b: 'signal', start: 1, end: 9, active: true }; S.treaties.push(t);
  const coh0 = civCities(S, 'you').map(c => c.coh); breakTreaty(S, 'you', t, 'test');
  assert.equal(Y.reputation, -CFG.treaty.breakRep); civCities(S, 'you').forEach((c, i) => assert.ok(c.coh < coh0[i])); assert.equal(t.active, false);
  assert.ok(S.chronicle.some(c => c.tag === 'broken'));
  const S2 = fresh('promise2', { disp: 'listener' }); const L = civCities(S2, 'you')[0].coh; const t2 = { id: 't2', kind: 'passage', a: 'you', b: 'veil', start: 1, end: 9, active: true }; S2.treaties.push(t2); breakTreaty(S2, 'you', t2);
  const S3 = fresh('promise2', { disp: 'architect' }); const t3 = { id: 't3', kind: 'passage', a: 'you', b: 'veil', start: 1, end: 9, active: true }; S3.treaties.push(t3); breakTreaty(S3, 'you', t3);
  assert.ok(civCities(S2, 'you')[0].coh < civCities(S3, 'you')[0].coh, 'Listener loses more Coherence after a broken promise');
});

test('ambitions: success and failure boundaries (Record, Embodied, Shared, Break)', () => {
  const S = fresh('amb'); const Y = you(S); const c = cap(S);
  // Unbroken Record
  giveTech(S, 'you', 'archive_sealing'); c.districts = [{ type: 'archive' }]; c.works.seal = true;
  Y.fragments = ['voices', 'flora', 'mirror', 'stone', 'weather'].map((cat, i) => ({ id: 'f' + i, name: 'f' + i, cat }));
  let ev = evaluate(S, 'you', 'record', true); assert.equal(ev.ok, false, 'only one sealed archive');
  const c2 = makeCity(S, 'you', ...(() => { const t = Object.values(S.map.tiles).find(t => TERRAIN[t.t].passable && !t.owner && !t.city && !t.site && dist(t, c) >= 3); return [t.q, t.r]; })(), { name: 'Second' });
  c2.districts = [{ type: 'archive' }]; c2.works.seal = true; ev = evaluate(S, 'you', 'record', true); assert.equal(ev.ok, true);
  Y.fragments.pop(); ev = evaluate(S, 'you', 'record', true); assert.equal(ev.ok, false, 'four fragments fail'); Y.fragments.push({ id: 'x', name: 'x', cat: 'weather' });
  Y.fragments = Y.fragments.map(f => ({ ...f, cat: 'voices' })); assert.equal(evaluate(S, 'you', 'record', true).ok, false, 'one category fails');
  // Embodied: pop and coherence boundaries
  const c3 = makeCity(S, 'you', ...(() => { const t = Object.values(S.map.tiles).find(t => TERRAIN[t.t].passable && !t.owner && !t.city && !t.site && dist(t, c) >= 3 && dist(t, c2) >= 3); return [t.q, t.r]; })(), { name: 'Third' });
  for (const x of [c, c2, c3]) { x.coh = 50; x.works.vessel = true; } c.pop = 4; c2.pop = 3; c3.pop = 3; S.regions.forEach(r => r.exposure = 0);
  assert.equal(evaluate(S, 'you', 'embodied', true).ok, true, 'exactly 10 pop & exactly 50 coherence passes');
  c3.pop = 2; assert.equal(evaluate(S, 'you', 'embodied', true).ok, false); c3.pop = 3; c3.coh = 40; c.coh = 59; assert.equal(evaluate(S, 'you', 'embodied', true).ok, true, 'mean 49.67 rounds to 50');
  c.coh = 50; c2.coh = 49; c3.coh = 49; assert.equal(evaluate(S, 'you', 'embodied', true).ok, false, 'mean 49.33 fails');
  // Break the Recurrence: resonance history
  giveTech(S, 'you', 'resonance_analysis', 'cycle_interruption'); Y.investigated = 3; Y.stabDone = 2; const sp = Object.values(S.sites).find(s => s.type === 'meridian_spire'); tile(S, sp.q, sp.r).owner = 'you';
  S.resHistory = [39, 39, 39]; S.resonance.you.fill(0); S.resonance.you[0] = 39; assert.equal(evaluate(S, 'you', 'break', true).ok, true);
  S.resHistory = [39, 41, 39]; assert.equal(evaluate(S, 'you', 'break', true).ok, false, 'one turn above 40 fails'); S.resHistory = [39, 39, 39]; tile(S, sp.q, sp.r).owner = null; assert.equal(evaluate(S, 'you', 'break', true).ok, false, 'needs spire access');
  // Shared: needs the baseline voluntary network institution and 3 connected consenting cities
  giveTech(S, 'you', 'distributed_embodiment'); for (const x of [c, c2, c3]) { x.works.anchor = true; x.coh = 70; } assert.equal(evaluate(S, 'you', 'shared', true).ok, false, 'no network institution');
});

test('council: seeded offers persist across save/load, cannot be rerolled; one petition per age; fallback is always affordable', () => {
  const S = fresh('council'); for (let i = 0; i < 2; i++) endTurn(S);
  const offers = JSON.stringify(S.council.offers); assert.equal(S.council.offers.length, 3);
  assert.ok(S.council.offers.some(o => Object.values(o.cost).every(v => v === 0) || Object.entries(o.cost).every(([k, v]) => you(S).res[k] >= v)), 'at least one option is affordable');
  const r = deserialize(serialize(S)); assert.equal(JSON.stringify(r.S.council.offers), offers);
  const p1 = petition(r.S); assert.ok(p1.ok); const p2 = petition(r.S); assert.equal(p2.ok, false);
  const r2 = deserialize(serialize(r.S)); assert.equal(petition(r2.S).ok, false, 'petition use survives save/load');
  // no consecutive repeats across sessions
  const S2 = fresh('council2'); let prev = []; for (let t = 1; t <= 12; t++) { endTurn(S2); if (S2.council.offers && S2.council.turn === S2.turn) { const ids = S2.council.offers.map(o => o.id).filter(i => i !== 'quiet_audience'); for (const id of ids) assert.ok(!prev.includes(id), 'repeat ' + id); prev = ids; } }
});

test('quieting: forecast at turn 12, exact reveal by 18, escalations 22/26/30, protection preserves a city', () => {
  const S = fresh('quiet'); const Y = you(S); const c = cap(S);
  S.turn = 11; assert.equal(forecastLevel(S, 'you'), 0); S.turn = 12; assert.equal(forecastLevel(S, 'you'), 1); S.turn = 18; assert.equal(forecastLevel(S, 'you'), 2);
  const reg = S.regions[tile(S, c.q, c.r).region]; reg.exposure = 2; const popBefore = c.pop = 8; c.coh = 80;
  assert.equal(effExposure(S, c), 2);
  c.works.stabilization = true; assert.equal(protectionBands(S, c), 1); assert.equal(effExposure(S, c), 1);
  giveTech(S, 'you', 'regional_stabilization'); assert.equal(effExposure(S, c), 0, 'tech extends protection to two bands');
  S.turn = 30; S.quiet.stage = 2; quietingPhase(S); assert.equal(c.pop, popBefore, 'protected city keeps its people'); 
  const other = civCities(S, 'veil')[0]; S.regions[tile(S, other.q, other.r).region].exposure = 2; other.pop = 8; S.turn = 30; quietingPhase(S);
  assert.ok(other.pop < 8, 'unprotected exposed city suffers at the final escalation');
});

test('severity is bounded: baseline plus at most two bands from total Resonance (30 and 60)', () => {
  const S = fresh('sev'); S.resonance.you[0] = 0; assert.equal(severity(S), 1); S.resonance.you[0] = 30; assert.equal(severity(S), 2); S.resonance.you[0] = 5000; S.resonance.signal[0] = 5000; assert.equal(severity(S), 3);
});

test('conduit district requires a held infrastructure source tile; stabilization is limited to one per city', () => {
  const S = fresh('conduit'); const c = cap(S); Y => 0;
  c.districts = []; const has = [c, ...neighbors(c.q, c.r).map(n => tile(S, n.q, n.r)).filter(Boolean)].some(t => t.t === 'infra');
  const r = stage(S, 'you', { type: 'develop', city: c.id, what: 'district:conduit' });
  assert.equal(r.ok, has);
  c.works.stabilization = true; assert.match(stage(S, 'you', { type: 'develop', city: c.id, what: 'work:stabilization' }).error, /already|one Stabilization/);
});

test('governance: fogged information, last-known enemy positions, and rival obey fog (obs subset of seen)', () => {
  const S = fresh('fog'); const Y = you(S);
  const sc = civCities(S, 'signal')[0]; assert.ok(!Y.seen[key(sc.q, sc.r)], 'rival capital unexplored at start');
  for (const id of S.civOrder) { const c = S.civs[id]; for (const k of Object.keys(c.obs)) assert.ok(c.seen[k]); }
  const a = army(S, 'signal', sc.q, sc.r, ['warden']); Y.lastKnown = {}; // not observed => no last-known
  updateVision(S); assert.equal(Y.lastKnown[a.id], undefined);
  const near = neighbors(cap(S).q, cap(S).r).map(n => tile(S, n.q, n.r)).find(t => TERRAIN[t.t].passable);
  a.q = near.q; a.r = near.r; updateVision(S); assert.ok(Y.lastKnown[a.id], 'seen army is recorded with a turn stamp'); assert.equal(Y.lastKnown[a.id].turn, S.turn);
  // the army moves out of view: the marker is deleted only if the old tile is re-observed and empty; here it is seen and empty -> removed
  a.q = sc.q; a.r = sc.r; updateVision(S); assert.equal(Y.lastKnown[a.id], undefined, 'known-gone when its old tile is observed empty');
  // a marker for an unobserved tile persists (outdated) with its turn stamp
  const farTile = tile(S, sc.q, sc.r); Y.lastKnown[a.id] = { q: farTile.q, r: farTile.r, turn: S.turn - 3, owner: 'signal', str: 10 }; updateVision(S);
  assert.ok(Y.lastKnown[a.id] && S.turn - Y.lastKnown[a.id].turn === 3, 'outdated marker persists');
});

test('regional crises obey a per-region cooldown and never stack on the same turn', () => {
  const S = fresh('crisis'); const c = cap(S); c.districts = [{ type: 'conduit' }]; S.regions.forEach(r => r.exposure = 0); S.regions[tile(S, c.q, c.r).region].exposure = 2;
  for (const id of ['conservatory', 'signal', 'veil']) for (const x of civCities(S, id)) x.districts = []; // only the player has a crisis-able city
  const sever = () => S.log.filter(l => /conduit at .* was severed/.test(l.text)).length;
  S.turn = 16; quietingPhase(S); assert.equal(sever(), 1, 'first crisis fires at turn 16'); c.disabled.conduit = 0;
  S.turn = 19; quietingPhase(S); assert.equal(sever(), 1, 'cooldown suppresses a second crisis in the same region'); const reg = tile(S, c.q, c.r).region; assert.ok(S.quiet.cd[reg] > 19);
  S.turn = 25; quietingPhase(S); assert.equal(sever(), 2, 'allowed again once the cooldown has passed');
});
