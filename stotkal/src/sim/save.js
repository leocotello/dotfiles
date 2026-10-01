// Versioned persistence. The simulation state is plain JSON, so a save is the whole RunState (map seed, RNG state, turn, staged
// orders, all civilizations, offers, flags). Loading never rerolls council offers because they are stored in the state.
import { SAVE_VERSION } from './state.js';
import { INSTITUTIONS, TECHS, DISTRICTS, WORKS, DISCOVERIES } from '../data/content.js';

const TRANSIENT = ['_econ', '_engage', '_battles', '_outcomes', '_tick'];
export function serialize(S) {
  const copy = JSON.parse(JSON.stringify(S, (k, v) => (TRANSIENT.includes(k) ? undefined : v)));
  return JSON.stringify({ schema: SAVE_VERSION, game: 'stotkal', savedAt: Date.now(), turn: S.turn, seed: S.seed, state: copy });
}
const MIGRATIONS = {}; // from-version -> fn(state) : add entries when SAVE_VERSION increases
export function deserialize(text) {
  let o; try { o = JSON.parse(text); } catch (e) { return { ok: false, message: 'This save could not be read (corrupted data). Your other saves and your Chronicle history are untouched.' }; }
  if (!o || o.game !== 'stotkal' || !o.state) return { ok: false, message: 'This file is not a Stotkal save.' };
  let v = o.schema; let S = o.state;
  if (v > SAVE_VERSION) return { ok: false, message: `This save is from a newer version of the game (save schema ${v}, this build understands ${SAVE_VERSION}). Update the game to open it.` };
  while (v < SAVE_VERSION) { const m = MIGRATIONS[v]; if (!m) return { ok: false, message: `No migration path from save schema ${v}. The save was kept; it cannot be restored by this build.` }; S = m(S); v++; }
  const notes = repair(S);
  S.v = SAVE_VERSION;
  return { ok: true, S, notes };
}
// Changed or removed content must fail gracefully: drop references to unknown ids, report what was dropped.
export function repair(S) {
  const notes = [];
  for (const civ of Object.values(S.civs)) {
    civ.inst = civ.inst.map(s => { if (s && !INSTITUTIONS[s.id]) { notes.push(`Unknown institution "${s.id}" was removed.`); return null; } return s; });
    for (const t of Object.keys(civ.techs)) if (!TECHS[t]) { notes.push(`Unknown technology "${t}" was removed.`); delete civ.techs[t]; }
    if (civ.research.target && !TECHS[civ.research.target]) civ.research.target = null;
  }
  for (const c of Object.values(S.cities)) {
    c.districts = c.districts.filter(d => { if (!DISTRICTS[d.type]) { notes.push(`Unknown district "${d.type}" in ${c.name} was removed.`); return false; } return true; });
    for (const w of Object.keys(c.works)) if (!WORKS[w]) delete c.works[w];
    if (c.project && !(c.project.what.startsWith('district:') ? DISTRICTS[c.project.what.slice(9)] : WORKS[c.project.what.slice(5)])) { c.project = null; notes.push(`Project in ${c.name} refers to removed content and was cancelled.`); }
  }
  for (const s of Object.values(S.sites)) if (!DISCOVERIES[s.type] && s.type !== 'meridian_spire') { notes.push(`Unknown site type "${s.type}" ignored.`); s.state = 'resolved'; }
  return notes;
}

// ---- browser storage wrappers (never throw; render without storage) ----
const store = () => { try { return globalThis.localStorage || null; } catch (e) { return null; } };
export const SLOT_KEY = (n) => 'stotkal.save.' + n;
export function saveToSlot(S, slot = 'auto') { const st = store(); if (!st) return false; try { st.setItem(SLOT_KEY(slot), serialize(S)); return true; } catch (e) { return false; } }
export function loadFromSlot(slot = 'auto') { const st = store(); if (!st) return { ok: false, message: 'Browser storage is unavailable.' }; const t = st.getItem(SLOT_KEY(slot)); if (!t) return { ok: false, message: 'No save found.' }; return deserialize(t); }
export function hasSave(slot = 'auto') { const st = store(); try { return !!(st && st.getItem(SLOT_KEY(slot))); } catch (e) { return false; } }
export function deleteSlot(slot = 'auto') { const st = store(); try { st && st.removeItem(SLOT_KEY(slot)); } catch (e) { } }
export function slotInfo(slot = 'auto') { const st = store(); try { const t = st && st.getItem(SLOT_KEY(slot)); if (!t) return null; const o = JSON.parse(t); return { turn: o.turn, seed: o.seed, savedAt: o.savedAt }; } catch (e) { return null; } }

// ---- profile: Chronicle history (narrative) is stored separately from the one active legacy (mechanical) ----
const PKEY = 'stotkal.profile';
export function loadProfile() { const st = store(); try { const t = st && st.getItem(PKEY); if (t) { const p = JSON.parse(t); if (p && p.version === 1) return p; } } catch (e) { } return { version: 1, history: [], legacy: null, fresh: false, runs: 0 }; }
export function saveProfile(p) { const st = store(); try { st && st.setItem(PKEY, JSON.stringify(p)); return true; } catch (e) { return false; } }
