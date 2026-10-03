// Action layer content: the hero, timed beats, ruin expeditions, boons, relics, seasons (world modifiers) and crossroads.
// Outcome lists reuse the council op vocabulary (res, cohAll, popRoom, mod, fragment, rel, resonance, claim, ...) plus hero ops:
//   {op:'hp',n} {op:'relic',n} {op:'boon',n} {op:'frayed',n} {op:'loot',tier} {op:'threatKill'} {op:'wit',n}
export const HERO = { hp: 10, atk: 3, def: 1, moves: 4, sight: 3, wit: 2, frayedTurns: 2, healTurn: 1, healHome: 2, relicSlots: 4, expulsionHp: 2 };
export const CHECK = { base: 0.5, perPoint: 0.12, min: 0.1, max: 0.95 }; // chance = base + perPoint * (stat - difficulty)
export const STAT_NAME = { atk: 'Mettle', def: 'Guard', moves: 'Stride', wit: 'Wit' };

// ---------------- Timed beats (the event phase) ----------------
// cond: minTurn, maxTurn, cities (needs a city), contact (met a rival), threatActive. fallback: choice taken if the timer runs out.
export const BEATS = {
  raiders_wall: { kind: 'threat', weight: 3, cond: { minTurn: 3 }, title: 'Raiders at the Wall', text: 'Figures in salt-white cloaks gather below the garden wall. They want grain, and they are not asking twice.',
    choices: [
      { id: 'stand', label: 'Hold the wall', check: { stat: 'atk', diff: 4 }, win: [{ op: 'loot', tier: 1 }], lose: [{ op: 'hp', n: -3 }, { op: 'cohAll', n: -4 }], hint: 'Mettle vs 4' },
      { id: 'parley', label: 'Parley', check: { stat: 'wit', diff: 4 }, win: [{ op: 'res', mat: 2 }, { op: 'rel', all: 3 }], lose: [{ op: 'res', sus: -3 }], hint: 'Wit vs 4' },
      { id: 'pay', label: 'Pay them off (3 ❀)', cost: { sus: 3 }, win: [], hint: 'Certain' },
    ], fallback: 'pay' },
  quiet_squall: { kind: 'weather', weight: 2, cond: { minTurn: 4 }, title: 'A Squall of Quiet', text: 'The air loses its edges. Voices in the market arrive a second late. The conduits hum out of key.',
    choices: [
      { id: 'brace', label: 'Brace the district', check: { stat: 'def', diff: 3 }, win: [{ op: 'res', mem: 2 }], lose: [{ op: 'res', ene: -4 }], hint: 'Guard vs 3' },
      { id: 'ride', label: 'Ride it out in the open', check: { stat: 'moves', diff: 4 }, win: [{ op: 'fragment', cat: 'weather', name: 'A Sentence Heard Twice' }], lose: [{ op: 'hp', n: -2 }], hint: 'Stride vs 4' },
      { id: 'wait', label: 'Wait', win: [{ op: 'res', ene: -2 }], hint: 'Lose 2 ⚡' },
    ], fallback: 'wait' },
  refugees_plea: { kind: 'plea', weight: 2, cond: { minTurn: 3, cities: true }, title: 'A Plea at the Gate', text: 'Thirty people with one cart ask only to be counted. You can feel the numbers shifting behind you.',
    choices: [
      { id: 'welcome', label: 'Welcome them (3 ❀)', cost: { sus: 3 }, win: [{ op: 'popRoom', n: 1, integ: 4 }, { op: 'res', mem: 1 }], hint: '+1 population' },
      { id: 'sort', label: 'Sort the skilled from the weary', check: { stat: 'wit', diff: 4 }, win: [{ op: 'popRoom', n: 1, integ: 2 }, { op: 'fragment', cat: 'foreign', name: 'The Cart-Song' }], lose: [{ op: 'cohAll', n: -3 }], hint: 'Wit vs 4' },
      { id: 'refuse', label: 'Turn them away', win: [{ op: 'cohAll', n: -2 }], hint: '−2 Coherence' },
    ], fallback: 'refuse' },
  wandering_trader: { kind: 'trade', weight: 2, cond: { minTurn: 4 }, title: 'The Trader Who Has Been Here Before', text: 'A chrome-armed trader unrolls a cloth of small, strange things. "Everything here is yours, once," she says.',
    choices: [
      { id: 'buy', label: 'Buy a curio (5 ◆)', cost: { mat: 5 }, win: [{ op: 'relic', n: 1 }], hint: 'A relic, with a catch' },
      { id: 'haggle', label: 'Haggle', check: { stat: 'wit', diff: 5 }, win: [{ op: 'relic', n: 1 }], lose: [{ op: 'res', mat: -3 }], hint: 'Wit vs 5' },
      { id: 'decline', label: 'Walk on', win: [{ op: 'res', mem: 1 }], hint: '+1 ◈ for the story' },
    ], fallback: 'decline' },
  echo_of_you: { kind: 'omen', weight: 2, cond: { minTurn: 5 }, title: 'A Figure Who Walks Like You', text: 'At the edge of the garden stands someone with your gait and your tiredness. They are looking at the same spot you are.',
    choices: [
      { id: 'speak', label: 'Speak first', check: { stat: 'wit', diff: 4 }, win: [{ op: 'fragment', cat: 'witness', name: 'What the Other One Remembered' }, { op: 'wit', n: 1 }], lose: [{ op: 'hp', n: -2 }], hint: 'Wit vs 4' },
      { id: 'strike', label: 'Strike', check: { stat: 'atk', diff: 4 }, win: [{ op: 'loot', tier: 2 }], lose: [{ op: 'hp', n: -3 }], hint: 'Mettle vs 4' },
      { id: 'look_away', label: 'Look away', win: [], hint: 'Nothing happens' },
    ], fallback: 'look_away' },
  glass_rain: { kind: 'weather', weight: 2, cond: { minTurn: 4 }, title: 'Glass Rain', text: 'The sky sheds needles of clear glass that chime where they land. By morning the ridge will be sharp and the streets will be rich.',
    choices: [
      { id: 'gather', label: 'Gather it quickly', check: { stat: 'moves', diff: 3 }, win: [{ op: 'res', mat: 5 }], lose: [{ op: 'hp', n: -2 }], hint: 'Stride vs 3' },
      { id: 'shelter', label: 'Shelter everyone', win: [{ op: 'cohAll', n: 2 }], hint: '+2 Coherence' },
    ], fallback: 'shelter' },
  envoy_gift: { kind: 'envoy', weight: 2, cond: { minTurn: 6, contact: true }, title: 'An Envoy with Open Hands', text: 'A neighbour sends a messenger with a gift wrapped in careful cloth and no demands. That is more unsettling than demands.',
    choices: [
      { id: 'accept', label: 'Accept graciously', win: [{ op: 'rel', all: 6 }, { op: 'res', mat: 3 }], hint: '+6 relations, +3 ◆' },
      { id: 'reciprocate', label: 'Answer with a gift (4 ◈)', cost: { mem: 4 }, win: [{ op: 'rel', all: 10 }, { op: 'mod', id: 'goodwill', turns: 99, fx: { treatyAccept: 6 } }], hint: '+10 relations, +6 treaty acceptance' },
      { id: 'refuse', label: 'Send it back', win: [{ op: 'rel', all: -3 }], hint: '−3 relations' },
    ], fallback: 'accept' },
  broken_conduit: { kind: 'event', weight: 2, cond: { minTurn: 5, cities: true }, title: 'A Conduit Screams', text: 'A buried line has started to carry something other than current. The glow under the sand has the wrong colour.',
    choices: [
      { id: 'repair', label: 'Repair it yourself', check: { stat: 'wit', diff: 3 }, win: [{ op: 'res', ene: 6 }], lose: [{ op: 'hp', n: -2 }, { op: 'res', ene: -2 }], hint: 'Wit vs 3' },
      { id: 'seal', label: 'Seal the section (3 ⚡)', cost: { ene: 3 }, win: [{ op: 'resonance', n: -2 }], hint: '−2 Resonance' },
      { id: 'leave', label: 'Leave it', win: [{ op: 'resonance', n: 2 }], hint: '+2 Resonance' },
    ], fallback: 'leave' },
  hungry_night: { kind: 'event', weight: 2, cond: { minTurn: 5, cities: true }, title: 'The Hungry Night', text: 'Someone has been taking from the stores. Nobody will say who. Everyone knows it was probably hunger.',
    choices: [
      { id: 'share', label: 'Open the stores (4 ❀)', cost: { sus: 4 }, win: [{ op: 'cohAll', n: 5 }], hint: '+5 Coherence' },
      { id: 'investigate', label: 'Find the one responsible', check: { stat: 'wit', diff: 4 }, win: [{ op: 'fragment', cat: 'testimony', name: 'A Confession at Midnight' }], lose: [{ op: 'cohAll', n: -4 }], hint: 'Wit vs 4' },
      { id: 'ration', label: 'Tighten the ration', win: [{ op: 'res', sus: 3 }, { op: 'cohAll', n: -3 }], hint: '+3 ❀, −3 Coherence' },
    ], fallback: 'ration' },
  dream_ledger: { kind: 'omen', weight: 1, cond: { minTurn: 8 }, title: 'The Ledger in the Dream', text: 'You wake with a page in your hand that was not there. The handwriting is yours; the grief is not.',
    choices: [
      { id: 'read', label: 'Read it all', check: { stat: 'wit', diff: 5 }, win: [{ op: 'fragment', cat: 'witness', name: 'The Page You Woke With' }, { op: 'boon', n: 1 }], lose: [{ op: 'hp', n: -3 }], hint: 'Wit vs 5' },
      { id: 'burn', label: 'Burn it', win: [{ op: 'hp', n: 2 }], hint: '+2 Resolve' },
    ], fallback: 'burn' },
  salt_caravan: { kind: 'trade', weight: 2, cond: { minTurn: 4 }, title: 'A Caravan in the Salt', text: 'A line of laden carriers crosses the flats at dusk, unguarded and overconfident.',
    choices: [
      { id: 'trade', label: 'Trade fairly (2 ⚡)', cost: { ene: 2 }, win: [{ op: 'res', mat: 5, sus: 2 }], hint: '+5 ◆, +2 ❀' },
      { id: 'raid', label: 'Take what you need', check: { stat: 'atk', diff: 3 }, win: [{ op: 'loot', tier: 2 }, { op: 'rel', all: -3 }], lose: [{ op: 'hp', n: -2 }], hint: 'Mettle vs 3; hurts reputation' },
      { id: 'pass', label: 'Let them pass', win: [{ op: 'rel', all: 2 }], hint: '+2 relations' },
    ], fallback: 'pass' },
  sleepers_stir: { kind: 'omen', weight: 1, cond: { minTurn: 7, cities: true }, title: 'The Sleepers Stir', text: 'In the quiet wing of the clinic a sleeper sits up, says a name, and lies down again. The name is on no list you hold.',
    choices: [
      { id: 'record', label: 'Record the name', win: [{ op: 'fragment', cat: 'cradle', name: 'A Name on No List' }, { op: 'res', mem: 1 }], hint: 'A named fragment' },
      { id: 'wake', label: 'Try to wake them (4 ❀)', cost: { sus: 4 }, win: [{ op: 'popRoom', n: 1, integ: 8 }], hint: '+1 population, heavy integration' },
    ], fallback: 'record' },
  collapsed_wall: { kind: 'event', weight: 2, cond: { minTurn: 6, cities: true }, title: 'A Wall Comes Down', text: 'A century-old wall gives up between one hour and the next. Underneath is a room that has been waiting patiently.',
    choices: [
      { id: 'enter', label: 'Go in first', check: { stat: 'def', diff: 3 }, win: [{ op: 'relic', n: 1 }], lose: [{ op: 'hp', n: -3 }], hint: 'Guard vs 3' },
      { id: 'survey', label: 'Send workers', win: [{ op: 'res', mat: 3, mem: 1 }], hint: '+3 ◆, +1 ◈' },
    ], fallback: 'survey' },
  warm_day: { kind: 'event', weight: 2, cond: { minTurn: 2 }, title: 'A Perfectly Ordinary Day', text: 'Nothing is wrong. The market is full, the lake is flat, and somebody is teaching a child to whistle. You are allowed to notice.',
    choices: [
      { id: 'rest', label: 'Rest in the garden', win: [{ op: 'hp', n: 4 }], hint: '+4 Resolve' },
      { id: 'walk', label: 'Walk the streets', win: [{ op: 'cohAll', n: 3 }], hint: '+3 Coherence' },
    ], fallback: 'rest' },
};

