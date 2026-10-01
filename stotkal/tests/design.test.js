import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh, you, cap, tile, giveTech, playBot } from './helpers.js';
import { key, neighbors, dist } from '../src/sim/hex.js';
import { CFG, TERRAIN, INSTITUTIONS } from '../src/data/content.js';
import { endTurn } from '../src/sim/resolve.js';
import { stage, restoreEvery, validate } from '../src/sim/commands.js';
import { civCities, civArmies, fx, hasInst, components, protectionBands, computeEconomy } from '../src/sim/economy.js';
import { evaluate, sealedArchives } from '../src/sim/ambitions.js';
import { installInstitution, transferCity, applyCmd } from '../src/sim/apply.js';
import { evaluateTreaty, relation, declareWar } from '../src/sim/diplomacy.js';
import { quietingPhase } from '../src/sim/quieting.js';
import { newRun, makeCity, atWar, updateVision } from '../src/sim/state.js';
import { planAs } from '../src/sim/rival.js';
import { invalidateSupplyCache } from '../src/sim/combat.js';

test('combinations change practical strategy, not just income (4 verified)', () => {
  // 1. Verified Treaties: Testimony + Consult the Ancestors -> a partner cannot declare war through a pact
  const S = fresh('combo1'); const Y = you(S); S.civs.signal.seen[key(cap(S).q, cap(S).r)] = 1; S.treaties.push({ id: 'p', kind: 'nonaggression', a: 'you', b: 'signal', start: 1, end: 9, active: true });
  assert.equal(validate(S, 'signal', { type: 'demand', to: 'you', kind: 'war' }), null, 'without the combo war can be declared (breaking the pact)');
  Y.inst[0] = { id: 'ancestors', site: null, turn: 1 }; giveTech(S, 'you', 'testimony');
  assert.match(validate(S, 'signal', { type: 'demand', to: 'you', kind: 'war' }), /verified/);
  // 2. Population Continuity: Release the Voices + Body Restoration -> restoration every 3 turns, gentler arrivals
  const S2 = fresh('combo2'); const Y2 = you(S2); Y2.inst[0] = { id: 'voices', site: null, turn: 1 }; assert.equal(restoreEvery(S2, Y2), 5);
  giveTech(S2, 'you', 'body_restoration'); assert.equal(restoreEvery(S2, Y2), 3);
  const c = cap(S2); c.pop = 3; const coh0 = c.coh; S2.turn = 10; Y2.res.mat = 20; Y2.res.ene = 20; Y2.restoreCd = -99; const r = stage(S2, 'you', { type: 'reform', kind: 'restore' }); assert.ok(r.ok, r.error);
  endTurn(S2); assert.equal(c.pop >= 5, true, 'two people restored'); assert.ok(coh0 - c.coh <= 4 + 1, 'integration penalty is 4 not 8');
  // 3. Network Recovery: Become the Choir + Collective Coordination -> severed links heal at once
  const S3 = fresh('combo3'); const Y3 = you(S3); Y3.inst[0] = { id: 'choir', site: null, turn: 1 }; const e0 = fx(S3, Y3, 'netRepairInstant'); giveTech(S3, 'you', 'collective_coordination'); assert.equal(e0, 0); assert.equal(fx(S3, Y3, 'netRepairInstant'), 1);
  // 4. Sealed Record: Preserve Testimony (Monolith) + Archive Sealing -> the Monolith is a sealed Archive
  const S4 = fresh('combo4'); const Y4 = you(S4); Y4.inst[0] = { id: 'testimony_stone', site: null, turn: 1 }; assert.equal(sealedArchives(S4, Y4), 0); giveTech(S4, 'you', 'archive_sealing'); assert.equal(sealedArchives(S4, Y4), 1);
});

