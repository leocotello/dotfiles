# Verification report

Honesty rule: **measured** = produced by running code in this repository; **estimated** = reasoning; **not validated** = needs humans.

## 1. What was actually run

| What | How | Result |
|---|---|---|
| Automated tests | `npm test` (`node --test tests/*.test.js`) | **47 / 47 passing** across `core`, `systems`, `design`, `simulation` |
| Complete-game sweeps | `npm run simulate -- 30 all` (30 seeds × 5 play modes = 150 full 30-turn games, rotating traditions/dispositions) | **0 crashes**, no NaN/negative/absurd values, no deadlocked turns, every game ended with an ending |
| In-test sweep | `tests/simulation.test.js`: 20 seeds × 2 modes, asserting no crash, turn advance each resolution, valid ranges, rival planner never throws, Resonance bounded | passing |
| Real-UI run | headless Chromium (Playwright) via `npm run screenshots`: begins a run through the setup screen, stages orders by keyboard and canvas clicks, commits with `Enter`, council, discovery, empire, diplomacy, Quieting, ambitions, army forecast, full game to the Chronicle, legacy choice, next run (legacy ruin appears) | no console errors on any screen |
| UI fuzz | `node tools/fuzz-ui.mjs <seed> <steps>`: seeded random clicks, hotkeys and map clicks inside the real page; 5 seeds, each played to a Chronicle (two via early collapse) | **0 console errors**, no dead ends (every run reached an ending) |
| Save/resume in the browser | `node tools/resume-test.mjs`: stage a council choice at turn 6, quit, reload, Continue | turn, RNG state, staged orders, council offers, stocks **identical** |
| Window / accessibility variants | 1024×640, 800×600, 140% text, `prefers-reduced-motion` | essential controls (End Turn, resources, Quieting chip) on-screen and no horizontal scroll in each; screenshots 15–18 |
| Performance (headless Chromium, software rendering) | `node tools/profile.mjs`; `tests/simulation.test.js` | turn resolution **≈ 12 ms** mean (max ≈ 23–33 ms) including the three rival planners; map frame **≈ 3.3 ms**; side-panel build ≈ 1.8 ms; planning + resolution ≈ 10 ms/turn headless |

## 2. Automated coverage against the requested list
Resource conservation & reservation (`core`: items sum to net; reservations across simultaneous orders; order cap; unstage refund) · deterministic seed replay and **save/load equivalence** (mid-run resume yields byte-identical future) · save at the commitment stage keeps staged orders, offers and RNG · save recovery messages (corrupt/foreign/newer/removed content) · map connectivity, size, content counts and start viability (30 seeds) · invalid prerequisites (research, works, restore, treaties, spacing) · construction completion and half-refund on replacement · research accounting (Memory spent = progress, switching preserves progress, no completion surcharge) · shortage forecast/allocation/starvation · connectivity (friendly ≠ connected) · ownership change (tiles, projects, capital reassignment, elimination, early collapse ending) · supply disruption (treaty passage ends, outpost restores, no healing out of supply) · combat (forecast == resolution, role/terrain numbers, approaches, siege entrenchment, raid cap + cooldown, capture) · initiative is unbiased between factions (400 draws) · objectives persist without orders; unreachable targets give a clear message · event cooldowns (raid per-target cooldown; regional crisis cooldown per region) · council (persisted offers, one petition per age persisting through save/load, no consecutive repeats, an affordable option) · Quieting (forecast levels at 11/12/18, escalation effects, protection bands, bounded severity) · each ambition's **success and failure boundaries** (exactly 10 population/exactly 50 mean Coherence, 4 vs 5 fragments, 1 vs 2 sealed Archives, Resonance 39/41, spire access, network institution) · four institution×tech combinations change practical rules · institution replacement leaves a Chronicle record and no dangling combo · mutual shutdown offers are accepted by the planner and pause the partner's Foundries · legacy effects are bounded/expire; fresh chronicle disables them · fog (explored vs observed vs last-known with age) · rival decisions all log motives and use the same commands · broken pacts are logged with reputation and Coherence cost and can be prevented by Verified Treaties · every ambition has a discoverable baseline route in 30 generated worlds · **no dead modifier keys in data**.

## 3. Simulation findings (heuristic planner playing the *player's* side, same API as rivals) — simulation, not human experience

| Mode | Games | Ambition achieved | Avg cities | Avg pop | Avg total Resonance | Collapse | Rival ambitions achieved per run (of 3) |
|---|---|---|---|---|---|---|---|
| embodied | 30 | 17 (57%) | 2.7 | 23.7 | 18.5 | 0 | 1.5 |
| shared | 30 | 19 (63%) | 3.0 | 26.4 | 30.4 | 0 | 1.5 |
| record | 30 | 19 (63%) | 2.6 | 20.2 | 19.1 | 0 | 1.6 |
| break | 30 | 11 (37%) | 2.2 | 19.5 | 18.8 | 0 | 1.6 |
| idle (never acts) | 30 | 0 (0%) | 0.7 | 3.9 | 20.2 | 9 (30%) | 1.9 |

