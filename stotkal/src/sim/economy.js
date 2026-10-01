// Economy: sources of modifiers, per-city yields, upkeep, shortage allocation, coherence breakdown, connectivity.
import { CFG, TERRAIN, DISTRICTS, TRADITIONS, DISPOSITIONS, TECHS, INSTITUTIONS, COMBOS } from '../data/content.js';
import { key, parse, dist, neighbors } from './hex.js';

export const RES = ['sus', 'mat', 'ene', 'mem'];
export const zero = () => ({ sus: 0, mat: 0, ene: 0, mem: 0 });
export const add = (a, b, m = 1) => { for (const k of RES) a[k] = (a[k] || 0) + (b[k] || 0) * m; return a; };
export const canPay = (have, cost) => RES.every(k => (have[k] || 0) >= (cost[k] || 0));
export const tileAt = (S, q, r) => S.map.tiles[key(q, r)];
export const civCities = (S, civId) => Object.values(S.cities).filter(c => c.owner === civId);
export const civArmies = (S, civId) => Object.values(S.armies).filter(a => a.owner === civId);
export const hasTech = (civ, id) => !!civ.techs[id];
export const hasInst = (civ, id) => civ.inst.some(s => s && s.id === id);

export function sources(S, civ) {
  const out = [];
  if (civ.tradition) out.push({ src: 'tradition', label: TRADITIONS[civ.tradition].name, fx: TRADITIONS[civ.tradition].fx });
  if (civ.disp) out.push({ src: 'disposition', label: DISPOSITIONS[civ.disp].name, fx: DISPOSITIONS[civ.disp].fx });
  for (const s of civ.inst) if (s) out.push({ src: 'institution', label: INSTITUTIONS[s.id].name, fx: INSTITUTIONS[s.id].fx });
  for (const t of Object.keys(civ.techs)) if (TECHS[t].fx) out.push({ src: 'tech', label: TECHS[t].name, fx: TECHS[t].fx });
  for (const [id, c] of Object.entries(COMBOS)) if (hasInst(civ, c.needs.inst) && hasTech(civ, c.needs.tech)) out.push({ src: 'combo', label: c.name, fx: c.fx });
  for (const m of civ.mods) out.push({ src: 'boon', label: m.label || m.id, fx: m.fx });
  return out;
}
export const fx = (S, civ, k) => sources(S, civ).reduce((a, s) => a + (s.fx[k] || 0), 0);
export const flag = (S, civ, k) => fx(S, civ, k) > 0;
export function fxSources(S, civ, k) { return sources(S, civ).filter(s => s.fx[k]).map(s => `${s.label} ${s.fx[k] > 0 ? '+' : ''}${s.fx[k]}`); }

// ---------- territory / connectivity ----------
export function hasTreaty(S, a, b, kind) {
  return S.treaties.some(t => t.active && t.kind === kind && ((t.a === a && t.b === b) || (t.a === b && t.b === a)));
}
export function passageOK(S, civId, tile) {
  return tile.owner && tile.owner !== civId && tile.owner !== 'ind' && hasTreaty(S, civId, tile.owner, 'passage');
}
export function passableForNetwork(S, civId, t) {
  if (!TERRAIN[t.t].passable) return false;
  return t.owner === civId || passageOK(S, civId, t);
}
// Returns map cityId -> component index among tiles the civ controls (or has passage through).
export function components(S, civId) {
  const comp = {}; let idx = 0; const seen = new Set();
  const cities = civCities(S, civId);
  for (const c of cities) {
    if (comp[c.id] !== undefined) continue;
    const st = [key(c.q, c.r)]; seen.add(st[0]);
    while (st.length) {
      const k = st.pop(); const { q, r } = parse(k);
      const t = S.map.tiles[k];
      if (t.city && S.cities[t.city].owner === civId) comp[t.city] = idx;
      for (const n of neighbors(q, r)) {
        const nk = key(n.q, n.r); const nt = S.map.tiles[nk];
        if (nt && !seen.has(nk) && passableForNetwork(S, civId, nt)) { seen.add(nk); st.push(nk); }
      }
    }
    idx++;
  }
  return comp;
}
export const connectedToCapital = (S, civId, cityId, comp) => {
  const civ = S.civs[civId]; comp = comp || components(S, civId);
  return civ.cap && comp[civ.cap] !== undefined && comp[civ.cap] === comp[cityId];
};