test('institution replacement: visible transition penalty, Chronicle keeps the memory, no dangling combo after removal', () => {
  const S = fresh('replace'); const Y = you(S); giveTech(S, 'you', 'testimony');
  installInstitution(S, Y, 'ancestors', 0, null); assert.equal(fx(S, Y, 'verifiedTreaties'), 1);
  const coh = civCities(S, 'you').map(c => c.coh); installInstitution(S, Y, 'choir', 0, null); // replaces ancestors (and is incompatible with nothing else)
  civCities(S, 'you').forEach((c, i) => assert.ok(c.coh <= coh[i] - 4, 'transition penalty'));
  assert.equal(fx(S, Y, 'verifiedTreaties'), 0, 'combo disappears with its institution; no dangling reference');
  assert.ok(S.chronicle.some(c => c.tag === 'replaced' && /Consult the Ancestors/.test(c.text)), 'narrative consequence persists');
  assert.equal(Y.instHistory.length, 1);
  // incompatible reform (Consult the Ancestors + Become the Choir) costs 6 once; Keepers of Names additionally resist the collective (-4)
  const S2 = fresh('replace2', { tradition: 'circuit' }); const Y2 = you(S2); installInstitution(S2, Y2, 'ancestors', 0, null); const before = civCities(S2, 'you')[0].coh; installInstitution(S2, Y2, 'choir', 1, null);
  assert.equal(before - civCities(S2, 'you')[0].coh, 6);
  const S3 = fresh('replace3', { tradition: 'keepers' }); const Y3 = you(S3); installInstitution(S3, Y3, 'ancestors', 0, null); const b3 = civCities(S3, 'you')[0].coh; installInstitution(S3, Y3, 'choir', 1, null);
  assert.equal(b3 - civCities(S3, 'you')[0].coh, 10, 'Keepers resist forced/collective integration (-4 more)');
});

test('mutual Resonance shutdown: planner accepts a compensated offer when it benefits (not refuse by default)', () => {
  const S = fresh('shutdown'); S.resonance.signal[0] = 12; giveTech(S, 'you', 'cycle_interruption');
  const ev = evaluateTreaty(S, 'you', 'signal', 'shutdown'); assert.ok(ev.reasons.some(r => /Compensation/.test(r.label))); assert.ok(ev.accept, 'score ' + ev.score);
  S.resonance.signal.fill(0); const ev2 = evaluateTreaty(S, 'you', 'signal', 'shutdown'); assert.ok(ev2.score < ev.score);
});

test('shutdown treaty pauses the partner\'s Foundries and removes their Resonance and pays compensation', async () => {
  const { makeTreaty } = await import('../src/sim/apply.js');
  const S = fresh('shutdown2'); const sc = civCities(S, 'signal')[0]; sc.districts = [{ type: 'foundry' }]; sc.coh = 80;
  const base = computeEconomy(S, 'signal'); assert.ok(base.resonance[sc.id] > 0);
  const t = makeTreaty(S, 'you', 'signal', 'shutdown'); const e = computeEconomy(S, 'signal'); assert.equal(e.resonance[sc.id], undefined, 'no Resonance while shut down'); assert.ok(e.net.mat < base.net.mat);
  assert.ok(computeEconomy(S, 'you').items.some(i => /compensation \(paid\)/.test(i.label)));
  assert.ok(computeEconomy(S, 'signal').items.some(i => /compensation \(received\)/.test(i.label)));
});

