# Forever Gear Planner

A gear planner for World of Warcraft: Forever, pre-raid. Import your character, see what to
upgrade, where to get it, and what it is worth in simulated DPS.

Live: https://dm15001.github.io/forever-gear-planner/

It is a fan project, not affiliated with or endorsed by Blizzard.

## What it covers

Damage builds of all nine classes, each one a preset configuration that WoWSims ships:

| Class | Builds |
|---|---|
| Shaman | Enhancement, Elemental |
| Warlock | SM/Ruin, Destro, Aff (Wrack), Demo (Fire Brand), Demo (Shadow Brand) |
| Priest | Shadow Testing, Smite Testing |
| Mage | Fire, Frost Med, Frost Incin, Arcane, Arcane Fire, FFB |
| Warrior | Fury, Arms |
| Rogue | Combat SS, Combat BS, Combat Venom, Asn Muti, Subtlety Hemo, Hemo Seal Fate |
| Druid | Balance, Feral Cat |
| Hunter | MM, BM, SV, SV Weave, SV Melee |
| Paladin | Retribution: Unsealed Wrath, Holy Shock |

Healing is covered for the Priest (Holy and Discipline), scored in healing per second instead
of DPS, see below. The other healers and tank specs are not covered. Raid
items are not in the data.

## What it does

- **Character**: paste an export from the WoWSims Exporter addon (`/wse`) or from wowsims.com,
  or load a WoWSims preset as an example. Gear, enchants, race and professions can be changed
  by hand. Several characters can be kept, and one can be shared as a link.
- **Plan**: builds the best set you can get from the content you pick (dungeons, quests,
  crafting, reputation, PvP, random-suffix items).
- **Upgrades**: every item per slot, ranked against what you wear, with a "Sim this" button.
- **Farm plan**: where the planned items come from, grouped by dungeon, with drop chances
  and how many runs to expect.
- **Enchants & professions**: enchants per slot and what your professions add.
- **Sim setup**: what the simulator is given, in words. Talents, consumables, buffs and
  debuffs can be changed one by one, and the settings can be copied to wowsims.com.

## How it calculates

There are two kinds of numbers, and they are not the same thing.

**Quick scores** (Plan, Upgrades, Farm plan). Each stat has a weight, for example "1 hit
rating is worth 1.5 spell damage". An item's score is its stats times those weights, with
the hit cap taken into account. This is fast enough to rank thousands of items, but it is an
approximation:

- Weights come from WoWSims where it ships them (Shaman, Warrior, Rogue, Druid). For the
  other builds they were measured with the simulator, one run per stat, on the preset gear.
- Procs, on-use effects and set bonuses are only measured for the Enhancement Shaman. For
  the other builds such items are marked "sim it", and the plan can rank them wrongly; this
  matters most for melee.
- The weights assume the build's own talents, consumables and buffs. They do not follow
  changes made on the Sim setup tab.
- An item with a random suffix counts with the suffix that is worth most to the build.

**Simulated DPS** ("Simulate", "Sim this"). This runs the real WoWSims Forever simulator
inside the page, in a web worker. Nothing is sent to a server. It starts from the WoWSims
preset of the build (rotation, buffs, debuffs, consumables, a 3-minute single-target fight)
and swaps in your race, professions, gear and talents. The rotation is the WoWSims file for
the build, unchanged; the Sim setup tab shows it in words with the original rule behind each
step. A fold-out under each result shows damage per spell, crit and miss rates and uptimes.

When two items are close in the quick score, trust the simulator.

**Healers** have no DPS, and healing power alone says little: in a long fight mana
regeneration can be worth more. So a healer is scored in healing per second over a whole
fight, played out by the same simulator: when the mana is gone, the healing stops until some
comes back. You pick the spells (tank healing, fast heals, group healing) and the fight (a
45-second burst, a 5-minute fight with casting half the time, a 10-minute fight with casting
70% of the time); each combination has its own stat weights, measured with the simulator.
WoWSims has the Priest's heals, talents and mana rules in its engine but ships no healing
rotation, so the short rotations are this planner's own (`src/lib/sim/healing.ts`). There is
no incoming damage in the model, so overhealing is not counted. Prayer of Mending cannot be
cast in the engine yet (it stops with an error), so for now its healing is an estimate added
on top of the simulator's number (`src/lib/sim/mending.ts`); it can be switched off.

**Drop chances** are Wowhead's Forever numbers where they exist, otherwise the WoW Classic
rates from AtlasLoot, marked "Classic rate". Forever may have changed those. Bosses that do
not appear on every run are counted with their spawn chance. For a random-suffix item the
chance is that of the item, not of the right suffix.

**Not in the game yet.** The WoWSims database marks every item as released. Items known to
be out of reach are listed by hand in `src/config/not-available.json` and left out by default.

## Run it locally

Needs [Node.js](https://nodejs.org) 20 or newer.

On Windows, double-click `start.bat`. Otherwise:

```
npm install
npm run dev
```

`npm test` runs the unit tests, `npm run build` writes the static site to `dist/`.
Every push to `main` deploys to GitHub Pages.

## Update the data

```
npm run build-data
```

Downloads the current item database, presets and simulator from WoWSims and rewrites
`src/data/` and `public/sim/`. Database and simulator come from the same WoWSims deployment,
so they match. Options for working offline are at the top of `scripts/build-data.mjs`.

```
npm run build-sim-values
```

Measures procs, on-use effects and set bonuses with the simulator (Enhancement Shaman only,
30 to 60 minutes).

## Adding a build

One file per build in `src/specs/`: what the class can equip, the hit cap, the stat weights
and which WoWSims preset it is. Most builds have their assembled sim request in
`scripts/builds/`; the scripts that made them are in `scripts/presets/`. Guide picks sit in
`src/config/guides/<build>.wowhead.json`.

## Credits and licenses

- Item data, stat weights, gear presets and the simulator come from
  [WoWSims Forever](https://github.com/wowsims/forever) (MIT).
- `public/sim/wasm_exec.js` is the WebAssembly support file of the Go project (BSD-style
  license, see the file's header).
- Item icons load from Blizzard's image server (`render.worldofwarcraft.com`), with Wowhead's as a
  fallback. World of Warcraft and its icons are © Blizzard Entertainment; this is a free fan project.
- Guide picks: the top (BiS) rows of Wowhead's Forever guides, where a guide has them (`src/config/guides/`, each file links its guide). The full guides are on [Wowhead](https://www.wowhead.com/forever).
- Drop chances: Wowhead's Forever item pages (`src/config/wowhead/loot.json`) and, as a fallback, the WoW Classic drop rates from [AtlasLootClassic](https://github.com/Hoizame/AtlasLootClassic) (`src/config/droprates.classic.json`, GPL v2). That file stays under the GPL v2.
- Icon names for items new in Forever: Wowhead tooltips (`src/config/wowhead/icons.json`).
- Sources for items from the new Forever dungeons: the loot tables of the AtlasLoot Classic Forever addon by Sliccer (CurseForge, GPL v2), imported with `node scripts/import-atlasloot.mjs path/to/AddOns` into `src/config/atlasloot/sources.json`.
- Headings are set in [Cinzel](https://github.com/NDISCOVER/Cinzel) (SIL Open Font License), bundled through `@fontsource/cinzel`. The bar end pieces and emblems are drawn for this project (`src/components/Ornaments.tsx`).
