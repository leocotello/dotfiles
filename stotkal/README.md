# STOTKAL: WHAT REMAINS

A single-player, turn-based civilization roguelite (working title). Thirty turns, three ages, three rival
civilizations, three to five cities. You are the Witness. The world cannot keep everything; when it cannot
carry everything forward, **who decides what it remembers?**

> **Canon note.** *Stotkal* is the creator's artistic identity and established aesthetic. The world (the Palimpsest),
> the factions, the Quieting and every system in this repository are **new game fiction inspired by that aesthetic**,
> not material from that body of work. Do not read them as depictions of it. See `docs/NARRATIVE_BIBLE.md`.

## Run it

Requires Node 18+ only for the tiny static server and tests; the game itself is plain browser JavaScript
(ES modules, Canvas 2D, no dependencies, no build step).

```
cd stotkal
npm start            # serves http://localhost:8765/   (node tools/serve.js [port])
npm test             # 47 tests: node --test tests/*.test.js
npm run simulate     # complete-game simulations:  node tools/simulate.js [nSeeds] [embodied|shared|record|break|idle|all]
npm run screenshots  # drives the real UI in headless Chromium and regenerates screenshots/ (needs the server running + Playwright)
```

Any static server works (`python3 -m http.server`), but ES modules need `http://`, not `file://`.
Developer tools are separate from normal play: add `?debug=1`, or press `Ctrl+Shift+D`, then Menu → Debug
(seed, fast-forward with bot orders, +20 resources, reveal map, rival motive log, ambition inspection).
`?seed=NAME&auto=1` starts a run straight away (used by the screenshot tool).

## How to play (30-second version)

* Three **orders** a turn: *Develop, Expand, Mobilize, Negotiate, Reform*. Ongoing work (projects, research, army
  objectives) needs no further orders. Stage, read, revise and undo for free; nothing is spent until you commit.
* Pick a **founding tradition** and **Witness disposition**, then explore. Discoveries become **institutions** (3 slots)
  through one of three interpretations each. Costs, gains, risks and combinations are shown before you commit.
* Council sessions on turns 3, 6 … 27. The **Quieting** forecast arrives on turn 12, exact regions and severity by 18,
  escalations on 22, 26, 30. Prepare: Stabilization Works, vessels, Archive Seals, lower Resonance, treaties.
* Commit to one of four **ambitions** between turns 16 and 21 (preview all of them from turn 1).
* At the end you read a **Chronicle**, choose one **legacy**, and begin another cycle.

Hotkeys: `Enter` end turn · `Esc` cancel/close · arrows move the map cursor (Shift+↑/↓ for the other diagonal) ·
`S` survey, `X` claim, `O` outpost, `F` found city · `U` undo last order · `E D Q A L G` Empire, Diplomacy, Quieting,
Ambition, Log, Guide · `C` council · `Home` recentre.

## Save behaviour

* The whole run state (map seed, RNG state, turn, **staged orders**, all civilizations, council offers, flags, legacy)
  is plain JSON in `localStorage` slot `stotkal.save.auto`. It is written after every resolved turn **and** (debounced)
  whenever you stage or unstage something, so you can quit and resume at the commitment stage.
* Loading never rerolls anything: council offers and the RNG state are inside the save.
* Saves carry a schema version (`SAVE_VERSION`). Corrupt, foreign or newer saves produce a readable message and are
  not overwritten. References to content that has since changed are dropped with a notice instead of crashing.
* Menu → *Export save file* / *Import save*. Chronicle history and the active legacy live separately in
  `stotkal.profile`; a **Fresh chronicle** toggle ignores the inherited legacy without deleting history.
  Settings are in `stotkal.settings`.

## Repository map

```
index.html, style.css          entry point and the UI skin
src/data/content.js            ALL content and balance numbers (editable, stable ids)       src/data/validate.js startup validation
src/sim/                       headless deterministic simulation (no DOM): rng, hex, mapgen, state, economy, commands,
                               apply, resolve (explicit phases), combat, army, diplomacy, council, quieting, ambitions,
                               rival (utility planner), chronicle, save
src/ui/                        main (input/flow), panels (DOM builders), render (canvas), audio (synthesised), dom
tests/                         core, systems, design, simulation
tools/                         serve, simulate, screenshots, profile
docs/                          PLAN, SYSTEMS, COMBAT, DECISIONS, VERIFICATION, NARRATIVE_BIBLE
screenshots/                   representative screenshots from the real UI
```

## Status

Milestone-two vertical slice complete and much of milestone three; see `docs/VERIFICATION.md` for exactly what was
tested, what was only simulated, and what is **not** validated (human playtime, art quality, long-term balance).
