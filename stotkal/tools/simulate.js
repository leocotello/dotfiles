// Headless complete-game simulation harness: node tools/simulate.js [nSeeds] [mode]
// mode: bot ambition id (embodied|shared|record|break) -> the player side is played by the rival planner with that ambition;
//       'idle' -> player does nothing.
import { newRun } from '../src/sim/state.js';
import { endTurn } from '../src/sim/resolve.js';
import { planAs } from '../src/sim/rival.js';
import { civCities, totalResonance, civArmies } from '../src/sim/economy.js';
import { AMBITIONS, TRADITIONS, DISPOSITIONS } from '../src/data/content.js';
import { evaluate } from '../src/sim/ambitions.js';

export function playBot(seed, ambition, tradition, disp, opts = {}) {
  const S = newRun({ seed, tradition, disp }); S.debugThrow = true;
  const fac = { embodied: 'veil', shared: 'signal', record: 'conservatory', break: 'conservatory' }[ambition] || 'veil';
  const trace = [];
  let guard = 0;
  while (!S.over && guard++ < 40) {
    if (ambition !== 'idle') { planAs(S, 'you', fac, ambition); }
    if (opts.trace && [5, 10, 15, 20, 25, 30].includes(S.turn)) trace.push({ turn: S.turn, res: { ...S.civs.you.res }, cities: civCities(S, 'you').length, pop: civCities(S, 'you').reduce((a, c) => a + c.pop, 0), coh: Math.round(civCities(S, 'you').reduce((a, c) => a + c.coh, 0) / Math.max(1, civCities(S, 'you').length)), techs: Object.keys(S.civs.you.techs).length, frags: S.civs.you.fragments.length, resTot: totalResonance(S), inst: S.civs.you.inst.filter(Boolean).map(x => x.id) });
    endTurn(S);
  }
  return { S, trace };
}

if (process.argv[1] && process.argv[1].endsWith('simulate.js')) {
  const n = +(process.argv[2] || 20); const mode = process.argv[3] || 'all';
  const modes = mode === 'all' ? ['embodied', 'shared', 'record', 'break', 'idle'] : [mode];
  const trads = Object.keys(TRADITIONS), disps = Object.keys(DISPOSITIONS);
  const summary = {};
  let crashes = 0;
  for (const m of modes) {
    const s = { n: 0, success: 0, cities: 0, pop: 0, collapse: 0, rivalWins: 0, resTot: 0, over: 0 };
    for (let i = 0; i < n; i++) {
      try {
        const { S, trace } = playBot('sim-' + i, m, trads[i % 3], disps[(i >> 1) % 3], { trace: n <= 2 });
        s.n++; if (S.ending.success) s.success++; if (S.ending.kind === 'collapse') s.collapse++;
        s.cities += civCities(S, 'you').length; s.pop += civCities(S, 'you').reduce((a, c) => a + c.pop, 0); s.resTot += totalResonance(S);
        s.rivalWins += S.ending.rivals.filter(r => r.ok).length;
        if (!S.over) s.over++;
        for (const k of Object.keys(S.civs)) for (const r of Object.values(S.civs[k].res)) if (!Number.isFinite(r) || r < 0 || r > 5000) throw new Error('invalid resource ' + k);
        if (n <= 2) console.log(m, i, JSON.stringify(trace.slice(-6)), S.ending.success, S.ending.parts.map(p => p.label + ':' + p.cur + '/' + p.need).join(' | '));
      } catch (e) { crashes++; console.log('CRASH', m, i, e.stack.split('\n').slice(0, 4).join(' / ')); }
    }
    summary[m] = { ...s, avgCities: +(s.cities / s.n).toFixed(2), avgPop: +(s.pop / s.n).toFixed(1), avgResonance: +(s.resTot / s.n).toFixed(1), winRate: +(s.success / s.n).toFixed(2), rivalAmbitionSuccessesPerRun: +(s.rivalWins / s.n).toFixed(2) };
  }
  console.log(JSON.stringify(summary, null, 1)); console.log('crashes:', crashes);
}
