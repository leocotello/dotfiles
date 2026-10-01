// DOM builders. They only read simulation state and call read-only sim helpers (validate, forecast, evaluate).
import { CFG, TERRAIN, RESOURCES, DISTRICTS, WORKS, TRADITIONS, DISPOSITIONS, TECHS, DISCOVERIES, INSTITUTIONS, AMBITIONS, FACTIONS, ROLES, APPROACH, COMBOS, REGION_NAMES, LEGACIES, OPPORTUNITIES, ACHIEVEMENTS } from '../data/content.js';
import { esc, costHtml, RES_META, sign, pct } from './dom.js';
import { OWN } from './render.js';
import { key, dist } from '../sim/hex.js';
import { RES, computeEconomy, cohBreakdown, cityHousing, civCities, civArmies, hasInst, hasTech, fx, fxSources, components, connectedToCapital, slotCount, protectionBands, effExposure, severity, totalResonance, civResonance, tileAt, hasTreaty, sources } from '../sim/economy.js';
import { available, reserved, ordersLeft, ordersUsed, validate, costOf, projectCost, projectTurns, projectDef, techReq, instCost, recruitCost, restoreEvery, isUnlocked, fmtCost, freeNegInterval, offerCost } from '../sim/commands.js';
import { forecastLevel, regionReport, projection, resonanceProjection } from '../sim/quieting.js';
import { relation, evaluateTreaty, power, contact } from '../sim/diplomacy.js';
import { evaluate, shelters, sealedArchives, participating, spireAccess } from '../sim/ambitions.js';
import { atWar, pairKey, ageOf } from '../sim/state.js';
import { armyPath, supplyMap, isSupplied } from '../sim/army.js';
import { forecast, armyStr, maxIntegrity } from '../sim/combat.js';
import { isCouncilTurn } from '../sim/council.js';
import { revealRange } from '../sim/state.js';
export const surveyBonus = (S) => fx(S, S.civs.you, 'surveyRange');

const btn = (act, label, o = {}) => `<button class="btn ${o.cls || ''}" data-act="${act}" ${Object.entries(o.data || {}).map(([k, v]) => `data-${k}='${esc(typeof v === 'object' ? JSON.stringify(v) : v)}'`).join(' ')} ${o.disabled ? 'disabled' : ''} ${o.title ? `title="${esc(o.title)}"` : ''} ${o.key ? `aria-keyshortcuts="${o.key}"` : ''}>${label}</button>`;
const stageBtn = (S, label, cmd, o = {}) => { const err = validate(S, 'you', cmd); return btn('stage', label, { ...o, data: { cmd }, disabled: !!err || o.disabled, title: err || o.title || '' }); };
const regionName = (S, t) => REGION_NAMES[t.region];

// ---------------------------------------------------------------- command descriptions
export function describeCmd(S, c) {
  const city = (id) => S.cities[id] ? S.cities[id].name : '?'; const civ = (id) => S.civs[id].name;
  switch (c.type) {
    case 'develop': { const { def } = projectDef(c.what); return `Develop: ${def.name} in ${city(c.city)}${c.replace !== undefined ? ' (replacing a district)' : ''}`; }
    case 'survey': return `Survey around (${c.q},${c.r})`; case 'claim': return `Claim ${TERRAIN[tileAt(S, c.q, c.r).t].name} (${c.q},${c.r})`;
    case 'outpost': return `Outpost at (${c.q},${c.r})`; case 'city': return `Found a city at (${c.q},${c.r}) from ${city(c.source)}`;
    case 'investigate': return `Investigate ${S.sites[c.site].name}`; case 'recruit': return `Recruit ${ROLES[c.role].name} at ${city(c.city)}`;
    case 'objective': return `Army ${c.obj}${c.obj !== 'guard' ? ` → (${c.q},${c.r}) [${APPROACH[c.approach || 'assault'].name}]` : ''}`;
    case 'treaty': return `Propose ${c.kind} to ${civ(c.to)}`; case 'influence': return `Influence ${city(c.city)}`;
    case 'demand': return `${c.kind === 'war' ? 'Declare war on' : c.kind === 'peace' ? 'Sue for peace with' : 'Demand tribute from'} ${civ(c.to)}`; case 'cancel': return 'Cancel a treaty early (broken promise)';
    case 'reform': switch (c.kind) { case 'install': return `Interpret ${S.sites[c.site].name}: ${INSTITUTIONS[c.interp].name}`; case 'install_baseline': return 'Install Voluntary Network'; case 'research': return `Research ${TECHS[c.tech].name}`; case 'reconcile': return `Reconcile ${city(c.city)}`; case 'restore': return 'Restoration (Release the Voices)'; case 'ambition_change': return `Change ambition to ${AMBITIONS[c.amb].name}`; } return 'Reform';
    case 'council': { const o = S.council.offers.find(x => x.id === c.offer); return `Council: ${o ? o.title : c.offer}`; }
    case 'ambition': return `Commit to ${AMBITIONS[c.amb].name}`; case 'respond': return `${c.accept ? 'Accept' : 'Decline'} a proposal`; case 'salvage': return `Salvage ${S.sites[c.site].name}`; case 'answer': return `${c.honor ? 'Honour' : 'Set aside'} request in ${city(c.city)}`;
  }
  return c.type;
}
const ageName = (S) => CFG.ageNames[ageOf(S.turn)];

// ---------------------------------------------------------------- tooltips
export function netTip(S, k) {
  const e = computeEconomy(S, 'you'); const rows = {};
  for (const it of e.items) if (it.res === k && it.amt) rows[it.label] = (rows[it.label] || 0) + it.amt;
  const lines = Object.entries(rows).sort((a, b) => b[1] - a[1]);
  return `<b>${RES_META[k].n}</b> · ${esc(RESOURCES[k].blurb)}<table>${lines.map(([l, v]) => `<tr><td>${esc(l)}</td><td class="r">${sign(v)}</td></tr>`).join('')}<tr><td><b>Next-turn net</b></td><td class="r"><b>${sign(e.net[k])}</b></td></tr></table>${k === 'sus' && e.deficit ? `<div class="bad">Deficit ${e.deficit}: shared by policy "${S.civs.you.rationPolicy}".</div>` : ''}${k === 'ene' && e.paused.length ? `<div class="warn">${e.paused.length} powered structure(s) would pause.</div>` : ''}`;
}

// ---------------------------------------------------------------- top & bottom bars
export function topbar(app) {
  const { S } = app; const you = S.civs.you; const e = computeEconomy(S, 'you'); const rs = reserved(S, 'you'); const L = ordersLeft(S, 'you');
  const q = forecastLevel(S, 'you'); const nextEsc = CFG.quieting.escalations.find(t => t >= S.turn);
  const sev = severity(S); const stage = S.quiet.stage;
  const qtxt = q === 0 ? `Quieting: faint tremors` : `Quieting ${stage ? 'stage ' + stage : 'forecast'} · severity ${q >= 2 ? sev + '/3' : '?'}${nextEsc ? ' · T' + nextEsc : ''}`;
  return `<div class="brand"><b>Stotkal</b> <i>·</i> <span class="w2">what remains</span></div>
  <div class="turnbox"><span class="t">Turn ${S.turn}<small> / ${CFG.turns}</small></span><span class="age">${ageName(S)}${isCouncilTurn(S.turn) ? ' · council' : ''}</span></div>
  <div class="res" role="group" aria-label="Resources, with next-turn net income">${RES.map(k => { const net = e.net[k]; const r = rs[k]; return `<div class="rchip r-${k}" tabindex="0" data-tip='${esc(netTip(S, k))}'><span class="ic" aria-hidden="true">${RES_META[k].i}</span><span class="n" aria-label="${RES_META[k].n}">${you.res[k]}</span><span class="d ${net < 0 ? 'neg' : net > 0 ? 'pos' : ''}">${sign(net)}</span>${r ? `<small title="Reserved by staged orders">(−${r})</small>` : ''}</div>`; }).join('')}</div>
  <div class="orders" title="Empire orders left this turn"><span class="tiny dim">ORDERS</span><span class="pips" aria-label="${L} of ${CFG.orders} orders left">${Array.from({ length: CFG.orders }, (_, i) => `<span class="pip ${i < CFG.orders - L ? 'used' : ''}"></span>`).join('')}</span><b>${L}</b></div>
  <button class="qchip s${Math.min(2, stage || q)}" data-act="sheet" data-s="quiet" data-tip="${esc('Open the Quieting forecast. ' + (q === 0 ? 'Tremors are faint. A clear forecast is issued on turn 12.' : 'Regional exposure is drawn on the map as hatched tiles. Next escalation: turn ' + (nextEsc || 'none') + '.'))}">◌ ${esc(qtxt)}</button>
  <button class="btn ghost sm" data-act="modal" data-m="settings" title="Settings (text size, motion, volume)" aria-label="Settings">⚙<span class="lab"> Settings</span></button>
  <button class="btn ghost sm" data-act="modal" data-m="menu" title="Save, quit, new run" aria-label="Menu">☰<span class="lab"> Menu</span></button>`;
}

export function bottombar(app) {
  const { S } = app; const you = S.civs.you; const cmds = S.staged.you;
  const slotsHtml = [];
  const orderCmds = cmds.filter(c => c.order), free = cmds.filter(c => !c.order);
  for (let i = 0; i < CFG.orders; i++) {
    const c = orderCmds[i];
    slotsHtml.push(c ? `<div class="slot full"><span class="d" title="${esc(describeCmd(S, c))}">${esc(describeCmd(S, c))}<br>${costHtml(c.cost)}</span><button class="x" data-act="unstage" data-id="${c.id}" aria-label="Remove this order" title="Remove (refunds the reservation)">×</button></div>` : `<div class="slot"><span class="no">open order ${i + 1}</span></div>`);
  }
  const freeHtml = free.length ? `<div class="slot free" style="flex:1.2"><span class="d">${free.map(c => esc(describeCmd(S, c)) + (c.freeNeg ? ' (free negotiation)' : '')).join(' · ')}</span><button class="x" data-act="unstage" data-id="${free[free.length - 1].id}" aria-label="Remove last free decision">×</button></div>` : '';
  const pend = Object.values(you.disc).filter(d => d.state === 'pending').length;
  return `<div class="slots" role="list" aria-label="Staged orders">${slotsHtml.join('')}${freeHtml}</div>
  <div class="col" style="text-align:right"><button class="btn primary" data-act="endturn" aria-keyshortcuts="Enter" title="Review commitment summary, then end the turn (Enter)">End Turn <kbd>Enter</kbd></button></div>`;
}

