// Presentation & input. All authoritative outcomes come from src/sim. This file stages commands, walks the hero and renders state.
import { CFG, TERRAIN, INSTITUTIONS, LEGACIES, AMBITIONS, FACTIONS, DISCOVERIES } from '../data/content.js';
import { SEASONS } from '../data/action.js';
import { validateContent } from '../data/validate.js';
import { newRun, revealRange } from '../sim/state.js';
import { endTurn } from '../sim/resolve.js';
import { stage, unstage, validate, setAlloc, setPolicy, setEmergency } from '../sim/commands.js';
import { petition, isCouncilTurn } from '../sim/council.js';
import { evaluateAchievements } from '../sim/chronicle.js';
import { civCities, tileAt } from '../sim/economy.js';
import { armyPath } from '../sim/army.js';
import { forecast } from '../sim/combat.js';
import { serialize, deserialize, saveToSlot, loadFromSlot, hasSave, deleteSlot, loadProfile, saveProfile } from '../sim/save.js';
import { botTurn } from '../sim/bot.js';
import { act, pendingView, expeditionSites, startExpedition, engageThreat } from '../sim/run.js';
import { heroMove, heroPath, heroDistMap, heroStats } from '../sim/hero.js';
import { advise } from '../sim/advisor.js';
import { key, dist } from '../sim/hex.js';
import { Renderer } from './render.js';
import { Sound } from './audio.js';
import { $, $$, esc, toast } from './dom.js';
import * as P from './panels.js';

const SETTINGS_KEY = 'stotkal.settings';
const defaults = { textScale: 1, reducedMotion: false, quietLayer: true, music: 0.35, fx: 0.5, debug: false, timedBeats: true, beatSeconds: 15, showAll: false };
function loadSettings() { try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); const m = { ...defaults, ...(s || {}) }; if (!s && window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) m.reducedMotion = true; return m; } catch (e) { return { ...defaults }; } }
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(app.settings)); } catch (e) { } };

const app = {
  S: null, profile: loadProfile(), settings: loadSettings(), hasSave: false,
  ui: { sheet: 'context', sel: null, hover: null, modal: null, queue: [], targeting: null, path: null, hoverFc: null, heroPath: null, reach: null, time: 0, setup: { tradition: 'keepers', disp: 'listener', seed: '', fresh: false, world: null, seasons: [] }, devOpen: null, replaceIdx: undefined, approach: 'assault', logFilter: 'you', guideOff: false, slot: undefined, legacyPick: -1, debugReveal: false, settings: null, revealed: {}, timer: null, radial: true, heroMax: 10 },
};
app.ui.settings = app.settings;
const snd = new Sound(); snd.music = app.settings.music; snd.fx = app.settings.fx;
let renderer, dirty = true, saveTimer = null;
window.__stotkal = app; // for debugging and automated screenshots
app.refresh = () => refresh();

