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
- [ ] Milestone 7: sim integration (optional)
- [ ] Milestone 8: GitHub Pages

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

This downloads the current item database from WoWSims and rewrites `src/data/`.
Use `npm run build-data -- --db path/to/db.json` to build from a local copy.

## Guide lists

- **WoWSims default set**: pulled automatically by `npm run build-data` into `src/data/simSets.json`.
- **Wowhead BiS guide**: kept by hand in `src/config/guides/enhancement-shaman.wowhead.json`.
  When the guide changes, update the items there and set `updated` and `checked`.

## Credits

Item data and stat weights come from [WoWSims Forever](https://github.com/wowsims/forever) (MIT).