// ---------------- Expeditions: rooms ----------------
export const ROOM_KINDS = {
  trap: { icon: '⚠', name: 'Trap', blurb: 'Something old still works.' },
  cache: { icon: '◆', name: 'Cache', blurb: 'Goods, and perhaps a catch.' },
  echo: { icon: '◈', name: 'Echo', blurb: 'A memory that wants a listener.' },
  guardian: { icon: '⚔', name: 'Guardian', blurb: 'Something is still on duty.' },
  rest: { icon: '✚', name: 'Quiet Room', blurb: 'A place to breathe.' },
  shrine: { icon: '✦', name: 'Shrine', blurb: 'Pay in Resolve for a gift.' },
};
// weights per kind by depth (earlier layers are gentler)
export const ROOM_WEIGHTS = [{ trap: 3, cache: 3, echo: 2, rest: 2, guardian: 1, shrine: 1 }, { trap: 3, cache: 2, echo: 2, rest: 1, guardian: 3, shrine: 2 }, { trap: 3, cache: 2, echo: 2, rest: 1, guardian: 3, shrine: 2 }, { trap: 3, cache: 2, echo: 2, rest: 2, guardian: 4, shrine: 2 }];
// Room encounters. `diff` grows with depth. {stat} checks use the hero.
export const ROOMS = {
  trap: { text: (th) => th.trap, choices: [
    { id: 'disarm', label: 'Disarm it', check: { stat: 'wit', diff: 3 }, win: [{ op: 'loot', tier: 1 }], lose: [{ op: 'hp', n: -2 }], hint: 'Wit' },
    { id: 'dash', label: 'Dash through', check: { stat: 'moves', diff: 3 }, win: [], lose: [{ op: 'hp', n: -3 }], hint: 'Stride' },
    { id: 'tank', label: 'Take the blow', win: [{ op: 'hp', n: -1 }, { op: 'loot', tier: 1 }], hint: '−1 Resolve, certain loot' } ] },
  cache: { text: (th) => th.cache, choices: [
    { id: 'take_all', label: 'Take everything', check: { stat: 'def', diff: 3 }, win: [{ op: 'loot', tier: 2 }], lose: [{ op: 'hp', n: -2 }, { op: 'loot', tier: 1 }], hint: 'Guard' },
    { id: 'take_some', label: 'Take a little', win: [{ op: 'loot', tier: 1 }], hint: 'Safe' } ] },
  echo: { text: (th) => th.echo, choices: [
    { id: 'listen', label: 'Listen all the way through', check: { stat: 'wit', diff: 3 }, win: [{ op: 'fragment', cat: 'echo', name: 'An Echo Heard to the End' }, { op: 'wit', n: 1 }], lose: [{ op: 'hp', n: -1 }], hint: 'Wit' },
    { id: 'record', label: 'Copy it and go', win: [{ op: 'res', mem: 2 }], hint: '+2 ◈' } ] },
  guardian: { text: (th) => th.guardian, choices: [
    { id: 'fight', label: 'Fight', check: { stat: 'atk', diff: 4 }, win: [{ op: 'relic', n: 1 }, { op: 'loot', tier: 1 }], lose: [{ op: 'hp', n: -4 }], hint: 'Mettle' },
    { id: 'speak', label: 'Speak the old words', check: { stat: 'wit', diff: 4 }, win: [{ op: 'loot', tier: 2 }], lose: [{ op: 'hp', n: -2 }], hint: 'Wit' },
    { id: 'sneak', label: 'Sneak past', check: { stat: 'moves', diff: 3 }, win: [], lose: [{ op: 'hp', n: -3 }], hint: 'Stride' } ] },
  rest: { text: (th) => th.rest, choices: [
    { id: 'rest', label: 'Rest here', win: [{ op: 'hp', n: 4 }], hint: '+4 Resolve' },
    { id: 'search', label: 'Search instead', win: [{ op: 'loot', tier: 1 }], hint: 'Loot' } ] },
  shrine: { text: (th) => th.shrine, choices: [
    { id: 'offer', label: 'Offer 3 Resolve', win: [{ op: 'hp', n: -3 }, { op: 'boon', n: 1 }], hint: '−3 Resolve → a boon' },
    { id: 'pray', label: 'Leave a small offering (2 ◈)', cost: { mem: 2 }, win: [{ op: 'relic', n: 1 }], hint: 'A relic' },
    { id: 'pass', label: 'Pass', win: [], hint: 'Nothing' } ] },
};
export const THEMES = {
  choir_engine: { name: 'Halls of the Choir', trap: 'The walls sing one note and the floor remembers every step you take.', cache: 'Shelves of unlabeled voice-cylinders, each warm to the touch.', echo: 'A gallery of people who each say one sentence, forever.', guardian: 'A tall figure of glass stands where the singing is loudest.', rest: 'A listening room with a single chair and a very quiet clock.', shrine: 'A small altar of stacked voices asks for something you have.' },
  sleeping_orchard: { name: 'Roots of the Orchard', trap: 'The roots flex when you step on them. Something is deciding whether you are a seed.', cache: 'Fruit hung in net bags, each humming a different pitch.', echo: 'A tree remembers the rain it was first given.', guardian: 'A gardener-machine pivots toward you, shears ready.', rest: 'A hollow trunk big enough for a bed and a lamp.', shrine: 'A pear tree has a shelf where you can leave something precious.' },
  mirror_well: { name: 'The Well Below', trap: 'Every surface shows you a half-second later than you moved.', cache: 'A mirror-cabinet with another version of your pack inside it.', echo: 'A reflection that has been waiting to finish a sentence.', guardian: 'Someone who is almost you blocks the stair.', rest: 'A dry fountain surrounded by mirrors that politely look away.', shrine: 'A mirror asks you to leave the part of you it prefers.' },
  monolith: { name: 'Inside the Monolith', trap: 'The suspended hands slowly close as you pass.', cache: 'Toys and flowers hang in the glass, shifting to match your hands.', echo: 'A child\'s voice counts to a number and stops just short of it.', guardian: 'An old custodian of stone and wire rises from the base.', rest: 'A gap between the exhibits where nothing is suspended.', shrine: 'A flower in the glass opens toward you and waits.' },
  weather_loom: { name: 'The Loom Frame', trap: 'Filaments snap tight across the corridor at head height.', cache: 'Spools of woven weather, each labeled with a date that has not happened.', echo: 'A single gust, caught and replayed, says goodbye.', guardian: 'The loom\'s shuttle is a person-sized thing, and it is awake.', rest: 'A quiet pocket of still air at the center of the frame.', shrine: 'A knot of cloud asks to be untied by someone who will pay.' },
  glass_cradle: { name: 'Under the Cradle', trap: 'The frost on the floor has patterns that move when you do not.', cache: 'Folded blankets and tiny labels in a patient handwriting.', echo: 'A sleeper murmurs a lullaby you somehow know.', guardian: 'A nurse-machine steps between you and the sleepers.', rest: 'A warm chair beside a bed where no one is sleeping.', shrine: 'A cot with a note: "pay what you can spare of yourself."' },
  ruin: { name: 'A Silent Ruin', trap: 'A fallen lintel rests on one remaining wire; the floor sounds hollow.', cache: 'A chest of corroded tools, some still sharp.', echo: 'A recording of a meal long finished.', guardian: 'A salvage-drone patrols the corridor in a patient square.', rest: 'A stairwell landing with a window onto the lake.', shrine: 'A shrine to nobody in particular, with a very particular dish.' },
};
export const LOOT = { 1: { sus: 2, mat: 3, ene: 2, mem: 1 }, 2: { sus: 4, mat: 6, ene: 4, mem: 3 } }; // loot rolls pick two of these resources deterministically by seed

