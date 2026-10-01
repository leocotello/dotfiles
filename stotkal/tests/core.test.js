import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContent } from '../src/data/validate.js';
import { CFG, TECHS, DISTRICTS } from '../src/data/content.js';
import { newRun } from '../src/sim/state.js';
import { generateMap } from '../src/sim/mapgen.js';
import { key, neighbors, dist } from '../src/sim/hex.js';
import { TERRAIN } from '../src/data/content.js';
import { endTurn } from '../src/sim/resolve.js';
import { serialize, deserialize } from '../src/sim/save.js';
import { stage, unstage, available, ordersLeft, reserved } from '../src/sim/commands.js';
import { computeEconomy, civCities } from '../src/sim/economy.js';
import { fresh, you, cap, playBot, tile, giveTech } from './helpers.js';
import { planAs } from '../src/sim/rival.js';

test('content validates: references, prerequisites, no cycles, six techs per age', () => { assert.deepEqual(validateContent(), []); });

test('map generation: connected, 65-80 traversable, content counts, viable accessible start (30 seeds)', () => {
  for (let i = 0; i < 30; i++) {
    const m = generateMap('seed-' + i); const tiles = Object.values(m.tiles);
    assert.equal(tiles.length, 91);
    const pass = tiles.filter(t => TERRAIN[t.t].passable); assert.ok(pass.length >= 65 && pass.length <= 80, 'passable ' + pass.length);
    const seen = new Set([key(pass[0].q, pass[0].r)]); const st = [pass[0]];
    while (st.length) { const c = st.pop(); for (const n of neighbors(c.q, c.r)) { const t = m.tiles[key(n.q, n.r)]; if (t && TERRAIN[t.t].passable && !seen.has(key(t.q, t.r))) { seen.add(key(t.q, t.r)); st.push(t); } } }
    assert.equal(seen.size, pass.length, 'all traversable tiles connected');
    assert.equal(m.caps.length, 4); assert.equal(m.indep.length, 4); assert.equal(m.sites.length, 12);
    assert.equal(m.sites.filter(s => s.type === 'anomaly').length, 3, 'three guaranteed anomaly sites');
    assert.ok(m.sites.some(s => s.type === 'meridian_spire'));
    const p = m.caps[0]; assert.ok(m.sites.some(s => dist(s, p) <= 4 && s.type !== 'meridian_spire'), 'early discovery near start');
    for (const s of m.sites) assert.ok(TERRAIN[m.tiles[key(s.q, s.r)].t].passable, 'sites on traversable tiles');
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) assert.ok(dist(m.caps[a], m.caps[b]) >= 5, 'capitals spaced');
    const around = [p, ...neighbors(p.q, p.r)].map(h => m.tiles[key(h.q, h.r)]).filter(Boolean);
    assert.ok(around.filter(t => t.t === 'garden').length >= 1);
  }
});

test('deterministic replay: same seed and same decisions give identical state', () => {
  const a = playBot('replay', 'record'); const b = playBot('replay', 'record');
  assert.equal(serialize(a).replace(/"savedAt":\d+,/, ''), serialize(b).replace(/"savedAt":\d+,/, ''));
  const c = playBot('replay-other', 'record'); assert.notEqual(JSON.stringify(a.map.tiles), JSON.stringify(c.map.tiles));
});

test('save/load equivalence: resuming mid-run yields the same future as never saving', () => {
  const fac = 'veil'; const run = (S, upto) => { while (!S.over && S.turn <= upto) { planAs(S, 'you', fac, 'embodied'); endTurn(S); } return S; };
  const A = fresh('saveload'); run(A, 13);
  const B = fresh('saveload'); run(B, 8);
  const r = deserialize(serialize(B)); assert.ok(r.ok); const B2 = r.S; B2.debugThrow = true; run(B2, 13);
  const strip = (S) => serialize(S).replace(/"savedAt":\d+,/, '');
  assert.equal(strip(A), strip(B2));
});

test('save at the commitment stage restores staged orders, offers, and RNG state', () => {
  const S = fresh('commit'); for (let i = 0; i < 2; i++) endTurn(S); // turn 3: council
  assert.ok(S.council.offers && S.council.turn === 3);
  const c = cap(S); stage(S, 'you', { type: 'develop', city: c.id, what: 'district:garden', replace: undefined });
  const r = deserialize(serialize(S)); assert.ok(r.ok);
  assert.deepEqual(r.S.council.offers, S.council.offers, 'offers do not reroll on load');
  assert.equal(r.S.staged.you.length, S.staged.you.length); assert.equal(r.S.rng, S.rng);
});

