# Combat specification (implemented in `src/sim/combat.js`; forecast and resolution share the same functions)

No separate battle screen. Fights resolve on the strategic map during the **conflict** phase.

## Units
Army: up to 3 regiments; each side may field ≤ 3 armies. Regiment: role, strength 0–10, upkeep 1 Energy/turn, 1 turn of preparation after recruitment (`ready`).
Recruit cost 6 Matter + 4 Energy (Mirror-Well *Doubles*: −25%).

| Role | Terrain / situation modifiers |
|---|---|
| Warden | ×1.10 when defending anywhere; ×1.20 more on ridge/infrastructure when defending |
| Lancer | ×1.25 attacking over desert, garden or coast; ×0.75 on glass ridge |
| Disruptor | ×1.50 against a settlement (city tile); on capture it damages one Archive |

Ridge adds ×1.20 to any defender. Defender approach is **Guard** (×1.15) by default.

## Power
```
regimentPower = strength × roleModifier(terrain, attack|defend)
armyPower     = Σ regimentPower × supplyMult × approachMult      supplyMult = 1 in supply, 0.8 beyond 3 traversable tiles of supply
sidePower     = Σ armyPower                                      (+ city garrison for the defender, × fortification)
fortification = 1.25 (settlement) + 0.25 Bulwark + 0.10 Fortification tech        (independent garrison: 12 strength pool, +2/turn)
```
Approach multipliers (attacker power / incoming-loss multiplier): **Assault** 1.25 / 1.25 · **Siege** 1.0 / 0.5 · **Raid** 0.5 / 0.5 · **Withdraw** 0 / 0.5.

## Damage (simultaneous)
```
lossAttacker = round( defenderPower × 0.30 × approach.takenMultiplier )   capped at attacker strength
lossDefender = round( attackerPower × 0.30 )                              capped at defender strength; 0 for Withdraw
```
Losses are spread proportionally over regiments (remainder to the strongest, ties by id): fully deterministic.

## Settlements
Integrity 10 (+4 Bulwark, +2 Fortification), recovering +2/turn when not attacked.
* Assault: integrity −⌊attackerPower / 8⌋ immediately.
* Siege: the first turn **entrenches** (no damage dealt to the defender, no integrity damage, attacker loss ×0.25 overall); afterwards defender losses are full, attacker losses ×0.5 and integrity −⌊attackerPower / 5⌋. Outside supply an army loses 20% power as for any approach.
* Raid: never captures. Steals up to **3** Matter and **3** Energy; **4-turn cooldown per target city** (capped, no infinite farming).
* **Capture** requires integrity 0 and no surviving defenders on the tile (Assault or Siege). The city keeps its infrastructure, imposes −15 Coherence, loses consent (needs reconciliation), clears its project, and the previous owner's capital passes to the most populous remaining city (or the civilization is eliminated).

## Movement, supply, retreat
Movement is 2 points per turn (ridge costs 2; water impassable; foreign territory closed unless at war or a passage treaty).
Disputed tiles resolve in a stable, seeded initiative order (a tie-breaker only; tested to be unbiased between factions).
Supply: tiles within 3 traversable tiles of a friendly city, outpost (+1 with Fortification), Bulwark city (+1) or a passage-treaty partner's city; Network Logistics +1.
Unsupplied armies lose 20% power and cannot heal (+2 per regiment per turn when supplied and not engaged).
Retreat: below the standing threshold (default 40% of starting strength) an army falls back up to 2 tiles toward home; defenders inside a settlement do not retreat (the city falls only through integrity). Occupation: a victorious attacker enters an emptied tile.

## Forecast honesty
`forecast()` returns power, expected losses (both sides), integrity damage, terrain/fortification/supply notes and **conditional** flags: if a hostile army was last seen within 3 tiles but is not currently observed, or the target tile is unobserved, the forecast is labelled *conditional* and says what it assumes. There is no randomness in this build.
Tested representative encounters: `tests/systems.test.js` (forecast == resolution, role/terrain numbers, supply, siege entrenchment, raid cooldown/cap, capture).
