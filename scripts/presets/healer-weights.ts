// Measures a healer's stat weights for every healing scenario with the WoWSims engine and writes
// them into the spec files (src/specs/<id>.json, "healing.scenarios" and the default "weights").
// Run with:
//   WASM=<lib.wasm, unzipped> DB=<forever/assets/database/db.json> WASM_EXEC=<Go's wasm_exec.js> \
//     npx vite-node scripts/presets/healer-weights.ts -- priest-holy priest-disc
//
// One run per stat with a little of that stat added, compared with the plain run, on the build's
// preset gear: the result is healing per second per point of the stat.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { applyHealingFight, DEFAULT_HEALING, HEALING_PRESSURES, HEALING_STYLES, scenarioKey } from '../../src/lib/sim/healing';
// @ts-expect-error plain JS helper without types
import { loadSim } from './sim.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const ITERATIONS = Number(process.env.ITERATIONS ?? 2000);
const STATS: Record<string, [index: number, amount: number]> = { intellect: [3, 50], healingPower: [4, 50], spirit: [13, 50], critRating: [18, 30], hasteRating: [19, 30], mp5: [31, 20] };

const log = console.log;
console.log = () => {};
const sim = await loadSim(process.env.WASM, process.env.DB);
console.log = log;

// The spec ids are the arguments that name a spec file; vite-node passes its own ahead of them.
for (const id of process.argv.slice(2).filter(arg => existsSync(join(ROOT, 'src/specs', `${arg}.json`)))) {
	const specPath = join(ROOT, 'src/specs', `${id}.json`);
	const spec = JSON.parse(readFileSync(specPath, 'utf8'));
	const template = JSON.parse(readFileSync(join(ROOT, 'public/sim', `template.${id}.json`), 'utf8'));
	const scenarios: Record<string, { hps: number; oomSeconds: number; weights: Record<string, number> }> = {};
	for (const style of HEALING_STYLES) {
		for (const pressure of HEALING_PRESSURES) {
			const choice = { style: style.id, pressure: pressure.id };
			const run = (index?: number, amount = 0) => {
				const request = structuredClone(template);
				applyHealingFight(request, choice);
				const stats = Array(39).fill(0);
				if (index !== undefined) stats[index] = amount;
				request.raid.parties[0].players[0].bonusStats = { stats };
				const outcome = sim.run(request, ITERATIONS);
				if (outcome.error) throw new Error(`${id} ${scenarioKey(choice)}: ${outcome.error}`);
				const player = outcome.result.raidMetrics.parties[0].players[0];
				return { hps: outcome.result.raidMetrics.hps.avg as number, oom: (player.secondsOomAvg ?? 0) as number };
			};
			const base = run();
			const weights: Record<string, number> = {};
			// A stat that makes things a touch worse in the run (haste when mana is the limit) counts as worth nothing.
			for (const [stat, [index, amount]] of Object.entries(STATS)) weights[stat] = Math.max(0, Math.round(((run(index, amount).hps - base.hps) / amount) * 1000) / 1000);
			scenarios[scenarioKey(choice)] = { hps: Math.round(base.hps), oomSeconds: Math.round(base.oom), weights };
			log(id, scenarioKey(choice), Math.round(base.hps), 'HPS, out of mana', Math.round(base.oom), 's', JSON.stringify(weights));
		}
	}
	spec.healing = { scenarios };
	spec.weights.stats = scenarios[scenarioKey(DEFAULT_HEALING)].weights;
	spec.weights.source = `Measured for this planner on ${new Date().toISOString().slice(0, 10)} with the WoWSims Forever simulator (${ITERATIONS} fights per stat, the WoWSims healer buffs, consumables and pre-raid gear). The numbers are healing per second per point of the stat, one set for each healing scenario. WoWSims has the Priest's heals in its engine but ships no healing rotation; the rotations are this planner's own (src/lib/sim/healing.ts).`;
	writeFileSync(specPath, JSON.stringify(spec, null, '\t') + '\n');
}
process.exit(0);