// ---------------- Boons (this-run perks) ----------------
export const BOONS = {
  deep_roots: { name: 'Deep Roots', tag: 'garden', desc: 'Gardens yield +1 Sustenance.', fx: { gardenSus: 1 } },
  bountiful_table: { name: 'Bountiful Table', tag: 'garden', desc: '+2 Sustenance per turn.', fx: { prodSus: 2 } },
  tended_quiet: { name: 'Tended Quiet', tag: 'garden', desc: '+1 Coherence per turn in every city.', fx: { cohAll: 1 } },
  hot_hands: { name: 'Hot Hands', tag: 'forge', desc: '+2 Matter per turn.', fx: { prodMat: 2 } },
  quick_hands: { name: 'Quick Hands', tag: 'forge', desc: 'Projects of 3+ turns finish 1 turn faster.', fx: { projTimeLong: -1 } },
  cheap_walls: { name: 'Cheap Walls', tag: 'forge', desc: 'Works cost 2 less Matter.', fx: { workDisc: 2 } },
  marginalia: { name: 'Marginalia', tag: 'archive', desc: '+2 Memory per turn.', fx: { prodMem: 2 } },
  open_stacks: { name: 'Open Stacks', tag: 'archive', desc: 'Archives yield +1 Memory.', fx: { archiveMem: 1 } },
  cheaper_truths: { name: 'Cheaper Truths', tag: 'archive', desc: 'Research requirement −10%.', fx: { techDisc: 0.1 } },
  long_stride: { name: 'Long Stride', tag: 'wander', desc: 'The Witness moves 1 further each turn.', fx: { heroMoves: 1 } },
  far_lantern: { name: 'Far Lantern', tag: 'wander', desc: 'The Witness sees 1 tile further.', fx: { heroSight: 1 } },
  quick_wit: { name: 'Quick Wit', tag: 'wander', desc: 'Wit +1 (checks and negotiation).', fx: { heroWit: 1 } },
  pathfinder: { name: 'Pathfinder', tag: 'wander', desc: 'Outposts cost 2 less Matter.', fx: { outpostDisc: 2 } },
  honest_tongue: { name: 'Honest Tongue', tag: 'voice', desc: '+10 treaty acceptance.', fx: { treatyAccept: 10 } },
  peacemaker: { name: 'Peacemaker', tag: 'voice', desc: 'Reconciliation restores 4 more Coherence.', fx: { reconcileBonus: 4 } },
  open_hands: { name: 'Open Hands', tag: 'voice', desc: 'One Negotiate every 8 turns is free.', fx: { freeNeg: 8 } },
  thick_skin: { name: 'Thick Skin', tag: 'ward', desc: 'Resolve +3.', fx: { heroHp: 3 } },
  wall_songs: { name: 'Wall Songs', tag: 'ward', desc: 'Every city defends +2 against threats.', fx: { cityDefense: 2 } },
  shield_cadence: { name: 'Shield Cadence', tag: 'ward', desc: 'Guard +1.', fx: { heroDef: 1 } },
  sharp_edge: { name: 'Sharp Edge', tag: 'ward', desc: 'Mettle +1.', fx: { heroAtk: 1 } },
};
// Attunements: holding 2 / 3 boons of one tag grants a bonus.
export const SETS = {
  garden: { 2: { housingEach: 1 }, 3: { prodSus: 2, cohAll: 1 }, name: 'Gardener\'s Attunement' },
  forge: { 2: { prodEne: 1 }, 3: { prodMat: 2, regCost: -0.15 }, name: 'Smith\'s Attunement' },
  archive: { 2: { prodMem: 1 }, 3: { techDisc: 0.1, protectedRecord: 1 }, name: 'Archivist\'s Attunement' },
  wander: { 2: { heroMoves: 1 }, 3: { heroSight: 1, heroWit: 1 }, name: 'Wayfarer\'s Attunement' },
  voice: { 2: { treatyAccept: 6 }, 3: { relBase: 5, cohAll: 1 }, name: 'Speaker\'s Attunement' },
  ward: { 2: { heroHp: 2 }, 3: { cityDefense: 2, heroDef: 1 }, name: 'Warden\'s Attunement' },
};

