// Relations, treaties, war, reputation. Rivals and the player go through exactly these functions.
import { CFG, FACTIONS, INSTITUTIONS } from '../data/content.js';
import { key, neighbors, dist } from './hex.js';
import { pairKey, atWar, log, nid } from './state.js';
import { fx, hasInst, civCities, civArmies, hasTreaty, flag, civResonance } from './economy.js';

export function power(S, civId) {
  const civ = S.civs[civId]; if (!civ || civ.eliminated) return 0;
  let p = 0; for (const a of civArmies(S, civId)) p += a.regs.reduce((s, r) => s + r.str, 0);
  return p + civCities(S, civId).length * 4;
}
export function borderContacts(S, a, b) {
  let n = 0;
  for (const t of Object.values(S.map.tiles)) if (t.owner === a) { if (neighbors(t.q, t.r).some(h => { const o = S.map.tiles[key(h.q, h.r)]; return o && o.owner === b; })) n++; }
  return n;
}
export function contact(S, a, b) { // a has seen any city/army tile of b
  const civ = S.civs[a]; if (!civ) return false;
  return civCities(S, b).some(c => civ.seen[key(c.q, c.r)]);
}
const PHIL = { 'conservatory|signal': -12, 'conservatory|veil': -4, 'signal|veil': -6 };

export function relation(S, a, b) {
  // How `a` regards `b`. Returns { score, reasons:[{label,amt}] }
  const reasons = []; const add = (label, amt) => { if (amt) reasons.push({ label, amt: Math.round(amt) }); };
  const A = S.civs[a], B = S.civs[b];
  const fa = FACTIONS[a], fb = FACTIONS[b];
  if (fa && fb) add('Philosophical distance', PHIL[pairKey(a, b)] || 0);
  if (fa) { // judging institutions of b
    let like = 0; for (const s of B.inst) if (s) { if (fa.prefers.includes(s.id)) like += 6; if (fa.dislikes.includes(s.id)) like -= 6; }
    add(`Their institutions vs. ${fa.short} values`, like);
    if (B.inst.some(s => s && INSTITUTIONS[s.id].tags.includes('forced'))) add('Doubles: forced identity', -6);
  }
  add('Past dealings', S.relMem[pairKey(a, b)] || 0);
  const kept = S.treaties.filter(t => t.active && ((t.a === a && t.b === b) || (t.a === b && t.b === a))).length;
  add('Active agreements', Math.min(3, kept) * 3);
  add('Border friction', -Math.min(6, borderContacts(S, a, b)));
  if (atWar(S, a, b)) add('At war', -30);
  add('Reputation for broken promises', Math.min(0, B.reputation) / 2);
  if (a !== 'you' && b === 'you') add('Envoy distrust / favour', fx(S, B, 'relBase'));
  const sc = reasons.reduce((s, r) => s + r.amt, 0);
  return { score: sc, reasons };
}

export function evaluateTreaty(S, from, to, kind) {
  // `to` decides. Same function whether `to` is a rival or (for hints) the player.
  const rel = relation(S, to, from); const reasons = rel.reasons.slice();
  const bonus = fx(S, S.civs[from], 'treatyAccept'); if (bonus) reasons.push({ label: 'Diplomatic standing of proposer', amt: bonus });
  const need = { trade: -5, nonaggression: -10, research: 4, passage: 4, preservation: 6, shutdown: 0 }[kind];
  let score = rel.score + bonus;
  if (kind === 'shutdown') { const mutual = civResonance(S, to) > 0 ? 6 : -4; reasons.push({ label: 'Compensation offered', amt: 8 }); reasons.push({ label: mutual > 0 ? 'Their foundries pressure Resonance' : 'Little to shut down', amt: mutual }); score += 8 + mutual; }
  if (atWar(S, from, to)) { reasons.push({ label: 'At war: refuses', amt: -50 }); score -= 50; }
  if (kind === 'nonaggression') { const pw = power(S, from) / Math.max(1, power(S, to)); if (pw > 1.5) { reasons.push({ label: 'Fear of the stronger power', amt: 6 }); score += 6; } }
  return { accept: score >= need, score, need, reasons };
}

export function stdTreaty(S, from, to, kind, extra = {}) {
  const t = { id: nid(S, 't'), kind, a: from, b: to, start: S.turn, end: S.turn + CFG.treaty.duration[kind], active: true, verified: false, ...extra };
  S.treaties.push(t); return t;
}
export function relMemAdd(S, a, b, n) { const k = pairKey(a, b); S.relMem[k] = Math.max(-60, Math.min(60, (S.relMem[k] || 0) + n)); }

// Breaking a promise: visible reputation and Coherence cost.
export function breakTreaty(S, breaker, treaty, why) {
  const civ = S.civs[breaker]; const other = treaty.a === breaker ? treaty.b : treaty.a;
  treaty.active = false; treaty.broken = { by: breaker, turn: S.turn, why };
  civ.reputation -= CFG.treaty.breakRep; civ.stats.broken++;
  relMemAdd(S, breaker, other, -20);
  for (const o of S.civOrder) if (o !== breaker && o !== other) relMemAdd(S, o, breaker, -3);
  const mult = 1 + (fx(S, civ, 'brokenPromise') || 0);
  for (const c of civCities(S, breaker)) c.coh = Math.max(0, c.coh - CFG.treaty.breakCoh * mult);
  log(S, breaker, `${civ.name} broke the ${treaty.kind} pact with ${S.civs[other].name}${why ? ' (' + why + ')' : ''}. Reputation -${CFG.treaty.breakRep}, Coherence -${CFG.treaty.breakCoh * mult}.`, 2, { pub: true });
  if (breaker === 'you') S.chronicle.push({ turn: S.turn, text: `You broke your ${treaty.kind} promise to ${S.civs[other].name}.`, tag: 'broken' });
}
export function declareWar(S, a, b, why) {
  for (const t of S.treaties.filter(t => t.active && (t.kind === 'nonaggression') && ((t.a === a && t.b === b) || (t.a === b && t.b === a)))) breakTreaty(S, a, t, 'declared war');
  for (const t of S.treaties.filter(t => t.active && ((t.a === a && t.b === b) || (t.a === b && t.b === a)))) t.active = false;
  S.wars[pairKey(a, b)] = S.turn;
  relMemAdd(S, a, b, -10); relMemAdd(S, b, a, -10);
  log(S, a, `${S.civs[a].name} declared war on ${S.civs[b].name}${why ? ': ' + why : ''}.`, 2, { pub: true });
}
export function makePeace(S, a, b) { delete S.wars[pairKey(a, b)]; relMemAdd(S, a, b, 6); log(S, a, `${S.civs[a].name} and ${S.civs[b].name} made peace.`, 2, { pub: true }); }

export function expireTreaties(S) {
  for (const t of S.treaties) if (t.active && S.turn >= t.end) {
    t.active = false; t.fulfilled = true;
    S.civs[t.a].stats.kept++; S.civs[t.b].stats.kept++;
    relMemAdd(S, t.a, t.b, 4);
    if (t.a === 'you' || t.b === 'you') log(S, 'you', `The ${t.kind} agreement with ${S.civs[t.a === 'you' ? t.b : t.a].name} ran its course, kept.`, 1);
  }
  // verified treaties: the partner cannot be released early (handled in cancel validation)
}