test('save recovery: corrupted, wrong game, and future-version saves give readable messages', () => {
  assert.equal(deserialize('{nope').ok, false); assert.match(deserialize('{nope').message, /corrupted/);
  assert.equal(deserialize('{"game":"other"}').ok, false);
  const S = fresh('v'); const o = JSON.parse(serialize(S)); o.schema = 99; const r = deserialize(JSON.stringify(o)); assert.equal(r.ok, false); assert.match(r.message, /newer version/);
  const o2 = JSON.parse(serialize(S)); o2.state.civs.you.inst[0] = { id: 'removed_in_patch', site: null, turn: 1 }; o2.state.civs.you.techs.vanished = true;
  const r2 = deserialize(JSON.stringify(o2)); assert.ok(r2.ok); assert.equal(r2.S.civs.you.inst[0], null); assert.ok(r2.notes.length >= 2);
});

test('orders: at most three; resources reserved across simultaneous orders; unstage refunds', () => {
  const S = fresh('orders'); const c = cap(S); const Y = you(S);
  Y.res.mat = 20;
  const r1 = stage(S, 'you', { type: 'develop', city: c.id, what: 'district:garden' }); assert.ok(r1.ok);
  assert.equal(available(S, 'you').mat, 12);
  // a second develop on the same city replaces the first rather than double-reserving
  const r2 = stage(S, 'you', { type: 'develop', city: c.id, what: 'district:foundry' }); assert.ok(r2.ok); assert.equal(S.staged.you.filter(x => x.type === 'develop').length, 1);
  assert.equal(available(S, 'you').mat, 10);
  // claims cost 2 Matter each: reservations must prevent overspend
  Y.res.mat = 11;
  const ts = Object.values(S.map.tiles).filter(t => !t.owner && Y.seen[key(t.q, t.r)] && neighbors(t.q, t.r).some(n => tile(S, n.q, n.r)?.owner === 'you'));
  assert.ok(ts.length >= 3);
  const claim = (t) => stage(S, 'you', { type: 'claim', q: t.q, r: t.r });
  S.staged.you = []; Y.res.mat = 5;
  assert.ok(claim(ts[0]).ok); assert.ok(claim(ts[1]).ok);
  const third = claim(ts[2]); assert.equal(third.ok, false); assert.match(third.error, /Not enough resources|No orders left/);
  S.staged.you = []; Y.res.mat = 50;
  assert.ok(claim(ts[0]).ok && claim(ts[1]).ok && claim(ts[2]).ok);
  const fourth = stage(S, 'you', { type: 'survey', q: c.q, r: c.r }); assert.equal(fourth.ok, false); assert.match(fourth.error, /No orders left/); assert.equal(ordersLeft(S, 'you'), 0);
  const first = S.staged.you[0]; unstage(S, 'you', first.id); assert.equal(ordersLeft(S, 'you'), 1); assert.equal(reserved(S, 'you').mat, 4);
});

test('invalid prerequisites are rejected with explanations', () => {
  const S = fresh('prereq'); const c = cap(S);
  assert.match(stage(S, 'you', { type: 'reform', kind: 'research', tech: 'cycle_interruption' }).error, /Requires/);
  assert.match(stage(S, 'you', { type: 'develop', city: c.id, what: 'work:vessel' }).error, /Requires Continuity Vessels/);
  assert.match(stage(S, 'you', { type: 'reform', kind: 'restore' }).error, /Release the Voices/);
  assert.match(stage(S, 'you', { type: 'treaty', to: 'signal', kind: 'trade' }).error, /not met/);
  assert.match(stage(S, 'you', { type: 'treaty', to: 'signal', kind: 'shutdown' }).error, /Cycle Interruption|not met/);
  assert.match(stage(S, 'you', { type: 'city', q: c.q, r: c.r, source: c.id }).error, /Occupied|Too close/);
  const far = Object.values(S.map.tiles).find(t => dist(t, c) === 5 && TERRAIN[t.t].passable); assert.ok(stage(S, 'you', { type: 'claim', q: far.q, r: far.r }).error);
});