// ---------------------------------------------------------------- side panel
const NAV = [['context', 'Map', ''], ['empire', 'Empire', 'E'], ['diplo', 'Diplomacy', 'D'], ['quiet', 'Quieting', 'Q'], ['ambition', 'Ambition', 'A'], ['log', 'Log', 'L'], ['guide', 'Guide', 'G']];
export function sidePanel(app) {
  const { S, ui } = app; const you = S.civs.you;
  const pend = Object.values(you.disc).filter(d => d.state === 'pending' && S.sites[Object.keys(you.disc).find(k => you.disc[k] === d)].state === 'open').length;
  const props = S.proposals.filter(p => p.to === 'you').length; const council = S.council.offers && S.council.turn === S.turn && !S.council.chosen && !S.staged.you.some(c => c.type === 'council');
  const badge = { context: pend, diplo: props, empire: 0, ambition: (S.turn >= 16 && S.turn <= 21 && !you.ambition) ? '!' : 0 };
  const nav = `<nav class="nav" role="tablist">${NAV.map(([id, lab, k]) => `<button role="tab" aria-selected="${ui.sheet === id}" class="${ui.sheet === id ? 'on' : ''}" data-act="sheet" data-s="${id}" title="${lab}${k ? ' (' + k + ')' : ''}">${lab}${badge[id] ? `<span class="badge">${badge[id]}</span>` : ''}</button>`).join('')}${council ? `<button class="on" data-act="modal" data-m="council" style="background:rgba(137,168,255,.35)">Council ●</button>` : ''}</nav>`;
  let body = '';
  switch (ui.sheet) {
    case 'empire': body = empireSheet(app); break; case 'diplo': body = diploSheet(app); break; case 'quiet': body = quietSheet(app); break;
    case 'ambition': body = ambitionSheet(app); break; case 'log': body = logSheet(app); break; case 'guide': body = guideSheet(app); break; default: body = contextPanel(app);
  }
  return nav + `<div class="sidebody" id="sidebody" tabindex="-1">${body}</div>`;
}

function homePanel(app) {
  const { S } = app; const you = S.civs.you; const cities = civCities(S, 'you'); const armies = civArmies(S, 'you');
  const pending = Object.entries(you.disc).filter(([id, d]) => d.state === 'pending' && S.sites[id].state === 'open').map(([id]) => S.sites[id]);
  const nextC = CFG.councilTurns.find(t => t >= S.turn);
  return `<h2>Your people</h2><p class="dim tiny">${esc(S.cities[you.cap] ? 'Capital: ' + S.cities[you.cap].name : '')}. Select a tile, city or army on the map. <kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd> move the cursor.</p>
  <h3>Cities</h3>${cities.map(c => `<div class="card"><div class="row"><b>${esc(c.name)}${c.capital ? ' ★' : ''}</b>${btn('select', 'Select', { cls: 'sm', data: { q: c.q, r: c.r } })}</div><div class="tiny dim">Pop ${c.pop}/${cityHousing(S, you, c)} · Coherence ${Math.round(c.coh)} · ${c.project ? '⚒ ' + (c.project.what.startsWith('district:') ? DISTRICTS[c.project.what.slice(9)].name : WORKS[c.project.what.slice(5)].name) + ' (' + c.project.remaining + 't)' : '<span class="warn">no project</span>'}</div></div>`).join('')}
  ${armies.length ? `<h3>Armies</h3>${armies.map(a => `<div class="card row"><span>${ROLES[a.regs[0] ? a.regs[0].role : 'warden'].icon.repeat(1)} Army · ${a.regs.length} regiment(s) · ${armyStr(a)} strength · ${a.obj.type}</span>${btn('select', 'Select', { cls: 'sm', data: { q: a.q, r: a.r, army: a.id } })}</div>`).join('')}` : ''}
  <h3>Discoveries awaiting interpretation</h3>${pending.length ? pending.map(s => `<div class="card row"><span><b>${esc(s.name)}</b><br><span class="tiny dim">${esc(DISCOVERIES[s.type].blurb)}</span></span>${btn('discovery', 'Examine', { cls: 'sm', data: { site: s.id } })}</div>`).join('') : '<p class="dim tiny">None yet. A Survey order reveals nearby ground; sites become available when explored.</p>'}
  <h3>Coming up</h3><ul class="clean"><li>Next council: ${nextC ? 'turn ' + nextC : 'none'}</li><li>Quieting forecast: turn ${CFG.quieting.firstForecast} · exact reading: turn ${CFG.quieting.revealTurn}</li><li>Ambition: choose between turns 16 and 21 ${you.ambition ? '· <b>' + AMBITIONS[you.ambition.id].name + '</b>' : ''}</li></ul>
  ${S.lastSummary ? `<h3>Last resolution</h3>${summaryList(S.lastSummary, 6)}${btn('modal', 'Open full log', { cls: 'sm ghost', data: { m: 'logfull' } })}` : ''}`;
}
export function summaryList(sum, n = 8) {
  const imp = sum.events.filter(e => e.imp >= 1).slice(0, n); const routine = sum.events.filter(e => e.imp === 0).length;
  return `<ul class="clean">${imp.map(e => `<li class="${e.imp >= 2 ? 'rose' : ''}">${e.imp >= 2 ? '◆' : '·'} ${esc(e.text)}</li>`).join('')}${routine ? `<li class="dim tiny">+ ${routine} routine change${routine === 1 ? '' : 's'} (production, growth) in the log</li>` : ''}${!imp.length && !routine ? '<li class="dim">A quiet turn.</li>' : ''}</ul>`;
}

