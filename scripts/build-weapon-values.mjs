#!/usr/bin/env node
// Measures what each weapon is worth as a whole, per hand, with the real WoWSims simulator, for the
// builds that hit with their weapons. Writes src/data/weaponValues/<build>.json.
//
// Why: for melee, "weapon DPS times a weight" is not enough. Instant attacks hit with the weapon's
// damage, so a slow main hand beats a fast one of the same DPS; talents favour one weapon type; an
// off hand counts differently from a main hand. The simulator knows all of that, so every weapon
// goes into the build's preset gear once per hand it can be held in, and the DPS difference to the
// preset's own weapon is stored. The planner then uses that number for the weapon instead of its
// stats, its DPS and its proc.
//
//   node scripts/build-weapon-values.mjs --spec rogue-combat-ss
//   node scripts/build-weapon-values.mjs --spec rogue-combat-ss --if-changed   skip if nothing it depends on changed
//   node scripts/build-weapon-values.mjs --spec rogue-combat-ss --only 12590,11684   just these item ids
//   node scripts/build-weapon-values.mjs --threads 4
//
// Which builds: those whose stat weights value main-hand DPS (melee hands are measured) or ranged DPS
// (the ranged slot is measured). Casters and healers hold weapons for their stats only; the stat
// score is right for them and this script does nothing.
// Which weapons: everything the build can hold from required level 45 or item level 50 up. Lower
// ones keep the stat estimate.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { gunzipSync } from 'node:zlib';

import { fitImbues } from './fit-imbues.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIM_DIR = join(ROOT, 'public', 'sim');
// Every weapon is run on the same random seed, so two weapons differ by far less than one run's own noise.
const ITERATIONS = Number(process.env.ITERATIONS ?? 2500);
const MAIN_HAND = 14;
const OFF_HAND = 15;
const RANGED = 16;
const MIN_REQUIRED_LEVEL = 45;
const MIN_ITEM_LEVEL = 50;

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));

// ---------------------------------------------------------------- worker: runs sims

