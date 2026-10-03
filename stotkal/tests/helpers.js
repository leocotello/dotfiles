import { newRun } from '../src/sim/state.js';
import { endTurn } from '../src/sim/resolve.js';
import { planAs } from '../src/sim/rival.js';
import { botTurn } from '../src/sim/bot.js';
import { key } from '../src/sim/hex.js';
export const fresh = (seed = 'test', o = {}) => { const S = newRun({ seed, tradition: 'keepers', disp: 'listener', ...o }); S.debugThrow = true; return S; };
export const you = (S) => S.civs.you;
export const cap = (S, id = 'you') => S.cities[S.civs[id].cap];
export function playBot(seed, ambition = 'embodied', turns = 30) {
  const S = fresh(seed); const fac = { embodied: 'veil', shared: 'signal', record: 'conservatory', break: 'conservatory' }[ambition];
  let g = 0; while (!S.over && S.turn <= turns && g++ < 40) { botTurn(S, fac, ambition); endTurn(S); }
  return S;
}
export const tile = (S, q, r) => S.map.tiles[key(q, r)];
export function giveTech(S, id, ...techs) { for (const t of techs) S.civs[id].techs[t] = true; }