// ---------------------------------------------------------------- tile / city / army context
function contextPanel(app) {
  const { S, ui } = app; const sel = ui.sel; if (!sel) return homePanel(app);
  const you = S.civs.you; const t = tileAt(S, sel.q, sel.r); if (!t) return homePanel(app); const k = key(t.q, t.r);
  if (!you.seen[k] && !ui.debugReveal) return `<h2>Unexplored</h2><p>This ground has not been seen. Order a <b>Survey</b> from a tile you currently observe (Expand), or send an army or outpost toward it.</p>${stageBtn(S, 'Survey here', { type: 'survey', q: t.q, r: t.r })}`;
  const obs = !!you.obs[k] || ui.debugReveal; const T = TERRAIN[t.t];
  let h = `<h2>${T.name}</h2><div class="tiny dim">${regionName(S, t)} region · (${t.q},${t.r})${obs ? ' · <span class="good">observed now</span>' : ' · <span class="warn">explored, not currently observed</span>'}</div><p class="tiny">${esc(T.blurb)} ${t.owner ? '' : ''}</p>`;
  const yl = Object.entries(T.yield).map(([k2, v]) => `${RES_META[k2].i}+${v}`).join(' '); const fl = forecastLevel(S, 'you'); const reg = S.regions[t.region];
  h += `<dl class="kv"><dt>Yield when claimed</dt><dd>${yl}</dd><dt>Movement</dt><dd>${T.passable ? 'cost ' + T.move : 'impassable'}</dd><dt>Owner</dt><dd>${t.owner ? `<span class="sw" style="border-color:${OWN[t.owner].dark};background:${OWN[t.owner].color}"></span>${OWN[t.owner].glyph} ${t.owner === 'you' ? 'You' : t.owner === 'ind' ? 'Independent' : FACTIONS[t.owner].short}` : 'Unclaimed'}</dd>${fl ? `<dt>Quieting exposure</dt><dd>${fl >= 2 ? ['safe', 'exposed', 'highly exposed'][reg.exposure] : reg.exposure ? 'exposed (band pending)' : 'safe'}</dd>` : ''}${obs ? `<dt>Your supply</dt><dd>${isSupplied(S, 'you', t.q, t.r) ? 'supplied' : 'out of supply'}</dd>` : ''}</dl>`;
  const army = Object.values(S.armies).find(a => a.q === t.q && a.r === t.r && a.owner === 'you');
  if (t.city) { const c = S.cities[t.city]; h += c.owner === 'you' ? cityPanel(app, c) : foreignCity(app, c, obs); }
  if (t.site) h += sitePanel(app, S.sites[t.site], t);
  const armiesHere = Object.values(S.armies).filter(a => a.q === t.q && a.r === t.r && (a.owner === 'you' || obs));
  for (const a of armiesHere) h += a.owner === 'you' ? armyPanel(app, a) : `<h3>Foreign army</h3><div class="card">${OWN[a.owner].glyph} ${S.civs[a.owner].name}: ${a.regs.length} regiment(s), ${armyStr(a)} strength ${atWar(S, 'you', a.owner) ? '· <b class="bad">at war</b>' : ''}</div>`;
  const lks = Object.values(you.lastKnown).filter(m => m.q === t.q && m.r === t.r && !obs); for (const m of lks) h += `<div class="card warn tiny">Outdated sighting (${S.turn - m.turn} turns old): an army of ${S.civs[m.owner].name}, about ${m.str} strength. It may have moved.</div>`;
  if (!t.city && T.passable) h += `<h3>Orders here</h3><div class="row wrap">${stageBtn(S, 'Survey <kbd>S</kbd>', { type: 'survey', q: t.q, r: t.r }, { title: `Reveals ${revealRange(S, you, t, 2 + surveyBonus(S), true)} unexplored tile(s) within ${2 + surveyBonus(S)} of here (one order, free of resources)` })}${stageBtn(S, 'Claim <kbd>X</kbd>', { type: 'claim', q: t.q, r: t.r })}${stageBtn(S, 'Outpost <kbd>O</kbd>', { type: 'outpost', q: t.q, r: t.r })}${foundBtn(S, t)}</div><p class="tiny dim">Claim: 2 ◆, adjacent to your border. Outpost: 6 ◆ 2 ⚡, sight and limited supply, 1 ⚡/turn upkeep. Found City: 12 ◆ 6 ❀ 4 ⚡ and 2 population from a connected city (needs ≥ 4).</p>`;
  return h;
}
function foundBtn(S, t) {
  const src = civCities(S, 'you').filter(c => !validate(S, 'you', { type: 'city', q: t.q, r: t.r, source: c.id })).sort((a, b) => dist(a, t) - dist(b, t))[0];
  const any = civCities(S, 'you').sort((a, b) => b.pop - a.pop)[0]; const err = src ? null : validate(S, 'you', { type: 'city', q: t.q, r: t.r, source: any.id });
  return btn('stage', 'Found city <kbd>F</kbd>', { data: { cmd: { type: 'city', q: t.q, r: t.r, source: src ? src.id : any.id } }, disabled: !src, title: err || 'Found a settlement here' });
}
function cohClass(c) { return c >= 50 ? '' : c >= 30 ? 'mid' : 'low'; }
function cityPanel(app, c) {
  const { S, ui } = app; const you = S.civs.you; const econ = computeEconomy(S, 'you'); const bd = cohBreakdown(S, c, econ);
  const hous = cityHousing(S, you, c); const slots = slotCount(c); const e = effExposure(S, c); const reg = S.regions[tileAt(S, c.q, c.r).region]; const fl = forecastLevel(S, 'you');
  const cr = econ.cityRes[c.id] || {};
  let h = `<h3>${esc(c.name)}${c.capital ? ' · capital' : ''}${c.federated ? ' · federated' : ''}</h3>
  <dl class="kv"><dt>Population</dt><dd>${c.pop} / ${hous} housing</dd><dt>Coherence</dt><dd>${Math.round(c.coh)}${c.crisis ? ' · <b class="bad">crisis</b>' : ''}</dd><dt>Integrity</dt><dd>${c.integrity}/${maxIntegrity(S, c)}</dd>${c.federated ? `<dt>Federation stipend</dt><dd>1 ❀/turn ${c.fedMet === false ? '<b class="bad">unpaid</b>' : '<span class="good">met</span>'}</dd>` : ''}</dl>
  <div class="bar coh ${cohClass(c.coh)}" title="Coherence ${Math.round(c.coh)} of 100"><i style="width:${Math.round(c.coh)}%"></i></div>
  <details class="tiny"><summary>Why does Coherence change? (${sign(bd.delta)}/turn)</summary><ul class="clean">${bd.items.map(i => `<li>${esc(i.label)}: <b>${sign(i.amt)}</b></li>`).join('') || '<li>No changes.</li>'}</ul><p class="dim">≥50 normal · 30–49 nonessential output −15% · 1–29 −30% and a local crisis after 2 turns · 0 becomes autonomous (people and buildings stay).</p></details>
  ${c.request ? `<div class="quote">${c.request.kind === 'rename' ? 'Restored citizens ask that their previous name be recognised.' : c.request.kind === 'mourn' ? 'The woken sleepers ask to be allowed to grieve openly before they work.' : 'The newcomers ask to be heard.'}<div class="row wrap" style="margin-top:6px">${stageBtn(S, 'Honour (1 ◈)', { type: 'answer', city: c.id, honor: true })}${stageBtn(S, 'Set aside', { type: 'answer', city: c.id, honor: false })}</div><div class="tiny dim">Honouring: +6 Coherence. Setting aside: −3 Coherence.</div></div>` : ''}
  <h3>Districts (${c.districts.length}/${slots})</h3><div class="row wrap">${Array.from({ length: slots }, (_, i) => { const d = c.districts[i]; return d ? `<div class="card" style="flex:1 1 45%" title="${esc(DISTRICTS[d.type].blurb)}"><b>${DISTRICTS[d.type].icon}</b> ${DISTRICTS[d.type].name}${econ.paused.some(p => p.city === c.id && p.idx === i) ? ' <span class="warn tiny">paused</span>' : ''}${d.type === 'conduit' && c.disabled.conduit > 0 ? ' <span class="bad tiny">severed ' + c.disabled.conduit + 't</span>' : ''}<div class="tiny dim">${esc(DISTRICTS[d.type].blurb)}</div></div>` : `<div class="card dim" style="flex:1 1 45%">empty slot</div>`; }).join('')}</div>
  ${Object.keys(c.works).length ? `<div class="tiny">Works: ${Object.keys(c.works).map(w => `<span class="tag">${esc(WORKS[w] ? WORKS[w].name : w)}</span>`).join('')}</div>` : ''}
  ${fl >= 1 ? `<div class="tiny" style="margin-top:6px">Quieting: region ${fl >= 2 ? ['safe', 'exposed', 'highly exposed'][reg.exposure] : (reg.exposure ? 'exposed' : 'safe')} · protection ${protectionBands(S, c)} band(s) → ${e > 0 ? `<b class="bad">still exposed (${e})</b>` : '<b class="good">protected</b>'}</div>` : ''}
  <h3>Project</h3>${c.project ? (() => { const { def } = projectDef(c.project.what); return `<div class="card"><b>${esc(def.name)}</b> · ${c.project.remaining} of ${c.project.total} turns left<div class="bar"><i style="width:${Math.round(100 * (c.project.total - c.project.remaining) / c.project.total)}%"></i></div><div class="tiny dim">Starting a different project refunds half of the ${c.project.matPaid} ◆ reserved (${Math.floor(c.project.matPaid / 2)}). Progress is not kept.</div></div>`; })() : '<p class="warn tiny">Idle: no project. Ongoing work consumes no orders; only starting one does.</p>'}
  <div class="row wrap">${btn('devtoggle', ui.devOpen === c.id ? 'Hide projects' : 'Develop…', { cls: ui.devOpen === c.id ? 'on' : '', data: { city: c.id } })}${stageBtn(S, 'Reconcile', { type: 'reform', kind: 'reconcile', city: c.id }, { title: 'One order, 3 ◆ 1 ⚡, two turns, +12 Coherence' })}${stageBtn(S, 'Recruit ' + ROLES.warden.icon, { type: 'recruit', city: c.id, role: 'warden' }, { title: 'Warden: defence. ' + fmtCost(recruitCost(S, you)) })}${stageBtn(S, 'Recruit ' + ROLES.lancer.icon, { type: 'recruit', city: c.id, role: 'lancer' }, { title: 'Lancer: mobility' })}${stageBtn(S, 'Recruit ' + ROLES.disruptor.icon, { type: 'recruit', city: c.id, role: 'disruptor' }, { title: 'Disruptor: infrastructure pressure' })}</div>
  ${c.reconcile ? `<div class="tiny good">Reconciliation underway (${c.reconcile.left} turn left).</div>` : ''}`;
  if (ui.devOpen === c.id) h += devList(app, c);
  return h;
}
function devList(app, c) {
  const { S, ui } = app; const you = S.civs.you; const full = c.districts.length >= slotCount(c); const have = available(S, 'you');
  let h = `<h3>Choose a project</h3>`;
  if (full) h += `<p class="tiny warn">All ${slotCount(c)} slots are in use. Pick the district to replace (the old one keeps working until the new one is finished; replacement costs +${CFG.cost.rebuildDistrict.mat} ◆):</p><div class="row wrap">${c.districts.map((d, i) => btn('replacepick', `${DISTRICTS[d.type].icon} ${DISTRICTS[d.type].name}`, { cls: 'sm ' + (ui.replaceIdx === i ? 'on' : ''), data: { i } })).join('')}</div>`;
  const items = [...Object.keys(DISTRICTS).map(id => 'district:' + id), ...Object.keys(WORKS).map(id => 'work:' + id)];
  for (const what of items) {
    const { id, kind, def } = projectDef(what); const cmd = { type: 'develop', city: c.id, what, ...(full ? { replace: ui.replaceIdx ?? undefined } : {}) };
    if (kind === 'work' && def.needsTech && !hasTech(you, def.needsTech) && !isUnlocked(S, you, 'work:' + id)) { h += `<div class="card disabled"><b>${esc(def.name)}</b> <span class="tag">locked</span> <span class="tiny">needs ${TECHS[def.needsTech].name}</span></div>`; continue; }
    const err = (full && ui.replaceIdx === undefined && kind === 'district') ? 'Choose which district to replace first.' : validate(S, 'you', cmd);
    const cost = projectCost(S, you, c, what); if (full && kind === 'district') cost.mat += CFG.cost.rebuildDistrict.mat; const tt = projectTurns(S, you, c, what);
    h += `<div class="card ${err ? 'disabled' : ''}"><div class="row"><b>${esc(def.name)}</b>${btn('stage', 'Start', { data: { cmd }, disabled: !!err, title: err || '', cls: 'sm' })}</div><div>${costHtml(cost, have)}<span class="tiny">${tt.turns} turn${tt.turns > 1 ? 's' : ''}${tt.notes.length ? ' (' + tt.notes.join(', ') + ')' : ''}</span></div><div class="tiny dim">${esc(def.blurb)}</div>${err ? `<div class="tiny bad">${esc(err)}</div>` : ''}</div>`;
  }
  return h;
}
function foreignCity(app, c, obs) {
  const { S } = app; const you = S.civs.you; const o = c.owner ? S.civs[c.owner] : null;
  let h = `<h3>${esc(c.name)}${c.ind ? ' · independent settlement' : ' · ' + esc(o.name)}</h3>`;
  if (c.ind) {
    const inf = c.influence.you || 0;
    h += `<p class="tiny">Independent settlements may trade, join a federation, stay neutral, or be conquered.</p><dl class="kv"><dt>Your influence</dt><dd>${inf} / ${CFG.influence.need}</dd>${c.notice ? `<dt>Federation notice</dt><dd>joins turn ${c.notice.due} (${S.civs[c.notice.civ].short || S.civs[c.notice.civ].name})</dd>` : ''}${obs ? `<dt>Population / Coherence</dt><dd>${c.pop} / ${Math.round(c.coh)}</dd><dt>Garrison</dt><dd>${c.garrison} · integrity ${c.integrity}/${c.integrityMax || 10}</dd>` : ''}</dl>
    <div class="row wrap">${stageBtn(S, 'Influence (4 ❀)', { type: 'influence', city: c.id }, { title: 'Negotiate order. Each order adds influence; at 3 a federation notice is given and it joins 2 turns later, obliging you to send 1 Sustenance per turn.' })}</div><p class="tiny dim">Peaceful integration needs influence, a tangible commitment (4 ❀ each time), and two turns of notice. Conquest needs an army: select your army and set a Besiege objective.</p>`;
  } else {
    const rel = relation(S, c.owner, 'you'); h += `<dl class="kv"><dt>Their regard for you</dt><dd>${rel.score}</dd><dt>War status</dt><dd>${atWar(S, 'you', c.owner) ? '<b class="bad">at war</b>' : 'peace'}</dd>${obs ? `<dt>Population / Coherence</dt><dd>${c.pop} / ${Math.round(c.coh)}</dd><dt>Integrity</dt><dd>${c.integrity}/${c.integrityMax || 10}</dd>` : '<dt>Details</dt><dd class="dim">not currently observed</dd>'}</dl>${btn('sheet', 'Diplomacy…', { cls: 'sm', data: { s: 'diplo' } })}`;
  }
  return h;
}
function sitePanel(app, s, t) {
  const { S } = app; const you = S.civs.you; const d = you.disc[s.id]; const D = DISCOVERIES[s.type];
  let h = `<h3>${esc(s.name)}</h3><p class="tiny"><span class="tag fact">observed</span> ${esc(D.blurb)}</p>`;
  if (s.type === 'meridian_spire') { const ac = spireAccess(S, you); return h + `<p class="tiny"><span class="tag unk">unknown</span> Its purpose is unclear. The Break the Recurrence ambition needs control of this tile or a passage treaty with its owner.</p><div>Your access: <b class="${ac ? 'good' : 'warn'}">${ac || 'none'}</b></div>${!t.owner ? stageBtn(S, 'Claim it (2 ◆)', { type: 'claim', q: t.q, r: t.r }) : ''}`; }
  if (D.anomaly) return h + `<p class="tiny"><span class="tag unk">unknown</span> Instruments disagree here. Investigating costs 3 ⚡ and one order and yields Memory plus a named measurement. You must hold an adjacent tile, outpost or army, but no conquest.</p>${s.invest.you ? '<div class="good">Investigated by you.</div>' : stageBtn(S, 'Investigate (3 ⚡)', { type: 'investigate', site: s.id })}`;
  if (s.state !== 'open') return h + `<div class="tiny">${s.state === 'salvaged' ? 'Salvaged' : 'Interpreted'} by ${s.by === 'you' ? 'you' : S.civs[s.by].name}${s.interp ? ': ' + INSTITUTIONS[s.interp].name : ''}.</div>`;
  if (d && d.state === 'pending') return h + btn('discovery', 'Examine interpretations…', { cls: 'primary', data: { site: s.id } });
  return h;
}
function armyPanel(app, a) {
  const { S, ui } = app; const sup = isSupplied(S, 'you', a.q, a.r); const ready = !a.regs.some(r => r.ready > S.turn);
  const obj = a.obj; const rt = a.retreatAt;
  let h = `<h3>Army</h3><div class="card"><ul class="clean">${a.regs.map(r => `<li>${ROLES[r.role].icon} ${ROLES[r.role].name}: ${r.str}/10 ${r.ready > S.turn ? '<span class="warn tiny">preparing</span>' : ''}</li>`).join('')}</ul><dl class="kv"><dt>Objective</dt><dd>${obj.type}${obj.q !== undefined ? ` → (${obj.q},${obj.r})` : ''}${obj.approach ? ' · ' + APPROACH[obj.approach].name : ''}</dd><dt>Supply</dt><dd>${sup ? '<span class="good">supplied</span>' : '<span class="bad">out of supply −20%, no healing</span>'}</dd><dt>Retreat below</dt><dd>${Math.round(rt * 100)}% strength</dd></dl></div>`;
  h += `<div class="row wrap">${stageBtn(S, 'Guard', { type: 'objective', army: a.id, obj: 'guard' })}${btn('target', 'Travel…', { data: { kind: 'objective', obj: 'travel', army: a.id }, cls: ui.targeting && ui.targeting.obj === 'travel' ? 'on' : '' })}${btn('target', 'Raid…', { data: { kind: 'objective', obj: 'raid', army: a.id } })}${btn('target', 'Besiege…', { data: { kind: 'objective', obj: 'besiege', army: a.id } })}</div>`;
  h += `<div class="tiny" style="margin-top:6px">Approach for the next objective: ${['assault', 'siege', 'raid', 'withdraw'].map(ap => btn('approach', APPROACH[ap].name, { cls: 'sm ' + ((ui.approach || 'assault') === ap ? 'on' : ''), data: { ap }, title: APPROACH[ap].blurb })).join(' ')}</div><p class="tiny dim">Objectives continue automatically each turn: they use an order only when you set or change them. Paths and break points show on the map before you commit.</p>`;
  if (ui.hoverFc) h += forecastHtml(ui.hoverFc);
  return h;
}
export function forecastHtml(f) {
  return `<h3>Forecast ${f.conditional && f.conditional.length ? '<span class="tag warn">conditional</span>' : ''}</h3><div class="card"><dl class="kv"><dt>Your power vs theirs</dt><dd>${f.attPower} vs ${f.defPower}</dd><dt>Estimated losses (you)</dt><dd>${f.attLoss}</dd><dt>Estimated losses (them)</dt><dd>${f.defLoss}</dd>${f.city ? `<dt>Integrity damage</dt><dd>${f.integrityDmg}</dd>` : ''}${f.path ? `<dt>Arrival</dt><dd>turn +${f.path.eta}</dd>` : ''}</dl><ul class="clean tiny">${f.notes.map(n => `<li>${esc(n)}</li>`).join('')}${f.city ? `<li>Capture: integrity must reach 0 with no defenders left (Assault or Siege). Raids never capture.</li>` : ''}</ul>${f.conditional && f.conditional.length ? `<div class="tiny warn">Assumes no unseen army intervenes. ${f.conditional.map(c => c.note ? esc(c.note) : `A last-known army (${c.age} turns old) was ${Math.round(c.q === undefined ? 0 : 0) || ''}within 3 tiles`).join(' ')}</div>` : ''}${f.path && f.path.breaks.length ? `<div class="tiny bad">Supply breaks on ${f.path.breaks.length} tile(s) (marked ✕).</div>` : ''}</div>`;
}

