import { CFG, TRADITIONS, DISPOSITIONS, FACTIONS, DISCOVERIES, NAMES, TECHS, TERRAIN } from '../data/content.js';
import { mulberry, hashStr, rnd, rint, stable } from './rng.js';
import { key, dist, neighbors, within } from './hex.js';
import { generateMap } from './mapgen.js';
import { RES, zero, tileAt, civCities, civArmies } from './economy.js';

export const SAVE_VERSION = 1;
export const RIVALS = ['conservatory', 'signal', 'veil'];

export function nid(S, p) { S.nextId++; return p + S.nextId; }
export function log(S, civ, text, imp = 0, extra = {}) { S.log.push({ turn: S.turn, civ, text, imp, ...extra }); if (S.log.length > 1500) S.log.splice(0, 300); }

export function makeCity(S, owner, q, r, o = {}) {
  const capital = !!o.capital;
  const id = nid(S, 'c');
  const city = {
    id, owner, name: o.name, q, r, capital, pop: capital ? CFG.start.pop : CFG.colony.pop,
    coh: capital ? CFG.start.coh : CFG.colony.coh - CFG.colony.integrationPenalty,
    districts: [], project: null, works: {}, growthWait: CFG.growth.interval, lowTurns: 0, shortTurns: 0, crisis: false,
    integrity: 10, integrityMax: 10, entrench: 0, raidCd: {}, disabled: { conduit: 0 }, request: null, consent: true, origin: o.origin || 'founded',
    founded: S.turn, lastRestore: -99, shelterSealed: false, ind: !!o.ind, influence: {}, notice: null, garrison: o.ind ? 12 : 0,
  };
  S.cities[id] = city;
  const t = tileAt(S, q, r); t.city = id; t.owner = owner || 'ind';
  for (const n of neighbors(q, r)) { const nt = tileAt(S, n.q, n.r); if (nt && !nt.owner && !nt.city) nt.owner = owner || 'ind'; }
  return city;
}

