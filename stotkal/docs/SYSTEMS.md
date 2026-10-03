# Systems reference

All numbers live in `src/data/content.js` (`CFG` and the data tables) and are **initial balancing hypotheses**.

## 1. Turn pipeline (`src/sim/resolve.js`, `PHASES`)
Player-facing sequence: (1) concise resolution of the previous turn → (2) council session if due → (3) free inspection →
(4) stage ≤ 3 orders + any council decision → (5) commitment summary, revise freely → (6) rivals commit orders through
the same `stage()` validators → (7) resolution:

| Phase | What happens |
|---|---|
| `political` | proposals expire; due federations join; staged *council, ambition, answer, respond, reform, treaty, influence, demand, cancel, claim, city, develop, salvage* commands apply in seeded initiative order |
| `exploration` | *survey, outpost, investigate, recruit, objective*; then vision and discovery sync |
| `movement` | armies advance along persistent objectives (initiative order; hostile tiles register engagements; non-hostile armies cannot stack) |
| `conflict` | engagements resolve (see `COMBAT.md`), retreats, occupation, captures |
| `production` | per-civilization economy applied; shortage bookkeeping; federation stipends; Resonance accumulates; armies heal; cities recover integrity |
| `construction` | projects tick/complete; research spends Memory and completes |
| `population` | growth, hunger, Coherence breakdown applied, reconciliations finish, crises, autonomy at 0; treaties expire |
| `quieting` | forecast milestones, escalations (22/26/30), regional crises; resonance history; ambition auto-commit on turn 20 if you never chose |

Turn 30's resolution runs the final Quieting and then evaluates every ambition (`buildEnding`).
A command that becomes invalid at resolution produces an explicit log line ("could not proceed … Nothing was spent.") and spends nothing: costs are charged at application time, never at staging, so cancelling before commit is a pure no-op and reservations only gate what you may stage.

## 2. Orders and costs
| Category | Commands | Initial cost |
|---|---|---|
| Develop | start/replace a district or work | district cost (8–10 ◆), 2–4 turns; replacing a district +4 ◆; starting a different project refunds **half** the reserved Matter |
| Expand | survey (free; reveals 2 (+bonus) tiles around an observed tile, never across water) · claim 2 ◆ (adjacent to border) · outpost 6 ◆ 2 ⚡ (sight, supply, 1 ⚡/turn) · found city 12 ◆ 6 ❀ 4 ⚡ (+2 pop from a connected city that keeps ≥ 2; ≥ 3 hexes from any city; ≤ 5 cities; target must be explored) · investigate anomaly 3 ⚡ |
| Mobilize | recruit regiment 6 ◆ 4 ⚡ (1 turn prep) · set/change army objective (guard/travel/raid/besiege + approach + retreat threshold) |
| Negotiate | treaty proposal · influence an independent settlement (4 ❀) · demand (tribute/war/peace) · cancel early |
| Reform | interpret a discovery into an institution slot · research program · reconcile a city · restore (Release the Voices) · change ambition |

Free (no order): council choice, ambition commit (turns 16–21), salvage, answer a citizens' request, accept/decline a proposal, research allocation, shortage policy, emergency measures.
One Negotiate every N turns is free with *Listener* (6) or *Mirrored Intermediaries* (5). Reservations: `available = stock − Σ staged costs`.

## 3. Economy
Resources: Sustenance ❀, Matter ◆, Energy ⚡, Memory ◈ (usable informational material; **named fragments are separate and never spent**).
Capital 5/3/3/2, colony 3/2/2/1, plus claimed-tile yields (garden ❀1, desert ◆1, coast ⚡1, ridge ◆1, lake ◈1, infrastructure ⚡1 ◈1) assigned to the nearest city, plus districts and modifiers.
Upkeep: population 1 ❀ each, 1 ⚡ per city maintenance, +2 ⚡ per non-capital city (integration), +1 ⚡ per city from the 4th, 1 ⚡ per regiment and per outpost, 1 ❀/turn per federated city.
`computeEconomy()` returns every line item; the HUD shows next-turn net per resource and a tooltip lists the causes. Tests assert items sum to net.
Shortage: the deficit is shown beforehand and allocated by a visible policy (*share evenly* by population / *protect capital*). Affected cities lose 6 Coherence (a Reservoir absorbs that); two consecutive turns lose 1 population. Energy shortage pauses powered districts in the order Bulwark → Archive → Foundry (never life support). *Emergency rationing* (−25% ❀ upkeep, −3 Coherence/city/turn) and *shutdown* (pause all powered districts) are explicit toggles.
Growth: +1 population when housing is free, city ❀ surplus ≥ 2 (≥ 1 with Body Restoration), Coherence ≥ 50, not shorted, and ≥ 3 turns since the last growth (2 with *Feed the Bodies*).

