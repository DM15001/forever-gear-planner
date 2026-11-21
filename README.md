# Forever Gear Planner

Private gear planner for World of Warcraft: Forever. First target: Enhancement Shaman, pre-raid.
See [SPEC.md](SPEC.md) for scope, data model and milestones.

## Status

- [x] Milestone 1: data script
- [ ] Milestone 2: app shell + character import

## Update the game data

Needs [Node.js](https://nodejs.org) 20 or newer.

```
npm run build-data
```

This downloads the current item database from WoWSims and rewrites `src/data/`.
Use `npm run build-data -- --db path/to/db.json` to build from a local copy.

## Credits

Item data and stat weights come from [WoWSims Forever](https://github.com/wowsims/forever) (MIT).
