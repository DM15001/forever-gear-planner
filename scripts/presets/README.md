# Preset tooling

Working scripts that produced the files in `scripts/builds/`, the measured stat weights in
`src/specs/` and the guide files in `src/config/guides/`. They were written for one machine and
carry its paths; set the paths at the top of each script before running.

They expect:

- a clone of `wowsims/forever` (the preset sources under `ui/specs/`),
- the simulator: `public/sim/lib.wasm.gz` unpacked to `lib.wasm`, plus Go's `wasm_exec.js`
  (`WASM_EXEC=/path/to/wasm_exec.js`),
- the full item database `assets/database/db.json` of the WoWSims deployment.

| Script | What it does |
|---|---|
| `sim.mjs` | Loads the simulator in Node; `run(request, iterations)` and `stats(request)`. |
| `cons.mjs` | Looks up consumable ids by the names WoWSims' TypeScript uses. |
| `mkbuilds.mjs` | Warlock, Shadow Priest and the first three Mage builds. |
| `mkbuilds2.mjs` | Mage Arcane Fire, FFB, Frost Incin and Priest Smite. |
| `mkbuilds3.mjs` | Warrior Fury and Arms. |
| `mkbuilds4.mjs` | The six Rogue builds. |
| `mkbuilds5.mjs` | Druid Balance and Feral Cat. |
| `extract-bundle.mjs` | Reads presets that WoWSims writes in its .siml format out of the built site's bundle. |
| `mkbuilds6.mjs` | Hunter (five builds) and Retribution Paladin (two), from `extract-bundle.mjs`' output. |
| `weights-melee.mjs` | Measures stat weights in attack-power units (used to check Retribution). |
| `weights.mjs` | Measures stat weights for builds WoWSims ships none for (one run per stat). |
| `class-capabilities.py` | Reads armor, weapons and races per class from WoWSims. |
| `make-guide.py` | Turns "slot|item name" lines into a guide file. |

The simulator prints a lot to stdout; send it to a file and grep for the result lines.

## Healing Priest

WoWSims has the healer Priest as a gear planner without a healing rotation, so two scripts
build what the planner needs. Both run with `vite-node`, because they share
`src/lib/sim/healing.ts` (the healing scenarios) with the app.

```
# 1. The build files, from the WoWSims healer gear set, consumables, buffs and talents
npx vite-node scripts/presets/healer-builds.ts -- <path to a wowsims/forever clone>
# 2. The sim templates
npm run build-data -- --pages <pages-deploy clone> --repo <wowsims/forever clone>
# 3. The stat weights of every scenario, measured with the engine (about ten minutes)
WASM=<lib.wasm, unzipped> DB=<forever/assets/database/db.json> WASM_EXEC=<Go's wasm_exec.js> \
  npx vite-node scripts/presets/healer-weights.ts -- priest-holy priest-disc
```

Prayer of Mending: the engine cannot cast it yet, so `src/lib/sim/mending.ts` adds it as an
estimate. `npx vite-node scripts/presets/check-mending.ts` (same environment variables as step 3)
prints whether the engine can cast it by now. Once it can: add the spell to the rotation in
`src/lib/sim/healing.ts`, delete `mending.ts` and its uses, and run step 3 again.

Step 3 writes `healing.scenarios` and the default `weights` into `src/specs/priest-holy.json`
and `priest-disc.json`. Run it again when the engine's Priest changes.

## Item effects, proc enchants and set bonuses

What a proc, an on-use effect or a set bonus is worth has to be simulated per build; WoWSims
ships the simulator and stat weights, not these values. `scripts/build-sim-values.mjs --spec <id>`
measures them and writes `src/data/simValues/<id>.json` (DPS). It takes 20 to 90 minutes per
build, so it runs in GitHub Actions: `.github/workflows/measure.yml` starts when the simulator,
its item database, a preset or the script changes, measures each damage build whose inputs
changed, commits the files if tests and build pass, and deploys.

Until a build has its own file the app falls back to `src/data/simValues.json` (Enhancement
only, older) and `src/data/setValues.json` (set bonuses only, from `scripts/build-set-values.mjs`).
Healing builds are not measured.