// ---------------------------------------------------------------- Empire sheet (institutions, research, fragments)
function empireSheet(app) {
  const { S, ui } = app; const you = S.civs.you; const have = available(S, 'you');
  const active = Object.entries(COMBOS).filter(([id, c]) => hasInst(you, c.needs.inst) && hasTech(you, c.needs.tech));
  const near = Object.entries(COMBOS).filter(([id, c]) => (hasInst(you, c.needs.inst) !== hasTech(you, c.needs.tech)));
  let h = `<h2>Empire</h2><h3>Institutions (3 slots)</h3>` + you.inst.map((s, i) => s ? `<div class="card"><div class="row"><b>${esc(INSTITUTIONS[s.id].name)}</b><span class="tag">${esc(INSTITUTIONS[s.id].style)}</span></div><div class="tiny gain">${esc(INSTITUTIONS[s.id].gain)}</div><div class="tiny bad">${esc(INSTITUTIONS[s.id].risk)}</div><div class="tiny dim">${s.site ? 'From ' + esc(S.sites[s.site].name) : 'Baseline institution'} · turn ${s.turn}. Replacing costs an order and −4 Coherence in every city.</div></div>` : `<div class="card dim">Slot ${i + 1}: empty ${i === 0 && !you.inst.some(Boolean) ? '· interpret a discovery (Reform) to fill it' : ''}</div>`).join('');
  if (!hasInst(you, 'voluntary_network') && you.inst.some(x => !x)) h += `<div class="card"><b>Voluntary Network</b> <span class="tag">baseline</span><div class="tiny">${esc(INSTITUTIONS.voluntary_network.gain)} ${esc(INSTITUTIONS.voluntary_network.risk)}</div>${stageBtn(S, 'Install (1 order · ' + fmtCost(INSTITUTIONS.voluntary_network.cost) + ')', { type: 'reform', kind: 'install_baseline', slot: you.inst.findIndex(x => !x) }, { cls: 'sm' })}</div>`;
  if (hasInst(you, 'voices')) h += `<div class="card"><b>Restoration</b> <span class="tiny">every ${restoreEvery(S, you)} turns</span><div class="tiny">${fmtCost(CFG.restore.cost)} → +2 population where there is room, ${fx(S, you, 'restoreFast') > 0 ? 4 : 8} Coherence integration penalty.</div>${stageBtn(S, 'Restore', { type: 'reform', kind: 'restore' }, { cls: 'sm' })}</div>`;
  h += `<h3>Combinations</h3>${active.length ? active.map(([id, c]) => `<div class="card sel"><b>${esc(c.name)}</b> <span class="tag fact">active</span><div class="tiny">${esc(c.blurb)}</div></div>`).join('') : '<p class="tiny dim">No combination active yet. Institutions and technologies combine to change what you can do.</p>'}${near.map(([id, c]) => `<div class="card dim tiny">${esc(c.name)}: needs ${esc(INSTITUTIONS[c.needs.inst].name)} + ${esc(TECHS[c.needs.tech].name)}. ${esc(c.blurb)}</div>`).join('')}`;
  const R = you.research;
  h += `<h3>Research</h3><div class="card"><div class="row"><b>${R.target ? esc(TECHS[R.target].name) : 'No active program'}</b><span class="tiny">allocation per turn: ${CFG.research.allocOptions.map(n => btn('alloc', n, { cls: 'sm ' + (R.alloc === n ? 'on' : ''), data: { n }, title: 'Memory spent on research each turn' })).join('')}</span></div>${R.target ? `<div class="bar"><i style="width:${Math.min(100, Math.round(100 * (R.progress[R.target] || 0) / techReq(S, you, R.target)))}%"></i></div><div class="tiny">${R.progress[R.target] || 0} / ${techReq(S, you, R.target)} paid. Memory is spent from your stockpile each turn (${R.alloc}); nothing extra is charged on completion.</div>` : '<div class="tiny warn">Start a program (Reform order).</div>'}</div>`;
  for (let age = 0; age < 3; age++) {
    h += `<div class="tiny dim" style="margin-top:8px">${CFG.ageNames[age].toUpperCase()} · requirement ${CFG.research.cost[age]}${fx(S, you, 'techDisc') ? ` (−${Math.round(fx(S, you, 'techDisc') * 100)}% → ${Math.ceil(CFG.research.cost[age] * (1 - fx(S, you, 'techDisc')))})` : ''}</div>`;
    for (const [id, t] of Object.entries(TECHS).filter(([, t]) => t.age === age)) {
      const known = you.techs[id]; const pre = t.pre.every(p => you.techs[p]); const paid = R.progress[id] || 0; const cmd = { type: 'reform', kind: 'research', tech: id }; const err = known ? 'Known' : validate(S, 'you', cmd);
      h += `<div class="card ${known ? 'sel' : ''} ${!pre && !known ? 'disabled' : ''}"><div class="row"><b>${esc(t.name)}</b>${known ? '<span class="tag fact">known</span>' : btn('stage', R.target ? (R.target === id ? 'Active' : 'Redirect') : 'Start', { data: { cmd }, disabled: !!err, title: err || '', cls: 'sm' })}</div><div class="tiny">${esc(t.blurb)}</div>${!known && t.pre.length ? `<div class="tiny dim">Needs: ${t.pre.map(p => (you.techs[p] ? '✓ ' : '✕ ') + TECHS[p].name).join(', ')}</div>` : ''}${paid && !known ? `<div class="tiny">Paid so far: ${paid}/${techReq(S, you, id)}</div>` : ''}</div>`;
    }
  }
  h += `<h3>Named fragments (${you.fragments.length})</h3><p class="tiny dim">Fragments are named discoveries. They are never spent like Memory. Distinct fragments and source categories count toward The Unbroken Record.</p>${you.fragments.map(f => `<div class="tiny"><span class="tag">${esc(f.cat)}</span> ${esc(f.name)}</div>`).join('') || '<p class="tiny dim">None yet.</p>'}`;
  const sh = computeEconomy(S, 'you');
  h += `<h3>Emergency measures</h3><div class="tiny">Shortages are allocated by policy:</div><div class="row wrap">${btn('policy', 'Share evenly', { cls: 'sm ' + (you.rationPolicy === 'even' ? 'on' : ''), data: { p: 'even' } })}${btn('policy', 'Protect capital', { cls: 'sm ' + (you.rationPolicy === 'capital' ? 'on' : ''), data: { p: 'capital' } })}</div><div class="row wrap" style="margin-top:6px">${btn('emergency', 'Emergency rationing', { cls: 'sm ' + (you.emergency === 'ration' ? 'on' : ''), data: { m: 'ration' }, title: 'Sustenance upkeep −25%; −3 Coherence per city per turn' })}${btn('emergency', 'Emergency shutdown', { cls: 'sm ' + (you.emergency === 'shutdown' ? 'on' : ''), data: { m: 'shutdown' }, title: 'Pauses all powered districts (Foundry, Archive, Bulwark): saves their Energy upkeep and loses their output' })}</div><p class="tiny dim">Rationing: −25% Sustenance upkeep, −3 Coherence/city/turn. Shutdown: all powered districts pause (no output, no upkeep, no Resonance).</p>`;
  return h;
}