export function cityTiles(S, city) {
  const out = [S.map.tiles[key(city.q, city.r)]];
  for (const n of neighbors(city.q, city.r)) { const t = S.map.tiles[key(n.q, n.r)]; if (t && t.owner === city.owner) out.push(t); }
  return out;
}
// Tile -> city assignment for claimed tiles (nearest owned city within 2; ties lowest id).
export function tileCity(S, t) {
  let best = null, bd = 99;
  for (const c of civCities(S, t.owner)) { const d = dist(c, t); if (d < bd || (d === bd && c.id < best.id)) { bd = d; best = c; } }
  return bd <= 2 ? best : null;
}
export function slotCount(city) { return city.capital ? CFG.capitalSlots : CFG.citySlots; }
export function nearestCity(S, civId, pos, maxD = 99, exclude) {
  let best = null, bd = 1e9;
  for (const c of civCities(S, civId)) { if (exclude && c.id === exclude) continue; const d = dist(c, pos); if (d < bd) { bd = d; best = c; } }
  return bd <= maxD ? best : null;
}

// ---------- quieting helpers used by economy ----------
export function protectionBands(S, city) {
  const civ = S.civs[city.owner]; if (!civ) return 0;
  let bands = 0;
  const stabBands = 1 + (hasTech(civ, 'regional_stabilization') ? 1 : 0);
  if (city.works.stabilization) bands += stabBands;
  if (city.works.vessel) bands += 1;
  for (const sl of civ.inst) if (sl && sl.id === 'cradle_seal') { const site = S.sites[sl.site]; const n = site && nearestCity(S, city.owner, site); if (n && n.id === city.id) bands += 1; }
  // adjacent connected settlement protected by a neighbour's Stabilization (one band)
  const comp = components(S, city.owner);
  for (const o of civCities(S, city.owner)) {
    if (o.id === city.id || !o.works.stabilization) continue;
    const near = nearestCity(S, city.owner, o, CFG.citySpacing + 1, o.id);
    if (near && near.id === city.id && comp[o.id] === comp[city.id]) bands += 1;
  }
  if (civ.flagsProtectCap && civ.cap === city.id) bands += 1;
  return bands;
}
export function effExposure(S, city) {
  const reg = S.regions[S.map.tiles[key(city.q, city.r)].region];
  return Math.max(0, reg.exposure - protectionBands(S, city));
}
export function severity(S) {
  const tot = totalResonance(S);
  return 1 + CFG.quieting.thresholds.filter(t => tot >= t).length;
}
export function totalResonance(S) { let s = 0; for (const c of Object.values(S.resonance)) for (const v of c) s += v; return s; }
export function civResonance(S, id) { return (S.resonance[id] || []).reduce((a, b) => a + b, 0); }
function quietOutMult(S, city) {
  if (S.quiet.stage < 1) return 1;
  const e = effExposure(S, city); if (e <= 0) return 1;
  return Math.max(0.25, 1 - 0.25 * severity(S) * (e >= 2 ? 1.3 : 1));
}

