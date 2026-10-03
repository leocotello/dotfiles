// Startup validation of editable content: references, prerequisites, ids. Returns a list of problems (empty = ok).
import { CFG, TERRAIN, DISTRICTS, WORKS, TRADITIONS, DISPOSITIONS, TECHS, DISCOVERIES, INSTITUTIONS, OPPORTUNITIES, AMBITIONS, FACTIONS, ROLES, LEGACIES, COMBOS, ACHIEVEMENTS } from './content.js';

export function validateContent() {
  const errs = []; const e = (m) => errs.push(m);
  for (const [id, t] of Object.entries(TECHS)) { for (const p of t.pre) if (!TECHS[p]) e(`tech ${id}: unknown prerequisite ${p}`); if (t.age < 0 || t.age > 2) e(`tech ${id}: bad age`); if (t.pre.some(p => TECHS[p] && TECHS[p].age > t.age)) e(`tech ${id}: prerequisite from a later age`); }
  const perAge = [0, 0, 0]; Object.values(TECHS).forEach(t => perAge[t.age]++); if (perAge.some(n => n !== 6)) e('tech: expected six per age, got ' + perAge);
  // cycle check
  const visiting = new Set(), done = new Set(); const dfs = (id) => { if (done.has(id)) return; if (visiting.has(id)) { e('tech cycle at ' + id); return; } visiting.add(id); (TECHS[id].pre || []).forEach(p => TECHS[p] && dfs(p)); visiting.delete(id); done.add(id); }; Object.keys(TECHS).forEach(dfs);
  for (const [id, d] of Object.entries(DISCOVERIES)) { for (const ip of d.interps) { if (!INSTITUTIONS[ip]) e(`discovery ${id}: unknown interpretation ${ip}`); else if (INSTITUTIONS[ip].source !== id) e(`institution ${ip}: source mismatch (${INSTITUTIONS[ip].source} vs ${id})`); } if (!d.anomaly && !d.expedition && id !== 'legacy_ruin' && d.interps.length !== 3) e(`discovery ${id}: needs exactly three interpretations`); }
  for (const [id, i] of Object.entries(INSTITUTIONS)) { if (i.source && !DISCOVERIES[i.source]) e(`institution ${id}: unknown source`); if (!i.gain || !i.risk) e(`institution ${id}: gain and risk text are required`); }
  for (const [id, o] of Object.entries(OPPORTUNITIES)) { if (!o.fx || !o.fx.length) e(`opportunity ${id}: no effects`); if (o.cond && o.cond.terrain && !TERRAIN[o.cond.terrain]) e(`opportunity ${id}: bad terrain`); if (o.cond && o.cond.tech && !TECHS[o.cond.tech]) e(`opportunity ${id}: bad tech`); if (o.cond && o.cond.anyDistrict && !DISTRICTS[o.cond.anyDistrict]) e(`opportunity ${id}: bad district`); }
  for (const [id, a] of Object.entries(AMBITIONS)) for (const t of a.techs) if (!TECHS[t]) e(`ambition ${id}: unknown tech ${t}`);
  for (const [id, f] of Object.entries(FACTIONS)) { if (!AMBITIONS[f.ambition]) e(`faction ${id}: bad ambition`); if (!TRADITIONS[f.tradition]) e(`faction ${id}: bad tradition`); if (!DISPOSITIONS[f.disposition]) e(`faction ${id}: bad disposition`); for (const p of [...f.prefers, ...f.dislikes]) if (!INSTITUTIONS[p]) e(`faction ${id}: unknown institution ${p}`); }
  for (const [id, w] of Object.entries(WORKS)) { if (w.needsTech && !TECHS[w.needsTech]) e(`work ${id}: bad tech`); if (w.needsDistrict && !DISTRICTS[w.needsDistrict]) e(`work ${id}: bad district`); }
  for (const [id, c] of Object.entries(COMBOS)) { if (!INSTITUTIONS[c.needs.inst]) e(`combo ${id}: bad institution`); if (!TECHS[c.needs.tech]) e(`combo ${id}: bad tech`); }
  for (const t of Object.values(TECHS)) for (const u of t.unlock || []) { if (u.startsWith('work:') && !WORKS[u.slice(5)]) e(`tech unlock: unknown work ${u}`); }
  for (const grp of [TRADITIONS, DISPOSITIONS]) for (const [id, o] of Object.entries(grp)) if (o.unlock && !ACHIEVEMENTS[o.unlock]) e(`${id}: unknown achievement ${o.unlock}`);
  for (const f of Object.values(FACTIONS)) if (TRADITIONS[f.tradition].unlock || DISPOSITIONS[f.disposition].unlock) e('rivals must not depend on unlockable options');
  if (CFG.councilTurns.length !== 9) e('council schedule must have nine sessions');
  if (Object.keys(OPPORTUNITIES).length < 12) e('need at least twelve council opportunities');
  // every ambition must be reachable in principle: all required techs exist & chain is acyclic (checked above); required works exist
  for (const id of ['vessel', 'anchor', 'seal', 'stabilization']) if (!WORKS[id]) e('missing work ' + id);
  return errs;
}