// ---------------- Relics (power with a catch; four slots) ----------------
export const RELICS = {
  cracked_lantern: { name: 'Cracked Lantern', desc: 'See 2 tiles further.', catch: 'Resolve −2.', fx: { heroSight: 2, heroHp: -2 } },
  chime_of_hours: { name: 'Chime of Hours', desc: 'Move 2 further each turn.', catch: '−1 Energy per turn.', fx: { heroMoves: 2, prodEne: -1 } },
  mirror_coin: { name: 'Mirror Coin', desc: 'One Negotiate every 4 turns is free.', catch: 'Rivals regard you 5 lower.', fx: { freeNeg: 4, relBase: -5 } },
  saltwood_staff: { name: 'Saltwood Staff', desc: 'Guard +2.', catch: 'Stride −1.', fx: { heroDef: 2, heroMoves: -1 } },
  heavy_ledger: { name: 'Heavy Ledger', desc: '+3 Memory per turn.', catch: '−1 Matter per turn.', fx: { prodMem: 3, prodMat: -1 } },
  glass_knife: { name: 'Glass Knife', desc: 'Mettle +3.', catch: '−1 Coherence per turn everywhere.', fx: { heroAtk: 3, cohAll: -1 } },
  seed_reliquary: { name: 'Seed Reliquary', desc: '+3 Sustenance per turn.', catch: '+1 Resonance per turn.', fx: { prodSus: 3, resonanceFlat: 1 } },
  weather_bell: { name: 'Weather Bell', desc: 'Stabilization costs 4 less Matter.', catch: '−1 Energy per turn.', fx: { stabDiscMat: 4, prodEne: -1 } },
  hollow_crown: { name: 'Hollow Crown', desc: 'Research requirement −20%.', catch: 'Resolve −2.', fx: { techDisc: 0.2, heroHp: -2 } },
  orphans_compass: { name: 'Orphan\'s Compass', desc: 'Survey range +1, see 1 further.', catch: '−1 Sustenance per turn.', fx: { surveyRange: 1, heroSight: 1, prodSus: -1 } },
  echo_shard: { name: 'Echo Shard', desc: 'Loot is richer (+1 tier on checks won).', catch: 'Wit −1.', fx: { lootBonus: 1, heroWit: -1 } },
  patient_hourglass: { name: 'Patient Hourglass', desc: 'Cities grow a turn faster.', catch: '−1 Matter per turn.', fx: { growthInterval: -1, prodMat: -1 } },
  wardens_seal: { name: 'Warden\'s Seal', desc: 'Every city defends +3.', catch: '+2 Energy upkeep.', fx: { cityDefense: 3, upkeepEne: 2 } },
  black_honey: { name: 'Black Honey', desc: 'Resolve +4.', catch: 'Mettle −1.', fx: { heroHp: 4, heroAtk: -1 } },
};

