// "Next Move" advisor: the three things most worth doing now, in plain language. Pure read of the state.
import { CFG, DISTRICTS, DISCOVERIES, TECHS, AMBITIONS } from '../data/content.js';
import { THREAT_KINDS } from '../data/action.js';
import { key, dist, neighbors } from './hex.js';
import { civCities, computeEconomy, tileAt, cityTiles, slotCount, effExposure, hasTech, cityHousing } from './economy.js';
import { threatList, threatForecast } from './threats.js';
import { expeditionSites, pendingTop } from './run.js';
import { heroDistMap, heroStats } from './hero.js';
import { validate } from './commands.js';
import { isCouncilTurn } from './council.js';
import { forecastLevel } from './quieting.js';
import { TERRAIN } from '../data/content.js';

export function suggestDistrict(S, city) {
  const you = S.civs.you; const e = computeEconomy(S, 'you'); const has = (t) => city.districts.some(d => d.type === t);
  const infra = cityTiles(S, city).some(t => t.t === 'infra'); const threatened = threatList(S).some(t => t.target === city.id);
  const opts = [];
  if (e.net.sus < 2 && !has('garden')) opts.push(['garden', 'Food is tight.']);
  if (threatened && !has('bulwark')) opts.push(['bulwark', 'Raiders are heading here.']);
  if (e.net.ene < 1 && infra && !has('conduit')) opts.push(['conduit', 'Energy is running thin and there is a conduit source here.']);
  if (e.net.mem < 3 && !has('archive')) opts.push(['archive', 'Memory (research) is slow.']);
  if (e.net.mat < 5 && !has('foundry')) opts.push(['foundry', 'Matter limits everything you build.']);
  if (city.coh < 60 && !has('sanctuary')) opts.push(['sanctuary', 'Coherence is low.']);
  if (city.pop >= cityHousing(S, you, city) - 1 && !has('reservoir')) opts.push(['reservoir', 'The city is nearly full.']);
  if (!has('garden')) opts.push(['garden', 'A Garden keeps people fed.']);
  if (!has('archive')) opts.push(['archive', 'An Archive feeds research.']);
  opts.push(['sanctuary', 'Steady the people.']);
  for (const [d, why] of opts) { if (city.districts.length >= slotCount(city) && !city.capital) continue; const cmd = { type: 'develop', city: city.id, what: 'district:' + d }; if (!validate(S, 'you', cmd)) return { district: d, why, cmd }; }
  return null;
}

