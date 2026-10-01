// Council sessions: seeded weighted offers, persisted so reloading never rerolls.
import { CFG, OPPORTUNITIES, FALLBACK_OFFER, TERRAIN } from '../data/content.js';
import { rnd, weightedPick } from './rng.js';
import { key } from './hex.js';
import { RES, add, canPay, tileAt, civCities, civArmies, hasInst, hasTech, cityHousing, civResonance } from './economy.js';
import { log, ageOf, pairKey } from './state.js';
import { offerCost } from './commands.js';
import { contact, relMemAdd } from './diplomacy.js';

export const isCouncilTurn = (t) => CFG.councilTurns.includes(t);

function eligible(S, civ, o) {
  const c = o.cond || {}; const cities = civCities(S, civ.id);
  if (c.minTurn && S.turn < c.minTurn) return false; if (c.maxTurn && S.turn > c.maxTurn) return false;
  if (c.terrain && !Object.values(S.map.tiles).some(t => t.owner === civ.id && t.t === c.terrain)) return false;
  if (c.anyDistrict && !cities.some(x => x.districts.some(d => d.type === c.anyDistrict))) return false;
  if (c.contact && !S.civOrder.some(o2 => o2 !== civ.id && contact(S, civ.id, o2))) return false;
  if (c.lowCoh && !cities.some(x => x.coh < 60)) return false;
  if (c.hasArmy && !civArmies(S, civ.id).length) return false;
  if (c.tech && !hasTech(civ, c.tech)) return false;
  if (c.resonanceMin && civResonance(S, civ.id) < c.resonanceMin) return false;
  return true;
}
function weight(S, civ, id, o) {
  let w = 1; const c = o.cond || {};
  if (c.terrain) w += 2; if (c.anyDistrict) w += 1; if (c.lowCoh) w += 2;
  w += (civ.flags.catBoost && civ.flags.catBoost[o.cat]) || 0;
  if (o.cat === 'preparation' && S.turn >= 12) w += 1.5;
  if (S.council.lastIds.includes(id)) w = 0; // no consecutive repeats
  if ((civ.flags.picked || []).includes(id)) w *= 0.3; // previous choices shape later offers
  return w;
}
export function drawOffers(S, civ, n = 3, exclude = []) {
  const pool = Object.keys(OPPORTUNITIES).filter(id => !exclude.includes(id) && eligible(S, civ, OPPORTUNITIES[id]));
  const out = [];
  for (let i = 0; i < n; i++) {
    const rest = pool.filter(id => !out.includes(id));
    const pick = weightedPick(S, rest, id => {
      let w = weight(S, civ, id, OPPORTUNITIES[id]);
      if (out.some(x => OPPORTUNITIES[x].cat === OPPORTUNITIES[id].cat)) w *= 0.25; return w;
    });
    if (pick) out.push(pick);
  }
  return out;
}
export function offerView(S, civ, id) {
  const o = id === FALLBACK_OFFER.id ? FALLBACK_OFFER : OPPORTUNITIES[id];
  return { id, title: o.title, cat: o.cat, story: o.story, shows: o.shows, cost: offerCost(S, civ, o), fx: o.fx };
}
export function openCouncil(S) {
  const you = S.civs.you; if (!isCouncilTurn(S.turn)) { S.council.offers = null; return null; }
  let ids = drawOffers(S, you);
  let views = ids.map(id => offerView(S, you, id));
  if (!views.some(v => canPay(you.res, v.cost))) { views.pop(); views.push(offerView(S, you, FALLBACK_OFFER.id)); }
  if (views.length < 3) { views.push(offerView(S, you, FALLBACK_OFFER.id)); views = views.slice(0, 3); }
  S.council.offers = views; S.council.turn = S.turn; S.council.chosen = null;
  return views;
}
export function petition(S) {
  const age = ageOf(S.turn); const cs = S.council;
  if (!cs.offers || cs.turn !== S.turn) return { ok: false, error: 'No council session.' };
  if (cs.petition[age]) return { ok: false, error: 'You have already used this age\'s petition.' };
  // the petition replaces the least-affordable (last) offer with a new draw; persisted so a reload cannot reroll it
  const you = S.civs.you; const have = cs.offers.map(o => o.id);
  const ids = drawOffers(S, you, 1, have);
  if (!ids.length) return { ok: false, error: 'No other opportunity is available.' };
  const idx = cs.offers.length - 1; cs.offers[idx] = offerView(S, you, ids[0]); cs.petition[age] = turnTag(S);
  return { ok: true };
}
const turnTag = (S) => S.turn;

export function addPopulation(S, civ, n, integ = 0, request = null) {
  let added = 0; const hit = new Set();
  for (let i = 0; i < n; i++) {
    const cities = civCities(S, civ.id).filter(c => c.pop < cityHousing(S, civ, c)).sort((a, b) => (cityHousing(S, civ, b) - b.pop) - (cityHousing(S, civ, a) - a.pop) || (b.capital ? 1 : 0) - (a.capital ? 1 : 0));
    if (!cities.length) break; const c = cities[0]; c.pop++; added++; hit.add(c);
  }
  for (const c of hit) { if (integ) c.coh = Math.max(0, c.coh - integ); if (request && !c.request) c.request = { kind: request, turn: S.turn }; }
  return { added, cities: [...hit] };
}

