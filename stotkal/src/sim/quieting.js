// The Quieting: schedule, readable regional exposure, bounded severity, escalations and regional crises.
import { CFG, REGION_NAMES, DISTRICTS } from '../data/content.js';
import { key } from './hex.js';
import { rnd, rint } from './rng.js';
import { civCities, tileAt, fx, hasTech, effExposure, protectionBands, severity, totalResonance, civResonance, flag, hasInst } from './economy.js';
import { log } from './state.js';
import { addFragment } from './council.js';

export function forecastLevel(S, civId) {
  const early = civId ? flag(S, S.civs[civId], 'earlyForecast') : false;
  const t = S.turn;
  if (t >= CFG.quieting.revealTurn || S.quiet.revealed || (early && t >= 8)) return 2;
  if (t >= CFG.quieting.firstForecast) return 1;
  return 0;
}
// Resonance Analysis: a plain linear projection from the recent history of the world total (shown, never hidden-modified).
export function resonanceProjection(S, civId = 'you') {
  if (!(fx(S, S.civs[civId], 'resonanceSight') > 0)) return null;
  const h = (S.resHistory || []).slice(-4); if (h.length < 2) return null;
  const rate = (h[h.length - 1] - h[0]) / (h.length - 1); const left = CFG.turns - S.turn + 1;
  return { rate: Math.round(rate * 10) / 10, final: Math.max(0, Math.round(totalResonance(S) + rate * left)) };
}
export function regionReport(S, civId) {
  const lvl = forecastLevel(S, civId);
  return S.regions.map((r, i) => {
    const byCiv = {}; for (const id of S.civOrder) byCiv[id] = S.resonance[id][i];
    return { id: i, name: REGION_NAMES[i], exposure: lvl >= 2 ? r.exposure : lvl === 1 ? (r.exposure > 0 ? 1 : 0) : null, exact: lvl >= 2, byCiv, total: Object.values(byCiv).reduce((a, b) => a + b, 0) };
  });
}
// Projected consequences for a city at each escalation, using the real formulas (also used by resolution).
export function cityEffects(S, city, stage, sev) {
  const e = effExposure(S, city); const out = { exposure: e, outMult: 1, cohLoss: 0, popLoss: 0, archives: false };
  if (e <= 0) return out;
  if (stage >= 1) out.outMult = Math.max(0.25, 1 - 0.25 * sev * (e >= 2 ? 1.3 : 1));
  if (stage >= 2) out.cohLoss = 6 * sev;
  if (stage >= 3) { out.popLoss = Math.min(city.pop - 1, e >= 2 ? sev + 1 : sev); out.cohLoss += 8 * sev; out.archives = true; }
  return out;
}
export function projection(S, civId) {
  const sev = severity(S); const rows = [];
  for (const c of civCities(S, civId)) {
    const fin = cityEffects(S, c, 3, sev); const reg = S.regions[tileAt(S, c.q, c.r).region];
    rows.push({ city: c, region: REGION_NAMES[reg.id], exposure: reg.exposure, protectedBy: protectionBands(S, c), eff: fin.exposure, losses: fin });
  }
  return { severity: sev, total: totalResonance(S), rows, nextEscalation: CFG.quieting.escalations.find(t => t >= S.turn) || null };
}

