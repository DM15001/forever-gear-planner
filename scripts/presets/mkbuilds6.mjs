// Hunter and Retribution Paladin. WoWSims writes these presets in its .siml format, which only its
// own build step turns into JSON. So the presets are read from the built site instead:
//   node scripts/presets/extract-bundle.mjs <pages-deploy>/forever/bundle/<hunter spec chunk>.js hunter.json
//   node scripts/presets/extract-bundle.mjs <pages-deploy>/forever/bundle/<retribution spec chunk>.js ret.json
// (the chunk is the spec-*.chunk.js that holds "ClassHunter" / "ClassPaladin" and several talentsString),
// then: WASM_EXEC=<wasm_exec.js> node scripts/presets/mkbuilds6.mjs <dir with hunter.json and ret.json> <lib.wasm> <db.json>
// Prints one RESULT line per build: DPS, and what one point of the weights' unit is worth in DPS.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadSim } from './sim.mjs';
const [, , DIR, WASM, DB] = process.argv;
const OUT = new URL('../builds/', import.meta.url).pathname;
const read = name => JSON.parse(readFileSync(`${DIR}/${name}`, 'utf8'));
const calls = (data, has) => data.filter(c => c.args.some(a => a && typeof a === 'object' && has(a)));
const builds = {};

// Hunter: the defaults carry buffs, debuffs, consumables and the fight; each build replaces what it names.
const hunter = read('hunter.json');
const hunterDefaults = calls(hunter, a => a.raidBuffs && a.player && a.encounter)[0].args.find(a => a?.player);
const hunterBuild = name => calls(hunter, a => a.player?.talentsString).find(c => c.args[0] === name).args.find(a => a?.player).player;
for (const [id, name] of [['hunter-mm', 'MM'], ['hunter-bm', 'BM'], ['hunter-sv', 'SV'], ['hunter-sv-weave', 'SV Weave'], ['hunter-sv-melee', 'SV Melee']]) {
	builds[id] = {
		unit: 1, // the weights count in Agility
		raidBuffs: hunterDefaults.raidBuffs, partyBuffs: hunterDefaults.partyBuffs ?? {}, debuffs: hunterDefaults.debuffs,
		player: { apiVersion: 2, name: 'Player', ...hunterDefaults.player, ...hunterBuild(name) },
		encounter: hunterDefaults.encounter,
	};
}

// Retribution: the builds are whole; the page's simple rotation picks the APL by talents, here it is set outright.
const ret = read('ret.json');
const retDefaults = calls(ret, a => a.raidBuffs && a.player && a.encounter)[0].args.find(a => a?.player);
const rotation = name => ret.find(c => c.args[0] === name && c.args[1]?.priorityList).args[1];
const swap = ret.find(c => c.args[0] === 'Holy Shock' && c.args[1]?.items?.some(i => !i.id)).args[1];
for (const [id, name, apl, itemSwap] of [['paladin-ret', 'Unsealed Wrath', 'Default'], ['paladin-ret-holy-shock', 'Holy Shock', 'Holy Shock', swap]]) {
	const build = ret.find(c => c.args[0] === name && c.args[2]?.player).args[2];
	builds[id] = {
		unit: 14, // the weights count in attack power
		raidBuffs: build.raidBuffs, partyBuffs: build.partyBuffs ?? {}, debuffs: build.debuffs,
		player: { apiVersion: 2, name: 'Player', ...build.player, rotation: rotation(apl), ...(itemSwap ? { itemSwap, enableItemSwap: true } : {}) },
		encounter: retDefaults.encounter,
	};
}

const log = console.log; console.log = () => {};
const sim = await loadSim(WASM, DB);
console.log = log;
for (const [id, { unit, ...b }] of Object.entries(builds)) {
	const request = bonus => {
		const player = structuredClone(b.player);
		if (bonus) player.bonusStats = { stats: Array.from({ length: 39 }, (_, i) => (i === unit ? bonus : 0)) };
		return { raid: { parties: [{ players: [player], buffs: b.partyBuffs }], numActiveParties: 1, buffs: b.raidBuffs, debuffs: b.debuffs }, encounter: b.encounter, type: 'SimTypeIndividual' };
	};
	const base = sim.run(request(), 6000);
	if (base.error) { log('RESULT', id, 'ERROR', String(base.error).slice(0, 300)); continue; }
	const more = sim.run(request(100), 6000);
	const final = sim.stats(request())?.raidStats?.parties?.[0]?.players?.[0]?.finalStats;
	log('RESULT', id, base.dps.toFixed(1), 'dpsPerPoint', ((more.dps - base.dps) / 100).toFixed(4), 'missing', JSON.stringify(base.missing), 'hitRating', final?.stats?.[17], 'talents', b.player.talentsString, b.player.race);
	writeFileSync(`${OUT}${id}.build.json`, JSON.stringify(b));
}
process.exit(0);
