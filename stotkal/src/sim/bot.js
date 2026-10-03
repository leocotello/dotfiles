// A heuristic player for headless simulation and the debug fast-forward: resolves decisions, walks the hero, then stages orders.
import { FACTIONS, AMBITIONS, INSTITUTIONS } from '../data/content.js';
import { BOONS } from '../data/action.js';
import { key, dist, neighbors, within } from './hex.js';
import { planAs } from './rival.js';
import { act, pendingView, expeditionSites, startExpedition, engageThreat, heartOptions } from './run.js';
import { heroStats, heroMove, heroPath, heroDistMap } from './hero.js';
import { threatList, threatForecast } from './threats.js';
import { civCities, tileAt } from './economy.js';
import { TERRAIN } from '../data/content.js';
import { validate } from './commands.js';
import { applyCmd } from './apply.js';

const TAG_PREF = { embodied: ['garden', 'ward', 'voice'], shared: ['voice', 'wander', 'archive'], record: ['archive', 'wander', 'ward'], break: ['wander', 'archive', 'forge'] };

function bestChoice(choices, fallback) {
  const ok = choices.filter(c => c.afford); const checks = ok.filter(c => c.chance != null).sort((a, b) => b.chance - a.chance);
  const free = ok.filter(c => c.chance == null && !c.cost); const fb = ok.find(c => c.id === fallback);
  if (checks[0] && checks[0].chance >= 0.55) return checks[0]; if (free[0]) return free[0]; return checks[0] || fb || ok[0] || choices[0];
}
export function botDecide(S, fac, amb) {
  let guard = 0;
  while (S.pending.length && guard++ < 60) {
    const v = pendingView(S); if (!v) { S.pending.shift(); continue; }
    if (v.type === 'beat') { const c = bestChoice(v.choices, v.fallback); act(S, { type: 'beat', id: c.id }); }
    else if (v.type === 'boon') { const pref = TAG_PREF[amb] || []; const sorted = v.options.slice().sort((a, b) => (pref.indexOf(a.tag) < 0 ? 9 : pref.indexOf(a.tag)) - (pref.indexOf(b.tag) < 0 ? 9 : pref.indexOf(b.tag))); act(S, { type: 'boon', id: sorted[0].id }); }
    else if (v.type === 'crossroads') { const st = heroStats(S); const hp = S.hero.hp; const id = hp < 6 ? 'haven' : (st.atk >= 5 || st.wit >= 5) && v.options.some(o => o.id === 'warden') ? 'warden' : v.options.find(o => o.id === 'front') ? 'front' : 'haven'; act(S, { type: 'cross', id }); }
    else if (v.type === 'boss') { const c = bestChoice(v.choices, null); act(S, { type: 'boss', id: c.id }); }
    else if (v.type === 'exped') {
      if (v.heart) {
        const opts = v.heartOptions; const f = FACTIONS[fac] || FACTIONS.conservatory; const pickI = opts.filter(o => o.kind === 'interp' && o.afford).sort((a, b) => (f.prefers.includes(b.id) ? 1 : 0) - (f.prefers.includes(a.id) ? 1 : 0) - ((f.dislikes.includes(b.id) ? 1 : 0) - (f.dislikes.includes(a.id) ? 1 : 0)))[0];
        const slot = S.civs.you.inst.findIndex(x => !x);
        if (pickI && slot >= 0) { act(S, { type: 'heart', id: pickI.id, slot }); }
        else if (opts.some(o => o.kind === 'ruin')) act(S, { type: 'heart', id: S.hero.hp < 6 ? 'relic' : 'relic' });
        else act(S, { type: 'heart', id: 'salvage' });
      } else if (v.room) { const c = bestChoice(v.room.choices, null); act(S, { type: 'room', id: c.id }); }
      else { // choose a door: rest when hurt, otherwise cache/echo before fights
        const pri = S.hero.hp < 6 ? ['rest', 'cache', 'echo', 'trap', 'shrine', 'guardian'] : ['cache', 'echo', 'shrine', 'rest', 'trap', 'guardian']; const i = v.doors.map(d => pri.indexOf(d.kind)).reduce((bi, x, idx, arr) => x < arr[bi] ? idx : bi, 0);
        if (S.hero.hp <= 3 && v.layer > 0) act(S, { type: 'leave' }); else act(S, { type: 'door', i });
      }
    } else S.pending.shift();
  }
}

function frontier(S) {
  const you = S.civs.you; let best = null; const { dst } = heroDistMap(S);
  for (const t of Object.values(S.map.tiles)) {
    if (!TERRAIN[t.t].passable || !you.seen[key(t.q, t.r)] || (t.city && S.cities[t.city].owner !== 'you')) continue;
    let g = 0; for (const h of within(t, S.hero.sight)) { const o = S.map.tiles[key(h.q, h.r)]; if (o && !you.seen[key(h.q, h.r)]) g++; }
    if (g < 3) continue; const pc = dst.get(key(t.q, t.r)); if (pc === undefined) continue; const score = g / (1 + pc * 0.6) + (dist(t, S.hero) > 0 ? 0 : -9);
    if (!best || score > best.score) best = { t, score };
  }
  return best && best.t;
}
export function botHero(S, amb) {
  const h = S.hero; let safety = 0;
  while (h.movesLeft > 0 && !S.pending.length && safety++ < 12) {
    const you = S.civs.you;
    // 1. engage a threat next to us when the odds are fine; 2. go home when hurt
    const th = threatList(S).find(t => dist(t, h) <= 1 && you.obs[key(t.q, t.r)]);
    if (th && h.hp >= 6) { engageThreat(S, th.id); return; }
    if (h.hp <= 4) { const home = civCities(S, 'you').sort((a, b) => dist(a, h) - dist(b, h))[0]; if (home && dist(home, h) > 0) { heroMove(S, home.q, home.r); if (h.hp <= 4) break; continue; } break; }
    // sites: anomalies for Break, expedition sites otherwise
    const near = expeditionSites(S)[0];
    if (near && h.hp >= 5) { const r = startExpedition(S, near.id); if (r.ok) return; }
    if (amb === 'break') { const an = Object.values(S.sites).find(s => s.type === 'anomaly' && !s.invest.you && dist(s, h) <= 1); if (an && !validate(S, 'you', { type: 'investigate', site: an.id })) { applyCmd(S, 'you', { type: 'investigate', site: an.id }); } }
    const goals = Object.values(S.sites).filter(s => you.seen[key(s.q, s.r)] && ((s.state === 'open' && !(s.cd > S.turn) && s.type !== 'meridian_spire' && (s.type !== 'anomaly' || (amb === 'break' && !s.invest.you))) || (amb === 'break' && s.type === 'meridian_spire' && false)));
    let target = null, bd = 1e9; const { dst } = heroDistMap(S);
    for (const g of goals) { const nb = neighbors(g.q, g.r).map(n => S.map.tiles[key(n.q, n.r)]).filter(t => t && TERRAIN[t.t].passable && !(t.city && S.cities[t.city].owner !== 'you')); for (const t of nb) { const pc = dst.get(key(t.q, t.r)); if (pc !== undefined && pc < bd) { bd = pc; target = t; } } }
    if (!target) target = frontier(S);
    if (!target) break; const before = h.movesLeft; const r = heroMove(S, target.q, target.r); if (!r.ok || r.moved === 0) break; if (h.movesLeft === before) break;
  }
}
export function botTurn(S, fac, amb) { botDecide(S, fac, amb); botHero(S, amb); botDecide(S, fac, amb); planAs(S, 'you', fac, amb); }
