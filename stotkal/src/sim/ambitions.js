// Ambition requirements and success evaluation. Rivals use the same function.
import { CFG, AMBITIONS, TECHS, DISTRICTS, INSTITUTIONS } from '../data/content.js';
import { key } from './hex.js';
import { civCities, hasTech, hasInst, components, connectedToCapital, effExposure, totalResonance, hasTreaty, tileAt, fx } from './economy.js';

const settlements = (S, civ) => civCities(S, civ.id).filter(c => !c.federated || c.fedMet !== false);
export function shelters(S, civ) {
  let n = civCities(S, civ.id).reduce((a, c) => a + (c.works.vessel ? 1 : 0) + (c.works.stabilization ? 1 : 0), 0);
  n += civ.inst.filter(s => s && INSTITUTIONS[s.id].fx.shelter).length; return n;
}
export function sealedArchives(S, civ) {
  let n = civCities(S, civ.id).filter(c => c.works.seal && c.districts.some(d => d.type === 'archive')).length;
  if (fx(S, civ, 'monolithSealed') > 0) n++; else if (hasInst(civ, 'testimony_stone') && hasTech(civ, 'archive_sealing')) n++;
  return n;
}
export function participating(S, civ) {
  const comp = components(S, civ.id);
  if (!(hasInst(civ, 'voluntary_network') || hasInst(civ, 'choir'))) return [];
  return civCities(S, civ.id).filter(c => c.consent !== false && connectedToCapital(S, civ.id, c.id, comp));
}
export function spireAccess(S, civ) {
  const s = Object.values(S.sites).find(x => x.type === 'meridian_spire'); const t = tileAt(S, s.q, s.r);
  if (t.owner === civ.id) return 'controlled'; if (t.owner && t.owner !== 'ind' && hasTreaty(S, civ.id, t.owner, 'passage')) return 'treaty'; return null;
}
const part = (label, cur, need, ok, note) => ({ label, cur, need, ok: ok === undefined ? cur >= need : ok, note: note || '' });

export function evaluate(S, civId, id, final = false) {
  const civ = S.civs[civId]; const cs = civCities(S, civId); const parts = [];
  if (id === 'embodied') {
    const st = settlements(S, civ);
    parts.push(part('Inhabited settlements', st.length, 3));
    parts.push(part('Protected from the final Quieting', st.filter(c => effExposure(S, c) <= 0).length, 2, undefined, 'Safe regions count; exposed ones need Stabilization, a Vessel, or shelter.'));
    parts.push(part('Vessels / regional shelters', shelters(S, civ), 2));
    const pop = st.reduce((a, c) => a + c.pop, 0); parts.push(part('Total population', pop, 10));
    const avg = st.length ? Math.round(st.reduce((a, c) => a + c.coh, 0) / st.length) : 0; parts.push(part('Mean Coherence', avg, 50));
  } else if (id === 'shared') {
    parts.push(part('Distributed Embodiment researched', hasTech(civ, 'distributed_embodiment') ? 1 : 0, 1));
    const pt = participating(S, civ); parts.push(part('Connected participating settlements', pt.length, 3, undefined, hasInst(civ, 'voluntary_network') || hasInst(civ, 'choir') ? '' : 'Install the Voluntary Network (or Become the Choir) first.'));
    const nodes = cs.filter(c => c.works.anchor && c.coh > 0 && effExposure(S, c) <= 0); parts.push(part('Functioning anchor nodes', nodes.length, 2));
    const avg = pt.length ? Math.round(pt.reduce((a, c) => a + c.coh, 0) / pt.length) : 0; parts.push(part('Network Coherence', avg, 60));
  } else if (id === 'record') {
    parts.push(part('Protected (sealed) Archives', sealedArchives(S, civ), 2));
    const cats = new Set(civ.fragments.map(f => f.cat)); parts.push(part('Named fragments', civ.fragments.length, 5)); parts.push(part('Fragment source categories', cats.size, 3));
    parts.push(part('Archive Sealing researched', hasTech(civ, 'archive_sealing') ? 1 : 0, 1));
    parts.push(part('Functioning protected record', (sealedArchives(S, civ) >= 1 || fx(S, civ, 'protectedRecord') > 0) ? 1 : 0, 1, undefined, 'A sealed Archive or the Monolith record node. Fragments are preserved, not spent.'));
  } else if (id === 'break') {
    parts.push(part('Resonance Analysis', hasTech(civ, 'resonance_analysis') ? 1 : 0, 1)); parts.push(part('Cycle Interruption', hasTech(civ, 'cycle_interruption') ? 1 : 0, 1));
    parts.push(part('Anomaly sites investigated', civ.investigated, 3)); parts.push(part('Stabilization projects complete', civ.stabDone || 0, 2));
    const hist = S.resHistory || []; const last3 = hist.slice(-3); const okR = last3.length >= 3 && last3.every(v => v < CFG.quieting.interruptThreshold);
    parts.push(part(`Total Resonance < ${CFG.quieting.interruptThreshold} for the final 3 turns`, totalResonance(S), CFG.quieting.interruptThreshold, final ? okR : totalResonance(S) < CFG.quieting.interruptThreshold, `Now ${totalResonance(S)}`));
    parts.push(part('Meridian Spire access', spireAccess(S, civ) ? 1 : 0, 1, undefined, spireAccess(S, civ) || 'Claim the tile or hold a passage treaty with its owner.'));
  }
  const ok = parts.every(p => p.ok);
  const frac = parts.reduce((a, p) => a + Math.min(1, p.need ? p.cur / p.need : 1), 0) / parts.length;
  return { id, parts, ok, frac };
}
export const ambitionTechs = (id) => AMBITIONS[id].techs;