Reading: all four routes are reachable by a mediocre, non-conquering planner; Break the Recurrence is the hardest (needs scouting/outposts, two Stabilizations and a Resonance budget); doing nothing never wins and is punished (rivals exploit an undefended neighbour); peaceful builds are rarely attacked (wars involving the player ≈ 0.1 per run for embodied, ≈ 0.3 for record, city lost ≈ 0.0–0.03 per run). Most common failures for the planner: too few settlements (Embodied), missing sealed Archives/fragments (Record), connection/anchors (Shared), anomaly investigation (Break).
Rivals reach their own ambitions about half the time in these runs; this affects only the epilogue, never the player's result.

## 4. Design tests requested
* *Peaceful archive civilisation*, *embodied federation*, *route needing no conquest*: run as **automated approximations** (`tests/design.test.js`, 16 seeds each, bot ambition = record / embodied / break): ≥ 3, ≥ 3 and ≥ 2 successes required and met; the Break test additionally requires wins with zero conquests.
* *Military-supported continuity*: scripted scenario: an army of three roles takes an independent settlement in ≤ 8 turns, retaining infrastructure and suffering integration pressure.
* *Recovery from an early poor interpretation* (institution replacement, transition penalty and Chronicle memory), *a lost city* (capital passes on; ambitions/works update; last-city loss ends the run with a Chronicle and three legacy options), *a broken supply route* (passage ends → unsupplied; an outpost restores): all tested.
These are not human playtests.

## 5. Run length — estimated, **not validated**
The brief's 75–110 minute target (centre 90) cannot be established by simulation. Estimate from structure: 30 turns × (resolution summary read ≈ 20 s + 3 orders with forecast reading ≈ 60–150 s + a council session on 9 turns ≈ 90 s + an occasional discovery ≈ 2 min) ≈ **60–100 minutes** for a first run; faster on repeat. Human playtests must measure: median turn time, total duration, unused orders, decision reversals (undo), interpretation diversity, when players understand their ambition, and whether outcomes feel attributable to choices. Nothing has been measured.

## 6. Known limitations (balance, art, content)
* **Balance is simulation-tuned only.** Every number is a hypothesis in data. Observations to examine with humans: Sustenance/Energy become abundant for the planner by mid-game while Matter and Memory stay scarce (distinct bottlenecks exist early, saturate late); rival ambition success (~50%) may be too high; wars are infrequent for developing players; Resonance thresholds (30/60) were not retuned for four civilisations and the 40 interruption threshold is rarely binding for active players.
* **Art is a procedural Canvas approximation** of the Stotkal vocabulary (chrome gradients, glass, wirelines, rose horizon, giant sleeper silhouette, per-faction city silhouettes, per-institution city features). It is not hyperreal and does not claim to be. Upgrade path in `DECISIONS.md`.
* **Audio is a synthesised drone and chimes**; no licensed assets; not a composed score.
* Content volume: 18 technologies, 6 interpretable discovery types × 3 readings (+ anomalies and the Spire), 27 council opportunities, 4 ambitions, 3 legacies, 8 districts + 4 works, 3 rivals, 3 traditions, 3 dispositions. Not implemented: see `DECISIONS.md` ("Removed or not implemented").
* Keyboard: all actions reachable via Tab/Enter/hotkeys; map cursor by arrows. No screen-reader pass was run; the canvas itself is not described tile-by-tile (the context panel is the text equivalent).
* The UI was inspected visually at 1440×900, 1024×640, 800×600 and at 140% text; no touch testing.
* Browser support was exercised in Chromium only.

## 7. Screenshots (`screenshots/`, generated by `npm run screenshots`)
01 founding choices · 02 awakening · 03 develop · 04 commitment summary · 05 resolution summary · 05b claim targeting with city-site hints · 06 council · 07 discovery interpretation · 08 map at turn 8 · 09 Quieting forecast · 10 Empire · 11 Diplomacy · 12 Ambitions · 13 army path and conditional forecast · 14 Chronicle and legacy · 15–18 small window, 140% text, reduced motion.

## 8. v2 verification
- `npm test`: 64 tests pass (47 v1 regression + 17 action-layer).
- UI fuzz (`node tools/fuzz-ui.mjs fz1 900`): reaches the ending, 483 clicks, 0 console errors. Manual headless-browser checks of setup, beats (with timer), expedition doors/rooms, radial menu, walk preview.
- `tools/resume-test.mjs`: quit-and-resume at the commitment stage is byte-identical.
- Not validated: human pacing of timed beats, true difficulty, accessibility of the new modals with a screen reader.