export function quietingPhase(S) {
  const T = S.turn; const Q = S.quiet; const N = T + 1;
  if (N === CFG.quieting.firstForecast) log(S, 'you', 'Forecast issued: the Quieting is coming. Escalations at turns 22, 26 and 30. Regional exposure is now shown on the map.', 2, { pub: true });
  if (N === CFG.quieting.revealTurn) { Q.revealed = true; log(S, 'you', `Quieting severity is now readable: ${severity(S)} of 3. Exact regional exposure revealed.`, 2, { pub: true }); }
  if (CFG.quieting.escalations.some(e => N === e - 2)) {
    const n = CFG.quieting.escalations.find(x => x - 2 === N); log(S, 'you', `Warning: escalation ${CFG.quieting.escalations.indexOf(n) + 1} arrives on turn ${n}. See the forecast panel for likely losses and responses.`, 2);
  }
  const sev = severity(S);
  const idx = CFG.quieting.escalations.indexOf(T);
  if (idx >= 0) {
    Q.stage = idx + 1;
    for (const civId of S.civOrder) {
      for (const c of civCities(S, civId)) {
        const eff = cityEffects(S, c, Q.stage, sev); if (eff.exposure <= 0) { if (civId === 'you') log(S, 'you', `${c.name} is protected from escalation ${Q.stage}.`, 1); continue; }
        if (Q.stage === 1 && civId === 'you') log(S, 'you', `Escalation 1: powered districts in ${c.name} dim to ${Math.round(eff.outMult * 100)}% output.`, 2);
        if (Q.stage >= 2) { c.coh = Math.max(0, c.coh - 6 * sev); if (civId === 'you') log(S, 'you', `Escalation ${Q.stage}: ${c.name} loses ${6 * sev} Coherence.`, 2); }
        if (Q.stage === 2) { // some connections become vulnerable
          if (c.districts.some(d => d.type === 'conduit')) severConduit(S, civId, c);
        }
        if (Q.stage === 3) {
          const lose = eff.popLoss; c.pop = Math.max(1, c.pop - lose); c.coh = Math.max(0, c.coh - 8 * sev);
          const arc = c.districts.findIndex(d => d.type === 'archive'); if (arc >= 0 && !c.works.seal) { c.districts.splice(arc, 1); if (civId === 'you') log(S, 'you', `${c.name}'s unsealed Archive went silent.`, 2); S.civs[civId].stats.lost++; }
          if (civId === 'you') { log(S, 'you', `The final Quieting reaches ${c.name}: population -${lose}, Coherence -${8 * sev}.`, 2); S.chronicle.push({ turn: T, text: `${c.name} lost ${lose} of its people to the final Quieting.`, tag: 'sacrifice' }); }
        }
      }
    }
  }
  // regional crises (small set, cooldowns, bounded) from turn 16
  if (T >= 16 && T % CFG.quieting.crisisCooldown === 1) {
    for (const civId of S.civOrder) {
      const cands = civCities(S, civId).filter(c => effExposure(S, c) > 0);
      if (!cands.length) continue; const c = cands[rint(S, cands.length)]; const reg = tileAt(S, c.q, c.r).region;
      if ((Q.cd[reg] || 0) > T) continue; Q.cd[reg] = T + CFG.quieting.crisisCooldown + 2;
      const civ = S.civs[civId];
      if (c.districts.some(d => d.type === 'conduit')) severConduit(S, civId, c);
      else if (c.districts.some(d => d.type === 'archive')) { c.coh = Math.max(0, c.coh - 6); if (civId === 'you') log(S, 'you', `Crisis in ${c.name}: incompatible memories resurface. -6 Coherence.`, 2); }
      else { const out = Object.values(S.map.tiles).find(t => t.outpost === civId && effExposure(S, c) > 0); if (out) { out.outpostDown = T + 2; if (civId === 'you') log(S, 'you', `Crisis: the route through ${REGION_NAMES[reg]} is failing; an outpost goes dark for 2 turns.`, 2); } }
    }
  }
}
function severConduit(S, civId, city) {
  const civ = S.civs[civId];
  if (fx(S, civ, 'netRepairInstant') > 0) { if (civId === 'you') log(S, 'you', `A conduit near ${city.name} was severed and healed at once (Network Recovery).`, 1); return; }
  city.disabled.conduit = fx(S, civ, 'repairFree') > 0 ? 1 : 3;
  if (civId === 'you') log(S, 'you', `A conduit at ${city.name} was severed. It repairs in ${city.disabled.conduit} turn(s).`, 2);
}