// ---------------------------------------------------------------- Diplomacy
function diploSheet(app) {
  const { S } = app; const you = S.civs.you;
  let h = `<h2>Diplomacy</h2>`;
  const props = S.proposals.filter(p => p.to === 'you');
  if (props.length) h += `<h3>Incoming</h3>` + props.map(p => { const f = FACTIONS[p.from]; const staged = S.staged.you.find(c => c.type === 'respond' && c.proposal === p.id); return `<div class="card"><b>${OWN[p.from].glyph} ${esc(S.civs[p.from].name)}</b> proposes <b>${p.kind === 'tribute' ? 'a tribute demand (4 ◆ 4 ⚡)' : p.kind === 'peace' ? 'peace' : p.kind + ' agreement'}</b>${p.why ? `<div class="tiny">Their reason: ${esc(p.why)}</div>` : ''}<div class="tiny dim">Expires turn ${p.expires}. ${staged ? `<b>Staged: ${staged.accept ? 'accept' : 'decline'}</b>` : ''}</div><div class="row wrap">${stageBtn(S, 'Accept', { type: 'respond', proposal: p.id, accept: true }, { cls: 'sm' })}${stageBtn(S, 'Decline', { type: 'respond', proposal: p.id, accept: false }, { cls: 'sm' })}</div></div>`; }).join('');
  const fi = freeNegInterval(S, you); if (fi) h += `<p class="tiny dim">One Negotiate order every ${fi} turns is free (${S.turn - you.negCd >= fi ? '<b class="good">available</b>' : 'ready in ' + (fi - (S.turn - you.negCd)) + ' turns'}).</p>`;
  for (const id of ['conservatory', 'signal', 'veil']) {
    const o = S.civs[id]; const F = FACTIONS[id]; const met = contact(S, 'you', id);
    h += `<h3>${OWN[id].glyph} ${esc(F.name)}${o.eliminated ? ' (fallen)' : ''}</h3>`;
    if (!met) { h += `<p class="tiny dim">Not yet met. ${esc(F.blurb.split('.')[0])}? Explore until you see one of their settlements.</p>`; continue; }
    const rel = relation(S, id, 'you'); const treaties = S.treaties.filter(t => t.active && ((t.a === 'you' && t.b === id) || (t.b === 'you' && t.a === id)));
    h += `<p class="tiny">${esc(F.blurb)}</p><p class="tiny dim">Cities: ${esc(F.visual)}.</p>
    <details><summary class="tiny">Their regard for you: <b>${rel.score}</b> (${atWar(S, 'you', id) ? '<span class="bad">at war</span>' : 'peace'}) · why?</summary><table class="t">${rel.reasons.map(r => `<tr><td>${esc(r.label)}</td><td class="r">${sign(r.amt)}</td></tr>`).join('')}<tr><td><b>Total</b></td><td class="r"><b>${rel.score}</b></td></tr></table></details>
    <div class="tiny">Power ${power(S, 'you')} vs ${power(S, id)} (visible armies and cities)</div>`;
    h += treaties.map(t => `<div class="tiny">• ${esc(t.kind)} until turn ${t.end} ${t.kind === 'shutdown' ? '(compensation ' + t.pay + ' ⚡/turn)' : ''} ${stageBtn(S, 'Cancel early', { type: 'cancel', treaty: t.id }, { cls: 'sm danger', title: 'Breaking a promise: reputation −10 and Coherence loss in every city' })}</div>`).join('');
    h += `<div class="row wrap" style="margin-top:6px">${['trade', 'nonaggression', 'research', 'passage', 'preservation', 'shutdown'].map(k => { const cmd = { type: 'treaty', to: id, kind: k }; const err = validate(S, 'you', cmd); const ev = evaluateTreaty(S, 'you', id, k); return btn('stage', k === 'nonaggression' ? 'Non-aggression' : k[0].toUpperCase() + k.slice(1), { cls: 'sm', data: { cmd }, disabled: !!err, title: err || `They are ${ev.accept ? 'likely' : 'unlikely'} to accept (score ${ev.score} vs needed ${ev.need}). Duration ${CFG.treaty.duration[k]} turns; breaking it early costs reputation and Coherence.` }); }).join('')}</div>
    <div class="row wrap" style="margin-top:6px">${atWar(S, 'you', id) ? stageBtn(S, 'Sue for peace', { type: 'demand', to: id, kind: 'peace' }, { cls: 'sm' }) : `${stageBtn(S, 'Demand tribute', { type: 'demand', to: id, kind: 'tribute', why: 'You demanded tribute.' }, { cls: 'sm', title: 'They accept only if you are much stronger; otherwise relations worsen' })}${stageBtn(S, 'Declare war', { type: 'demand', to: id, kind: 'war', why: 'You declared war.' }, { cls: 'sm danger' })}`}</div>`;
    const reasons = S.log.filter(l => l.pub && l.civ === id && /broke|declared war/.test(l.text)).slice(-2); h += reasons.map(r => `<div class="tiny bad">Turn ${r.turn}: ${esc(r.text)}</div>`).join('');
  }
  const inds = Object.values(S.cities).filter(c => c.ind && you.seen[key(c.q, c.r)]);
  h += `<h3>Independent settlements</h3>` + (inds.map(c => `<div class="card row"><span>○ ${esc(c.name)}<br><span class="tiny dim">influence ${c.influence.you || 0}/${CFG.influence.need}${c.notice ? ' · joining ' + (S.civs[c.notice.civ].short || S.civs[c.notice.civ].name) + ' turn ' + c.notice.due : ''}</span></span>${btn('select', 'Show', { cls: 'sm', data: { q: c.q, r: c.r } })}</div>`).join('') || '<p class="tiny dim">None discovered.</p>');
  return h;
}

// ---------------------------------------------------------------- Quieting
function quietSheet(app) {
  const { S } = app; const lvl = forecastLevel(S, 'you'); const you = S.civs.you; const sev = severity(S); const tot = totalResonance(S);
  let h = `<h2>The Quieting</h2><p class="tiny"><span class="tag fact">observed</span> Memories lose associations, infrastructure drifts out of calibration, some regions become hard to inhabit. <span class="tag unk">unknown</span> Why. The costs below are certain even though the cause is not.</p>`;
  h += `<h3>Schedule</h3><table class="t">${CFG.quieting.escalations.map((t, i) => `<tr><td>Escalation ${i + 1} · turn ${t}</td><td>${['Exposed powered districts lose output', 'Unprotected exposed cities lose Coherence; links become vulnerable', 'Final test: unprotected cities lose people and unsealed Archives'][i]}</td><td class="r">${S.quiet.stage > i ? '<b class="rose">arrived</b>' : t - S.turn <= 2 ? '<b class="warn">soon</b>' : ''}</td></tr>`).join('')}</table>`;
  if (lvl === 0) return h + `<p class="dim">Faint tremors only. A clear forecast arrives on turn ${CFG.quieting.firstForecast}; exact severity and regions by turn ${CFG.quieting.revealTurn}. Meanwhile, Foundries add Resonance: keep an eye on it.</p>${resonanceTable(S, false)}`;
  h += `<h3>Severity</h3><div class="card"><b>${lvl >= 2 ? sev + ' of 3' : 'reading…'}</b><div class="tiny">Baseline 1, +1 at 30 total Resonance, +1 at 60. Total Resonance now: <b>${tot}</b>. Break the Recurrence needs it below ${CFG.quieting.interruptThreshold} for the final 3 turns.</div><div class="bar"><i style="width:${Math.min(100, tot)}%"></i></div></div>`;
  h += resonanceTable(S, true);
  if (hasTech(you, 'resonance_analysis')) { const rp = resonanceProjection(S, 'you'); h += rp ? `<div class="card"><b>Resonance Analysis</b><div class="tiny">Current rate ${sign(rp.rate)}/turn → projected total <b>${rp.final}</b> on turn ${CFG.turns} ${rp.final >= CFG.quieting.interruptThreshold ? '<span class="bad">(above the interruption threshold of ' + CFG.quieting.interruptThreshold + ')</span>' : '<span class="good">(below the interruption threshold)</span>'}.</div></div>` : ''; } else h += '<p class="tiny dim">Resonance Analysis (final age) adds a projection of the total from current operations.</p>';
  const proj = projection(S, 'you');
  h += `<h3>Your cities at the final escalation</h3>${proj.rows.map(r => `<div class="card"><b>${esc(r.city.name)}</b> · ${esc(r.region)} · exposure ${lvl >= 2 ? r.exposure : (r.exposure ? '≥1' : 0)} · protection ${r.protectedBy} → <b class="${r.eff ? 'bad' : 'good'}">${r.eff ? 'exposed' : 'protected'}</b>${r.eff ? `<div class="tiny bad">Likely: ${r.losses.popLoss ? '−' + r.losses.popLoss + ' population, ' : ''}−${r.losses.cohLoss} Coherence, powered output ×${r.losses.outMult.toFixed(2)}${r.losses.archives ? ', an unsealed Archive is lost' : ''}.</div><div class="tiny">Responses: Stabilization Works (12 ◆ 8 ⚡, 3 turns; −10 Resonance; protects this city and a nearby connected one) · Continuity Vessel · Archive Seal · lower your Resonance.</div>` : ''}</div>`).join('')}`;
  h += `<h3>Regions</h3>${regionReport(S, 'you').map(r => `<div class="tiny">${esc(r.name)}: ${r.exposure === null ? '?' : r.exact ? ['safe', 'exposed', 'highly exposed'][r.exposure] : (r.exposure ? 'exposed' : 'safe')} · Resonance ${r.total}</div>`).join('')}`;
  const crises = S.log.filter(l => l.civ === 'you' && /Crisis|severed/.test(l.text)).slice(-3); if (crises.length) h += `<h3>Recent crises</h3>` + crises.map(c => `<div class="tiny">T${c.turn}: ${esc(c.text)}</div>`).join('');
  return h;
}
function resonanceTable(S, byRegion) {
  const ids = S.civOrder; return `<h3>Resonance by society</h3><table class="t">${ids.map(id => `<tr><td>${OWN[id].glyph} ${id === 'you' ? 'You' : FACTIONS[id].short}</td><td class="r">${civResonance(S, id)}</td></tr>`).join('')}<tr><td><b>Total</b></td><td class="r"><b>${totalResonance(S)}</b></td></tr></table><p class="tiny dim">Resonance is pressure on unstable world systems, not a currency or a moral score. Foundries add 1 per operating turn; some institutions add more; Gardens damp it (up to 1/turn); Stabilization removes 10 once.</p>`;
}