// ---------- city economy ----------
export function districtOut(S, civ, city, d, comp) {
  // returns {out, up, label, resonance} for one operating district
  const D = DISTRICTS[d.type]; const out = zero(), up = zero();
  if (D.out) add(out, D.out);
  if (D.upkeep) add(up, D.upkeep);
  const lab = D.name;
  if (d.type === 'garden') {
    const gt = cityTiles(S, city).filter(t => t.t === 'garden').length;
    out.sus += Math.min(2, Math.max(0, gt - 1)) + fx(S, civ, 'gardenSus');
  }
  if (d.type === 'archive') out.mem += fx(S, civ, 'archiveMem') + Math.floor(civ.fragments.length * fx(S, civ, 'fragMem'));
  if (d.type === 'conduit') {
    const infra = cityTiles(S, city).filter(t => t.t === 'infra').length;
    out.ene += fx(S, civ, 'conduitEne') + (infra >= 2 ? 1 : 0);
    if (city.disabled.conduit > 0) { out.ene = 0; }
    if (fx(S, civ, 'connectedEne') > 0 && civCities(S, civ.id).length > 1) out.ene += fx(S, civ, 'connectedEne') * (Object.values(comp || {}).filter(c => c === comp?.[civ.cap]).length - 1 > 0 ? 1 : 0);
  }
  let res = 0;
  if (DISTRICTS[d.type].resonance) res = Math.max(0, DISTRICTS[d.type].resonance + fx(S, civ, 'foundryRes'));
  return { out, up, res, label: lab };
}

export function cohCut(coh) { return coh >= CFG.coherence.normal ? 0 : coh >= CFG.coherence.low ? CFG.coherence.lowCut : CFG.coherence.critCut; }

export function cityHousing(S, civ, city) {
  let h = city.capital ? CFG.start.housing : CFG.colony.housing;
  h += city.districts.filter(d => d.type === 'reservoir').length * DISTRICTS.reservoir.housing;
  h += fx(S, civ, 'housingEach');
  return h;
}