export function addFragment(S, civ, cat, name, src) {
  if (civ.fragments.some(f => f.name === name)) return false;
  civ.fragments.push({ id: 'f' + civ.fragments.length + '_' + S.turn, name, cat, turn: S.turn, src: src || null });
  if (civ.id === 'you') log(S, 'you', `Named fragment preserved: "${name}" (${cat}). Fragments are never spent as Memory.`, 1);
  return true;
}
export function addResonance(S, civId, n, regionIdx) {
  const arr = S.resonance[civId]; const civ = S.civs[civId];
  if (regionIdx === undefined) { const cap = S.cities[civ.cap] || civCities(S, civId)[0]; regionIdx = cap ? tileAt(S, cap.q, cap.r).region : 0; }
  if (n >= 0) arr[regionIdx] += n;
  else { let left = -n; const order = arr.map((v, i) => i).sort((a, b) => arr[b] - arr[a]); for (const i of order) { const take = Math.min(left, arr[i]); arr[i] -= take; left -= take; } }
}

export function applyOffer(S, civ, offer, silent) {
  const notes = [];
  for (const f of offer.fx) {
    switch (f.op) {
      case 'res': { for (const k of RES) if (f[k]) { civ.res[k] += f[k]; } notes.push('Resources gained.'); break; }
      case 'cohAll': for (const c of civCities(S, civ.id)) c.coh = Math.max(0, Math.min(100, c.coh + f.n)); break;
      case 'popRoom': { const r = addPopulation(S, civ, f.n, f.integ, 'welcome'); notes.push(`+${r.added} population`); break; }
      case 'mod': civ.mods.push({ id: f.id, label: offer.title, fx: f.fx, turn: S.turn, expires: f.turns >= 99 ? null : S.turn + f.turns }); break;
      case 'fragment': addFragment(S, civ, f.cat, f.name, offer.id); break;
      case 'rel': for (const o of S.civOrder) if (o !== civ.id && contact(S, civ.id, o)) relMemAdd(S, o, civ.id, f.all); break;
      case 'claim': { let n = f.n; const cand = Object.values(S.map.tiles).filter(t => !t.owner && !t.city && key(t.q, t.r) && civ.seen[key(t.q, t.r)] && neighborsOwned(S, civ, t)).sort((a, b) => yieldScore(b) - yieldScore(a) || a.q - b.q || a.r - b.r); for (const t of cand) { if (n <= 0) break; if (t.owner) continue; t.owner = civ.id; n--; } break; }
      case 'cohLowest': { const cs = civCities(S, civ.id).sort((a, b) => a.coh - b.coh); if (cs[0]) cs[0].coh = Math.min(100, cs[0].coh + f.n); break; }
      case 'revealForecast': S.quiet.revealed = true; S.quiet.seenBy = S.quiet.seenBy || {}; S.quiet.seenBy[civ.id] = true; break;
      case 'resonance': addResonance(S, civ.id, f.n); break;
      case 'armyStr': for (const a of civArmies(S, civ.id)) for (const r of a.regs) r.str = Math.min(10, r.str + f.n); break;
      case 'freeRegiment': giveRegiment(S, civ, f.role); break;
    }
  }
  civ.flags.picked = (civ.flags.picked || []).concat(offer.id);
  const cat = offer.cat; civ.flags.catBoost = civ.flags.catBoost || {}; civ.flags.catBoost[cat] = Math.min(3, (civ.flags.catBoost[cat] || 0) + 1);
  return notes;
}
const yieldScore = (t) => { const y = TERRAIN[t.t].yield; return Object.values(y).reduce((a, b) => a + b, 0) + (t.site ? 2 : 0); };
function neighborsOwned(S, civ, t) { return [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]].some(([a, b]) => { const n = S.map.tiles[key(t.q + a, t.r + b)]; return n && n.owner === civ.id; }); }

export function giveRegiment(S, civ, role) {
  const cap = S.cities[civ.cap]; if (!cap) return false;
  let army = civArmies(S, civ.id).find(a => a.q === cap.q && a.r === cap.r && a.regs.length < CFG.army.maxRegs);
  if (!army) { if (civArmies(S, civ.id).length >= CFG.army.maxArmies) return false; S.nextId++; army = { id: 'a' + S.nextId, owner: civ.id, q: cap.q, r: cap.r, regs: [], obj: { type: 'guard' }, retreatAt: CFG.army.retreatDefault, start: 0, entrench: 0 }; S.armies[army.id] = army; }
  S.nextId++; army.regs.push({ id: 'g' + S.nextId, role, str: 10, ready: S.turn });
  return true;
}