export function newRun(opts = {}) {
  const seed = String(opts.seed ?? 'stotkal');
  const map = generateMap(seed);
  const S = {
    v: SAVE_VERSION, seed, rng: hashStr(seed + ':run') >>> 0, turn: 1, over: false, ending: null, phase: 'staging',
    map: { R: map.R, tiles: map.tiles }, regions: [], civs: {}, civOrder: ['you', ...RIVALS], cities: {}, armies: {}, sites: {},
    treaties: [], wars: {}, proposals: [], relMem: {}, log: [], report: [], aiLog: [], nextId: 0, staged: {}, council: { offers: null, turn: 0, history: [], petition: {}, lastIds: [], pickedLog: [] },
    quiet: { stage: 0, forecastTurn: 0, revealed: false, crises: [], cd: {} }, resonance: {}, chronicle: [], flags: {}, mapAttempt: map.attempt,
  };
  // regions
  const ex = [0, 0, 1, 1, 1, 2, 2]; for (let i = ex.length - 1; i > 0; i--) { const j = rint(S, i + 1); [ex[i], ex[j]] = [ex[j], ex[i]]; }
  S.regions = ex.map((e, i) => ({ id: i, exposure: e }));
  // civs
  const mk = (id, name, faction, human) => ({
    id, name, faction, human, cap: null, res: { ...CFG.start.res }, tradition: null, disp: null, inst: [null, null, null], techs: {},
    research: { target: null, progress: {}, alloc: CFG.research.defaultAlloc }, ambition: null, ambitionChanged: false, seen: {}, obs: {}, lastKnown: {},
    fragments: [], mods: [], disc: {}, flags: {}, reputation: 0, emergency: null, rationPolicy: 'even', stats: { kept: 0, broken: 0, conquered: 0, lost: 0 },
    restoreCd: -99, negCd: -99, cpPrev: null, eliminated: false, done: {}, instHistory: [], vessels: 0, investigated: 0,
  });
  S.civs.you = mk('you', 'The Witness\'s People', null, true);
  for (const f of RIVALS) S.civs[f] = mk(f, FACTIONS[f].name, f, false);
  S.civs.you.tradition = opts.tradition || 'keepers'; S.civs.you.disp = opts.disp || 'listener';
  for (const f of RIVALS) { S.civs[f].tradition = FACTIONS[f].tradition; S.civs[f].disp = FACTIONS[f].disposition; }
  // starting modifiers to resources
  for (const id of S.civOrder) { const c = S.civs[id]; for (const [k, v] of Object.entries(TRADITIONS[c.tradition].startRes || {})) c.res[k] += v; for (const [k, v] of Object.entries(DISPOSITIONS[c.disp].startRes || {})) c.res[k] += v; S.resonance[id] = new Array(7).fill(0); S.staged[id] = []; }
  // capitals (player gets cap[0]; rivals shuffled onto the others using the seed)
  const capNames = NAMES.cityCap.slice(); const order = [1, 2, 3]; for (let i = 2; i > 0; i--) { const j = rint(S, i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  S.civOrder.forEach((id, i) => {
    const pos = map.caps[i === 0 ? 0 : order[i - 1]];
    const nm = capNames.splice(rint(S, capNames.length), 1)[0];
    const c = makeCity(S, id, pos.q, pos.r, { capital: true, name: nm }); S.civs[id].cap = c.id;
  });
  // independents
  map.indep.forEach((p, i) => { const c = makeCity(S, null, p.q, p.r, { name: NAMES.indep[i], ind: true, origin: 'independent' }); c.coh = 60; c.pop = 3; c.housing = 5; });
  // sites
  const ctr = { loom: 0, cradle: 0, anomaly: 0 };
  map.sites.forEach(s => {
    const id = nid(S, 's'); let name;
    const D = DISCOVERIES[s.type];
    if (s.type === 'meridian_spire') name = 'The Meridian Spire';
    else { name = D.name; if (s.type === 'weather_loom') name += ' ' + ['I', 'II'][ctr.loom++]; if (s.type === 'glass_cradle') name += ' ' + ['I', 'II'][ctr.cradle++]; if (s.type === 'anomaly') name = 'Anomaly ' + ['Alpha', 'Beta', 'Gamma'][ctr.anomaly++]; }
    S.sites[id] = { id, type: s.type, name, q: s.q, r: s.r, state: 'open', by: null, interp: null, invest: {}, found: {}, fragment: s.type === 'meridian_spire' ? null : (D.fragment + (s.type === 'anomaly' ? ' ' + name.split(' ')[1] : '')) };
    tileAt(S, s.q, s.r).site = id;
  });
  // legacy complications
  const leg = opts.legacy && !opts.fresh ? opts.legacy : null;
  S.legacy = leg ? { ...leg } : null;
  if (leg) applyLegacy(S, leg);
  // vision & discoveries
  S.initiative = {};
  updateVision(S);
  syncDiscoveries(S);
  // starting regions get at most a mild exposure near the player: keep the player's own capital region <=1 so the first run is learnable
  const pr = tileAt(S, S.cities[S.civs.you.cap].q, S.cities[S.civs.you.cap].r).region;
  if (S.regions[pr].exposure === 2) { const swap = S.regions.find(r => r.exposure === 0) || S.regions.find(r => r.exposure === 1); const t = S.regions[pr].exposure; S.regions[pr].exposure = swap.exposure; swap.exposure = t; }
  S.chronicle.push({ turn: 1, text: 'The Witness woke beside ' + S.cities[S.civs.you.cap].name + '.' });
  log(S, 'you', 'You awaken. The world has layers; this is the nearest one.', 1);
  return S;
}

function applyLegacy(S, leg) {
  const you = S.civs.you;
  if (leg.kind === 'ruin') {
    const cap = S.cities[you.cap];
    const cand = Object.values(S.map.tiles).filter(t => t.t !== 'lake' && !t.city && !t.site && dist(cap, t) >= 3 && dist(cap, t) <= 4 && !Object.values(S.sites).some(s => dist(s, t) < 2)).sort((a, b) => a.q - b.q || a.r - b.r);
    if (cand.length) { const t = cand[rint(S, cand.length)]; const id = nid(S, 's'); S.sites[id] = { id, type: 'legacy_ruin', name: leg.name || 'Named Ruin', q: t.q, r: t.r, state: 'open', by: null, interp: null, invest: {}, found: {}, fragment: leg.fragment || 'An Inherited Place-Name' }; t.site = id; you.mods.push({ id: 'ruin_obligation', label: 'Obligation to the Ruin', fx: { prodMem: -1 } }); }
  } else if (leg.kind === 'echo') { you.flags.echo = true; }
  else if (leg.kind === 'character') {
    you.res.mem += 4; you.mods.push({ id: 'former_ruler', label: 'Former ruler\'s expertise', fx: { prodMem: 1 }, expires: 11 });
    const r = RIVALS[rint(S, 3)]; S.relMem[pairKey('you', r)] = -10; you.flags.grievance = r;
  }
}

export const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
export const atWar = (S, a, b) => !!S.wars[pairKey(a, b)];

// ---------------- vision ----------------
export function sightSources(S, civId) {
  const out = [];
  for (const c of civCities(S, civId)) { const t = tileAt(S, c.q, c.r); out.push({ q: c.q, r: c.r, rad: 2 + (t.t === 'ridge' ? 1 : 0) }); }
  for (const t of Object.values(S.map.tiles)) if (t.outpost === civId && !t.city) out.push({ q: t.q, r: t.r, rad: 2 });
  for (const a of civArmies(S, civId)) { const t = tileAt(S, a.q, a.r); out.push({ q: a.q, r: a.r, rad: 2 + (TERRAIN_SIGHT(t)) }); }
  return out;
}
const TERRAIN_SIGHT = (t) => (t.t === 'ridge' ? 1 : 0);

export function updateVision(S) {
  for (const id of S.civOrder) {
    const civ = S.civs[id]; civ.obs = {};
    if (civ.eliminated) continue;
    for (const s of sightSources(S, id)) for (const h of within(s, s.rad)) { const k = key(h.q, h.r); if (S.map.tiles[k]) { civ.obs[k] = 1; civ.seen[k] = 1; } }
    // last-known enemy armies
    for (const a of Object.values(S.armies)) {
      if (a.owner === id) continue; const k = key(a.q, a.r);
      if (civ.obs[k]) civ.lastKnown[a.id] = { q: a.q, r: a.r, turn: S.turn, owner: a.owner, str: a.regs.reduce((s, r) => s + r.str, 0) };
    }
    for (const [aid, lk] of Object.entries(civ.lastKnown)) { if (!S.armies[aid]) delete civ.lastKnown[aid]; else if (civ.obs[key(lk.q, lk.r)] && (S.armies[aid].q !== lk.q || S.armies[aid].r !== lk.r)) delete civ.lastKnown[aid]; }
  }
}
export function revealRange(S, civ, center, range, dry = false) { // survey: BFS from an observed tile, not crossing impassable terrain
  const seen = new Set([key(center.q, center.r)]); let frontier = [center]; let n = 0;
  if (!dry) civ.seen[key(center.q, center.r)] = 1;
  for (let step = 0; step < range; step++) {
    const next = [];
    for (const f of frontier) for (const nb of neighbors(f.q, f.r)) {
      const k = key(nb.q, nb.r); const t = S.map.tiles[k]; if (!t || seen.has(k)) continue; seen.add(k);
      if (!civ.seen[k]) n++; if (!dry) civ.seen[k] = 1;
      if (t.t !== 'lake') next.push(nb);
    }
    frontier = next;
  }
  return n;
}

export function syncDiscoveries(S) {
  for (const civ of Object.values(S.civs)) {
    if (civ.eliminated) continue;
    for (const s of Object.values(S.sites)) {
      if (s.type === 'meridian_spire') continue;
      const k = key(s.q, s.r);
      if (!civ.seen[k] || civ.disc[s.id]) continue;
      civ.disc[s.id] = { turn: S.turn, state: s.state === 'open' ? 'pending' : 'gone' };
      if (civ.id === 'you') { log(S, 'you', `Discovered: ${s.name}.`, 2); if (s.type === 'legacy_ruin') civ.mods = civ.mods.filter(m => m.id !== 'ruin_obligation'); }
    }
  }
}

export function ageOf(turn) { return turn <= CFG.ageBounds[0] ? 0 : turn <= CFG.ageBounds[1] ? 1 : 2; }
export function cloneState(S) { return JSON.parse(JSON.stringify(S)); }