## 4. Cities, districts, works
Slots: capital 4, others 3. Districts: Garden, Foundry (+Resonance), Reservoir, Archive, Conduit (needs a held infrastructure tile), Sanctuary, Exchange, Bulwark. A district keeps working while its replacement is built.
Works (do not use slots): Stabilization (12 ◆ 8 ⚡, 3 turns, −10 Resonance once, protects its city and one nearby connected city against one exposure band; max one per city), Continuity Vessel, Distributed Anchor Node, Archive Seal.
Project duration modifiers: Garden Custodians +1 on Foundries, Architect −1 on 3+ turn projects, local Foundry −1, *Become the Choir* −1 on network projects when connected; minimum 1.

## 5. Coherence (0–100)
≥ 50 normal · 30–49 nonessential output −15% · 1–29 −30% and a recoverable local **crisis** after 2 turns (output halved until ≥ 40) · 0 → the city becomes an autonomous settlement with its people and buildings intact.
Per-turn deltas (all listed in the city panel): natural recovery +2 below 60, Sanctuary +3 (cap 80; Civic Architecture 85), institutions, network bonus, broken-link penalties, shortage, rationing, Quieting erosion. One-offs: conquest −15, integration −10 on founding, broken promise −8 (×2 for Listener), incompatible reform −6, institution replacement −4, reconciliation +12 over two turns (3 ◆ 1 ⚡, one order).
Political requests (restored communities, woken sleepers, welcomed strangers) are rare, attached to specific events, and answered for free or 1 ◈.

## 6. Discoveries, institutions, combinations
Eight site kinds: Choir Engine, Sleeping Orchard, Mirror Well, Monolith of Memory, Weather Loom (×2), Glass Cradle (×2), Anomaly (×3), Meridian Spire (landmark; no interpretation), plus a legacy Named Ruin. Each interpretable site offers **three** interpretations → 18 institutions + a baseline Voluntary Network. Every interpretation lists gain, risk, tags, conflicts and combinations. *Salvage* (free: +3 ◈ +4 ◆ and the fragment) is always available; leaving a site open defers it. Rivals compete for the same sites.
Interpreting costs one Reform order plus the institution's cost. Replacement: −4 Coherence everywhere, recorded in the Chronicle even after the institution is gone. Combos are derived from currently installed institution + known tech (no stored references):

| Combo | Needs | Practical effect |
|---|---|---|
| Verified Treaties | Consult the Ancestors + Testimony | no partner can declare war through your non-aggression pact; you cannot cancel theirs early either |
| Population Continuity | Release the Voices + Body Restoration | Restore every 3 turns instead of 5; arrivals cost 4 Coherence instead of 8 |
| Network Recovery | Become the Choir + Collective Coordination | severed conduits/links heal instantly; the 10-Coherence broken-link penalty never applies |
| Sealed Record | Preserve Testimony + Archive Sealing | the Monolith counts as a sealed Archive for The Unbroken Record |

## 7. Council
Sessions on turns 3, 6 … 27. Offers are drawn from 27 opportunities with seeded weights (terrain held, districts, contact, Coherence, tech, resonance; previous picks reduce weight; categories you invest in gain weight; **no id repeats in consecutive sessions**), 3 per session, persisted in the state. At least one must be affordable, otherwise a free "Quiet Audience" is substituted. One **petition per age** replaces the last offer with a fresh draw (stored, so reloading cannot reroll). Passing is allowed. Merchant Charter's leverage makes later council costs +25%.