export function computeEconomy(S, civId, opts = {}) {
  const civ = S.civs[civId]; const cities = civCities(S, civId);
  const comp = components(S, civId);
  const items = []; // {label,res,amt,city?}
  const net = zero();
  const cityRes = {}; const paused = []; const pausedSet = new Set();
  const push = (label, res, amt, cid) => { if (!amt) return; items.push({ label, res, amt, city: cid || null }); net[res] += amt; if (cid) { cityRes[cid] = cityRes[cid] || zero(); cityRes[cid][res] += amt; } };
  const armies = civArmies(S, civId);
  const energyStock = civ.res.ene;
  const emergencyShutdown = civ.emergency === 'shutdown';
  const rationing = civ.emergency === 'ration';

  const compute = (pausedSetIn) => {
    items.length = 0; for (const k of RES) net[k] = 0; for (const k in cityRes) delete cityRes[k];
    let resonanceOps = {};
    for (const c of cities) {
      const base = c.capital ? CFG.capProd : CFG.colProd;
      const cut = cohCut(c.coh) + (c.crisis ? 0.3 : 0);
      const cutAmt = (a) => Math.floor(a * Math.min(0.7, cut) + 1e-9);
      const qm = quietOutMult(S, c);
      let produced = zero();
      for (const k of RES) produced[k] += base[k];
      // claimed tiles
      for (const t of S.map.tiles ? Object.values(S.map.tiles) : []) {
        if (t.owner !== civId || (t.outpost && !t.city)) continue;
        const tc = tileCity(S, t); if (!tc || tc.id !== c.id) continue;
        const Y = TERRAIN[t.t].yield; for (const k of RES) produced[k] += Y[k] || 0;
        if (t.t === 'coast') produced.ene += fx(S, civ, 'coastEne');
      }
      const ups = zero(); let resAdd = 0;
      for (let i = 0; i < c.districts.length; i++) {
        const d = c.districts[i]; const D = DISTRICTS[d.type];
        if (pausedSetIn.has(c.id + ':' + i)) continue;
        const o = districtOut(S, civ, c, d, comp);
        const m = D.powered ? qm : 1;
        for (const k of RES) { produced[k] += o.out[k] * m; ups[k] += o.up[k]; }
        if (m < 1 && D.out) items.push({ label: 'Quieting damps ' + D.name, res: 'ene', amt: 0, city: c.id, note: true });
        resAdd += o.res;
      }
      // coherence cut on non-sustenance output
      const cutLabel = c.crisis ? 'Local crisis' : 'Dislocation';
      for (const k of RES) {
        const amt = produced[k];
        if (!amt) continue;
        if (k !== 'sus' && cut > 0) { const loss = cutAmt(amt); push(`${c.name} output`, k, amt - loss, c.id); if (loss) push(`${cutLabel} (${Math.round(Math.min(0.7, cut) * 100)}%) in ${c.name}`, k, 0, c.id); }
        else push(`${c.name} output`, k, amt, c.id);
      }
      for (const k of RES) if (ups[k]) push(`${c.name} district upkeep`, k, -ups[k], c.id);
      // population & maintenance
      const popUp = rationing ? Math.ceil(c.pop * CFG.popUpkeepSus * (1 - CFG.rationing.susCut)) : c.pop * CFG.popUpkeepSus;
      push(`${c.name} population${rationing ? ' (rationed)' : ''}`, 'sus', -popUp, c.id);
      push(`${c.name} maintenance`, 'ene', -CFG.cityMaintEne, c.id);
      if (!c.capital) push(`${c.name} integration upkeep`, 'ene', -CFG.newCityUpkeepEne, c.id);
      if (c.federated) push(`${c.name} federation stipend`, 'sus', -1, c.id);
      if (resAdd) resonanceOps[c.id] = resAdd;
    }
    // civ-level
    for (const k of RES) { const v = fx(S, civ, 'prod' + k[0].toUpperCase() + k.slice(1)); if (v) push('Institutions & boons', k, v); }
    if (cities.length >= CFG.wideFrom) push('Wide-empire pressure', 'ene', -(cities.length - CFG.wideFrom + 1) * CFG.wideExtraEne);
    const up = fx(S, civ, 'upkeepEne'); if (up) push('Witness maintenance demands', 'ene', -up);
    if (fx(S, civ, 'connectedEne') > 0) { const cc = Object.values(comp).filter(x => x === comp[civ.cap]).length - 1; if (cc > 0) push('Circuit: connected cities', 'ene', cc * fx(S, civ, 'connectedEne')); }
    const regs = armies.reduce((a, ar) => a + ar.regs.length, 0); if (regs) push('Regiment upkeep', 'ene', -regs * CFG.regimentUpkeepEne);
    const outs = Object.values(S.map.tiles).filter(t => t.outpost === civId && !t.city).length; if (outs) push('Outpost upkeep', 'ene', -outs * CFG.outpostUpkeepEne);
    // trade treaties
    for (const t of S.treaties) if (t.active && t.kind === 'trade' && (t.a === civId || t.b === civId)) {
      const ex = cities.reduce((a, c) => a + c.districts.filter(d => d.type === 'exchange').length, 0);
      push('Trade agreement', 'ene', 1 + 2 * ex); push('Trade agreement', 'mat', 1 + 2 * ex);
    }
    for (const t of S.treaties) if (t.active && t.kind === 'shutdown' && t.payer === civId) push('Shutdown compensation (paid)', 'ene', -t.pay);
    for (const t of S.treaties) if (t.active && t.kind === 'shutdown' && t.partner === civId) push('Shutdown compensation (received)', 'ene', t.pay);
    return resonanceOps;
  };

  for (const t of S.treaties) if (t.active && t.kind === 'shutdown' && t.partner === civId) for (const c of cities) c.districts.forEach((d, i) => { if (d.type === 'foundry') pausedSet.add(c.id + ':' + i); });
  let resOps = compute(pausedSet);
  // energy shortage: pause optional powered structures in order bulwark -> archive -> foundry (never life support).
  if (emergencyShutdown) {
    for (const c of cities) c.districts.forEach((d, i) => { if (DISTRICTS[d.type].powered) { pausedSet.add(c.id + ':' + i); paused.push({ city: c.id, idx: i, type: d.type }); } });
    resOps = compute(pausedSet);
  }
  const order = ['bulwark', 'archive', 'foundry'];
  for (const type of order) {
    for (const c of cities) c.districts.forEach((d, i) => {
      if (energyStock + net.ene >= 0) return;
      if (d.type === type && !pausedSet.has(c.id + ':' + i)) { pausedSet.add(c.id + ':' + i); paused.push({ city: c.id, idx: i, type }); resOps = compute(pausedSet); }
    });
  }
  // sustenance deficit allocation
  const susAfter = civ.res.sus + net.sus; const deficit = susAfter < 0 ? -susAfter : 0;
  const shortCities = {};
  if (deficit > 0) {
    const pol = civ.rationPolicy || 'even'; let left = deficit;
    const list = cities.slice().sort((a, b) => pol === 'capital' ? (a.capital ? 1 : 0) - (b.capital ? 1 : 0) || b.pop - a.pop : b.pop - a.pop || a.id.localeCompare(b.id));
    if (pol === 'capital') { for (const c of list) { const take = Math.min(left, c.pop); if (take > 0) { shortCities[c.id] = take; left -= take; } } }
    else { const totalPop = cities.reduce((a, c) => a + c.pop, 0) || 1; for (const c of list) { const share = Math.min(left, Math.ceil(deficit * c.pop / totalPop)); if (share > 0) { shortCities[c.id] = share; left -= share; } } }
  }
  const resonance = {}; for (const [cid, v] of Object.entries(resOps)) if (!pausedSet.has(cid)) resonance[cid] = v;
  return { net, items, paused, deficit, shortCities, cityRes, resonance, comp };
}