// ---------------------------------------------------------------- Ambition
function ambitionSheet(app) {
  const { S } = app; const you = S.civs.you; const can = S.turn >= 16 && S.turn <= 21 && !you.ambition; const changeable = you.ambition && !you.ambitionChanged && S.turn <= 23;
  let h = `<h2>Ambitions</h2><p class="tiny">Commit between turns 16 and 21 (free). You may change once through turn 23 for ${fmtCost(CFG.cost.ambitionChange)} and an order; shared research and projects remain useful. The final result is resolved on turn 30 after the Quieting. ${you.ambition ? `You are committed to <b>${AMBITIONS[you.ambition.id].name}</b>${you.ambition.auto ? ' (assigned automatically on turn 20)' : ''}.` : ''}</p>`;
  for (const [id, a] of Object.entries(AMBITIONS)) {
    const ev = evaluate(S, 'you', id); const mine = you.ambition && you.ambition.id === id;
    h += `<div class="card ${mine ? 'sel' : ''}"><div class="row"><b>${esc(a.name)}</b><span class="tiny">${Math.round(ev.frac * 100)}% there</span></div><div class="tiny dim">${esc(a.blurb)}</div><div class="bar"><i style="width:${Math.round(ev.frac * 100)}%"></i></div><ul class="clean">${ev.parts.map(p => `<li class="${p.ok ? 'good' : ''}">${p.ok ? '✓' : '○'} ${esc(p.label)}: <b>${p.cur}</b>${p.need > 1 || p.cur > 1 ? ' / ' + p.need : ''}${p.note ? ` <span class="tiny dim">${esc(p.note)}</span>` : ''}</li>`).join('')}</ul><div class="tiny dim">Key technologies: ${a.techs.map(t => (you.techs[t] ? '✓ ' : '') + TECHS[t].name).join(' · ')}</div>${can ? stageBtn(S, 'Commit to this ambition', { type: 'ambition', amb: id }, { cls: 'sm' }) : ''}${changeable && !mine ? stageBtn(S, 'Change to this (order + ' + fmtCost(CFG.cost.ambitionChange) + ')', { type: 'reform', kind: 'ambition_change', amb: id }, { cls: 'sm' }) : ''}</div>`;
  }
  const rv = ['conservatory', 'signal', 'veil'].map(r => `${OWN[r].glyph} ${FACTIONS[r].short}: ${AMBITIONS[FACTIONS[r].ambition].name}`).join(' · ');
  return h + `<p class="tiny dim">Rivals pursue their own ambitions with the same rules (${rv}). Several societies may succeed; a rival's success changes the epilogue but does not defeat you unless an announced exclusive condition applies (none do in this build).</p>`;
}

// ---------------------------------------------------------------- Log & Guide
function logSheet(app) {
  const { S, ui } = app; const f = ui.logFilter || 'you';
  const rows = S.log.filter(l => f === 'all' ? true : f === 'you' ? l.civ === 'you' : l.pub).slice(-250).reverse();
  return `<h2>Log</h2><div class="row wrap">${['you', 'pub', 'all'].map(x => btn('logfilter', { you: 'Mine', pub: 'World', all: 'All' }[x], { cls: 'sm ' + (f === x ? 'on' : ''), data: { f: x } })).join('')}</div>${rows.map(l => `<div class="logline i${l.imp}"><span class="tn">T${l.turn}</span>${esc(l.text)}</div>`).join('') || '<p class="dim">Nothing yet.</p>'}`;
}
export function guideSheet(app) {
  return `<h2>Guide & glossary</h2>
  <h3>Hotkeys</h3><div class="hotkeys"><kbd>Enter</kbd><span>End turn (opens commitment summary)</span><kbd>Esc</kbd><span>Cancel targeting / close panel</span><kbd>←↑↓→</kbd><span>Move map cursor (Shift+↑/↓ for the other diagonal)</span><kbd>S</kbd><span>Survey mode</span><kbd>X</kbd><span>Claim mode</span><kbd>O</kbd><span>Outpost mode</span><kbd>F</kbd><span>Found-city mode</span><kbd>U</kbd><span>Undo last staged order</span><kbd>E D Q A L G</kbd><span>Empire, Diplomacy, Quieting, Ambition, Log, Guide</span><kbd>C</kbd><span>Council</span><kbd>Home</kbd><span>Recentre map</span></div>
  <h3>Core ideas</h3><ul class="clean tiny"><li><b>Orders</b>: 3 per turn. Develop, Expand, Mobilize, Negotiate, Reform. Ongoing work (projects, research, army objectives) continues without more orders. Staging, reading and undoing are free until you commit.</li><li><b>Resources</b>: Sustenance ❀ feeds people; Matter ◆ builds; Energy ⚡ powers; Memory ◈ is usable informational material. <b>Named fragments</b> are different: never silently spent.</li><li><b>Coherence</b>: whether a city can function together. Not goodness: an authoritarian city can be coherent and unhappy.</li><li><b>Resonance</b>: pressure on unstable world systems from active infrastructure. Not a currency, not a moral score.</li><li><b>Fog</b>: unexplored (dark), explored (veiled), observed (clear). Enemy armies you can no longer see leave a dashed, aged marker.</li><li><b>Ownership is never colour alone</b>: every society has a glyph and a border pattern. ${Object.entries(OWN).map(([id, o]) => `<span class="legend"><span class="mini" style="border-color:${o.dark};border-top-style:${o.dash.length ? (o.dash[0] > 6 ? 'dashed' : 'dotted') : 'solid'}"></span>${o.glyph} ${o.name}</span>`).join(' ')}</li></ul>
  <h3>Terrain</h3><ul class="clean tiny">${Object.values(TERRAIN).map(t => `<li><b>${t.name}</b>: ${esc(t.blurb)}</li>`).join('')}</ul>
  <h3>Districts</h3><ul class="clean tiny">${Object.values(DISTRICTS).map(d => `<li><b>${d.icon} ${d.name}</b>: ${esc(d.blurb)}</li>`).join('')}</ul>
  <h3>Combat</h3><ul class="clean tiny">${Object.values(ROLES).map(r => `<li><b>${r.icon} ${r.name}</b>: ${esc(r.blurb)}</li>`).join('')}${Object.values(APPROACH).map(a => `<li><b>${a.name}</b>: ${esc(a.blurb)}</li>`).join('')}</ul>
  <p class="tiny dim">Full formulas: docs/COMBAT.md · Systems reference: docs/SYSTEMS.md. The cosmology stays ambiguous on purpose: costs and forecasts are always exact even when lore is not.</p>`;
}

// ---------------------------------------------------------------- tutorial guide card
export function guideCard(app) {
  const { S, ui } = app; if (ui.guideOff || S.turn > 8) return ''; const you = S.civs.you; const cities = civCities(S, 'you');
  const done = { city: cities.length > 1, dev: cities.some(c => c.project || c.districts.length) , survey: (S.log.some(l => l.civ === 'you' && /Survey revealed/.test(l.text))), disc: you.inst.some(Boolean) || Object.values(S.sites).some(s => s.by === 'you') };
  let msg;
  if (!done.survey) msg = `<b>1 · Look around.</b> Select a tile you can see and press <b>Survey</b> (<kbd>S</kbd>). Surveys cost an order but no resources, and reveal nearby ground.`;
  else if (!done.dev) msg = `<b>2 · Build.</b> Select your capital and choose <b>Develop…</b> A Garden or Archive finishes in 2 turns. Projects keep working without more orders.`;
  else if (!done.city) msg = `<b>3 · Settle.</b> Cities must be 3+ hexes apart and on explored ground. <b>Survey</b> first, then <b>Claim</b> (<kbd>X</kbd>) a tile marked <b>⌂+</b> (2 ◆), then <b>Found city</b> (<kbd>F</kbd>). Your orders are limited: 3 per turn.`;
  else if (!done.disc) msg = `<b>4 · Interpret.</b> A pulsing ring marks a discovery. Open it, read the three readings (facts, interpretations, unknowns), and choose, or take the modest salvage.`;
  else msg = `<b>5 · Long goal.</b> Open <b>Ambition</b> to preview all four endings. You commit between turns 16–21. The Quieting forecast arrives on turn 12, and it is survivable if you prepare.`;
  return `<div class="guide" role="note">${msg}<div class="row"><span class="tiny dim">Tutorial · turns 1–8</span>${btn('guideoff', 'Hide', { cls: 'sm ghost' })}</div></div>`;
}

