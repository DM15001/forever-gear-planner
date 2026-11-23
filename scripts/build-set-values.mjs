#!/usr/bin/env node
// Measures what set bonuses are worth for every build, with the real simulator, so that the plan
// does not break a set for an item whose stats alone look better. Writes one file per build into
// an output folder; `--merge` joins them into src/data/setValues.json.
//
//   WASM_EXEC=<wasm_exec.js> node scripts/build-set-values.mjs <lib.wasm> <db.json> <out dir> <spec id>...
//   node scripts/build-set-values.mjs --merge <out dir>
//
// How: all usable pieces of a set go into the build's WoWSims preset gear. The run is repeated
// with only the first k pieces counting towards the set (the others are copies without the set),
// same random seed each time. DPS with k pieces minus DPS with none is the worth of the bonuses
// reached at k. A set whose full bonus changes nothing is done after two runs.
// Values are in DPS. Builds whose number is healing are skipped (their fights are set up in TypeScript).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const args = process.argv.slice(2);

if (args[0] === '--merge') {
	const dir = args[1];
	const specs = {};
	for (const file of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) specs[file.replace(/\.json$/, '')] = readJson(join(dir, file));
	const out = {
		generatedAt: new Date().toISOString(),
		note: 'Worth of set bonuses per build, in DPS, measured with the WoWSims simulator in each build\'s preset gear (scripts/build-set-values.mjs). byCount: pieces worn -> DPS over wearing the same items without the set. Values within the noise of the measurement are left out.',
		specs,
	};
	writeFileSync(join(ROOT, 'src/data/setValues.json'), `${JSON.stringify(out)}\n`);
	console.log(`Wrote src/data/setValues.json: ${Object.keys(specs).length} builds, ${Object.values(specs).reduce((n, s) => n + Object.keys(s.sets).length, 0)} set values.`);
	process.exit(0);
}

const [WASM, DB, OUT, ...ids] = args;
const SCREEN = Number(process.env.SCREEN ?? 300);
const FINAL = Number(process.env.ITERATIONS ?? 1500);
const NO_SET = 20_000_000;
const SLOT_OF = { head: 0, neck: 1, shoulder: 2, back: 3, chest: 4, wrist: 5, hands: 6, waist: 7, legs: 8, feet: 9, finger: 10, trinket: 12, weapon: 14, ranged: 16 };
const ARMOR = new Set(['head', 'shoulder', 'chest', 'wrist', 'hands', 'waist', 'legs', 'feet']);

const { loadSim } = await import('./presets/sim.mjs');
const log = console.log;
console.log = () => {};
const sim = await loadSim(WASM, DB);
console.log = log;
const dbItem = new Map(sim.db.items.map(i => [i.id, i]));
const items = readJson(join(ROOT, 'src/data/items.json'));
mkdirSync(OUT, { recursive: true });

