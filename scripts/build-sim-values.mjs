#!/usr/bin/env node
// Measures, with the real WoWSims simulator, what the stat score cannot see:
// procs and on-use effects of items, proc enchants, and set bonuses.
// Writes src/data/simValues/<build>.json, one file per build. Slow (20 to 90 minutes per build on
// four cores), so it runs in GitHub Actions (.github/workflows/measure.yml) whenever the simulator,
// its item database or a build's preset changed.
//
//   npm run build-sim-values -- --spec mage-fire          one build
//   npm run build-sim-values -- --spec mage-fire --if-changed   skip if nothing it depends on changed
//   npm run build-sim-values -- --spec mage-fire --only 13965,22321   just these item ids (for a quick check)
//   npm run build-sim-values -- --threads 4
//
// Values are in DPS. A healing build is measured in HPS, in its default healing fight, on the request
// that scripts/presets/healer-measure-template.ts writes to scripts/builds/<id>.healing.json.
//
// How a value is measured: the item goes into the WoWSims default gear set, once as it is and
// once with its effects removed from the item record. The DPS difference is the effect's worth.
// Both runs use the same random seed, so an effect that does nothing gives exactly zero.
// DPS is converted to attack-power equivalents with a run that adds plain attack power.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { gunzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIM_DIR = join(ROOT, 'public', 'sim');
// The first look only has to tell "does something" from "does nothing": both runs share a seed, so an effect that
// never triggers gives exactly the same number however short the run is.
const SCREEN_ITERATIONS = 300;
const FINAL_ITERATIONS = 2400;
/** Items below this item level are left out unless they are trinkets: no level 60 plan holds them. */
const LOWEST_ITEM_LEVEL = 40;
/** Sets whose best piece is below this item level are left out. */
const LOWEST_SET_LEVEL = 45;
const AP_INDEX = 14; // Stat enum: attack power
const AP_PROBE = 300;
const MAIN_HAND = 14;
const OFF_HAND = 15;
const SLOT_OF_KIND = { head: 0, neck: 1, shoulder: 2, back: 3, chest: 4, wrist: 5, hands: 6, waist: 7, legs: 8, feet: 9, finger: 10, trinket: 12, weapon: MAIN_HAND, ranged: 16 };
const SLOT_KINDS = ['head', 'neck', 'shoulder', 'back', 'chest', 'wrist', 'hands', 'waist', 'legs', 'feet', 'finger', 'finger', 'trinket', 'trinket', 'weapon', 'weapon', 'ranged'];
const ITEM_TYPE_OF_KIND = { head: 1, neck: 2, shoulder: 3, back: 4, chest: 5, wrist: 6, hands: 7, waist: 8, legs: 9, feet: 10, finger: 11, trinket: 12, weapon: 13, ranged: 14 };

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));

// ---------------------------------------------------------------- worker: runs sims

