// Endings, Chronicle and legacy options. Mechanical success is kept separate from its emotional cost.
import { CFG, AMBITIONS, INSTITUTIONS, FACTIONS, LEGACIES, DISCOVERIES, ACHIEVEMENTS } from '../data/content.js';
import { civCities, hasInst, effExposure, totalResonance } from './economy.js';
import { evaluate } from './ambitions.js';
import { RIVALS } from './state.js';

export function buildEnding(S, kind) {
  const you = S.civs.you; const cities = civCities(S, 'you');
  const ambId = you.ambition ? you.ambition.id : null;
  const results = {}; for (const id of Object.keys(AMBITIONS)) results[id] = evaluate(S, 'you', id, true);
  const mine = ambId ? results[ambId] : null; const success = kind === 'final' && !!mine && mine.ok;
  const rivals = RIVALS.map(r => { const c = S.civs[r]; const a = FACTIONS[r].ambition; const ev = c.eliminated ? { ok: false } : evaluate(S, r, a, true); return { id: r, name: c.name, ambition: a, ok: ev.ok, eliminated: c.eliminated, cities: civCities(S, r).length }; });
  const ending = { kind, success, ambition: ambId, parts: mine ? mine.parts : [], rivals, turn: S.turn, results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { ok: v.ok, frac: v.frac }])) };
  ending.chronicle = chronicle(S, ending);
  ending.legacies = legacyOptions(S, ending);
  return ending;
}

function chronicle(S, e) {
  const you = S.civs.you; const cities = civCities(S, 'you'); const pop = cities.reduce((a, c) => a + c.pop, 0);
  const lines = []; const A = e.ambition ? AMBITIONS[e.ambition] : null;
  const head = e.kind === 'collapse' ? 'The last settlement fell silent before the cycle ended.'
    : e.success ? `${A.name}: achieved. The cycle ends; what remains is carried.` : A ? `${A.name}: not achieved. The cycle ends anyway.` : 'No ambition was ever named; the cycle ended on its own terms.';
  const built = []; // what they built
  built.push(`${cities.length} settlement${cities.length === 1 ? '' : 's'} (${cities.map(c => c.name).join(', ') || 'none'}), ${pop} people at the end.`);
  const believed = you.inst.filter(Boolean).map(s => INSTITUTIONS[s.id].name); const gone = you.instHistory.map(h => INSTITUTIONS[h.id].name);
  const believedTxt = believed.length ? `You believed in ${list(believed)}.` : 'You never settled on a creed.'; const goneTxt = gone.length ? ` You set aside ${list(gone)}, and the record keeps that too.` : '';
  const kept = you.stats.kept, broken = you.stats.broken;
  const promises = `${kept} agreement${kept === 1 ? '' : 's'} ran their course kept; ${broken ? broken + ' promise' + (broken === 1 ? ' was' : 's were') + ' broken, and ' + (broken > 1 ? 'those who were told remember' : 'the one who was told remembers') + '.' : 'none were broken.'}`;
  const sac = S.chronicle.filter(c => c.tag === 'sacrifice' || c.tag === 'conquest').map(c => c.text);
  const frag = you.fragments.length ? `${you.fragments.length} named fragment${you.fragments.length === 1 ? '' : 's'} preserved: ${list(you.fragments.slice(0, 6).map(f => '"' + f.name + '"'))}${you.fragments.length > 6 ? ', and more' : ''}.` : 'Nothing named was preserved; the Quieting took the rest.';
  const rivalTxt = e.rivals.map(r => `${r.name}: ${r.eliminated ? 'fell' : r.ok ? 'reached ' + AMBITIONS[r.ambition].name : 'did not reach ' + AMBITIONS[r.ambition].name}.`);
  // emotional cost, separate from mechanical success
  let cost = '';
  if (e.success) cost = e.ambition === 'record' ? 'The record is whole, and for a while it was more tended than the people who made it.' : e.ambition === 'shared' ? 'The network holds, and some who stayed apart are remembered only as gaps in it.' : e.ambition === 'embodied' ? 'The shelters hold; the Witness lost part of her own history in making room for others.' : 'The Recurrence is interrupted, and the world, relieved, forgets there was ever a pattern.';
  else cost = 'It did not hold. What survived did so by smaller kindnesses than the plan.';
  const witnessLoss = you.fragments.some(f => f.cat === 'witness') ? 'You kept one name that was yours. The rest drifted.' : 'Part of the Witness\'s own history went quiet; nobody wrote it down.';
  return { head, built, believedTxt: believedTxt + goneTxt, promises, sacrifices: sac, frag, rivals: rivalTxt, cost, witnessLoss, survivors: cities.map(c => ({ name: c.name, pop: c.pop, coh: Math.round(c.coh) })), events: S.chronicle.slice(-40) };
}
const list = (a) => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

// Achievements (checked once when a run ends). They unlock sidegrade founding options; see content.js.
export function evaluateAchievements(S, e = S.ending) {
  const you = S.civs.you; const earned = [];
  if (!e) return earned;
  if (e.success) earned.push('something_remains');
  if (e.kind === 'final' && you.stats.kept >= 3 && you.stats.broken === 0) earned.push('every_promise');
  if (e.success && !(you.stats.declared > 0) && you.stats.conquered === 0) earned.push('hands_unraised');
  if (e.success && you.stats.lost > 0) earned.push('out_of_ashes');
  return earned;
}
export function legacyOptions(S, e) {
  const you = S.civs.you; const cities = civCities(S, 'you'); const opts = [];
  const arc = cities.find(c => c.districts.some(d => d.type === 'archive'));
  opts.push({ kind: 'ruin', name: (arc ? arc.name : (cities[0] ? cities[0].name : 'The First City')) + ' (ruin)', fragment: you.fragments[0] ? you.fragments[0].name : 'An Inherited Place-Name', eligible: true, why: arc ? 'You kept an Archive there.' : 'Something remained.' });
  const inst = you.inst.find(Boolean) || (you.instHistory[0] && { id: you.instHistory[0].id });
  opts.push({ kind: 'echo', inst: inst ? inst.id : null, name: inst ? 'Echo of ' + INSTITUTIONS[inst.id].name : 'Echo of nothing', eligible: !!inst, why: inst ? 'An institution remembered by the land.' : 'You founded no institution.' });
  opts.push({ kind: 'character', name: 'The Witness, restored', eligible: true, why: 'A former ruler with expertise and a grievance.' });
  return opts;
}