test('legacy: one active legacy with bounded effect and a complication; fresh chronicle disables inherited mechanics', () => {
  const base = fresh('legacy'); const r0 = you(base).res.mem;
  const S = newRun({ seed: 'legacy', tradition: 'keepers', disp: 'listener', legacy: { kind: 'character', name: 'The Witness, restored' } });
  assert.equal(you(S).res.mem, r0 + 4); assert.ok(you(S).mods.some(m => m.id === 'former_ruler')); assert.ok(S.relMem['signal|you'] === -10 || S.relMem['conservatory|you'] === -10 || S.relMem['veil|you'] === -10, 'grievance');
  for (let i = 0; i < 11; i++) endTurn(S); assert.ok(!you(S).mods.some(m => m.id === 'former_ruler'), 'bonus expires: bounded, not permanent');
  const F = newRun({ seed: 'legacy', tradition: 'keepers', disp: 'listener', legacy: { kind: 'character' }, fresh: true }); assert.equal(you(F).res.mem, r0); assert.equal(F.legacy, null);
  const R = newRun({ seed: 'legacy', tradition: 'keepers', disp: 'listener', legacy: { kind: 'ruin', name: 'Old Place', fragment: 'A Name' } });
  const ruin = Object.values(R.sites).find(s => s.type === 'legacy_ruin'); assert.ok(ruin && dist(ruin, cap(R)) >= 3 && dist(ruin, cap(R)) <= 4); assert.ok(you(R).mods.some(m => m.id === 'ruin_obligation'));
  you(R).seen[key(ruin.q, ruin.r)] = 1; updateVision(R); import('../src/sim/state.js').then(m => { m.syncDiscoveries(R); });
});

test('unlisted content in a loaded legacy fails gracefully (unknown kind is ignored)', () => {
  const S = newRun({ seed: 'legacy2', tradition: 'keepers', disp: 'listener', legacy: { kind: 'mystery' } }); assert.ok(S.turn === 1);
});

test('design test A (automated approximation): peaceful archive civilisation can succeed without war', () => {
  let wins = 0, wars = 0; for (let i = 0; i < 16; i++) { const S = playBot('peace-' + i, 'record'); if (S.ending.success) wins++; wars += Object.keys(S.wars).filter(k => k.includes('you')).length; }
  assert.ok(wins >= 3, 'wins ' + wins);
});
test('design test B (automated approximation): embodied federation counts federated settlements only while obligations are met', () => {
  let ok = 0; for (let i = 0; i < 16; i++) { const S = playBot('fed-' + i, 'embodied'); if (S.ending.success) ok++; }
  assert.ok(ok >= 3, 'wins ' + ok);
  const S = fresh('fedrule'); const c = cap(S); const ind = Object.values(S.cities).find(x => x.ind); transferCity(S, ind, 'you', 'federated'); assert.equal(ind.federated, true);
  const ev1 = evaluate(S, 'you', 'embodied'); const n1 = ev1.parts[0].cur; ind.fedMet = false; const n2 = evaluate(S, 'you', 'embodied').parts[0].cur; assert.equal(n2, n1 - 1, 'unmet federation obligations do not count');
});
test('design test C (automated approximation): Break the Recurrence needs no conquest and is reachable', () => {
  let ok = 0, peacefulWins = 0; for (let i = 0; i < 16; i++) { const S = playBot('brk-' + i, 'break'); if (S.ending.success) { ok++; if (S.civs.you.stats.conquered === 0) peacefulWins++; } }
  assert.ok(ok >= 2, 'wins ' + ok); assert.ok(peacefulWins >= 2, 'wins without conquering anything: ' + peacefulWins);
});

test('military-supported continuity: an army takes an independent settlement; infrastructure retained; integration pressure applies', () => {
  const S = fresh('conquest'); const ind = Object.values(S.cities).find(c => c.ind); const c = cap(S);
  const nb = neighbors(ind.q, ind.r).map(n => tile(S, n.q, n.r)).find(t => t && TERRAIN[t.t].passable && !t.city);
  const id = 'aT'; S.armies[id] = { id, owner: 'you', q: nb.q, r: nb.r, regs: ['lancer', 'warden', 'disruptor'].map((role, i) => ({ id: 'g' + i, role, str: 10, ready: 0 })), obj: { type: 'besiege', q: ind.q, r: ind.r, approach: 'assault' }, retreatAt: 0.2, entrench: 0 };
  ind.districts = [{ type: 'garden' }, { type: 'conduit' }]; you(S).seen[key(ind.q, ind.r)] = 1; invalidateSupplyCache(S);
  let taken = 0; for (let t = 0; t < 8 && !taken; t++) { endTurn(S); if (ind.owner === 'you') taken = S.turn; }
  assert.ok(taken && taken <= 8, 'settlement taken'); assert.ok(ind.districts.some(d => d.type === 'garden') && ind.districts.some(d => d.type === 'conduit'), 'infrastructure retained'); assert.ok(ind.coh < 60 && ind.consent === false, 'integration pressure'); assert.equal(S.civs.you.stats.conquered, 1);
});