// Visible allocation and explanations of coherence change for one city this turn.
export function cohBreakdown(S, city, econ) {
  const civ = S.civs[city.owner]; const items = [];
  if (!civ) return { items, delta: 0 };
  const comp = econ ? econ.comp : components(S, civ.id);
  const conn = connectedToCapital(S, civ.id, city.id, comp);
  const ncity = civCities(S, civ.id).length;
  if (city.coh < CFG.colony.recoverBelow) items.push({ label: 'Natural recovery', amt: CFG.colony.recoverStep });
  const sanct = city.districts.filter(d => d.type === 'sanctuary').length;
  const cap = CFG.coherence.sanctCap + (hasTech(civ, 'civic_architecture') ? 5 : 0);
  if (sanct && city.coh < cap) items.push({ label: 'Sanctuary', amt: Math.min(cap - city.coh, sanct * (DISTRICTS.sanctuary.coh + fx(S, civ, 'sanctBonus'))) });
  const ca = fx(S, civ, 'cohAll'); if (ca) items.push({ label: 'Institutions', amt: ca });
  const cc = fx(S, civ, 'cohConnected');
  if (cc && ncity > 1 && conn) items.push({ label: 'Connected network', amt: cc });
  const bl = fx(S, civ, 'brokenLinkCoh');
  if (bl && ncity > 1 && !conn && !civ.flagsNetRepair) items.push({ label: 'Broken capital connection', amt: -bl });
  const dc = fx(S, civ, 'disconnectedCoh');
  if (dc && ncity > 1 && !conn) items.push({ label: 'Cut off from the capital', amt: -dc });
  if (city.capital) { const c = fx(S, civ, 'capCohTurn'); if (c) items.push({ label: 'Verification fatigue', amt: c }); }
  if (civ.emergency === 'ration') items.push({ label: 'Emergency rationing', amt: -CFG.rationing.cohCost });
  if (econ && econ.shortCities[city.id]) { const res = city.districts.some(d => d.type === 'reservoir'); items.push({ label: res ? 'Shortage (Reservoir absorbs)' : 'Sustenance shortage', amt: res ? 0 : -CFG.coherence.shortagePenalty }); }
  if (S.quiet.stage >= 2) { const e = effExposure(S, city); if (e > 0) items.push({ label: 'Quieting erodes unprotected city', amt: -2 * severity(S) }); }
  const delta = items.reduce((a, b) => a + b.amt, 0);
  return { items, delta, conn };
}