// ---------------- Seasons: a world modifier chosen at the start of a run ----------------
export const SEASONS = {
  calm_tide: { name: 'Calm Tide', blurb: 'A gentle year. The world is quieter than it should be.', gain: 'Threats 40% weaker and rarer; fewer timed beats.', cost: 'One fewer boon at every crossroads.', threat: 0.6, beatRate: 0.6, boonDelta: -1, relicMult: 1, quietShift: 0, civFx: {} },
  long_dusk: { name: 'Long Dusk', blurb: 'The light has a long, patient edge. The Quieting arrives early.', gain: 'Relics are twice as common.', cost: 'The first two Quieting escalations arrive 3 turns earlier.', threat: 1, beatRate: 1, boonDelta: 0, relicMult: 2, quietShift: -3, civFx: {} },
  hungry_winter: { name: 'Hungry Winter', blurb: 'Every table is a little emptier. Everyone notices.', gain: 'An extra boon at every crossroads.', cost: 'Every society produces 2 less Sustenance per turn.', threat: 1, beatRate: 1, boonDelta: 1, relicMult: 1, quietShift: 0, civFx: { prodSus: -2 } },
  gilded_drift: { name: 'Gilded Drift', blurb: 'Treasure lies about, and so do the things that follow it.', gain: 'Loot is richer.', cost: 'Threats 40% stronger and more frequent.', threat: 1.4, beatRate: 1.2, boonDelta: 0, relicMult: 1.5, quietShift: 0, lootBonus: 1, civFx: {} },
  ember_year: { name: 'Ember Year', blurb: 'Every foundry is lit. The world hums.', gain: 'Every society produces 2 more Matter per turn.', cost: 'Foundries add +1 Resonance.', threat: 1, beatRate: 1, boonDelta: 0, relicMult: 1, quietShift: 0, civFx: { prodMat: 2, foundryRes: 1 } },
  open_roads: { name: 'Open Roads', blurb: 'Every path is passable and everyone is on one.', gain: 'The Witness moves 1 further each turn.', cost: 'More beats and slightly stronger threats.', threat: 1.2, beatRate: 1.3, boonDelta: 0, relicMult: 1, quietShift: 0, civFx: {}, heroFx: { heroMoves: 1 } },
};

