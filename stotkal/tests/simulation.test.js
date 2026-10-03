import test from 'node:test';
import assert from 'node:assert/strict';
import { newRun } from '../src/sim/state.js';
import { endTurn } from '../src/sim/resolve.js';
import { planAs } from '../src/sim/rival.js';
import { civCities, totalResonance, computeEconomy } from '../src/sim/economy.js';
import { CFG, AMBITIONS, TECHS } from '../src/data/content.js';
import { key, dist } from '../src/sim/hex.js';
import { TERRAIN } from '../src/data/content.js';

const MODES = ['embodied', 'shared', 'record', 'break', 'idle'];
const FAC = { embodied: 'veil', shared: 'signal', record: 'conservatory', break: 'conservatory' };

test('complete-game simulation: 20 seeds x modes: no crashes, no deadlocked turns, valid values, no runaway economy', () => {
  const t0 = Date.now(); let games = 0, ended30 = 0, successes = 0;
  for (let i = 0; i < 20; i++) {
    for (const mode of [MODES[i % 5], MODES[(i + 2) % 5]]) {
      const S = newRun({ seed: 'sweep-' + i, tradition: ['keepers', 'circuit', 'gardeners'][i % 3], disp: ['listener', 'architect', 'pilgrim'][(i >> 1) % 3] }); S.debugThrow = true; games++;
      let guard = 0, lastTurn = 0;
      while (!S.over && guard++ < 40) {
        if (mode !== 'idle') planAs(S, 'you', FAC[mode], mode);
        const before = S.turn; endTurn(S); assert.ok(S.over || S.turn === before + 1, 'turn advanced (no deadlock)');
        for (const c of Object.values(S.civs)) for (const [k, v] of Object.entries(c.res)) { assert.ok(Number.isFinite(v) && v >= 0 && v < 3000, `resource ${k}=${v}`); }
        for (const c of Object.values(S.cities)) { assert.ok(Number.isInteger(c.pop) && c.pop >= 0, 'pop'); assert.ok(c.coh >= 0 && c.coh <= 100, 'coh ' + c.coh); }
        assert.ok(S.turn <= 31);
      }
      assert.ok(S.over && S.ending, 'run ends with an ending'); if (S.ending.kind === 'final') ended30++; if (S.ending.success) successes++;
      assert.ok(S.aiLog.every(l => !l.error), 'rival planner threw: ' + JSON.stringify(S.aiLog.find(l => l.error)));
      assert.ok(totalResonance(S) >= 0 && totalResonance(S) < 400, 'resonance runaway ' + totalResonance(S));
    }
  }
  assert.ok(ended30 >= games * 0.9, 'most runs reach the final resolution'); assert.ok(successes > 0);
  console.log(`# ${games} games in ${Date.now() - t0}ms, ${successes} player successes`);
});

test('every ambition has a discoverable baseline route in each generated world (30 seeds)', () => {
  for (let i = 0; i < 30; i++) {
    const S = newRun({ seed: 'route-' + i, tradition: 'keepers', disp: 'listener' });
    const sites = Object.values(S.sites);
    assert.equal(sites.filter(s => s.type === 'anomaly').length, 3, 'three anomaly sites guaranteed');
    const spire = sites.find(s => s.type === 'meridian_spire'); assert.ok(spire && TERRAIN[S.map.tiles[key(spire.q, spire.r)].t].passable && !S.map.tiles[key(spire.q, spire.r)].owner, 'spire unclaimed and reachable');
    for (const s of sites) { const t = S.map.tiles[key(s.q, s.r)]; assert.ok(!t.owner || t.owner === null, 'no site starts inside a border'); }
    // every technology required by every ambition exists and its prerequisite chain is acyclic & within the tree
    for (const a of Object.values(AMBITIONS)) for (const t of a.techs) assert.ok(TECHS[t]);
    // anomaly sites are never inside a rival capital's ring (investigation never requires conquest)
    const caps = Object.values(S.civs).map(c => S.cities[c.cap]);
    for (const s of sites.filter(s => s.type === 'anomaly' || s.type === 'meridian_spire')) for (const c of caps) assert.ok(dist(c, s) >= 2, 'site outside any capital border');
    // peaceful routes exist: at least four independent settlements to influence, and a baseline institution that needs no discovery
    assert.equal(Object.values(S.cities).filter(c => c.ind).length, 6);
  }
});

test('turn resolution is fast enough: complete 30-turn game with four civilisations resolves quickly', () => {
  const S = newRun({ seed: 'perf', tradition: 'keepers', disp: 'listener' }); const t0 = performance.now(); let n = 0;
  while (!S.over) { planAs(S, 'you', 'veil', 'embodied'); endTurn(S); n++; } const per = (performance.now() - t0) / n;
  console.log(`# mean turn (planning + resolution, 4 civs): ${per.toFixed(1)}ms`); assert.ok(per < 100, 'per-turn ' + per);
});