async function startSim() {
	const require = createRequire(import.meta.url);
	require(join(SIM_DIR, 'wasm_exec.js'));
	const ready = new Promise(resolveReady => (globalThis.wasmready = resolveReady));
	console.log = () => {}; // the sim logs every request
	const go = new globalThis.Go();
	const { instance } = await WebAssembly.instantiate(gunzipSync(readFileSync(join(SIM_DIR, 'lib.wasm.gz'))), go.importObject);
	go.run(instance);
	await ready;

	const db = readJson(join(SIM_DIR, 'db.json'));
	const template = readJson(workerData.templateFile);
	const metric = workerData.healing ? 'hps' : 'dps';
	const itemById = new Map(db.items.map(i => [i.id, i]));
	const enchantsById = new Map();
	for (const e of db.enchants) (enchantsById.get(e.effectId) ?? enchantsById.set(e.effectId, []).get(e.effectId)).push(e);

	// The sim keeps the first record it sees for an item id, for as long as it runs. A stripped
	// variant therefore needs an id of its own; these offsets are far above any real id.
	const NO_EFFECTS = 10_000_000;
	const NO_SET = 20_000_000;

	/**
	 * DPS of `gear` (17 pieces). `strip` removes what a record contributes beyond its stats:
	 * { effects: Set<itemId>, sets: Set<itemId>, enchants: Set<effectId> }. `bonusAp` adds attack power.
	 */
	return function dps(gear, iterations, strip = {}, bonusAp = 0) {
		const request = structuredClone(template);
		const player = request.raid.parties[0].players[0];
		if (bonusAp) {
			player.bonusStats ??= { stats: [] };
			player.bonusStats.stats = Array.from({ length: 39 }, (_, i) => (i === AP_INDEX ? bonusAp : (player.bonusStats.stats?.[i] ?? 0)));
		}
		const records = new Map();
		const enchantRecords = new Map();
		const register = piece => {
			if (!piece?.id) return {};
			let record = itemById.get(piece.id);
			if (!record) throw new Error(`item ${piece.id} is not in public/sim/db.json`);
			let id = piece.id;
			if (strip.effects?.has(piece.id)) {
				const { itemEffects: _e, pseudoStats: _p, ...rest } = record;
				record = rest;
				id += NO_EFFECTS;
			}
			if (strip.sets?.has(piece.id)) {
				const { setName: _n, setId: _i, ...rest } = record;
				record = rest;
				id += NO_SET;
			}
			records.set(id, { ...record, id });
			const out = { id };
			if (piece.enchant) {
				let effectId = piece.enchant;
				let variants = enchantsById.get(effectId) ?? [];
				if (strip.enchants?.has(effectId)) {
					effectId += NO_EFFECTS;
					variants = variants.map(({ enchantEffects: _e, pseudoStats: _p, procKind: _k, weaponDamage: _w, ...rest }) => ({ ...rest, effectId }));
				}
				enchantRecords.set(effectId, variants);
				out.enchant = effectId;
			}
			return out;
		};
		player.equipment = { items: gear.map(register) };
		if (player.itemSwap?.items) player.itemSwap.items = player.itemSwap.items.map(register);
		const items = [...records.values()];
		const ilvls = new Set(items.map(i => i.scalingOptions?.['0']?.ilvl));
		player.database = {
			items,
			enchants: [...enchantRecords.values()].flat(),
			randomSuffixes: [],
			itemEffectRandPropPoints: db.itemEffectRandPropPoints.filter(r => ilvls.has(r.ilvl)),
			consumables: db.consumables,
			spellEffects: db.spellEffects,
		};
		request.simOptions = { iterations, randomSeed: '1' };
		const out = globalThis.raidSimJson(JSON.stringify(request));
		if (!out) throw new Error('the sim rejected the request');
		const result = JSON.parse(out);
		const failure = result.error ?? result.errorResult;
		if (failure && (typeof failure !== 'object' || Object.keys(failure).length)) throw new Error(JSON.stringify(failure).slice(0, 300));
		return { avg: result.raidMetrics[metric].avg, se: result.raidMetrics[metric].stdev / Math.sqrt(iterations) };
	};
}

/** Difference of two runs, screened first: an exact zero (same seed, nothing changed) needs no long run. */
function difference(run) {
	const quick = run(SCREEN_ITERATIONS);
	if (quick.with.avg === quick.without.avg) return { dps: 0, margin: 0 };
	const full = run(FINAL_ITERATIONS);
	return { dps: full.with.avg - full.without.avg, margin: Math.hypot(full.with.se, full.without.se) };
}

if (!isMainThread) {
	const dps = await startSim();
	const reference = workerData.reference;
	parentPort.on('message', task => {
		try {
			let result;
			if (task.kind === 'ap') {
				result = { referenceDps: dps(reference, 3000).avg };
			} else if (task.kind === 'item') {
				const gear = reference.map((p, i) => (i === task.slotIndex ? { id: task.id } : i === task.clear ? null : p));
				result = difference(n => ({ with: dps(gear, n), without: dps(gear, n, { effects: new Set([task.id]) }) }));
			} else if (task.kind === 'enchant') {
				const gear = reference.map((p, i) => (i === task.slotIndex && p ? { id: p.id, enchant: task.effectId } : p));
				result = difference(n => ({ with: dps(gear, n), without: dps(gear, n, { enchants: new Set([task.effectId]) }) }));
			} else if (task.kind === 'set') {
				// All pieces equipped; count k means the first k pieces still belong to the set.
				const gear = [...reference];
				for (const piece of task.pieces) gear[piece.slotIndex] = { id: piece.id };
				const ids = task.pieces.map(p => p.id);
				const stripped = k => ({ sets: new Set(ids.slice(k)) });
				// The run with no piece in the set is the same for every count: do it once per length.
				const none = new Map();
				const without = n => none.get(n) ?? none.set(n, dps(gear, n, stripped(0))).get(n);
				const byCount = {};
				let previous = 0;
				// A bonus starts at some piece counts only. A short run per count shows where the number moves (same
				// seed: no new bonus, same number); only those counts get the long run, the others repeat the one before.
				let screened = without(SCREEN_ITERATIONS).avg;
				let last = { dps: 0, margin: 0 };
				for (let k = 2; k <= ids.length; k++) {
					const look = dps(gear, SCREEN_ITERATIONS, stripped(k)).avg;
					if (look !== screened) {
						screened = look;
						const full = { with: dps(gear, FINAL_ITERATIONS, stripped(k)), without: without(FINAL_ITERATIONS) };
						last = { dps: full.with.avg - full.without.avg, margin: Math.hypot(full.with.se, full.without.se) };
					}
					// Bonuses only ever add up; a dip is noise.
					previous = Math.max(previous, last.dps);
					byCount[k] = { dps: previous, margin: last.margin };
				}
				result = { byCount };
			}
			parentPort.postMessage({ task, result });
		} catch (err) {
			parentPort.postMessage({ task, error: String(err.message ?? err) });
		}
	});
	parentPort.postMessage({ ready: true });
}