export function advise(S, opts = {}) {
  const you = S.civs.you; const out = []; const add = (p) => out.push(p); const h = S.hero; const cities = civCities(S, 'you'); if (!cities.length || S.over) return [];
  const staged = S.staged.you; const e = computeEconomy(S, 'you'); const { dst } = heroDistMap(S); const st = heroStats(S);
  const pend = pendingTop(S); if (pend) add({ prio: 100, icon: '❖', text: 'A decision is waiting.', hint: 'Resolve it to continue.', act: { kind: 'pending' } });
  for (const th of threatList(S)) { if (!you.obs[key(th.q, th.r)]) continue; const c = S.cities[th.target]; if (!c || c.owner !== 'you') continue; const f = threatForecast(S, th); if (f.outcome === 'holds') continue; const K = THREAT_KINDS[th.kind];
    add({ prio: 90, icon: '⚔', text: `${K.name} (power ${th.power}) reach ${c.name} in ${f.eta + 1} turn(s).`, hint: `Defence ${f.defense}: it would ${f.outcome === 'breach' ? 'be breached' : 'be shaken'}. Build a Bulwark, recruit a Warden, or stand there (+2).`, act: { kind: 'select', q: c.q, r: c.r } }); }
  const near = expeditionSites(S)[0]; if (near && h.hp >= 3) add({ prio: 85, icon: '✦', text: `Enter ${near.name}.`, hint: `You are standing beside it. Rooms test Wit, Mettle, Guard and Stride; the reward is yours to interpret.`, act: { kind: 'enter', site: near.id } });
  if (h.hp <= 3) add({ prio: 80, icon: '♥', text: `Resolve is low (${h.hp}).`, hint: 'Rest in a city (+2 per turn) before another ruin.', act: { kind: 'home' } });
  if (e.deficit > 0) add({ prio: 78, icon: '❀', text: `A Sustenance shortage of ${e.deficit} is coming.`, hint: 'Build a Garden, or open Empire → Emergency measures.', act: { kind: 'sheet', s: 'empire' } });
  for (const c of cities) { if (!c.project && !staged.some(x => x.type === 'develop' && x.city === c.id) && S.turn >= 1) { const s = suggestDistrict(S, c); if (s) add({ prio: c.capital ? 74 : 70, icon: '⚒', text: `${c.name} is idle: build ${/^[AEIOU]/.test(DISTRICTS[s.district].name) ? 'an' : 'a'} ${DISTRICTS[s.district].name}.`, hint: s.why + ' Projects keep working without more orders.', act: { kind: 'stage', cmd: s.cmd, q: c.q, r: c.r } }); } }
  for (const c of cities) if (c.coh < 45 && !c.reconcile && !staged.some(x => x.kind === 'reconcile' && x.city === c.id)) add({ prio: 68, icon: '☾', text: `${c.name} is fraying (Coherence ${Math.round(c.coh)}).`, hint: 'Reconcile: 3 ◆ 1 ⚡ and two turns for +12.', act: { kind: 'select', q: c.q, r: c.r } });
  if (S.turn >= CFG.quieting.firstForecast - 1 && forecastLevel(S, 'you') >= 1) { const c = cities.find(x => effExposure(S, x) > 0 && !x.works.stabilization && !x.project); if (c) add({ prio: 72, icon: '◌', text: `${c.name} is exposed to the Quieting.`, hint: 'Stabilization Works (12 ◆ 8 ⚡) protect it and remove 10 Resonance.', act: { kind: 'select', q: c.q, r: c.r } }); }
  if (S.turn >= 16 && S.turn <= 21 && !you.ambition) add({ prio: 66, icon: '★', text: 'Choose your ambition.', hint: 'Between turns 16 and 21. Preview all four endings.', act: { kind: 'sheet', s: 'ambition' } });
  if (S.proposals.some(p => p.to === 'you')) add({ prio: 60, icon: '✉', text: 'A society has made you a proposal.', hint: 'Accept or decline: free.', act: { kind: 'sheet', s: 'diplo' } });
  if (!you.research.target && S.turn >= 2 && Object.keys(TECHS).some(t => !you.techs[t] && TECHS[t].pre.every(p => you.techs[p]))) add({ prio: 62, icon: '◈', text: 'No research is running.', hint: 'Pick a technology (one Reform order).', act: { kind: 'sheet', s: 'empire' } });
  if (isCouncilTurn(S.turn) && S.council.offers && S.council.turn === S.turn && !S.council.chosen && !staged.some(x => x.type === 'council')) add({ prio: 64, icon: '☷', text: 'The council is in session.', hint: 'Pick one of three offers, or pass.', act: { kind: 'council' } });
  // travel suggestions: a known, still-open site; otherwise the unexplored
  if (h.movesLeft > 0 && !near) {
    let best = null; for (const s of Object.values(S.sites)) { if (!you.seen[key(s.q, s.r)] || s.state !== 'open' || s.type === 'meridian_spire' || s.type === 'anomaly' || (s.cd && s.cd > S.turn)) continue; for (const n of neighbors(s.q, s.r)) { const k = key(n.q, n.r); const c = dst.get(k); if (c !== undefined && (!best || c < best.c)) best = { s, n, c }; } }
    if (best) { const turns = Math.ceil(best.c / Math.max(1, st.moves)); add({ prio: 56, icon: '➜', text: `Walk to ${best.s.name}${turns > 1 ? ` (${turns} turns)` : ''}.`, hint: DISCOVERIES[best.s.type] ? DISCOVERIES[best.s.type].blurb : '', act: { kind: 'walk', q: best.n.q, r: best.n.r } }); }
    else add({ prio: 40, icon: '➜', text: 'Explore: nothing is known beyond your border.', hint: 'Walk toward the dark edge of the map. You see 3 tiles around you.', act: { kind: 'explore' } });
  }
  const free = 3 - staged.filter(x => x.order).length; if (free >= 1 && cities.length < CFG.maxCities && S.turn >= 2 && !out.some(x => x.prio >= 70)) add({ prio: 35, icon: '⌂', text: 'Settle another city.', hint: 'Claim a tile (X) marked ⌂+, then found a city (F).', act: { kind: 'hint-settle' } });
  out.sort((a, b) => b.prio - a.prio); const top = out.slice(0, opts.n || 3);
  if (!top.length || top[top.length - 1].prio < 50 || free <= 0) top.push({ prio: 1, icon: '⏎', text: 'Ready? End the turn.', hint: free > 0 ? `${free} order${free === 1 ? '' : 's'} unused: that is fine.` : 'All three orders are staged.', act: { kind: 'end' } });
  return top.slice(0, (opts.n || 3) + 1);
}
