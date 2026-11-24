// Measures stat weights in attack-power units for builds whose shipped EP weights do not hold up
// (Retribution, 2026-11-23: a plan built on them simulated lower than the preset set).
//   WASM_EXEC=<wasm_exec.js> node scripts/presets/weights-melee.mjs <lib.wasm> <db.json> <build id>...
import { readFileSync } from 'node:fs';
import { loadSim } from './sim.mjs';
const [, , WASM, DB, ...ids] = process.argv;
const STATS = { attackPower: [14, 100], strength: [0, 50], agility: [1, 50], intellect: [3, 50], spellDamage: [5, 50], holyDamage: [9, 50], hitRating: [17, -20], critRating: [18, 28], hasteRating: [19, 30], expertiseRating: [21, 20], armorPenetration: [20, 100] };
const N = Number(process.env.ITERATIONS ?? 4000);
const log = console.log; console.log = () => {};
const sim = await loadSim(WASM, DB);
console.log = log;
for (const id of ids) {
	const b = JSON.parse(readFileSync(new URL(`../builds/${id}.build.json`, import.meta.url), 'utf8'));
	const run = (index, delta) => {
		const player = structuredClone(b.player);
		player.bonusStats = { stats: Array.from({ length: 39 }, (_, i) => (i === index ? delta : 0)) };
		const r = sim.run({ raid: { parties: [{ players: [player], buffs: b.partyBuffs }], numActiveParties: 1, buffs: b.raidBuffs, debuffs: b.debuffs }, encounter: b.encounter, type: 'SimTypeIndividual' }, N);
		if (r.error) throw new Error(r.error);
		return r.dps;
	};
	const base = run(-1, 0);
	const per = Object.fromEntries(Object.entries(STATS).map(([name, [index, delta]]) => [name, (run(index, delta) - base) / delta]));
	log('WEIGHTS', id, base.toFixed(1), 'dpsPerAP', per.attackPower.toFixed(4), JSON.stringify(Object.fromEntries(Object.entries(per).map(([k, v]) => [k, Math.round((v / per.attackPower) * 100) / 100]))));
}
process.exit(0);