for (const id of ids) {
	const file = join(OUT, `${id}.json`);
	if (existsSync(file)) continue;
	const spec = readJson(join(ROOT, 'src/specs', `${id}.json`));
	if (spec.role === 'healer') continue;
	const template = readJson(join(ROOT, 'public/sim', `template.${id}.json`));
	const usable = item => {
		if (item.classes && !item.classes.includes(spec.classId)) return false;
		if (ARMOR.has(item.slot)) return !item.armorType || spec.armorTypes.includes(item.armorType);
		if (item.slot === 'weapon') {
			const { type, hand } = item.weapon ?? {};
			if (hand === 'twoHand') return spec.weaponSetup !== 'oneHand' && spec.weaponTypes.twoHand.includes(type);
			if (hand === 'offHand') return spec.weaponTypes.offHand.includes(type) || (spec.canDualWield && spec.weaponTypes.oneHand.includes(type));
			return spec.weaponSetup !== 'twoHand' && spec.weaponTypes.oneHand.includes(type);
		}
		if (item.slot === 'ranged') return spec.rangedTypes.includes(item.rangedType ?? '');
		return true;
	};
	// One piece per slot, the highest item level the build can wear. Sets that only PvP ranks sell are left out.
	const sets = new Map();
	for (const item of items) {
		if (!item.setId || (item.ilvl ?? 0) < 50 || !usable(item) || !dbItem.has(item.id)) continue;
		if (item.sources?.length && item.sources.every(s => s.kind === 'pvp')) continue;
		const set = sets.get(item.setId) ?? sets.set(item.setId, { name: item.setName, bySlot: new Map() }).get(item.setId);
		let slot = SLOT_OF[item.slot];
		if (item.slot === 'weapon' && item.weapon?.hand === 'offHand') slot = 15;
		if ((item.slot === 'finger' || item.slot === 'trinket') && set.bySlot.has(slot) && set.bySlot.get(slot).name !== item.name) slot += 1;
		const known = set.bySlot.get(slot);
		if (!known || (item.ilvl ?? 0) > (known.ilvl ?? 0)) set.bySlot.set(slot, item);
	}

	const base = structuredClone(template);
	const gearOf = request => request.raid.parties[0].players[0].equipment.items;
	/** DPS with the set's pieces in, the first `counting` of them as set pieces and the rest as plain copies. */
	const run = (pieces, counting, iterations) => {
		const request = structuredClone(base);
		const gear = gearOf(request);
		while (gear.length < 17) gear.push({});
		const extra = [];
		pieces.forEach(([slot, item], index) => {
			const kept = gear[slot]?.enchant ? { enchant: gear[slot].enchant } : {};
			if (index < counting) gear[slot] = { id: item.id, ...kept };
			else {
				const { setName: _n, setId: _i, ...record } = dbItem.get(item.id);
				extra.push({ ...record, id: item.id + NO_SET });
				gear[slot] = { id: item.id + NO_SET, ...kept };
			}
			// A two-hander leaves no room for the off hand.
			if (slot === 14 && item.weapon?.hand === 'twoHand') gear[15] = {};
		});
		const out = sim.run(request, iterations, extra);
		if (out.error) throw new Error(out.error);
		return { avg: out.dps, se: out.stdev / Math.sqrt(iterations) };
	};

	const started = Date.now();
	const result = { referenceDps: null, sets: {}, measured: [] };
	try {
		result.referenceDps = Math.round(sim.run(base, SCREEN).dps * 10) / 10;
	} catch {}
	// QUICK=1: only the sets that decide a plan most often: those in the preset gear, the class's own sets
	// and its dungeon set. The sets anyone can wear (Postmaster, Devilsaur ...) are left for a full run.
	const worn = new Set(gearOf(base).map(piece => items.find(i => i.id === piece?.id)?.setId).filter(Boolean));
	const dungeonSet = { 1: 'Battlegear of Valor', 2: 'Lightforge Armor', 3: 'Beaststalker Armor', 4: 'Shadowcraft Armor', 5: 'Vestments of the Devout', 7: 'The Elements', 8: "Magister's Regalia", 9: 'Dreadmist Raiment', 11: 'Wildheart Raiment' }[spec.classId];
	for (const [setId, set] of sets) {
		const pieces = [...set.bySlot].sort((a, b) => a[0] - b[0]);
		if (pieces.length < 2) continue;
		if (process.env.QUICK && !worn.has(setId) && set.name !== dungeonSet && !pieces.some(([, item]) => item.classes)) continue;
		try {
			const none = run(pieces, 0, SCREEN);
			const all = run(pieces, pieces.length, SCREEN);
			result.measured.push(setId);
			if (none.avg === all.avg) continue; // the bonuses do nothing for this build
			const zero = run(pieces, 0, FINAL);
			const byCount = {};
			let last = 0;
			let before = run(pieces, 1, SCREEN);
			for (let k = 2; k <= pieces.length; k++) {
				// Same seed: a count that adds no bonus gives exactly the previous number.
				const quick = k === pieces.length ? all : run(pieces, k, SCREEN);
				const same = quick.avg === before.avg;
				before = quick;
				if (same) {
					if (last) byCount[k] = last;
					continue;
				}
				const full = run(pieces, k, FINAL);
				const dps = full.avg - zero.avg;
				last = Math.abs(dps) > 2 * Math.hypot(full.se, zero.se) ? Math.round(dps * 10) / 10 : 0;
				if (last) byCount[k] = last;
			}
			if (Object.keys(byCount).length) result.sets[setId] = { name: set.name, pieces: pieces.length, byCount };
		} catch (err) {
			log(`  ${id}: ${set.name} failed: ${String(err.message).slice(0, 160)}`);
		}
	}
	writeFileSync(file, JSON.stringify(result));
	log(`DONE ${id}: ${result.measured.length} sets tried, ${Object.keys(result.sets).length} with a bonus worth something, ${Math.round((Date.now() - started) / 1000)} s`, JSON.stringify(Object.fromEntries(Object.entries(result.sets).map(([, s]) => [s.name, s.byCount]))));
}
process.exit(0);