if (!isMainThread) {
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
	const itemById = new Map(db.items.map(i => [i.id, i]));

	/** DPS of `gear` (17 pieces, each { id } or null). */
	const dps = gear => {
		const request = structuredClone(template);
		const player = request.raid.parties[0].players[0];
		player.equipment = { items: gear.map(piece => (piece?.id ? { id: piece.id } : {})) };
		// The preset's stone was picked for the preset's weapon: every candidate gets the stone that goes on it.
		player.consumables = fitImbues(template.raid.parties[0].players[0].consumables, itemById.get(gear[MAIN_HAND]?.id), itemById.get(gear[MAIN_HAND + 1]?.id), db.consumables);
		// The preset's swap set stays as it is; its items need their records too.
		const worn = [...gear, ...(player.itemSwap?.items ?? [])].filter(piece => piece?.id);
		const records = [...new Set(worn.map(piece => piece.id))].map(id => {
			const record = itemById.get(id);
			if (!record) throw new Error(`item ${id} is not in public/sim/db.json`);
			return record;
		});
		const ilvls = new Set(records.map(i => i.scalingOptions?.['0']?.ilvl));
		const swapEnchants = new Set((player.itemSwap?.items ?? []).map(piece => piece?.enchant).filter(Boolean));
		const swapSuffixes = new Set((player.itemSwap?.items ?? []).map(piece => piece?.randomSuffix).filter(Boolean));
		player.database = {
			items: records,
			enchants: db.enchants.filter(e => swapEnchants.has(e.effectId)),
			randomSuffixes: (db.randomSuffixes ?? []).filter(suffix => swapSuffixes.has(suffix.id)),
			itemEffectRandPropPoints: db.itemEffectRandPropPoints.filter(r => ilvls.has(r.ilvl)),
			consumables: db.consumables,
			spellEffects: db.spellEffects,
		};
		request.simOptions = { iterations: ITERATIONS, randomSeed: '1' };
		const out = globalThis.raidSimJson(JSON.stringify(request));
		if (!out) throw new Error('the sim rejected the request');
		const result = JSON.parse(out);
		const failure = result.error ?? result.errorResult;
		if (failure && (typeof failure !== 'object' || Object.keys(failure).length)) throw new Error(JSON.stringify(failure).slice(0, 300));
		return result.raidMetrics.dps.avg;
	};

	parentPort.on('message', task => {
		try {
			parentPort.postMessage({ task, dps: dps(task.gear) });
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
	const specId = arg('--spec');
	if (!specId) {
		console.error('Usage: node scripts/build-weapon-values.mjs --spec <build id> [--if-changed] [--only id,id] [--threads n]');
		process.exit(2);
	}

	const spec = readJson(join(ROOT, 'src', 'specs', `${specId}.json`));
	const outFile = join(ROOT, 'src', 'data', 'weaponValues', `${specId}.json`);
	const hands = (spec.weights.mainHandDps ?? 0) > 0 && spec.role !== 'healer';
	const ranged = (spec.weights.rangedDps ?? 0) > 0;
	if (!hands && !ranged) {
		console.log(`${specId}: holds weapons for their stats only; nothing to measure.`);
		process.exit(0);
	}

	const templateFile = join(SIM_DIR, `template.${specId}.json`);
	const itemsFile = join(ROOT, 'src', 'data', 'items.json');
	const loaded = readJson(itemsFile);
	const items = Array.isArray(loaded) ? loaded : loaded.items;
	// What cannot be had yet or has no trustworthy value is not offered (src/lib/scoring.ts), so it is not measured.
	const closedConfig = readJson(join(ROOT, 'src', 'config', 'not-available.json'));
	const unknownProcsFile = join(ROOT, 'src', 'data', 'unknownProcs.json');
	const unknownProcs = existsSync(unknownProcsFile) ? readJson(unknownProcsFile) : {};
	const closedIconWords = Object.keys(closedConfig.iconWords ?? {});
	const closed = item => {
		if (closedConfig.items?.[item.id] || unknownProcs[item.id]) return true;
		if (item.tag && closedConfig.tags?.[item.tag]) return true;
		if (item.icon && closedIconWords.some(word => item.icon.includes(word))) return true;
		const sources = item.sources ?? [];
		return sources.length > 0 && sources.every(source => closedConfig.npcs?.[source.npcId] || (source.kind === 'drop' && closedConfig.zones?.[source.zoneId]));
	};
	const usableWeapons = items.filter(item => {
		if (item.classes && !item.classes.includes(spec.classId)) return false;
		if (item.unreleased || closed(item)) return false;
		if ((item.reqLvl ?? 0) < MIN_REQUIRED_LEVEL && (item.ilvl ?? 0) < MIN_ITEM_LEVEL) return false;
		if (item.slot === 'ranged') return ranged && spec.rangedTypes.includes(item.rangedType ?? '');
		if (item.slot !== 'weapon' || !hands) return false;
		const { type, hand } = item.weapon ?? {};
		if (hand === 'twoHand') return spec.weaponTypes.twoHand.includes(type);
		if (hand === 'offHand') return spec.weaponTypes.offHand.includes(type) || (spec.canDualWield && spec.weaponTypes.oneHand.includes(type));
		return spec.weaponTypes.oneHand.includes(type);
	});

	// Everything a measurement depends on. Unchanged inputs mean the stored values still hold.
	const hash = createHash('sha256');
	for (const file of [join(SIM_DIR, 'lib.wasm.gz'), join(SIM_DIR, 'db.json'), templateFile, fileURLToPath(import.meta.url)]) hash.update(readFileSync(file));
	hash.update(JSON.stringify([spec.weaponSetup, spec.canDualWield, spec.weaponNeeds ?? null, usableWeapons.map(item => item.id)]));
	const inputs = hash.digest('hex').slice(0, 16);
	if (args.includes('--status')) {
		const stored = existsSync(outFile) ? readJson(outFile) : null;
		console.log(JSON.stringify({ at: stored?.generatedAt?.slice(0, 10) ?? null, current: stored?.inputs === inputs }));
		process.exit(0);
	}
	if (args.includes('--if-changed') && existsSync(outFile) && readJson(outFile).inputs === inputs) {
		console.log(`${specId}: simulator, item database, preset, weapon list and script are unchanged since the last measurement. Nothing to do.`);
		process.exit(0);
	}

	const template = readJson(templateFile);
	const byId = new Map(items.map(item => [item.id, item]));
	// The reference gear: the sim maintainers' default set, without enchants so they do not blur the picture.
	const reference = template.raid.parties[0].players[0].equipment.items.map(piece => (piece?.id ? { id: piece.id } : null));
	while (reference.length < 17) reference.push(null);
	const refHand = byId.get(reference[MAIN_HAND]?.id)?.weapon?.hand;
	const needs = (slot, item) => {
		const types = slot === OFF_HAND ? spec.weaponNeeds?.offHand : spec.weaponNeeds?.mainHand;
		return !types || types.includes(item.weapon?.type ?? '');
	};
	// The same rules as fitsSlot in src/lib/scoring.ts.
	const fitsMainHand = item => {
		const hand = item.weapon?.hand;
		if (!needs(MAIN_HAND, item)) return false;
		if (spec.weaponSetup === 'twoHand') return hand === 'twoHand';
		return hand === 'mainHand' || hand === 'oneHand' || (spec.weaponSetup === 'either' && hand === 'twoHand');
	};
	const fitsOffHand = item => {
		const hand = item.weapon?.hand;
		if (spec.weaponSetup === 'twoHand' || !needs(OFF_HAND, item)) return false;
		return hand === 'offHand' || (spec.canDualWield && hand === 'oneHand');
	};

	const tasks = [{ kind: 'reference', gear: reference }];
	// What an empty off hand costs next to a one-handed main hand.
	if (hands && reference[OFF_HAND] && refHand !== 'twoHand') tasks.push({ kind: 'emptyOffHand', gear: reference.map((piece, i) => (i === OFF_HAND ? null : piece)) });
	for (const item of usableWeapons) {
		if (only && !only.includes(item.id)) continue;
		if (item.slot === 'ranged') {
			if (item.id !== reference[RANGED]?.id) tasks.push({ kind: 'ranged', id: item.id, gear: reference.map((piece, i) => (i === RANGED ? { id: item.id } : piece)) });
			continue;
		}
		if (fitsMainHand(item) && item.id !== reference[MAIN_HAND]?.id) {
			// A two-hander leaves no room for the preset's off hand.
			const twoHand = item.weapon.hand === 'twoHand';
			tasks.push({ kind: 'mainHand', id: item.id, gear: reference.map((piece, i) => (i === MAIN_HAND ? { id: item.id } : twoHand && i === OFF_HAND ? null : piece)) });
		}
		// An off hand is measured next to the preset's main hand, which has to be one-handed for that.
		if (fitsOffHand(item) && refHand !== 'twoHand' && reference[MAIN_HAND] && item.id !== reference[OFF_HAND]?.id) {
			tasks.push({ kind: 'offHand', id: item.id, gear: reference.map((piece, i) => (i === OFF_HAND ? { id: item.id } : piece)) });
		}
	}

	console.log(`${specId}: ${tasks.length} simulations of ${ITERATIONS} fights on ${threads} thread(s).`);
	const started = Date.now();
	const results = [];
	let next = 0;
	let done = 0;
	await new Promise(finish => {
		let running = threads;
		for (let t = 0; t < threads; t++) {
			const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { templateFile } });
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
					if (message.error && message.task.kind === 'reference') console.error(`  the reference run failed: ${message.error}`);
					if (done % 25 === 0 || done === tasks.length) console.log(`  ${done}/${tasks.length} after ${Math.round((Date.now() - started) / 60000)} min`);
				}
				feed();
			});
			worker.on('error', err => {
				console.error(err);
				process.exit(1);
			});
		}
	});

	const referenceDps = results.find(r => r.task.kind === 'reference')?.dps;
	if (typeof referenceDps !== 'number') throw new Error('The reference run failed.');
	const round = value => Math.round(value * 100) / 100;
	const previous = only && existsSync(outFile) ? readJson(outFile) : null;
	const out = {
		generatedAt: new Date().toISOString(),
		inputs: only ? (previous?.inputs ?? 'partial') : inputs,
		note: "What each weapon is worth as a whole for this build, in DPS against the weapon the build's preset holds in that hand (which is 0), measured with the WoWSims simulator in the preset gear. It covers the weapon's damage, speed, stats and proc. A two-hander is measured without an off hand.",
		iterations: ITERATIONS,
		reference: { dps: round(referenceDps), mainHand: reference[MAIN_HAND]?.id, offHand: reference[OFF_HAND]?.id, ranged: reference[RANGED]?.id },
		...(previous?.emptyOffHand !== undefined ? { emptyOffHand: previous.emptyOffHand } : {}),
		weapons: previous?.weapons ?? {},
		failed: [],
	};
	for (const { task, dps, error } of results.sort((a, b) => (a.task.id ?? 0) - (b.task.id ?? 0))) {
		if (task.kind === 'reference') continue;
		if (error || typeof dps !== 'number') {
			// A weapon the sim will not put next to the preset's other hand (a unique pair, for one) keeps the stat estimate.
			if (task.id) out.failed.push({ id: task.id, hand: task.kind, error: String(error).slice(0, 120) });
			continue;
		}
		if (task.kind === 'emptyOffHand') {
			out.emptyOffHand = round(dps - referenceDps);
			continue;
		}
		const entry = (out.weapons[task.id] ??= { name: byId.get(task.id)?.name });
		entry[task.kind] = round(dps - referenceDps);
	}
	mkdirSync(dirname(outFile), { recursive: true });
	writeFileSync(outFile, JSON.stringify(out, null, '\t') + '\n');
	console.log(`${specId}: ${Object.keys(out.weapons).length} weapons measured, ${out.failed.length} could not be simulated. ${Math.round((Date.now() - started) / 60000)} min.`);
	process.exit(0);
}