// ---------------------------------------------------------------- modals
export function modalHtml(app) {
  const m = app.ui.modal; if (!m) return '';
  const { S } = app;
  const wrap = (inner, o = {}) => `<div class="scrim" data-act="scrim"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(o.label || 'Dialog')}" style="${o.w ? 'width:' + o.w : ''}">${o.nox ? '' : `<button class="btn sm ghost close" data-act="closemodal" aria-label="Close (Esc)">✕</button>`}${inner}</div></div>`;
  switch (m.type) {
    case 'setup': return wrap(setupHtml(app), { label: 'Begin a civilization', nox: !m.canClose, w: 'min(1000px,96vw)' });
    case 'council': return wrap(councilHtml(app), { label: 'Council session' });
    case 'summary': return wrap(summaryHtml(app), { label: 'Turn resolution', w: 'min(620px,96vw)' });
    case 'commit': return wrap(commitHtml(app), { label: 'Commitment summary', w: 'min(660px,96vw)' });
    case 'discovery': return wrap(discoveryHtml(app, m.site), { label: 'Discovery', w: 'min(1040px,97vw)' });
    case 'settings': return wrap(settingsHtml(app), { label: 'Settings', w: 'min(520px,96vw)' });
    case 'menu': return wrap(menuHtml(app), { label: 'Menu', w: 'min(480px,96vw)' });
    case 'ending': return wrap(endingHtml(app), { label: 'Chronicle', nox: true, w: 'min(980px,97vw)' });
    case 'logfull': return wrap(`<h2>Complete log</h2>${logSheet(app)}`, { label: 'Log', w: 'min(640px,96vw)' });
    case 'debug': return wrap(debugHtml(app), { label: 'Debug', w: 'min(760px,96vw)' });
    case 'message': return wrap(`<h2>${esc(m.title)}</h2><p>${esc(m.text)}</p><div class="row">${btn('closemodal', 'OK', { cls: 'primary' })}</div>`, { label: m.title, w: 'min(520px,96vw)' });
  }
  return '';
}
function setupHtml(app) {
  const { ui, profile } = app; const st = ui.setup; const leg = profile.legacy && !st.fresh ? profile.legacy : null;
  return `<div class="titlescreen"><div class="sub">the palimpsest</div><h1>Stotkal</h1><div class="sub" style="letter-spacing:.35em">what remains</div>
  <p style="max-width:640px;margin:10px auto;font-family:var(--serif);font-style:italic">You wake with language, instincts and an incomplete past. The world cannot keep everything. When it cannot carry everything forward, who decides what it remembers?</p></div>
  <h3 style="margin-top:6px">Founding tradition</h3><div class="pickrow">${Object.entries(TRADITIONS).map(([id, t]) => { const lock = t.unlock && !(profile.achievements || []).includes(t.unlock) && !app.settings.debug; return `<button class="pick ${st.tradition === id ? 'on' : ''}" ${lock ? 'disabled' : ''} data-act="setup" data-k="tradition" data-v="${id}">${lock ? `<span class="tag">locked</span> <span class="tiny">Earn “${esc(ACHIEVEMENTS[t.unlock].name)}”: ${esc(ACHIEVEMENTS[t.unlock].desc)}</span><br>` : ''}<b>${esc(t.name)}</b><div class="tiny">${esc(t.blurb)}</div><span class="g">＋ ${esc(t.gain)}</span><span class="c">− ${esc(t.cost)}</span></button>`; }).join('')}</div>
  <h3>Witness disposition</h3><div class="pickrow">${Object.entries(DISPOSITIONS).map(([id, t]) => { const lock = t.unlock && !(profile.achievements || []).includes(t.unlock) && !app.settings.debug; return `<button class="pick ${st.disp === id ? 'on' : ''}" ${lock ? 'disabled' : ''} data-act="setup" data-k="disp" data-v="${id}">${lock ? `<span class="tag">locked</span> <span class="tiny">Earn “${esc(ACHIEVEMENTS[t.unlock].name)}”: ${esc(ACHIEVEMENTS[t.unlock].desc)}</span><br>` : ''}<b>${esc(t.name)}</b><div class="tiny">${esc(t.blurb)}</div><span class="g">＋ ${esc(t.gain)}</span><span class="c">− ${esc(t.cost)}</span></button>`; }).join('')}</div>
  <p class="tiny dim">Terrain is the third influence: the map is generated from the seed, and your start always has a garden, an early discovery and more than one way to develop. None of these choices locks you into an ambition.</p>
  ${profile.legacy ? `<div class="card"><label><input type="checkbox" data-act="setupfresh" ${st.fresh ? 'checked' : ''}> <b>Fresh chronicle</b> — ignore the inherited legacy (your history is kept).</label><div class="tiny">${st.fresh ? 'No inherited effects this run.' : `Inherited: <b>${esc(profile.legacy.name)}</b> (${LEGACIES[profile.legacy.kind].name}). ${esc(LEGACIES[profile.legacy.kind].gain)} <span class="bad">${esc(LEGACIES[profile.legacy.kind].cost)}</span>`}</div></div>` : ''}
  <div class="row"><label class="tiny">Seed <input id="seedin" value="${esc(st.seed)}" placeholder="(random)" style="width:150px" aria-label="Seed"></label><span class="tiny dim">${profile.runs ? profile.runs + ' chronicle(s) written' : 'first run'}</span><div>${app.hasSave ? btn('continue', 'Continue saved run', { cls: '' }) : ''} ${btn('beginrun', 'Begin', { cls: 'primary' })}</div></div>`;
}
function councilHtml(app) {
  const { S } = app; const you = S.civs.you; const cs = S.council; const have = available(S, 'you'); const chosen = S.staged.you.find(c => c.type === 'council');
  const age = ageOf(S.turn); const used = !!cs.petition[age];
  return `<h2>Council · turn ${S.turn}</h2><p class="tiny dim">A scheduled session. Choosing one normally uses no empire order; the displayed costs still apply. You may pass. Offers are fixed for this turn and saved: loading cannot reroll them.</p>
  <div class="cols c3">${cs.offers.map(o => { const cost = o.cost; const err = chosen && chosen.offer === o.id ? null : null; const afford = RES.every(k => have[k] + (chosen && chosen.offer === o.id ? (chosen.cost[k] || 0) : 0) >= (cost[k] || 0)); return `<div class="opt ${chosen && chosen.offer === o.id ? 'sel' : ''}"><span class="tag">${esc(o.cat)}</span><h3>${esc(o.title)}</h3><div class="interp-text"><span class="tag interp">story</span> ${esc(o.story)}</div><div class="gain"><span class="tag fact">effect</span> ${esc(o.shows)}</div><div>${costHtml(cost, have)}</div>${btn('council', chosen && chosen.offer === o.id ? 'Chosen ✓' : 'Choose', { cls: 'primary', data: { offer: o.id }, disabled: !afford && !(chosen && chosen.offer === o.id) , title: afford ? '' : 'Not affordable' })}</div>`; }).join('')}</div>
  <div class="row" style="margin-top:12px"><span>${btn('council', 'Pass', { data: { offer: '' } })} ${btn('petition', 'Petition: replace one offer', { disabled: used, title: used ? 'Used this age' : 'Once per age: replaces the last offer with a new draw. No currency.' })}</span><span class="tiny dim">${used ? 'Petition used this age.' : 'One petition available this age.'}</span>${btn('closemodal', 'Decide later', { cls: 'ghost' })}</div>`;
}
function summaryHtml(app) {
  const { S } = app; const sum = S.lastSummary; if (!sum) return '';
  const battles = sum.events.filter(e => e.battle);
  return `<h2>Turn ${sum.turn} resolved</h2><p class="tiny dim">Now turn ${S.turn} · ${ageName(S)}. Short summary; the complete log is under Log.</p>${summaryList(sum, 10)}<div class="row"><span class="tiny dim">${S.proposals.filter(p => p.to === 'you').length ? '◆ A society has made you a proposal.' : ''}</span>${btn('closemodal', 'Continue', { cls: 'primary' })}</div>`;
}
function commitHtml(app) {
  const { S } = app; const you = S.civs.you; const cmds = S.staged.you; const e = computeEconomy(S, 'you'); const rs = reserved(S, 'you'); const L = ordersLeft(S, 'you');
  const warns = []; if (e.deficit) warns.push(`Sustenance deficit of ${e.deficit} next turn: ${Object.keys(e.shortCities).map(id => S.cities[id].name).join(', ')} lose Coherence.`); if (e.paused.length) warns.push(`${e.paused.length} powered structure(s) will pause for lack of Energy.`);
  const idleCities = civCities(S, 'you').filter(c => !c.project && !cmds.some(x => x.type === 'develop' && x.city === c.id)); if (idleCities.length) warns.push(`Idle (no project): ${idleCities.map(c => c.name).join(', ')}.`);
  if (!you.research.target && !cmds.some(c => c.kind === 'research')) warns.push('No research program is active.');
  if (S.council.offers && S.council.turn === S.turn && !S.council.chosen && !cmds.some(c => c.type === 'council')) warns.push('A council session is open and no choice is staged (passing is allowed).');
  if (L > 0) warns.push(`${L} order${L === 1 ? '' : 's'} unused. Skipping is allowed.`);
  const next = {}; for (const k of RES) next[k] = you.res[k] - rs[k] + e.net[k];
  return `<h2>Commit this turn?</h2><p class="tiny dim">Everything below can still be revised. Nothing is spent until you commit.</p>
  <ol>${cmds.map(c => `<li>${esc(describeCmd(S, c))} ${costHtml(c.cost)}${c.order ? '' : ' <span class="tag">free</span>'}</li>`).join('') || '<li class="dim">No orders staged.</li>'}</ol>
  <dl class="kv"><dt>Reserved</dt><dd>${costHtml(rs)}</dd><dt>Projected stocks next turn</dt><dd>${RES.map(k => `${RES_META[k].i}${Math.max(0, next[k])}`).join(' ')}</dd></dl>
  ${warns.length ? `<ul class="clean">${warns.map(w => `<li class="warn">▲ ${esc(w)}</li>`).join('')}</ul>` : ''}
  <div class="row" style="margin-top:10px">${btn('closemodal', 'Revise', {})}${btn('commit', 'Commit &amp; end turn <kbd>Enter</kbd>', { cls: 'primary' })}</div>`;
}
export function discoveryHtml(app, siteId) {
  const { S, ui } = app; const you = S.civs.you; const s = S.sites[siteId]; const D = DISCOVERIES[s.type]; const have = available(S, 'you');
  if (s.state !== 'open') return `<h2>${esc(s.name)}</h2><p>${s.state === 'salvaged' ? 'Salvaged' : 'Interpreted'} by ${s.by === 'you' ? 'you' : esc(S.civs[s.by].name)}${s.interp ? ': <b>' + esc(INSTITUTIONS[s.interp].name) + '</b>' : ''}. The site is closed; its named fragment, "${esc(s.fragment || '')}", went with it.</p><div class="row">${btn('closemodal', 'Close', { cls: 'primary' })}</div>`;
  const slot = ui.slot ?? (you.inst.findIndex(x => !x) >= 0 ? you.inst.findIndex(x => !x) : 0);
  const haveInst = you.inst.filter(Boolean).map(x => INSTITUTIONS[x.id]);
  const staged = S.staged.you.find(c => (c.kind === 'install' && c.site === siteId) || (c.type === 'salvage' && c.site === siteId));
  const sal = Math.round(CFG.salvage.mem * (1 + fx(S, you, 'salvageMult'))), salm = Math.round(CFG.salvage.mat * (1 + fx(S, you, 'salvageMult')));
  return `<h2>${esc(s.name)}</h2>
  <div class="cols c3"><div class="card"><span class="tag fact">observed</span><p class="tiny">${esc(D.blurb)}</p><p class="tiny">It will leave a named fragment: <i>"${esc(s.fragment)}"</i> (${esc(D.cat)}). Fragments are preserved, never spent.</p></div>
  <div class="card"><span class="tag interp">faction readings</span><ul class="clean tiny">${Object.entries(FACTIONS).map(([id, f]) => { const likes = D.interps.filter(i => f.prefers.includes(i)).map(i => INSTITUTIONS[i].name), dis = D.interps.filter(i => f.dislikes.includes(i)).map(i => INSTITUTIONS[i].name); return `<li>${OWN[id].glyph} <b>${esc(f.short)}</b> ${likes.length ? 'would favour ' + esc(likes.join(', ')) : 'has no strong view'}${dis.length ? '; recoils from ' + esc(dis.join(', ')) : ''}.</li>`; }).join('')}</ul></div>
  <div class="card"><span class="tag unk">unknown</span><p class="tiny">What this place <i>is</i> stays uncertain. A tower may be a library, an organism, a climate machine, or several. The costs and rules below are exact; the meaning is yours to choose.</p></div></div>
  <h3>Institution slot</h3><div class="row wrap">${you.inst.map((x, i) => btn('slot', `Slot ${i + 1}: ${x ? esc(INSTITUTIONS[x.id].name) + ' (replace)' : 'empty'}`, { cls: 'sm ' + (slot === i ? 'on' : ''), data: { i } })).join('')}</div>${you.inst[slot] ? `<p class="tiny warn">Replacing ${esc(INSTITUTIONS[you.inst[slot].id].name)} costs −4 Coherence in every city and is recorded in your Chronicle even after it is gone.</p>` : ''}
  <div class="cols c3" style="margin-top:8px">${D.interps.map(id => { const I = INSTITUTIONS[id]; const cost = instCost(S, you, id); const cmd = { type: 'reform', kind: 'install', site: s.id, interp: id, slot }; const err = validate(S, 'you', cmd); const others = you.inst.filter((x, i) => x && i !== slot).map(x => INSTITUTIONS[x.id]); const clash = others.filter(o => o.conflicts.some(t => I.tags.includes(t)) || I.conflicts.some(t => o.tags.includes(t))); const syn = Object.entries(COMBOS).filter(([cid, c]) => c.needs.inst === id).map(([, c]) => `${c.name}: ${hasTech(you, c.needs.tech) ? 'ACTIVE' : 'with ' + TECHS[c.needs.tech].name}`);
      return `<div class="opt ${staged && staged.interp === id ? 'sel' : ''}"><span class="tag">${esc(I.style)}</span><h3>${esc(I.name)}</h3><div class="interp-text">${esc(I.blurb)}</div><div class="gain"><b>Gain</b> ${esc(I.gain)}</div><div class="risk"><b>Risk</b> ${esc(I.risk)}</div>${clash.length ? `<div class="risk"><b>Conflicts with</b> ${clash.map(c => esc(c.name)).join(', ')}: −6 Coherence in every city, once.</div>` : ''}${syn.length ? `<div class="syn"><b>Combines</b> ${syn.map(esc).join(' · ')}</div>` : ''}<div class="tiny">${I.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div><div>${costHtml(cost, have)}<span class="tiny">+ 1 Reform order</span></div>${btn('stage', staged && staged.interp === id ? 'Staged ✓' : 'Interpret this way', { cls: 'primary', data: { cmd }, disabled: !!err, title: err || '' })}${err ? `<div class="tiny bad">${esc(err)}</div>` : ''}</div>`; }).join('')}</div>
  <div class="row" style="margin-top:12px"><span>${stageBtn(S, `Salvage (free): +${sal} ◈ +${salm} ◆ and the fragment; closes this site`, { type: 'salvage', site: s.id })}</span><span class="tiny dim">Declining or deferring is fine: the site stays open.</span>${btn('closemodal', 'Decide later', { cls: 'ghost' })}</div>`;
}
function settingsHtml(app) {
  const st = app.settings;
  return `<h2>Settings</h2><div class="stack"><label>Text size <input type="range" min="0.85" max="1.5" step="0.05" value="${st.textScale}" data-act="set" data-k="textScale" aria-label="Text size"> <b>${Math.round(st.textScale * 100)}%</b></label>
  <label><input type="checkbox" data-act="setb" data-k="reducedMotion" ${st.reducedMotion ? 'checked' : ''}> Reduced motion (stops drifting clouds, pulses and shimmer)</label>
  <label><input type="checkbox" data-act="setb" data-k="quietLayer" ${st.quietLayer !== false ? 'checked' : ''}> Show Quieting exposure on the map</label>
  <label>Music <input type="range" min="0" max="1" step="0.05" value="${st.music}" data-act="set" data-k="music" aria-label="Music volume"></label>
  <label>Effects <input type="range" min="0" max="1" step="0.05" value="${st.fx}" data-act="set" data-k="fx" aria-label="Effects volume"></label>
  <p class="tiny dim">Ownership is always shown by glyph and border pattern as well as colour. Audio is never required to understand a threat.</p>
  <label><input type="checkbox" data-act="setb" data-k="debug" ${st.debug ? 'checked' : ''}> Developer tools (separate from normal play)</label></div>`;
}
function menuHtml(app) {
  return `<h2>Menu</h2><div class="stack"><p class="tiny dim">The run is saved after every resolved turn and whenever you change staged orders, so you can quit and resume at the commitment stage.</p>${btn('savenow', 'Save now')} ${btn('exportsave', 'Export save file')} <label class="btn">Import save <input type="file" id="importfile" accept=".json,application/json" hidden></label>${btn('newrun', 'Abandon run and begin a new one', { cls: 'danger' })}${btn('closemodal', 'Back', { cls: 'primary' })}${app.settings.debug ? btn('modal', 'Debug…', { data: { m: 'debug' }, cls: 'sm' }) : ''}</div>`;
}
function debugHtml(app) {
  const { S } = app;
  const ai = S.aiLog.slice(-40).reverse();
  return `<h2>Developer tools</h2><p class="tiny dim">Separate from normal play. Seed <b>${esc(S.seed)}</b> · map attempt ${S.mapAttempt} · RNG ${S.rng}</p><div class="row wrap">${btn('dbg', '+20 all resources', { data: { a: 'res' }, cls: 'sm' })}${btn('dbg', 'Reveal map', { data: { a: 'reveal' }, cls: 'sm' })}${btn('dbg', 'Fast-forward 1 (bot orders)', { data: { a: 'ff1' }, cls: 'sm' })}${btn('dbg', 'Fast-forward to turn 12', { data: { a: 'ff12' }, cls: 'sm' })}${btn('dbg', 'Fast-forward to turn 29', { data: { a: 'ff29' }, cls: 'sm' })}</div>
  <h3>Ambition inspection</h3>${Object.keys(AMBITIONS).map(id => { const ev = evaluate(S, 'you', id, S.turn >= 30); return `<div class="tiny"><b>${id}</b> ${Math.round(ev.frac * 100)}% ${ev.ok ? '✓' : ''}: ${ev.parts.map(p => `${p.label} ${p.cur}/${p.need}`).join(' | ')}</div>`; }).join('')}
  <h3>Rival motives (last 40)</h3><table class="t">${ai.map(l => `<tr><td>T${l.turn}</td><td>${esc(l.civ)}</td><td>${esc(l.cmd || '')}</td><td class="r">${l.u ?? ''}</td><td>${esc(l.why || l.error || '')}</td></tr>`).join('')}</table>`;
}
function endingHtml(app) {
  const { S, ui } = app; const e = S.ending; const c = e.chronicle; const A = e.ambition ? AMBITIONS[e.ambition] : null;
  return `<div class="titlescreen"><div class="sub">${e.kind === 'collapse' ? 'the record ends early' : 'turn 30 · the cycle ends'}</div><h1 style="font-size:1.9rem;letter-spacing:.12em">${esc(c.head)}</h1></div>
  <div class="cols c2"><div><h3>What you built</h3>${c.built.map(b => `<p>${esc(b)}</p>`).join('')}<h3>What you believed</h3><p>${esc(c.believedTxt)}</p><h3>Promises</h3><p>${esc(c.promises)}</p><h3>What was sacrificed</h3>${c.sacrifices.length ? c.sacrifices.map(x => `<p>• ${esc(x)}</p>`).join('') : '<p>No settlement was lost.</p>'}<h3>What was preserved</h3><p>${esc(c.frag)}</p></div>
  <div><h3>The ambition (mechanical result)</h3>${A ? `<p><b>${esc(A.name)}</b>: ${e.success ? '<b class="good">achieved</b>' : '<b class="bad">not achieved</b>'}</p><ul class="clean tiny">${e.parts.map(p => `<li class="${p.ok ? 'good' : 'bad'}">${p.ok ? '✓' : '✕'} ${esc(p.label)}: ${p.cur}${p.need > 1 ? '/' + p.need : ''}</li>`).join('')}</ul>` : '<p>None was committed.</p>'}<h3>The cost (emotional result)</h3><div class="quote">${esc(c.cost)} ${esc(c.witnessLoss)}</div><h3>The others</h3>${c.rivals.map(r => `<p class="tiny">${esc(r)}</p>`).join('')}<h3>Those who remain</h3>${c.survivors.map(s => `<p class="tiny">${esc(s.name)}: ${s.pop} people, Coherence ${s.coh}</p>`).join('') || '<p class="tiny">No one.</p>'}</div></div>
  ${(e.newAchievements || []).length ? `<div class="card sel"><b>Earned:</b> ${e.newAchievements.map(id => `“${esc(ACHIEVEMENTS[id].name)}”`).join(', ')} — ${e.newAchievements.map(id => id === 'something_remains' ? 'the Salt Cartographers can now found a people' : id === 'every_promise' ? 'the Mourner can now be chosen as Witness' : 'recorded in your history').join('; ')}.</div>` : ''}
  <h3>Choose one legacy for the next cycle</h3><p class="tiny dim">Only one legacy modifies the next run, with bounded strength and a complication. The record of this run is kept either way.</p>
  <div class="cols c3">${e.legacies.map((l, i) => `<div class="opt ${ui.legacyPick === i ? 'sel' : ''}"><h3>${esc(l.name)}</h3><div class="tiny">${esc(l.why)}</div><div class="gain">${esc(LEGACIES[l.kind].gain)}</div><div class="risk">${esc(LEGACIES[l.kind].cost)}</div>${btn('legacy', ui.legacyPick === i ? 'Chosen ✓' : 'Choose', { data: { i }, disabled: !l.eligible, cls: 'primary' })}</div>`).join('')}</div>
  <div class="row" style="margin-top:12px">${btn('legacy', 'No legacy (fresh chronicle)', { data: { i: -1 } })}${btn('nextrun', 'Begin another cycle', { cls: 'primary' })}</div>`;
}
