# Decision log (material choices and departures from the specification)

Numbers are balancing hypotheses in `src/data/content.js`. "Spec" = the design brief.

## Engine and architecture
1. **Vanilla JS + Canvas 2D, no build, no dependencies.** The game is a compact strategy game; the simulation must run headlessly and deterministically (Node runs the shipped modules). Consequence: no PBR/hyperreal materials. Approximated with gradients, specular strips, mirrored reflections, rose horizon light, chrome gradients and wirelines. **Upgrade path:** `Renderer` only reads state; swap in sprite atlases or WebGL (Three.js) per tile/city without touching the simulation. City silhouettes are keyed by owner and by each institution's `visual` tag.
2. **State is plain JSON** (RunState) so save = serialisation; RNG state is stored inside it; council offers are stored; initiative and AI jitter use *stateless* seeded hashes so they do not depend on draw counts.
3. **Costs are charged at resolution, not at staging.** Staging only *reserves* (`available = stock − Σ staged costs`). Consequence: undo is a pure no-op, a command that becomes invalid refunds nothing because nothing was spent, and there is a single rule for "refund unspent costs".
4. **Rivals use `stage()`/`validate()`/`applyCmd()` exactly like the player**, and the same `computeEconomy`, fog (`seen`/`obs`/`lastKnown`), research, treaties and combat. Council choices go through the same command with the offer snapshot attached. A unit test asserts that rival decisions all log a motive and none error.

## Rules interpreted or changed
5. **Found City needs an explored (not currently observed) tile.** Sight radius 2 can never observe a tile ≥ 3 hexes from your own city, so requiring observation made expansion impossible. Found by simulation (the bot never settled). A connectivity rule remains: the site must touch territory connected to the source city, which creates the claim→found puzzle; claim targets that bring a future site in reach are marked ⌂+ on the map.
6. **Map generation rejects crowded starts**: every capital needs legal city sites within 3–5 hexes (≥ 2 for the player); otherwise the whole seed attempt is rejected (mean ~17 attempts, tens of ms).
7. **Free decisions** (no order): council choice, ambition commit, salvage, answering a citizens' request, accepting/declining proposals, research allocation, shortage policy and emergency toggles. Everything else uses one of the three orders.
8. **Survey** targets any currently observed tile (not only "frontier" tiles) and reveals ≥ 2 hexes around it without crossing water. Survey marks tiles *explored*; only cities, outposts and armies *observe*.
9. **Tile yields** go to the nearest owned city within 2 hexes; a new city claims the free tiles around it automatically.
10. **Regiments** need one turn of preparation; an army with unprepared members does not move that turn.
11. **Combat** has no randomness (the spec allows it later with visible bounds). Constants and formulas are in `COMBAT.md`; forecast and resolution call the same functions.
12. **Quieting**: seven regions with hidden exposure 0/1/2; the player's own start region is never 2 so that the first run is learnable. Effects scale with bounded severity (1–3). Protection is in "bands" so partial protection is meaningful; Regional Stabilization adds a band.
13. **Resonance dampening:** each Garden district removes 1 Resonance per turn (visible cap: 1/turn per civilisation). Thresholds 30/60 and the interruption threshold 40 are the spec values; they were not retuned for four civilisations (simulation: mean total Resonance 6–22 at the end, so the thresholds are rarely crossed by active play; see VERIFICATION).
14. **Federation obligations:** a federated city costs 1 Sustenance per turn. If unmet for two turns it leaves; unmet it does not count for Embodied Continuity.
15. **Ambition auto-commit** on turn 20 to the nearest path if you never chose, so inaction cannot lock you out of an ending (visible in the log; one change is still allowed).
16. **Shared Continuity participation:** cities consent by default; conquered, restored-from-capture or federated-by-force cities start non-consenting until reconciled or time passes. This is a deliberately small model of the spec's "consent-related obligations".
17. **Rival aggression:** rivals declare war when (a) they are much stronger and relations are poor, (b) they are *overwhelmingly* stronger (power ≥ 3×) and have a real army, or (c) they are very strong and a non-aggression pact is worth breaking (breaking costs reputation and Coherence, is logged with the motive, and can be prevented by the Verified Treaties combo). Without (b) the simulation showed rivals never attacked a neglectful player.
18. **Independent settlements** can be influenced into a federation (3 influence orders, 2 turns' notice) or conquered. Trade with independents is not implemented (see below).
19. **Legacy** strengths are small and bounded (one active; +4 Memory for ten turns, a ruin that costs 1 Memory/turn until found, a 30% discount with a 4-Coherence scar).

## Removed or not implemented (honest list)
* Rivers (conduits and infrastructure tiles carry the "economic connection" role).
* Maritime ferry crossings (Maritime Passage gives coast Energy only; the blurb was corrected after an audit found the claim unsupported).
* Trade with independent settlements; the visible spacing exception for founding; the Common Signal's bespoke "network access for citizens" offer; special-institution reconciliation alternatives (only basic reconciliation, Sanctuaries and honoured requests exist).
* Unlocks are minimal: four achievements and two sidegrade founding options (Salt Cartographers, Mourner). Additional opportunity chains, alternate rivals and world conditions are planned expansion.
* Council opportunity chains (offers are single-step; categories you pick influence later offers).
* Licensed or recorded audio: all audio is synthesised at runtime.

## Audits that changed the build (found by tests/simulation, fixed)
* The staged command's `id` overwrote the ambition id: ambitions were never committed. (Found by simulation: every bot "committed" to nothing.)
* City names used a module-level counter: determinism broke across games (replay test).
* A module-level supply cache could leak between states; moved onto the state, never serialised.
* Rival council picks silently failed validation; they now apply (270 applied picks over 10 simulated runs).
* Ten modifier keys in the data were never read by the simulation (some only by name in the UI), and several in-game promises (ferry, "rivals desire to claim", Circuit double-count) were not implemented. A test now fails on any dead modifier key, and the text was corrected.
* Target highlighting in the renderer read a field the UI never set; fixed after the first screenshot review.