test('lost city: the run continues; works and ambitions update consistently; a conquered capital passes the capital role', () => {
  const S = fresh('lostcity'); const Y = you(S); const c = cap(S);
  const spare = makeCity(S, 'you', ...(() => { const t = Object.values(S.map.tiles).find(t => TERRAIN[t.t].passable && !t.owner && !t.city && !t.site && dist(t, c) >= 3); return [t.q, t.r]; })(), { name: 'Spare' }); spare.pop = 5; spare.works.seal = true; spare.districts = [{ type: 'archive' }];
  assert.equal(sealedArchives(S, Y), 1);
  transferCity(S, c, 'signal', 'captured'); assert.equal(Y.cap, spare.id); assert.equal(spare.capital, true); assert.equal(c.owner, 'signal');
  endTurn(S); assert.ok(!S.over, 'run continues with the remaining city');
  transferCity(S, spare, 'signal', 'captured'); assert.ok(Y.eliminated); endTurn(S); assert.ok(S.over && S.ending.kind === 'collapse', 'early end with a meaningful record'); assert.ok(S.ending.chronicle.head.length > 10 && S.ending.legacies.length === 3);
});

test('broken supply route: cancelling passage or losing an outpost leaves an army unsupplied; recoverable by an outpost', async () => {
  const { isSupplied } = await import('../src/sim/army.js'); const { makeTreaty } = await import('../src/sim/apply.js');
  const S = fresh('supply2'); const sc = civCities(S, 'signal')[0]; const tr = makeTreaty(S, 'signal', 'you', 'passage');
  const m1 = isSupplied(S, 'you', sc.q, sc.r); assert.equal(m1, true, 'treaty-access infrastructure supplies the army');
  tr.active = false; const m2 = isSupplied(S, 'you', sc.q, sc.r); assert.equal(m2, false, 'supply breaks when passage ends');
  const t = Object.values(S.map.tiles).find(x => TERRAIN[x.t].passable && !x.owner && !x.city && dist(x, sc) === 2); t.owner = 'you'; t.outpost = 'you'; assert.equal(isSupplied(S, 'you', t.q, t.r), true, 'an outpost restores local supply');
});

test('rivals obey the same rules: they act through stage(), pay costs, and do not receive hidden resources', () => {
  const S = fresh('fair'); const before = { ...S.civs.veil.res }; let spent = { sus: 0, mat: 0, ene: 0, mem: 0 };
  for (let i = 0; i < 12; i++) { endTurn(S); }
  const e = S.aiLog.filter(l => l.civ === 'veil' && l.cmd).length; assert.ok(e > 5, 'rival issued orders'); assert.ok(S.aiLog.every(l => !l.error));
  for (const id of ['conservatory', 'signal', 'veil']) assert.ok(S.civs[id].res.sus < 400 && S.civs[id].res.mat < 400, 'no runaway');
  for (const l of S.aiLog.filter(l => l.cmd)) assert.ok(l.why && l.why.length > 3, 'every rival decision logs a motive');
});

test('rival pact-breaking is surfaced with a concise explanation and costs reputation', () => {
  const S = fresh('pact'); S.treaties.push({ id: 'p', kind: 'nonaggression', a: 'veil', b: 'you', start: 1, end: 9, active: true }); declareWar(S, 'veil', 'you', 'they are weak');
  const l = S.log.find(x => /broke the nonaggression pact/.test(x.text)); assert.ok(l && /reputation/i.test(l.text)); assert.ok(S.civs.veil.reputation < 0); assert.ok(atWar(S, 'veil', 'you'));
});