// ---------------------------------------------------------------- main: plans the work

if (isMainThread) {
	const args = process.argv.slice(2);
	const arg = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
	const only = arg('--only')?.split(',').map(Number);
	const threads = Number(arg('--threads') ?? Math.max(1, availableParallelism()));
	const specId = arg('--spec') ?? 'enhancement-shaman';

	const spec = readJson(join(ROOT, 'src', 'specs', `${specId}.json`));
	const items = readJson(join(ROOT, 'src', 'data', 'items.json'));
	const enchants = readJson(join(ROOT, 'src', 'data', 'enchants.json'));
	const simDb = readJson(join(SIM_DIR, 'db.json'));
	const outFile = join(ROOT, 'src', 'data', 'simValues', `${specId}.json`);
	// A healer is measured in healing per second, on its preset with the default healing fight set up
	// (scripts/presets/healer-measure-template.ts writes that file).
	const healing = spec.role === 'healer';
	const templateFile = healing ? join(ROOT, 'scripts', 'builds', `${specId}.healing.json`) : join(SIM_DIR, `template.${specId}.json`);
	// Everything a measurement depends on. Unchanged inputs mean the stored values still hold.
	const inputs = createHash('sha256');
	for (const file of [join(SIM_DIR, 'lib.wasm.gz'), join(SIM_DIR, 'db.json'), templateFile, fileURLToPath(import.meta.url)]) inputs.update(readFileSync(file));
	const inputsHash = inputs.digest('hex').slice(0, 16);
	// --status: is the stored measurement the one for today's simulator, item data and preset? (scripts/measurement-status.mjs)
	if (args.includes('--status')) {
		const stored = existsSync(outFile) ? readJson(outFile) : null;
		console.log(JSON.stringify({ at: stored?.generatedAt?.slice(0, 10) ?? null, current: stored?.inputs === inputsHash }));
		process.exit(0);
	}
	if (args.includes('--if-changed') && existsSync(outFile) && readJson(outFile).inputs === inputsHash) {
		console.log(`${specId}: simulator, item database, preset and script are unchanged since the last measurement. Nothing to do.`);
		process.exit(0);
	}
	const template = readJson(templateFile);
	const rawById = new Map(simDb.items.map(i => [i.id, i]));
	// The reference gear: the sim maintainers' default set, without enchants so they do not blur the picture.
	const reference = template.raid.parties[0].players[0].equipment.items.map(p => (p?.id ? { id: p.id } : null));

	const planItem = new Map(items.map(i => [i.id, i]));
	const twoHandReference = planItem.get(reference[MAIN_HAND]?.id)?.weapon?.hand === 'twoHand';
	const fitsMainHand = item => (spec.weaponSetup === 'twoHand' ? item.weapon?.hand === 'twoHand' : spec.weaponSetup === 'oneHand' ? item.weapon?.hand !== 'offHand' && item.weapon?.hand !== 'twoHand' : item.weapon?.hand !== 'offHand');
	const ARMOR = new Set(['head', 'shoulder', 'chest', 'wrist', 'hands', 'waist', 'legs', 'feet']);
	/** What the build can wear, as in src/lib/specs.ts. */
	const usable = item => {
		if (item.classes && !item.classes.includes(spec.classId)) return false;
		if (ARMOR.has(item.slot)) return !item.armorType || spec.armorTypes.includes(item.armorType);
		if (item.slot === 'weapon') {
			const { type, hand } = item.weapon ?? {};
			if (hand === 'twoHand') return spec.weaponTypes.twoHand.includes(type);
			if (hand === 'offHand') return spec.weaponTypes.offHand.includes(type) || (spec.canDualWield && spec.weaponTypes.oneHand.includes(type));
			return spec.weaponTypes.oneHand.includes(type);
		}
		if (item.slot === 'ranged') return spec.rangedTypes.includes(item.rangedType ?? '');
		return true;
	};
	// What cannot be had in the game yet, or has no trustworthy value, is not measured: it is not offered either
	// (src/lib/scoring.ts, notYetAvailable). When it opens up, the next run picks it up.
	const closedConfig = readJson(join(ROOT, 'src', 'config', 'not-available.json'));
	const unknownProcs = existsSync(join(ROOT, 'src', 'data', 'unknownProcs.json')) ? readJson(join(ROOT, 'src', 'data', 'unknownProcs.json')) : {};
	const closedIconWords = Object.keys(closedConfig.iconWords ?? {});
	const closed = item => {
		if (closedConfig.items?.[item.id] || unknownProcs[item.id] || item.unreleased) return true;
		if (item.tag && closedConfig.tags?.[item.tag]) return true;
		if (item.icon && closedIconWords.some(word => item.icon.includes(word))) return true;
		const sources = item.sources ?? [];
		return sources.length > 0 && sources.every(source => closedConfig.npcs?.[source.npcId] || (source.kind === 'drop' && closedConfig.zones?.[source.zoneId]));
	};
	const tooLow = item => (item.ilvl ?? 0) < LOWEST_ITEM_LEVEL && item.slot !== 'trinket';
	const tasks = [{ kind: 'ap' }];

	// Items whose record has effects or special stats.
	for (const item of items) {
		const raw = rawById.get(item.id);
		const hasEffect = raw?.itemEffects?.length || raw?.pseudoStats?.some(Boolean);
		// Every item with an effect that the build can wear and get, from item level 40 on (trinkets at any level).
		if (!hasEffect || !usable(item)) continue;
		if (only && !only.includes(item.id)) continue;
		if (!only && (closed(item) || tooLow(item))) continue;
		const hand = item.slot === 'weapon' ? item.weapon?.hand : undefined;
		if (hand === 'offHand') {
			// Shields, held items and off-hand weapons go next to the preset's main hand, unless that is a two-hander.
			if (twoHandReference || (spec.weaponNeeds?.offHand && !spec.weaponNeeds.offHand.includes(item.weapon?.type))) continue;
			tasks.push({ kind: 'item', id: item.id, name: item.name, slotIndex: OFF_HAND });
			continue;
		}
		if (item.slot === 'weapon' && (!fitsMainHand(item) || (spec.weaponNeeds?.mainHand && !spec.weaponNeeds.mainHand.includes(item.weapon?.type)))) continue;
		// A two-hander leaves no room for the preset's off hand.
		tasks.push({ kind: 'item', id: item.id, name: item.name, slotIndex: SLOT_OF_KIND[item.slot], ...(hand === 'twoHand' ? { clear: OFF_HAND } : {}) });
	}

	if (!only) {
		// Enchants that are a proc or effect, each on the slot it belongs to.
		const seen = new Set();
		for (const enchant of enchants) {
			if (!enchant.hasEffect || seen.has(enchant.effectId) || (enchant.classes && !enchant.classes.includes(spec.classId))) continue;
			if (enchant.only === 'shield' || enchant.only === 'offHand') continue;
			const slotIndex = SLOT_KINDS.findIndex((kind, i) => enchant.slots.includes(kind) && reference[i] && (kind !== 'weapon' || i === MAIN_HAND));
			if (slotIndex < 0) continue;
			seen.add(enchant.effectId);
			tasks.push({ kind: 'enchant', effectId: enchant.effectId, name: enchant.name, slotIndex });
		}

		// Sets: every set the build can wear two pieces of, PvP sets and low-level ones included. One piece per slot, the highest item level variant.
		const sets = new Map();
		for (const item of items) {
			if (!item.setId || !usable(item) || closed(item)) continue;
			if (item.slot === 'weapon' && !fitsMainHand(item)) continue;
			const set = sets.get(item.setId) ?? sets.set(item.setId, { name: item.setName, bySlot: new Map() }).get(item.setId);
			const slotIndex = item.slot === 'finger' && set.bySlot.has(10) && set.bySlot.get(10).name !== item.name ? 11 : SLOT_OF_KIND[item.slot];
			const known = set.bySlot.get(slotIndex);
			if (!known || (item.ilvl ?? 0) > (known.ilvl ?? 0)) set.bySlot.set(slotIndex, item);
		}
		for (const [setId, set] of sets) {
			if (set.bySlot.size < 2 || Math.max(...[...set.bySlot.values()].map(item => item.ilvl ?? 0)) < LOWEST_SET_LEVEL) continue;
			tasks.push({ kind: 'set', setId, name: set.name, pieces: [...set.bySlot].map(([slotIndex, item]) => ({ slotIndex, id: item.id })) });
		}
	}

	if (args.includes('--plan')) {
		const count = kind => tasks.filter(task => task.kind === kind).length;
		console.log(`${specId}: ${count('item')} items, ${count('enchant')} enchants, ${count('set')} sets to measure.`);
		process.exit(0);
	}
	console.log(`${tasks.length} measurements on ${threads} thread(s). Reference: the ${spec.simBuilds?.[0]?.title ?? 'default set'}.`);
	const started = Date.now();
	const results = [];
	let next = 0;
	let done = 0;

	await new Promise(finish => {
		let running = threads;
		for (let t = 0; t < threads; t++) {
			const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { reference, templateFile, healing } });
			const feed = () => {
				if (next < tasks.length) worker.postMessage(tasks[next++]);
				else {
					worker.terminate();
					if (--running === 0) finish();
				}
			};
			worker.on('message', message => {
				if (!message.ready) {
					results.push(message);
					done++;
					if (message.error) console.warn(`  failed: ${message.task.kind} ${message.task.name ?? ''}: ${message.error}`);
					if (done % 20 === 0 || done === tasks.length) console.log(`  ${done}/${tasks.length} after ${Math.round((Date.now() - started) / 60000)} min`);
				}
				feed();
			});
			worker.on('error', err => {
				console.error(err);
				process.exit(1);
			});
		}
	});

	const ap = results.find(r => r.task.kind === 'ap')?.result;
	if (!ap?.referenceDps) throw new Error('The reference run failed.');
	// Keep a value only when it clearly stands out from the noise of its two runs.
	const clear = d => d.dps !== 0 && Math.abs(d.dps) > 2 * d.margin;
	const round = v => Math.round(v * 100) / 100;

	const out = {
		generatedAt: new Date().toISOString(),
		spec: spec.id,
		inputs: inputsHash,
		unit: healing ? 'HPS' : 'DPS',
		note: "Worth of item effects, proc enchants and set bonuses for this build, in DPS (HPS for a healer, in its default healing fight), measured with the WoWSims simulator in the build's preset gear. Values within the noise of the measurement are left out.",
		reference: { dps: round(ap.referenceDps), iterations: FINAL_ITERATIONS },
		items: {},
		enchants: {},
		sets: {},
		measured: { items: [], enchants: [], sets: [] },
	};
	for (const { task, result, error } of results.sort((a, b) => (a.task.id ?? a.task.effectId ?? a.task.setId ?? 0) - (b.task.id ?? b.task.effectId ?? b.task.setId ?? 0))) {
		if (error || !result) continue;
		if (task.kind === 'item') {
			out.measured.items.push(task.id);
			if (clear(result)) out.items[task.id] = { name: task.name, dps: round(result.dps) };
		} else if (task.kind === 'enchant') {
			out.measured.enchants.push(task.effectId);
			if (clear(result)) out.enchants[task.effectId] = { name: task.name, dps: round(result.dps) };
		} else if (task.kind === 'set') {
			out.measured.sets.push(task.setId);
			const byCount = {};
			for (const [count, d] of Object.entries(result.byCount)) if (clear(d)) byCount[count] = { dps: round(d.dps) };
			if (Object.keys(byCount).length) out.sets[task.setId] = { name: task.name, pieces: task.pieces.length, byCount };
		}
	}

	if (only) {
		for (const r of results) if (r.task.kind === 'item') console.log(r.task.name, r.error ?? `${r.result.dps.toFixed(2)} DPS, margin ${r.result.margin.toFixed(2)}`);
		console.log(JSON.stringify({ reference: out.reference, items: out.items }, null, 2));
	} else {
		mkdirSync(dirname(outFile), { recursive: true });
		writeFileSync(outFile, JSON.stringify(out) + '\n');
		console.log(`Wrote src/data/simValues/${specId}.json: ${Object.keys(out.items).length} items, ${Object.keys(out.enchants).length} enchants, ${Object.keys(out.sets).length} sets with a measurable effect.`);
	}
	console.log(`Done in ${Math.round((Date.now() - started) / 60000)} min. Reference: ${out.reference.dps} DPS.`);
}
