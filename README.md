# Forever Gear Planner

Private gear planner for World of Warcraft: Forever. First target: Enhancement Shaman, pre-raid.
See [SPEC.md](SPEC.md) for scope, data model and milestones.

## Status

- [x] Milestone 1: data script
- [x] Milestone 2: app shell + character import
- [x] Milestone 3: character tab (icons, stats, Wowhead links)
- [x] Milestone 4: scoring + upgrades tab
- [x] Milestone 5: farm plan tab
- [x] Milestone 6: enchants & professions tab
- [x] Milestone 7: the WoWSims simulator runs in the page
- [x] Milestone 8: guided Plan tab, content picker, effect values measured with the sim
- [ ] Milestone 9: GitHub Pages

## Run it locally

Needs [Node.js](https://nodejs.org) 20 or newer.

```
npm install
npm run dev
```

Then open the address Vite prints (usually http://localhost:5173).
`npm test` runs the unit tests, `npm run build` writes the static site to `dist/`.

## Update the game data

```
npm run build-data
```

This downloads the current item database, the gear presets and the simulator from WoWSims and
rewrites `src/data/` and `public/sim/`. The database and the simulator come from the same
WoWSims deployment, so they always match. Options for working offline are at the top of
`scripts/build-data.mjs`.

## The simulator

"Simulate" and "Sim" run the real WoWSims Forever simulator in the browser, in a web worker.
It is the prebuilt WebAssembly file from wowsims.com (`public/sim/lib.wasm.gz`, about 6 MB,
loaded on first use). Settings are the simulator's defaults for the spec: full raid buffs, a
3-minute single-target fight, the default rotation. `npm test` runs the same simulator in Node.

`VITE_NO_SIM=1 npx vite build --outDir dist-preview` builds a copy without the simulator.

## Effect values

The stat score cannot see procs, on-use effects, proc enchants and set bonuses. Their worth is
measured once with the simulator and stored in `src/data/simValues.json`:

```
npm run build-sim-values
```

This takes 30 to 60 minutes. Run it after `npm run build-data` when the simulator or the item
data changed. How it measures is described at the top of `scripts/build-sim-values.mjs`.

## Guide lists

- **WoWSims default set**: pulled automatically by `npm run build-data` into `src/data/simSets.json`.
- **Wowhead BiS guide**: kept by hand in `src/config/guides/enhancement-shaman.wowhead.json`.
  When the guide changes, update the items there and set `updated` and `checked`.

## Credits

- Item data, stat weights, gear presets and the simulator come from
  [WoWSims Forever](https://github.com/wowsims/forever) (MIT).
- `public/sim/wasm_exec.js` is the WebAssembly support file of the Go project (BSD-style
  license, see the file's header).
- Item icons load from Blizzard's image server (`render.worldofwarcraft.com`), with Wowhead's as a
  fallback. World of Warcraft and its icons are © Blizzard Entertainment; this is a free fan project.
- BiS list: [Wowhead's Enhancement Shaman guide](https://www.wowhead.com/forever/guide/classes/shaman/enhancement/bis-gear).
- Drop chances: Wowhead's Forever item pages (`src/config/wowhead/loot.json`) and, as a fallback, the WoW Classic drop rates from [AtlasLootClassic](https://github.com/Hoizame/AtlasLootClassic) (`src/config/droprates.classic.json`, GPL v2). If this repository is made public, that file stays under the GPL v2.
- Icon names for items new in Forever: Wowhead tooltips (`src/config/wowhead/icons.json`).
- Sources for items from the new Forever dungeons: the loot tables of the AtlasLoot Classic Forever addon by Sliccer (CurseForge, GPL v2), imported with `node scripts/import-atlasloot.mjs path/to/AddOns` into `src/config/atlasloot/sources.json`.
- Headings are set in [Cinzel](https://github.com/NDISCOVER/Cinzel) (SIL Open Font License), bundled through `@fontsource/cinzel`. The bar end pieces and emblems are drawn for this project (`src/components/Ornaments.tsx`).
