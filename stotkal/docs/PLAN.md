# Implementation plan, engine choice, dependency map

## Engine choice
**Vanilla JavaScript (ES modules) + Canvas 2D + plain DOM panels. No bundler, no runtime dependencies.**

Why: the game is a compact turn-based strategy. The authoritative simulation must run headlessly and
deterministically (Node 22 runs the same modules the browser does, so tests exercise the shipped code).
Persistence is `localStorage` JSON. Canvas 2D is enough for an elevated three-quarter hex map with
material gradients, reflections and restrained motion. Nothing needs installing; `npm start` serves static files.
Trade-off: no PBR/hyperreal materials. Those are approximated with gradients, specular strips, mirrored
reflections and light, and an asset upgrade path is documented in `docs/DECISIONS.md`.

## Layers (strict one-way dependencies)
```
data/content.js  (editable structured data, stable ids, all numbers)  <- data/validate.js
      ^
sim/*  (pure, deterministic, headless; state is plain JSON)
      rng, hex -> mapgen -> state -> economy -> commands -> (combat, diplomacy, quieting, ambitions, council)
      -> resolve (explicit ordered phases) ;  rival (planner, uses the same commands API) ;  chronicle
      ^
persistence/save.js (versioned save, profile/legacy in localStorage, migrations)
      ^
ui/*  (render state, stage valid commands through sim API; never computes authoritative outcomes)
```

## Core system dependency map
```
Terrain/Map ──> Claims/Borders ──> Supply & Connectivity ──> Army power / Network bonuses / Quieting protection
Terrain ──> City yields ──> Economy (4 resources) ──> Orders (reservations) ──> Projects / Research / Recruit
Discoveries ──> Interpretations ──> Institutions (3 slots) ──> mods + combos ──> Strategy
Techs ──> unlocks (projects, actions, treaties) ──> Ambitions
Foundry/Operations ──> Resonance ──> Quieting severity (bounded) ──> Regional exposure ──> Protection projects
Treaties/Relations ──> Rival planner utility ──> orders (same API as player)
Ambition progress + Quieting final test ──> Ending ──> Chronicle ──> Legacy ──> next run founding complication
```

## Turn pipeline (explicit in `sim/resolve.js`)
1 report previous resolution -> 2 council session if due -> 3 free inspection -> 4 stage <=3 orders + council decision
-> 5 commitment summary/revise -> 6 rivals commit orders (same validators) -> 7 resolve phases:
`political` -> `exploration` -> `movement` -> `conflict` -> `production` -> `construction` -> `population` -> `quieting`.

## Milestones realised in this build
Milestone 2 vertical slice plus much of milestone 3 (see `docs/VERIFICATION.md` for the honest status list).