## 8. Technology
18 technologies, six per age, requirement 8 / 12 / 18 Memory (Consult the Ancestors −15%, rounded up). One active program; starting/redirecting costs a Reform order; each turn `alloc` (1/2/4, free to change) Memory is **spent from the stockpile**; progress on abandoned targets is kept; research treaties add +1 free progress per partner (shown separately). Completion charges nothing extra.

## 9. Diplomacy
Treaties: trade, non-aggression, research exchange, passage, preservation (needs Testimony; swaps named fragments and +1 ◈/turn), shutdown (needs Cycle Interruption; the proposer pays 2 ⚡/turn, partner's Foundries pause and add no Resonance). Durations 6–10 turns; cancelling early = broken promise (reputation −10, Coherence −8, relations −20 with the partner, −3 with others).
`relation()` returns every reason as a line item (philosophy, their institutions vs. your values, past dealings, active agreements, border friction, war, reputation, envoy distrust). The *same* `evaluateTreaty()` decides for rivals and previews for you ("likely/unlikely, score x vs needed y").
Independent settlements: **influence** (3 orders, 4 ❀ each) → federation notice → joins 2 turns later; it then costs 1 ❀/turn. Unmet stipend for 2 turns and it leaves. A federated city counts toward Embodied Continuity only while its obligation is met. Conquest is the alternative.

## 10. The Quieting and Resonance
Seven regions (centre + six sectors) have hidden exposure 0/1/2 (never 2 in the player's own start region). Forecast level 1 on turn 12 (exposed/safe), level 2 on turn 18 (exact bands, severity). Warnings two turns before escalations.
Severity = 1 + [total Resonance ≥ 30] + [≥ 60] (bounded). Effective exposure = region exposure − protection bands (Stabilization 1, 2 with Regional Stabilization; Vessel 1; neighbour's Stabilization 1; Cradle seal; Anchor Continuity).
* Escalation 1 (turn 22): powered districts in exposed cities ×max(0.25, 1 − 0.25·severity (×1.3 if highly exposed)).
* Escalation 2 (26): exposed cities lose 6·severity Coherence; conduits are severed (3 turns, 1 with Conduit Repair, instant with Network Recovery); further erosion each turn.
* Escalation 3 (30): exposed cities lose population (severity, +1 if highly exposed), 8·severity Coherence, and unsealed Archives.
Regional crises (from turn 16, ≥ 3-turn cooldown per region): severed conduit, resurfacing memories (−6 Coherence), failing route (outpost dark 2 turns). Resonance sources: Foundries +1/operating turn (0 for Garden Custodians), some institutions +1/+2 per turn, council deals; sinks: Gardens (−1/turn), Stabilization (−10), Foundry Pledge, shutdown accords.

## 11. Ambitions (`src/sim/ambitions.js`)
| Ambition | Requirements (all) |
|---|---|
| Embodied Continuity | ≥3 inhabited settlements (cities or *fulfilled* federations) · ≥2 protected from the final Quieting · 2 vessels/shelters · ≥10 population · mean Coherence ≥50 (after final resolution) |
| Shared Continuity | Distributed Embodiment · 3 connected participating (consenting, connected to the capital) settlements with a network institution (Voluntary Network baseline or the Choir) · ≥2 functioning anchor nodes · network Coherence ≥60 |
| The Unbroken Record | 2 sealed Archives · 5 distinct named fragments from ≥3 categories · Archive Sealing · a functioning protected record |
| Break the Recurrence | Resonance Analysis + Cycle Interruption · 3 anomaly sites investigated (guaranteed by map generation; needs adjacent claimed tile/outpost/army, never conquest) · 2 Stabilization projects · total Resonance < 40 for the final 3 turns · control or passage access to the Meridian Spire |
Commit between turns 16–21 (auto-commit to the nearest path on turn 20 if you do not); one change through turn 23 for 4 ◆ 4 ◈ + an order. Rivals (Conservatory → Record, Signal → Shared, Veil → Embodied) are evaluated by the same functions. A rival's success changes the epilogue but never defeats you; no exclusive condition exists in this build.

## 12. Persistence & legacy
`src/sim/save.js`; see README. Legacies (one active): *Named Ruin* (a ruin site near the start gives a fragment; −1 ◈/turn until found), *Institution Echo* (first interpretation −30%, a 4-Coherence scar), *Restored Character* (+4 ◈ at start, +1 ◈/turn for 10 turns; −10 relations with one rival). Effects are bounded and do not stack across runs.

## 12b. Achievements and unlocks
Checked once when a run ends (`evaluateAchievements`), stored in the profile: *Something Remains* (achieve any ambition), *Every Promise Kept* (≥ 3 agreements kept, none broken, reach turn 30), *Hands Unraised* (succeed without declaring war or conquering), *Out of the Ashes* (lose a settlement and still succeed). Two are wired to **sidegrade** founding options: **Salt Cartographers** (Survey range +1, Outposts −3 Matter; −2 Sustenance/turn) and the **Mourner** disposition (reconciliation +4 Coherence; −1 Memory/turn). Rivals never depend on unlockables and no unlock is required for any route. Debug mode (`?debug=1`) shows everything unlocked.

## 13. Modifier vocabulary
Institutions, traditions, dispositions, technologies, combos and boons all carry `fx` objects summed by `economy.fx()`: `prodSus/Mat/Ene/Mem, outpostDisc, reconcileBonus, techDisc, cohAll, cohConnected, gardenSus, archiveMem, conduitEne, foundryRes/Time/Mat, projTimeLong, workDisc, stabDiscMat/Ene, stabBands, upkeepEne, surveyRange, salvageMult, treatyAccept, brokenPromise, freeNeg, regCost, housingEach, growthInterval, growthSurplus, restoreFast, netSpeed, netRepairInstant, resonanceFlat, protectCapital, councilCostMult, verifiedTreaties, monolithSealed, …`. Adding a modifier means adding a key to data and one reader in the simulation; the UI reads `gain/risk` text from the same data.

## 14. The action layer (v2) — `src/sim/{hero,run,threats,advisor,bot}.js`, `src/data/action.js`
- **The Witness (hero)**: walks the map with `heroMove` (free of orders, movement points = Stride). Stats Mettle/Guard/Stride/Wit/Sight and Resolve (hp). Checks: `chance = clamp(0.5 + 0.12*(stat - difficulty), .1, .95)` rounded to 5%, always shown before choosing.
- **Pending decisions** (`S.pending`): timed beats, expedition rooms, boons, crossroads, boss stages. While one is open, `endTurn` returns `{blocked:true}`. Headless/bot play uses `autoResolve`, which always takes the cautious option.
- **Beats**: ~55% chance per turn from turn 2; countdown is UI-only and optional (Settings). Running out of time = the cautious fallback.
- **Expeditions**: stand next to a ruin or wonder, Enter. 3–4 layers of 2 doors → rooms (trap, cache, echo, guardian…) → the heart: interpret a wonder (institution) or take a ruin's relic, boon or hoard. Resolve 0 = expelled, Frayed 2 turns, site cooldown 3 turns.
- **Threats**: raiders and echoes spawn at distance 6–10, walk to a city, and resolve in the production phase: defence = 2 + bulwark 3 + army/3 + modifiers (+2 with the Witness in the city) vs power: holds / hurts / breaches. Engage them with the Witness to end them early.
- **Boons, relics, sets**: boons come from crossroads (turns 11, 21), shrines, ruins; relics have a catch; matching boon tags give set bonuses at 2 and 3.
- **Seasons**: Calm Tide, Long Dusk, Hungry Winter, Ember Year, Gilded Drift… chosen by seed or in setup; modify threat rate, boon picks, relic rate and the first Quieting escalations.
- **Crossroads** at turns 11 and 21 set the next age's threat level (Quiet Road, Front, Unmarked Road, Warden boss).
- **Heirloom legacy**: a relic carried into the next run, with its catch.
- **UI**: painted continuous terrain (the hex grid is only rules), scrolling/zooming camera following the walking hero, soft fog, radial action menu on the selected tile, Next-Moves advisor, progressive reveal of Energy/Memory/Empire/Diplomacy/Quieting/Ambition tabs (Settings → show everything).
