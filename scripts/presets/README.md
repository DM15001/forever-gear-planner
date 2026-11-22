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
| `weights.mjs` | Measures stat weights for builds WoWSims ships none for (one run per stat). |
| `class-capabilities.py` | Reads armor, weapons and races per class from WoWSims. |
| `make-guide.py` | Turns "slot|item name" lines into a guide file. |

The simulator prints a lot to stdout; send it to a file and grep for the result lines.