// ---------------- Crossroads (between ages) ----------------
export const CROSSROADS = {
  haven: { name: 'The Quiet Road', icon: '☾', blurb: 'A road through settled country. Rest, repair, a gentle gift.', gain: 'Resolve restored in full; +5 Coherence everywhere; choose a boon.', cost: 'Nothing is gained that you did not already have.', threat: 0.8 },
  front: { name: 'The Front', icon: '⚑', blurb: 'The road runs past the places where things are being taken.', gain: 'A relic and +6 Matter now.', cost: 'The next age has 40% stronger threats.', threat: 1.4 },
  mystery: { name: 'The Unmarked Road', icon: '?', blurb: 'There is no sign. The map has a blank.', gain: 'A coin-flip of a good outcome: a relic and a boon.', cost: 'Or a curse: Resolve −3 and a cursed relic.', threat: 1.0 },
  warden: { name: 'The Warden of Silence', icon: '♛', blurb: 'The road ends at a door. Something large is on the other side and it is awake.', gain: 'Defeat it for a relic, a boon and 8 Matter.', cost: 'Failure leaves you Frayed and costs Coherence.', threat: 1.2 },
};
export const BOSS_STAGES = [
  { title: 'The Warden Wakes', text: 'The door opens inward. The Warden is made of the quiet that comes after bells, and it stands very still.', choices: [
    { id: 'face', label: 'Face it', check: { stat: 'atk', diff: 4 }, hint: 'Mettle vs 4' }, { id: 'outwit', label: 'Name what it guards', check: { stat: 'wit', diff: 4 }, hint: 'Wit vs 4' }, { id: 'weather', label: 'Weather its first silence', check: { stat: 'def', diff: 3 }, hint: 'Guard vs 3' } ] },
  { title: 'The Second Silence', text: 'It takes the sound out of the room. You can still move; you cannot tell whether you are being followed.', choices: [
    { id: 'push', label: 'Push through', check: { stat: 'moves', diff: 4 }, hint: 'Stride vs 4' }, { id: 'hum', label: 'Hum something you remember', check: { stat: 'wit', diff: 5 }, hint: 'Wit vs 5' }, { id: 'brace', label: 'Hold your ground', check: { stat: 'def', diff: 4 }, hint: 'Guard vs 4' } ] },
  { title: 'The Last Question', text: 'It asks, without speaking, what you would keep if you could keep only one thing.', choices: [
    { id: 'people', label: 'The people', check: { stat: 'def', diff: 4 }, hint: 'Guard vs 4' }, { id: 'record', label: 'The record', check: { stat: 'wit', diff: 4 }, hint: 'Wit vs 4' }, { id: 'road', label: 'The road ahead', check: { stat: 'atk', diff: 5 }, hint: 'Mettle vs 5' } ] },
];
export const THREAT_KINDS = {
  raiders: { name: 'Salt Raiders', glyph: '⚔', blurb: 'Hungry people with sharp tools.', basePower: 3, perTurn: 0.33, loot: { mat: 3 } },
  echo: { name: 'A Wandering Echo', glyph: '≈', blurb: 'A Quieting manifestation: a place that remembers being someone.', basePower: 2, perTurn: 0.28, loot: { mem: 3 } },
};
export const AGE_BOUNDARIES = [11, 21]; // crossroads at the start of these turns
export const THREAT_CFG = { startTurn: 3, spawnBase: 0.4, spawnPerTurn: 0.03, spawnMax: 0.9, activeBase: 2, activePerTurns: 6, minDist: 6, maxDist: 10, moveRate: 1, attackLimit: 2, cityBase: 2, bulwark: 3, armyDiv: 3, repelRatio: 0.6, breachDamage: 3, breachCoh: 6, repelCoh: 3, beatChance: 0.55, beatMinTurn: 2 };