// ------------------------------------------------------------------ boot
function boot() {
  if (innerWidth <= 860) document.body.classList.add('panel-closed');
  const errs = validateContent(); if (errs.length) { document.body.innerHTML = `<pre style="padding:20px;color:#fff">Content validation failed:\n${esc(errs.join('\n'))}</pre>`; return; }
  renderer = new Renderer($('#map')); app.renderer = renderer; app.hasSave = hasSave('auto'); applySettings();
  const q = new URLSearchParams(location.search); if (q.get('debug')) app.settings.debug = true;
  openSetup(true); bind(); layout(); requestAnimationFrame(loop);
  if (q.get('seed') && q.get('auto')) { app.ui.setup.seed = q.get('seed'); if (q.get('world')) app.ui.setup.world = q.get('world'); beginRun(); }
}
function applySettings() {
  document.documentElement.style.setProperty('--scale', app.settings.textScale); document.body.classList.toggle('reduced', !!app.settings.reducedMotion);
  snd.setMusic(app.settings.music); snd.setFx(app.settings.fx); app.ui.settings = app.settings; saveSettings(); dirty = true;
}
function layout() {
  const top = $('#top'), bot = $('#bottom'), side = $('#side'); const narrow = innerWidth <= 860;
  side.style.top = (narrow ? '' : top.offsetHeight + 'px'); side.style.bottom = bot.offsetHeight + 'px';
  renderer.resize(narrow ? 0 : side.offsetWidth, top.offsetHeight, bot.offsetHeight + (narrow ? side.offsetHeight : 0)); dirty = true;
}
function loop(t) {
  app.ui.time = t; const anim = !app.settings.reducedMotion;
  if (app.S && (dirty || anim || (renderer.heroVis && renderer.heroVis.moving))) {
    if (!anim || t - (loop.last || 0) > 30 || dirty) { app.ui.heroMax = heroStats(app.S).maxHp; renderer.draw(app.S, { ...app.ui, settings: app.settings }); positionRadial(); loop.last = t; dirty = false; }
  } else if (dirty && !app.S) { const g = renderer.g; g.fillStyle = '#262938'; g.fillRect(0, 0, renderer.W, renderer.H); dirty = false; }
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ run lifecycle
function rollSeasons() { const ids = Object.keys(SEASONS).slice(); const out = []; while (out.length < 3 && ids.length) out.push(ids.splice(Math.floor(Math.random() * ids.length), 1)[0]); return out; }
function openSetup(first) { const st = app.ui.setup; if (!st.seasons.length) { st.seasons = rollSeasons(); st.world = st.seasons[0]; } app.hasSave = hasSave('auto'); app.ui.modal = { type: 'setup', canClose: !first && !!app.S }; document.body.dataset.screen = 'setup'; refresh(); }
function weave(then) { const el = $('#loading'); el.classList.add('on'); setTimeout(() => { try { renderer.setWorld(app.S); } finally { el.classList.remove('on'); then && then(); } }, 40); }
function startedRun() {
  const S = app.S; S.manual = true; app.ui.modal = null; app.ui.queue = []; app.ui.guideOff = false; app.ui.devOpen = null; app.ui.heroPath = null; app.ui.revealed = {}; document.body.dataset.screen = 'play';
  const h = S.hero; app.ui.sel = { q: h.q, r: h.r }; refresh(); layout(); renderer.focusOn(h.q, h.r, 1.55); updateReach(); dirty = true;
}
function beginRun() {
  const st = app.ui.setup; const seed = ($('#seedin') && $('#seedin').value.trim()) || st.seed || Math.random().toString(36).slice(2, 8);
  const legacy = app.profile.legacy && !st.fresh ? app.profile.legacy : null;
  try { app.S = newRun({ seed, tradition: st.tradition, disp: st.disp, legacy, fresh: st.fresh, world: st.world }); } catch (e) { toast('Could not generate a world for that seed: ' + e.message, 'err'); return; }
  weave(() => { startedRun(); persist(); snd.start(); snd.turn(); const S = app.S; toast(`Seed "${seed}" · Season: ${SEASONS[S.worldId].name}. Walk, build, and decide what is kept.`); });
}
function continueRun() {
  const r = loadFromSlot('auto'); if (!r.ok) { toast(r.message, 'err'); app.ui.modal = { type: 'message', title: 'Save could not be restored', text: r.message }; refresh(); return; }
  app.S = r.S; if (r.notes && r.notes.length) toast('Save repaired: ' + r.notes.length + ' reference(s) to changed content were removed.', 'err');
  weave(() => { startedRun(); if (app.S.over) openEnding(); else if (isCouncilDue()) app.ui.modal = { type: 'council' }; refresh(); snd.start(); });
}
const isCouncilDue = () => { const S = app.S; return !!(S.council.offers && S.council.turn === S.turn && !S.council.chosen && !S.staged.you.some(c => c.type === 'council')); };
function persist(now) { if (!app.S) return; clearTimeout(saveTimer); const go = () => { if (app.S.over) return; saveToSlot(app.S, 'auto'); }; if (now) go(); else saveTimer = setTimeout(go, 350); }
function openEnding() {
  const S = app.S; if (!S.ending.recorded) { S.ending.recorded = true; const got = evaluateAchievements(S); app.profile.achievements = app.profile.achievements || []; S.ending.newAchievements = got.filter(id => !app.profile.achievements.includes(id)); app.profile.achievements = [...new Set([...app.profile.achievements, ...got])]; app.profile.runs++; app.profile.history.push({ seed: S.seed, turn: S.turn, ambition: S.ending.ambition, success: S.ending.success, head: S.ending.chronicle.head, at: Date.now() }); app.profile.history = app.profile.history.slice(-30); saveProfile(app.profile); deleteSlot('auto'); }
  app.ui.legacyPick = -1; app.ui.modal = { type: 'ending' };
}
function commitTurn() {
  const S = app.S; closeModal(true);
  let r; try { r = endTurn(S); } catch (e) { console.error(e); toast('The simulation hit an error: ' + e.message, 'err'); return; }
  if (r && r.blocked) { toast('A decision is waiting first.', 'err'); refresh(); return; }
  app.ui.path = null; app.ui.targeting = null; app.ui.heroPath = null; snd.turn(); renderer.follow = true;
  if (S.over) { openEnding(); refresh(); return; }
  persist(true); app.ui.queue = []; app.ui.modal = { type: 'summary' }; if (isCouncilDue()) app.ui.queue.push({ type: 'council' });
  if (S.proposals.some(p => p.to === 'you')) app.ui.sheet = P.tabVisible(app, 'diplo') ? 'diplo' : app.ui.sheet;
  updateReach(); refresh();
}
function closeModal(silent) { app.ui.modal = null; if (!silent) { const n = app.ui.queue.shift(); if (n) app.ui.modal = n; refresh(); } }

// ------------------------------------------------------------------ refresh (DOM)
function syncPending() { const S = app.S; if (!S || S.over) return; const m = app.ui.modal; if (S.pending.length && (!m || m.type === 'pending-wait')) app.ui.modal = { type: 'pending' }; else if (!S.pending.length && m && m.type === 'pending') app.ui.modal = null; }
function refresh() {
  const S = app.S; const ui = app.ui; const active = document.activeElement; let fk = null;
  if (active && active.dataset && active.dataset.act && active.closest('#side, #bottom, .modal')) fk = [active.dataset.act, JSON.stringify(active.dataset)];
  syncPending();
  if (S) {
    $('#top').innerHTML = P.topbar(app); $('#bottom').innerHTML = P.bottombar(app);
    const side = $('#side'); const old = $('#sidebody'); const sc = old ? old.scrollTop : 0; const same = old && side.dataset.sheet === ui.sheet; side.innerHTML = P.sidePanel(app); side.dataset.sheet = ui.sheet; if (same) $('#sidebody').scrollTop = sc;
    $$('.guide').forEach(g => g.remove()); renderRadial(); checkReveal();
  } else { $('#top').innerHTML = '<div class="brand"><b>Stotkal</b> <i>·</i> what remains</div>'; $('#side').innerHTML = ''; $('#bottom').innerHTML = ''; $('#radial').innerHTML = ''; }
  const mr = $('#modal-root'); const oldModal = $('.modal', mr); const msc = oldModal ? oldModal.scrollTop : 0; const hadType = mr.dataset.type;
  const sig = ui.modal ? ui.modal.type + (ui.modal.site || '') + (S && S.pending.length ? S.pending[0].type + (S.pending[0].id || '') + (S.exped ? S.exped.layer + ':' + (S.exped.room ? 1 : 0) : '') : '') : '';
  mr.innerHTML = P.modalHtml(app); mr.dataset.type = sig; if (hadType === sig && $('.modal', mr)) $('.modal', mr).scrollTop = msc;
  if (fk) { const cand = $$(`[data-act="${fk[0]}"]`).find(b => JSON.stringify(b.dataset) === fk[1]); if (cand && !cand.disabled) cand.focus({ preventScroll: true }); }
  else if (ui.modal && !hadType) { const f = $('.modal button:not(.close), .modal input'); if (f) f.focus({ preventScroll: true }); }
  if (S) layout(); armTimer(); dirty = true;
}
function checkReveal() {
  const S = app.S; const rv = P.uiStage(app); const names = { ene: 'Energy', mem: 'Memory', empire: 'Empire (research & institutions)', diplo: 'Diplomacy', quiet: 'the Quieting forecast', ambition: 'Ambitions' };
  for (const k of Object.keys(names)) { if (rv[k] && !app.ui.revealed[k]) { app.ui.revealed[k] = true; if (S.turn > 1 && !app.settings.showAll) toast(`New: ${names[k]} is now in view.`); } }
}

// ------------------------------------------------------------------ the radial menu
function renderRadial() {
  const el = $('#radial'); const S = app.S; const ui = app.ui; if (!S || ui.modal || ui.targeting || !ui.sel || !ui.radial) { el.innerHTML = ''; el.dataset.key = ''; return; }
  const items = P.radialItems(app); const k = JSON.stringify([ui.sel, items.map(i => [i.label, i.disabled, i.badge])]); if (el.dataset.key === k) return; el.dataset.key = k;
  const n = items.length; el.innerHTML = items.map((it, i) => { const a = (-90 + (360 / Math.max(n, 1)) * i) * Math.PI / 180; const rad = n <= 3 ? 58 : 66; return `<button class="rad ${it.cls || ''}" style="--dx:${Math.round(Math.cos(a) * rad)}px;--dy:${Math.round(Math.sin(a) * rad)}px" data-act="${it.act}" ${it.data ? Object.entries(it.data).map(([k2, v]) => `data-${k2}='${esc(typeof v === 'object' ? JSON.stringify(v) : v)}'`).join(' ') : ''} ${it.disabled ? 'disabled' : ''} title="${esc(it.title || it.label)}" aria-label="${esc(it.label)}"><span class="ic">${it.icon}</span><span class="lb">${esc(it.label)}</span>${it.badge ? `<small>${esc(it.badge)}</small>` : ''}</button>`; }).join('');
}
function positionRadial() {
  const el = $('#radial'); const ui = app.ui; if (!el.firstChild || !ui.sel || !app.S) return; const p = renderer.xy(ui.sel.q, ui.sel.r); el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y - renderer.R * 0.3)}px)`;
  const off = p.x < 0 || p.x > renderer.W - renderer.panelW || p.y < renderer.topH || p.y > renderer.H - renderer.botH; el.style.opacity = off ? 0 : 1; el.style.pointerEvents = off ? 'none' : '';
}

// ------------------------------------------------------------------ the hero
function updateReach() { const S = app.S; if (!S || !S.hero) return; const { dst } = heroDistMap(S); const out = new Set(); for (const [k, c] of dst) if (c > 0 && c <= S.hero.movesLeft) out.add(k); app.ui.reach = out; }
function previewPath(t) {
  const S = app.S; app.ui.heroPath = null; if (!t || S.pending.length) return; if (t.q === S.hero.q && t.r === S.hero.r) return;
  const p = heroPath(S, t); if (p && p.path.length) app.ui.heroPath = { steps: p.path, cost: p.cost, turns: p.turns };
}
function walkTo(q, r) {
  const S = app.S; const res = heroMove(S, q, r); if (!res.ok) { toast(res.error, 'err'); return; }
  if (!res.moved) { toast('Out of movement this turn. End the turn to keep walking.', 'err'); return; }
  snd.click(); app.ui.heroPath = null; renderer.follow = true; updateReach(); persist();
  const near = expeditionSites(S)[0]; if (near) toast(`You stand beside ${near.name}. Enter it?`);
  const th = Object.values(S.threats).find(t => dist(t, S.hero) <= 1 && S.civs.you.obs[key(t.q, t.r)]); if (th) toast('A threat is within reach. Select it to engage.');
  const rest = res.done ? '' : ' (out of movement: it will continue next turn)'; if (!res.done) toast('Moved ' + res.moved + ' tile(s)' + rest);
  app.ui.sel = { q: S.hero.q, r: S.hero.r }; refresh();
}

// ------------------------------------------------------------------ staging helpers
function doStage(cmd, quiet) {
  const r = stage(app.S, 'you', cmd); if (!r.ok) { toast(r.error, 'err'); snd.warn(); return r; }
  snd.confirm(); if (!quiet) toast('Staged: ' + P.describeCmd(app.S, r.cmd) + (r.cmd.order ? '' : ' (free)'));
  app.ui.path = null; persist(); refresh(); return r;
}
function validTargets(kind, extra) {
  const S = app.S; const set = new Set();
  for (const t of Object.values(S.map.tiles)) {
    let cmd;
    if (kind === 'survey') cmd = { type: 'survey', q: t.q, r: t.r }; else if (kind === 'claim') cmd = { type: 'claim', q: t.q, r: t.r }; else if (kind === 'outpost') cmd = { type: 'outpost', q: t.q, r: t.r };
    else if (kind === 'city') { const src = civCities(S, 'you').filter(c => !validate(S, 'you', { type: 'city', q: t.q, r: t.r, source: c.id }))[0]; if (src) set.add(key(t.q, t.r)); continue; }
    else if (kind === 'objective') cmd = { type: 'objective', army: extra.army, obj: extra.obj, q: t.q, r: t.r, approach: extra.approach };
    if (cmd && !validate(S, 'you', cmd)) set.add(key(t.q, t.r));
  }
  return set;
}
function potentialSites() {
  const S = app.S; const out = new Set(); const src = civCities(S, 'you').sort((a, b) => b.pop - a.pop)[0]; if (!src) return out;
  for (const t of Object.values(S.map.tiles)) { const err = validate(S, 'you', { type: 'city', q: t.q, r: t.r, source: src.id }); if (err && /touch territory/.test(err)) out.add(key(t.q, t.r)); }
  return out;
}
function startTarget(kind, extra = {}) {
  const set = validTargets(kind, extra); if (!set.size) { toast('There is no valid target for that right now.', 'err'); return; }
  let opens = null, potential = null;
  if (kind === 'claim') { potential = potentialSites(); opens = new Set([...set].filter(k => { const [q, r] = k.split(',').map(Number); return [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]].some(([a, b]) => potential.has(key(q + a, r + b))); })); }
  app.ui.targeting = { kind, ...extra, targets: set, opens, potential }; renderRadial(); toast(kind === 'claim' ? 'Choose a tile · ⌂+ marks tiles that bring a future city site within reach · Esc cancels' : 'Choose a highlighted tile · Esc cancels'); dirty = true;
}
function finishTarget(tile) {
  const S = app.S; const tg = app.ui.targeting; let cmd;
  if (tg.kind === 'city') { const src = civCities(S, 'you').filter(c => !validate(S, 'you', { type: 'city', q: tile.q, r: tile.r, source: c.id })).sort((a, b) => dist(a, tile) - dist(b, tile))[0]; cmd = { type: 'city', q: tile.q, r: tile.r, source: src.id }; }
  else if (tg.kind === 'objective') cmd = { type: 'objective', army: tg.army, obj: tg.obj, q: tile.q, r: tile.r, approach: tg.approach };
  else cmd = { type: tg.kind, q: tile.q, r: tile.r };
  app.ui.targeting = null; app.ui.hoverFc = null; app.ui.path = null; doStage(cmd);
}
function hoverFor(tile) {
  const S = app.S; const tg = app.ui.targeting; app.ui.path = null; app.ui.hoverFc = null;
  if (tg && tg.kind === 'objective' && tg.targets.has(key(tile.q, tile.r))) {
    const a = S.armies[tg.army]; const p = armyPath(S, a, tile); if (p) { app.ui.path = { from: { q: a.q, r: a.r }, steps: p.steps, breaks: p.breaks };
      const hostile = tile.city || Object.values(S.armies).some(x => x.q === tile.q && x.r === tile.r && x.owner !== 'you');
      if (hostile) { const fc = forecast(S, [a], tile, tg.approach); fc.path = p; app.ui.hoverFc = fc; } else app.ui.hoverFc = { attPower: 0, defPower: 0, attLoss: 0, defLoss: 0, notes: ['No enemy known there.'], city: null, integrityDmg: 0, path: p, conditional: [] }; }
  }
}
function showStagedPath() {
  const S = app.S; app.ui.path = null; const sel = app.ui.sel; if (!sel || app.ui.targeting) return;
  const a = Object.values(S.armies).find(x => x.owner === 'you' && x.q === sel.q && x.r === sel.r); if (!a) return;
  const cmd = S.staged.you.find(c => c.type === 'objective' && c.army === a.id && c.obj !== 'guard'); const tgt = cmd || (a.obj.type !== 'guard' ? { q: a.obj.q, r: a.obj.r } : null); if (!tgt) return;
  const p = armyPath(S, a, tgt); if (p) app.ui.path = { from: { q: a.q, r: a.r }, steps: p.steps, breaks: p.breaks };
}
function selectTile(t, opts = {}) {
  const S = app.S; const army = Object.values(S.armies).find(a => a.owner === 'you' && a.q === t.q && a.r === t.r); app.ui.sel = { q: t.q, r: t.r, army: army && army.id }; if (!opts.keepSheet) app.ui.sheet = 'context';
  document.body.classList.remove('panel-closed'); previewPath(t); showStagedPath(); refresh();
}

// ------------------------------------------------------------------ pending decisions (timed beats, expeditions, boons, crossroads)
function doAct(a) {
  const S = app.S; const r = act(S, a); if (!r.ok) { toast(r.error, 'err'); snd.warn(); return r; }
  snd.confirm(); clearTimeout(app.ui.timerHandle); app.ui.timer = null; persist(true); updateReach(); if (r.expelled) toast('The Witness was driven out. She is Frayed for two turns.', 'err');
  if (!S.pending.length) { app.ui.modal = null; app.ui.slot = undefined; }
  const th = r.ctx && r.ctx.loot ? Object.entries(r.ctx.loot).map(([k, v]) => '+' + v + ' ' + k).join(' ') : ''; if (r.text) toast(r.text + (th ? ' ' + th : ''));
  refresh(); return r;
}
function armTimer() {
  const S = app.S; clearTimeout(app.ui.timerHandle); clearInterval(app.ui.timerTick); const m = app.ui.modal;
  if (!S || !m || m.type !== 'pending' || !S.pending.length || S.pending[0].type !== 'beat' || !S.pending[0].timed || !app.settings.timedBeats) { app.ui.timer = null; return; }
  const p = S.pending[0]; const tk = p.id + ':' + S.turn; const dur = app.settings.beatSeconds * 1000;
  if (!app.ui.timer || app.ui.timer.key !== tk) app.ui.timer = { key: tk, start: performance.now() };
  const tick = () => { const bar = $('#beat-timer'); if (!bar) return; const left = Math.max(0, dur - (performance.now() - app.ui.timer.start)); bar.style.width = (left / dur * 100) + '%'; const num = $('#beat-timer-n'); if (num) num.textContent = Math.ceil(left / 1000) + 's'; if (left <= 0) { clearInterval(app.ui.timerTick); const v = pendingView(S); if (v && v.type === 'beat') doAct({ type: 'beat', id: v.fallback, timeout: true }); } };
  app.ui.timerTick = setInterval(() => { if (!document.hidden) { tick(); } else app.ui.timer.start += 250; }, 100); tick();
}

// ------------------------------------------------------------------ actions (data-act dispatch)
const ACT = {
  stage: (d) => { doStage(JSON.parse(d.cmd)); },
  unstage: (d) => { unstage(app.S, 'you', d.id); persist(); refresh(); },
  sheet: (d) => { if (innerWidth <= 860 && app.ui.sheet === d.s && !document.body.classList.contains('panel-closed')) document.body.classList.add('panel-closed'); else document.body.classList.remove('panel-closed'); app.ui.sheet = d.s; refresh(); layout(); },
  modal: (d) => { app.ui.modal = d.m === 'council' ? { type: 'council' } : { type: d.m }; refresh(); },
  closemodal: () => { if (app.ui.modal && (app.ui.modal.type === 'setup' && !app.S || app.ui.modal.type === 'pending')) return; closeModal(); },
  scrim: (d, e) => { if (e.target.classList.contains('scrim') && app.ui.modal && !['ending', 'setup', 'pending'].includes(app.ui.modal.type)) closeModal(); },
  select: (d) => { selectTile({ q: +d.q, r: +d.r }); renderer.follow = false; renderer.focusOn(+d.q, +d.r); renderer.follow = false; },
  discovery: (d) => { app.ui.slot = undefined; app.ui.modal = { type: 'discovery', site: d.site }; refresh(); },
  slot: (d) => { app.ui.slot = +d.i; refresh(); },
  devtoggle: (d) => { app.ui.devOpen = app.ui.devOpen === d.city ? null : d.city; app.ui.replaceIdx = undefined; app.ui.sheet = 'context'; refresh(); },
  replacepick: (d) => { app.ui.replaceIdx = +d.i; refresh(); },
  target: (d) => { if (d.kind === 'objective') startTarget('objective', { army: d.army, obj: d.obj, approach: d.obj === 'raid' ? 'raid' : d.obj === 'besiege' ? (app.ui.approach === 'assault' ? 'siege' : app.ui.approach) : app.ui.approach === 'siege' || app.ui.approach === 'raid' ? 'assault' : app.ui.approach }); else startTarget(d.kind); },
  approach: (d) => { app.ui.approach = d.ap; refresh(); },
  alloc: (d) => { setAlloc(app.S, 'you', +d.n); persist(); refresh(); },
  policy: (d) => { setPolicy(app.S, 'you', d.p); persist(); refresh(); },
  emergency: (d) => { const c = app.S.civs.you; setEmergency(app.S, 'you', c.emergency === d.m ? null : d.m); persist(); refresh(); },
  endturn: () => { if (app.S.over) return; if (app.S.pending.length) { toast('A decision is waiting first.', 'err'); return; } app.ui.modal = { type: 'commit' }; refresh(); },
  commit: () => commitTurn(),
  council: (d) => { const S = app.S; const ex = S.staged.you.find(c => c.type === 'council'); if (ex) unstage(S, 'you', ex.id); if (d.offer && !(ex && ex.offer === d.offer)) { const r = stage(S, 'you', { type: 'council', offer: d.offer }); if (!r.ok) toast(r.error, 'err'); else { snd.confirm(); toast('Council choice staged. It resolves when you end the turn.'); } } persist(); refresh(); },
  petition: () => { const r = petition(app.S); if (!r.ok) toast(r.error, 'err'); else { app.S.staged.you = app.S.staged.you.filter(c => c.type !== 'council'); toast('The council offers a different opportunity.'); persist(true); } refresh(); },
  setup: (d) => { app.ui.setup[d.k] = d.v; const si = $('#seedin'); if (si) app.ui.setup.seed = si.value; refresh(); },
  setupfresh: (d, e) => { app.ui.setup.fresh = e.target.checked; const si = $('#seedin'); if (si) app.ui.setup.seed = si.value; refresh(); },
  beginrun: () => beginRun(), continue: () => continueRun(),
  guideoff: () => { app.ui.guideOff = true; refresh(); },
  logfilter: (d) => { app.ui.logFilter = d.f; refresh(); },
  legacy: (d) => { app.ui.legacyPick = +d.i; refresh(); },
  nextrun: () => { const S = app.S; const l = S.ending.legacies[app.ui.legacyPick]; app.profile.legacy = l && l.eligible ? { kind: l.kind, name: l.name, fragment: l.fragment, inst: l.inst || null, relic: l.relic || null } : null; saveProfile(app.profile); app.ui.setup.seed = ''; app.ui.setup.fresh = false; app.ui.setup.seasons = []; app.S = null; app.ui.modal = null; openSetup(true); },
  newrun: () => { app.ui.modal = null; app.S && deleteSlot('auto'); app.S = null; app.ui.setup.seasons = []; openSetup(true); },
  savenow: () => { persist(true); toast('Saved.'); },
  exportsave: () => { const blob = new Blob([serialize(app.S)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `stotkal-${app.S.seed}-t${app.S.turn}.json`; a.click(); },
  set: (d, e) => { app.settings[d.k] = +e.target.value; applySettings(); if (d.k === 'textScale') { refresh(); layout(); } },
  setb: (d, e) => { app.settings[d.k] = e.target.checked; applySettings(); refresh(); },
  dbg: (d) => { const S = app.S; if (d.a === 'res') for (const k of Object.keys(S.civs.you.res)) S.civs.you.res[k] += 20; if (d.a === 'reveal') app.ui.debugReveal = !app.ui.debugReveal; const ff = (n) => { S.manual = false; while (!S.over && S.turn < n) { botTurn(S, 'veil', 'embodied'); endTurn(S); } S.manual = true; }; if (d.a === 'ff1') ff(S.turn + 1); if (d.a === 'ff12') ff(12); if (d.a === 'ff29') ff(29); updateReach(); refresh(); },
  // --- hero & world actions ---
  walk: (d) => walkTo(+d.q, +d.r),
  enter: (d) => { const r = startExpedition(app.S, d.site); if (!r.ok) { toast(r.error, 'err'); return; } snd.chime && snd.chime(520, 0.1); refresh(); },
  engage: (d) => { const r = engageThreat(app.S, d.id); if (!r.ok) { toast(r.error, 'err'); return; } refresh(); },
  home: () => { const c = civCities(app.S, 'you')[0]; if (c) { selectTile(tileAt(app.S, c.q, c.r)); previewPath(tileAt(app.S, c.q, c.r)); refresh(); } },
  advisor: (d) => { const a = JSON.parse(d.a); runAdvice(a); },
  // pending decisions
  pbeat: (d) => doAct({ type: 'beat', id: d.id }), pdoor: (d) => doAct({ type: 'door', i: +d.i }), proom: (d) => doAct({ type: 'room', id: d.id }), pleave: () => doAct({ type: 'leave' }),
  pheart: (d) => doAct({ type: 'heart', id: d.id, slot: app.ui.slot ?? app.S.civs.you.inst.findIndex(x => !x) }), pboon: (d) => doAct({ type: 'boon', id: d.id }), pcross: (d) => doAct({ type: 'cross', id: d.id }), pboss: (d) => doAct({ type: 'boss', id: d.id }),
  dismiss: () => { /* no-op placeholder for static cards */ },
  radialtoggle: () => { app.ui.radial = !app.ui.radial; refresh(); },
};
function runAdvice(a) {
  const S = app.S; const A = a.act || a;
  switch (A.kind) {
    case 'select': selectTile(tileAt(S, A.q, A.r)); renderer.focusOn(A.q, A.r); renderer.follow = false; break;
    case 'stage': doStage(A.cmd); selectTile(tileAt(S, A.q, A.r)); break;
    case 'enter': ACT.enter({ site: A.site }); break;
    case 'walk': { const t = tileAt(S, A.q, A.r); selectTile(t); previewPath(t); refresh(); toast('Click the tile again (or press W) to walk there.'); break; }
    case 'explore': { const { dst } = heroDistMap(S); let best = null; for (const t of Object.values(S.map.tiles)) { const c = dst.get(key(t.q, t.r)); if (c === undefined || S.civs.you.seen[key(t.q, t.r)] && false) continue; let g = 0; for (const o of Object.values(S.map.tiles)) if (!S.civs.you.seen[key(o.q, o.r)] && dist(o, t) <= S.hero.sight) g++; const sc = g / (1 + c * 0.5); if (g > 2 && (!best || sc > best.sc)) best = { t, sc }; } if (best) { selectTile(best.t); previewPath(best.t); refresh(); toast('Click again (or press W) to walk toward the unknown.'); } break; }
    case 'sheet': ACT.sheet({ s: A.s }); break; case 'council': app.ui.modal = { type: 'council' }; refresh(); break; case 'end': ACT.endturn(); break; case 'home': ACT.home(); break;
    case 'hint-settle': startTarget('claim'); break; default: break;
  }
}

// ------------------------------------------------------------------ input
function bind() {
  document.addEventListener('click', (e) => { if (!e.target.closest) return; const el = e.target.closest('[data-act]'); if (!el || el.tagName === 'INPUT' && el.type !== 'button') return; if (el.disabled) return; const f = ACT[el.dataset.act]; if (f) { snd.start(); f(el.dataset, e); } });
  document.addEventListener('input', (e) => { const el = e.target.closest && e.target.closest('[data-act]'); if (el && el.tagName === 'INPUT' && el.type === 'range' && ACT[el.dataset.act]) ACT[el.dataset.act](el.dataset, e); });
  document.addEventListener('change', (e) => { const el = e.target.closest && e.target.closest('[data-act]'); if (el && el.type === 'checkbox' && ACT[el.dataset.act]) ACT[el.dataset.act](el.dataset, e); if (e.target.id === 'importfile') importFile(e.target.files[0]); });
  const tip = $('#tooltip'); const showTip = (el, x, y) => { tip.innerHTML = el.dataset.tip; tip.classList.add('on'); const r = tip.getBoundingClientRect(); tip.style.left = Math.min(innerWidth - r.width - 8, Math.max(8, x)) + 'px'; tip.style.top = Math.min(innerHeight - r.height - 8, y + 18) + 'px'; };
  document.addEventListener('mouseover', (e) => { if (!e.target.closest) return; const el = e.target.closest('[data-tip]'); if (el) showTip(el, e.clientX, e.clientY); }); document.addEventListener('mouseout', (e) => { if (e.target.closest && e.target.closest('[data-tip]')) tip.classList.remove('on'); });
  document.addEventListener('focusin', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) { const r = el.getBoundingClientRect(); showTip(el, r.left, r.bottom - 14); } }); document.addEventListener('focusout', () => tip.classList.remove('on'));
  const cv = $('#map'); let drag = null;
  cv.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, mm: renderer.mm ? renderer.minimapHit(e.clientX - cv.getBoundingClientRect().left, e.clientY - cv.getBoundingClientRect().top) : null }; });
  window.addEventListener('mouseup', (e) => { if (!drag) return; const was = drag; drag = null; if (was.moved) return; if (was.mm) { renderer.lookAt(was.mm.x, was.mm.y); dirty = true; return; } canvasClick(e); });
  window.addEventListener('mousemove', (e) => { if (drag) { const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly; if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 5) drag.moved = true; if (drag.moved && !drag.mm) { renderer.pan(dx, dy); dirty = true; } drag.lx = e.clientX; drag.ly = e.clientY; return; } if (e.target === cv) canvasMove(e); else { app.ui.hover = null; $('#map-hover').style.display = 'none'; } });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); renderer.zoomBy(e.deltaY < 0 ? 1.1 : 0.91); dirty = true; }, { passive: false });
  cv.addEventListener('dblclick', (e) => { if (!app.S || app.ui.modal || app.ui.targeting) return; const t = canvasPick(e); if (t) { const p = heroPath(app.S, t); if (p && p.path.length) walkTo(t.q, t.r); } });
  window.addEventListener('resize', () => layout());
  window.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', () => persist(true));
}
function importFile(f) { if (!f) return; f.text().then(t => { const r = deserialize(t); if (!r.ok) { toast(r.message, 'err'); return; } app.S = r.S; saveToSlot(app.S, 'auto'); weave(() => { startedRun(); toast('Save imported.'); }); }); }
function canvasPick(e) { const r = $('#map').getBoundingClientRect(); return renderer.pick(e.clientX - r.left, e.clientY - r.top, app.S ? app.S.map.tiles : {}); }
function canvasClick(e) {
  if (!app.S || app.ui.modal || e.target !== $('#map')) return; const t = canvasPick(e);
  if (!t) { if (app.ui.targeting) { app.ui.targeting = null; refresh(); } return; }
  const tg = app.ui.targeting; if (tg) { if (tg.targets.has(key(t.q, t.r))) finishTarget(t); else toast('Not a valid target. ' + (validateReason(tg, t) || ''), 'err'); return; }
  const S = app.S; const sel = app.ui.sel;
  if (sel && sel.q === t.q && sel.r === t.r && app.ui.heroPath) { walkTo(t.q, t.r); return; } // click the same tile again: walk there
  snd.click(); selectTile(t);
}
function validateReason(tg, t) { const S = app.S; const probe = { survey: { type: 'survey' }, claim: { type: 'claim' }, outpost: { type: 'outpost' } }[tg.kind]; if (probe) return validate(S, 'you', { ...probe, q: t.q, r: t.r }); if (tg.kind === 'objective') return validate(S, 'you', { type: 'objective', army: tg.army, obj: tg.obj, q: t.q, r: t.r }); if (tg.kind === 'city') { const c = civCities(S, 'you').sort((a, b) => dist(a, t) - dist(b, t))[0]; return validate(S, 'you', { type: 'city', q: t.q, r: t.r, source: c.id }); } return ''; }
function canvasMove(e) {
  if (!app.S) return; const t = canvasPick(e); const prev = app.ui.hover; app.ui.hover = t ? { q: t.q, r: t.r } : null;
  const mh = $('#map-hover'); if (t && !app.ui.modal) { const S = app.S; const you = S.civs.you; const seen = you.seen[key(t.q, t.r)]; const own = t.owner ? (t.owner === 'you' ? 'yours' : t.owner === 'ind' ? 'independent' : FACTIONS[t.owner].short) : 'unclaimed'; mh.style.cssText = `display:block;position:fixed;left:${e.clientX + 14}px;top:${e.clientY + 14}px;z-index:9;pointer-events:none;background:rgba(34,37,46,.9);color:#f7f2e8;padding:3px 8px;border-radius:7px;font-size:.78rem;`; mh.textContent = seen ? `${TERRAIN[t.t].name} · ${own}${t.city ? ' · ' + S.cities[t.city].name : ''}${t.site && you.disc[t.site] ? ' · ' + S.sites[t.site].name : ''}` : 'unexplored'; } else mh.style.display = 'none';
  if (app.ui.targeting && t) { const had = app.ui.hoverFc; hoverFor(t); if (had !== app.ui.hoverFc || prev?.q !== t.q || prev?.r !== t.r) refresh(); }
  dirty = true;
}
function moveSel(dq, dr) {
  const S = app.S; let s = app.ui.sel; if (!s) s = { q: S.hero.q, r: S.hero.r };
  const nt = tileAt(S, s.q + dq, s.r + dr); if (!nt) return; renderer.ensureVisible(nt.q, nt.r); selectTile(nt);
}
function onKey(e) {
  const tag = (e.target.tagName || '').toLowerCase(); const typing = tag === 'input' && e.target.type === 'text' || tag === 'textarea';
  if (e.key === 'D' && e.shiftKey && e.ctrlKey) { app.settings.debug = !app.settings.debug; applySettings(); refresh(); return; }
  if (e.key === 'Escape') { if (app.ui.targeting) { app.ui.targeting = null; app.ui.path = null; app.ui.hoverFc = null; refresh(); return; } if (app.ui.modal && !['ending', 'setup', 'pending'].includes(app.ui.modal.type)) { closeModal(); return; } if (app.ui.heroPath) { app.ui.heroPath = null; dirty = true; return; } if (app.ui.sheet !== 'context') { app.ui.sheet = 'context'; refresh(); } return; }
  if (typing || !app.S || e.ctrlKey || e.metaKey || e.altKey) return;
  const M = app.ui.modal;
  if (e.key === 'Enter') { if (M && M.type === 'commit') { e.preventDefault(); commitTurn(); return; } if (M && M.type === 'summary') { e.preventDefault(); closeModal(); return; } if (!M && e.target.tagName !== 'BUTTON') { e.preventDefault(); ACT.endturn(); } return; }
  if (M) { if (M.type === 'pending' && /^[1-9]$/.test(e.key)) { const btns = $$('.modal [data-act^="p"]:not([disabled])'); const b = btns[+e.key - 1]; if (b) b.click(); } return; }
  const k = e.key.toLowerCase();
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: e.shiftKey ? [0, -1] : [1, -1], ArrowDown: e.shiftKey ? [0, 1] : [-1, 1] };
  if (arrows[e.key] && e.target.tagName !== 'INPUT') { e.preventDefault(); moveSel(...arrows[e.key]); return; }
  const sheets = { e: 'empire', d: 'diplo', q: 'quiet', a: 'ambition', l: 'log', m: 'context' };
  if (sheets[k] && P.tabVisible(app, sheets[k] === 'context' ? 'context' : sheets[k])) { ACT.sheet({ s: sheets[k] }); return; }
  if (k === 'g') { app.ui.modal = { type: 'guide' }; refresh(); return; }
  if (k === 'c') { app.ui.modal = { type: 'council' }; if (!app.S.council.offers || app.S.council.turn !== app.S.turn) { app.ui.modal = null; toast('No council session this turn (turns 3, 6, 9 … 27).'); } refresh(); return; }
  if (k === 'u') { const l = app.S.staged.you[app.S.staged.you.length - 1]; if (l) { unstage(app.S, 'you', l.id); persist(); refresh(); } return; }
  if (k === 'home' || k === 'h') { renderer.focusOn(app.S.hero.q, app.S.hero.r); dirty = true; return; }
  const sel = app.ui.sel; const tile = sel && tileAt(app.S, sel.q, sel.r);
  if ((k === 'w' || k === ' ') && tile) { e.preventDefault(); const p = heroPath(app.S, tile); if (p && p.path.length) walkTo(tile.q, tile.r); else toast('No route to that tile.', 'err'); return; }
  if (tile && ['s', 'x', 'o', 'f'].includes(k)) { const kind = { s: 'survey', x: 'claim', o: 'outpost', f: 'city' }[k]; const useful = kind !== 'survey' || revealRange(app.S, app.S.civs.you, tile, 2 + (P.surveyBonus(app.S)), true) > 0; if (useful && validTargets(kind).has(key(tile.q, tile.r))) { if (kind === 'city') { const src = civCities(app.S, 'you').filter(c => !validate(app.S, 'you', { type: 'city', q: tile.q, r: tile.r, source: c.id })).sort((a, b) => dist(a, tile) - dist(b, tile))[0]; doStage({ type: 'city', q: tile.q, r: tile.r, source: src.id }); } else doStage({ type: kind, q: tile.q, r: tile.r }); } else startTarget(kind); }
}
boot();