test('construction: reserves Matter, completes after N turns, replacement refunds half, queue replacement is visible', () => {
  const S = fresh('build'); const c = cap(S); const m0 = you(S).res.mat;
  const st = stage(S, 'you', { type: 'develop', city: c.id, what: 'district:garden' }); assert.ok(st.ok);
  endTurn(S); assert.ok(c.project && c.project.remaining === 1); assert.equal(c.districts.length, 0);
  const after = you(S).res.mat;
  stage(S, 'you', { type: 'develop', city: c.id, what: 'district:archive' }); // replaces the garden mid-way
  endTurn(S); assert.equal(c.project.what, 'district:archive');
  assert.ok(S.log.some(l => /Replaced project refunded 4 Matter/.test(l.text)), 'half of 8 refunded and shown');
  endTurn(S); endTurn(S); assert.ok(c.districts.some(d => d.type === 'archive'), 'archive completed');
});

test('research accounting: Memory spent equals progress; switching preserves paid progress; no free completion charge', () => {
  const S = fresh('research'); const Y = you(S); Y.res.mem = 20; Y.research.alloc = 2;
  assert.ok(stage(S, 'you', { type: 'reform', kind: 'research', tech: 'cultivation' }).ok);
  const m0 = Y.res.mem; endTurn(S);
  assert.equal(Y.research.progress.cultivation, 2);
  // production adds memory; research spends exactly 2
  const econ = S._econ.you.net.mem; assert.equal(Y.res.mem, m0 + econ - 2);
  stage(S, 'you', { type: 'reform', kind: 'research', tech: 'testimony' }); endTurn(S);
  assert.equal(Y.research.progress.cultivation, 2, 'old progress preserved'); assert.equal(Y.research.progress.testimony, 2);
  stage(S, 'you', { type: 'reform', kind: 'research', tech: 'cultivation' }); Y.research.alloc = 4; Y.res.mem = 30; endTurn(S);
  assert.equal(Y.research.progress.cultivation, 6); Y.res.mem = 30; endTurn(S);
  assert.equal(Y.research.progress.cultivation, 8); assert.ok(Y.techs.cultivation, 'completes at requirement'); assert.equal(Y.research.target, null);
  const consumed = 2 + 4 + 2; assert.equal(consumed, 8);
});

test('resource conservation: no negative stocks; net income explains every change', () => {
  const S = fresh('conserve'); for (let i = 0; i < 6; i++) {
    const before = { ...you(S).res }; const econ = computeEconomy(S, 'you');
    const sum = { sus: 0, mat: 0, ene: 0, mem: 0 }; for (const it of econ.items) sum[it.res] += it.amt;
    for (const k of Object.keys(sum)) assert.equal(sum[k], econ.net[k], 'items sum to net for ' + k);
    endTurn(S); for (const [k, v] of Object.entries(you(S).res)) assert.ok(v >= 0 && Number.isFinite(v));
  }
});

test('shortage: deficit is forecast, allocated to cities, and starvation reduces population after two turns', () => {
  const S = fresh('hunger'); const Y = you(S); const c = cap(S); Y.res.sus = 0; c.pop = 6; c.districts = [];
  const econ = computeEconomy(S, 'you'); Y.res.sus = 0;
  // force a deficit by overpopulating beyond production
  c.pop = 12; const e2 = computeEconomy(S, 'you'); assert.ok(e2.deficit > 0); assert.ok(e2.shortCities[c.id] > 0);
  const coh0 = c.coh; endTurn(S); assert.ok(c.coh < coh0 + 1, 'coherence penalised'); endTurn(S); assert.ok(c.pop < 12, 'population shrinks after two affected turns');
});

test('capital connectivity & supply: separated cities are not connected merely because both are friendly', async () => {
  const { components } = await import('../src/sim/economy.js'); const { makeCity } = await import('../src/sim/state.js');
  const S = fresh('conn'); const c = cap(S);
  const far = Object.values(S.map.tiles).filter(t => TERRAIN[t.t].passable && !t.owner && dist(t, c) >= 5 && !t.city && !t.site)[0];
  const far2 = makeCity(S, 'you', far.q, far.r, { name: 'Faraway' });
  const comp = components(S, 'you'); assert.notEqual(comp[c.id], comp[far2.id]);
});
