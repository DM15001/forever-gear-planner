import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadSim } from './sim.mjs';
const B = '/home/claude/forever-gear-planner/scripts/builds/';
const OUT = process.env.OUT;
const only = process.argv.slice(2);
const log = console.log; console.log = () => {};
const sim = await loadSim('lib.wasm', '/home/claude/simbin/pages-deploy/forever/assets/database/db.json');
console.log = log;
const STATS = { intellect: [3, 50], spirit: [13, 50], spellDamage: [5, 50], arcaneDamage: [6, 50], fireDamage: [7, 50], frostDamage: [8, 50], shadowDamage: [11, 50], holyDamage: [9, 50], hitRating: [17, -30], critRating: [18, 28], hasteRating: [19, 30], spellPiercing: [12, 20] };
const ITER = { 'warlock-destruction': 1500, 'warlock-demo-fire': 2500, 'warlock-demo-shadow': 2000, 'warlock-sm-ruin': 4000 };
const results = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
for (const id of only) {
	const b = JSON.parse(readFileSync(B + id + '.build.json', 'utf8'));
	const make = (index, delta) => {
		const player = structuredClone(b.player);
		const stats = Array.from({ length: 39 }, (_, i) => player.bonusStats?.stats?.[i] ?? 0);
		if (index !== undefined) stats[index] += delta;
		player.bonusStats = { ...(player.bonusStats ?? {}), stats };
		return { raid: { parties: [{ players: [player], buffs: b.partyBuffs }], numActiveParties: 1, buffs: b.raidBuffs, debuffs: b.debuffs }, encounter: b.encounter, type: 'SimTypeIndividual' };
	};
	const n = ITER[id] ?? 6000;
	const t = Date.now();
	const base = sim.run(make(), n);
	const st = sim.stats(make());
	const ps = st?.raidStats?.parties?.[0]?.players?.[0]?.finalStats?.pseudoStats ?? [];
	const fs = st?.raidStats?.parties?.[0]?.players?.[0]?.finalStats?.stats ?? [];
	const out = { dps: base.dps, stdev: base.stdev, iterations: n, hitRating: fs[17], hitPercents: { arcane: ps[6], fire: ps[7], frost: ps[8], shadow: ps[11], holy: ps[9], spell: ps[13] }, perPoint: {} };
	for (const [name, [index, delta]] of Object.entries(STATS)) {
		const r = sim.run(make(index, delta), n);
		out.perPoint[name] = (r.dps - base.dps) / delta;
	}
	// How much hit beyond the reference set is still worth something: +60 rating on top.
	out.hitPlus60 = (sim.run(make(17, 60), n).dps - base.dps) / 60;
	out.ep = Object.fromEntries(Object.entries(out.perPoint).map(([k, v]) => [k, Math.round((v / out.perPoint.spellDamage) * 100) / 100]));
	out.seconds = Math.round((Date.now() - t) / 1000);
	results[id] = out;
	writeFileSync(OUT, JSON.stringify(results, null, 1));
	log(id, out.dps.toFixed(1), JSON.stringify(out.ep), 'hit', out.hitRating, JSON.stringify(out.hitPercents), 'hit+60', (out.hitPlus60 / out.perPoint.spellDamage).toFixed(2), out.seconds + 's');
}
process.exit(0);
