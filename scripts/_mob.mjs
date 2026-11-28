#!/usr/bin/env node
// Measures a damage build's stat weights with the WoWSims simulator and writes
// src/data/weights/<build>.json. The planner uses that file instead of the weights in
// src/specs/<build>.json, unless the file is marked "held".
//
//   node scripts/build-weights.mjs --spec mage-fire
//   node scripts/build-weights.mjs --spec mage-fire --if-changed   skip if simulator, item database, preset and script are unchanged
//   node scripts/build-weights.mjs --spec mage-fire --accept       apply even a large change
//
// How: the build's preset (public/sim/template.<build>.json) is simulated once as it is and once
// per stat with a little of that stat added (expertise: taken away, since the preset sits at the
// cap; hit: four runs around the preset, to find its worth below and past the cap and the cap itself). All runs share one random seed, so the difference is the stat and not luck.
// A weight is the stat's DPS per point divided by the DPS per point of the build's unit stat
// (attack power, spell damage or, for Hunters, agility); "dpsPerPoint" is that unit's worth.
//
// The guard: a measurement that moves a weight far from the one in use (see FAR) is not applied.
// The file is then written with "held": true and the reasons, and .github/workflows/weights.yml
// opens an issue. A person looks at it and runs the workflow again with "accept".
//
// Healing builds are not measured here: their weights come from scripts/presets/healer-weights.ts.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIM_DIR = join(ROOT, 'public', 'sim');
const ITERATIONS = Number(process.env.ITERATIONS ?? 8000);
/** A weight that matters (at least MATTERS points) and moved by more than this share is held back. */
const FAR = 0.4;
const MATTERS = 0.3;

/** Stat enum index in the simulator, and how much of the stat a run adds. */
const STATS = {
	strength: [0, 50],
	agility: [1, 50],
	intellect: [3, 50],
	spellDamage: [5, 50],
	arcaneDamage: [6, 50],
	fireDamage: [7, 50],
	frostDamage: [8, 50],
	holyDamage: [9, 50],
	natureDamage: [10, 50],
	shadowDamage: [11, 50],
	spellPiercing: [12, 20],
	spirit: [13, 50],
	attackPower: [14, 100],
	rangedAttackPower: [15, 100],
	feralAttackPower: [16, 100],
	hitRating: [17, -20],
	critRating: [18, 28],
	hasteRating: [19, 30],
	armorPenetration: [20, 100],
	expertiseRating: [21, -20],
};
const UNITS = ['attackPower', 'spellDamage', 'agility'];

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const args = process.argv.slice(2);
const specId = args[args.indexOf('--spec') + 1];
if (!args.includes('--spec') || !specId) {
	console.error('Usage: node scripts/build-weights.mjs --spec <build id> [--if-changed] [--accept]');
	process.exit(2);
}
const spec = readJson(join(ROOT, 'src', 'specs', `${specId}.json`));
const outFile = join(ROOT, 'src', 'data', 'weights', `${specId}.json`);
if (spec.role === 'healer') {
	console.log(`${specId}: a healing build; its weights come from scripts/presets/healer-weights.ts.`);
	process.exit(0);
}
const templateFile = join(SIM_DIR, `template.${specId}.json`);
const hash = createHash('sha256');
for (const file of [join(SIM_DIR, 'lib.wasm.gz'), join(SIM_DIR, 'db.json'), templateFile, fileURLToPath(import.meta.url)]) hash.update(readFileSync(file));
const inputs = hash.digest('hex').slice(0, 16);
const previous = existsSync(outFile) ? readJson(outFile) : null;
if (args.includes('--status')) {
	console.log(JSON.stringify({ at: previous?.measuredOn ?? null, current: previous?.inputs === inputs, held: Boolean(previous?.held) }));
	process.exit(0);
}
if (args.includes('--if-changed') && previous?.inputs === inputs && !(previous.held && args.includes('--accept'))) {
	console.log(`${specId}: simulator, item database, preset and script are unchanged since the last measurement. Nothing to do.`);
	process.exit(0);
}

const unit = UNITS.find(name => spec.weights.stats[name] === 1);
if (!unit) {
	console.error(`${specId}: none of ${UNITS.join(', ')} has weight 1 in src/specs/${specId}.json, so there is no unit to measure against.`);
	process.exit(1);
}

// ---------------------------------------------------------------- the simulator

const log = console.log;
const require = createRequire(import.meta.url);
require(join(SIM_DIR, 'wasm_exec.js'));
const ready = new Promise(resolveReady => (globalThis.wasmready = resolveReady));
console.log = () => {}; // the sim logs every request
const go = new globalThis.Go();
const { instance } = await WebAssembly.instantiate(gunzipSync(readFileSync(join(SIM_DIR, 'lib.wasm.gz'))), go.importObject);
go.run(instance);
await ready;

const template = readJson(templateFile);
// The engine has no item data of its own: every request carries the records of what is worn.
const db = readJson(join(SIM_DIR, 'db.json'));
const itemById = new Map(db.items.map(i => [i.id, i]));
const enchantsById = new Map();
for (const e of db.enchants) (enchantsById.get(e.effectId) ?? enchantsById.set(e.effectId, []).get(e.effectId)).push(e);
const worn = template.raid.parties[0].players[0];
const pieces = [...(worn.equipment?.items ?? []), ...(worn.itemSwap?.items ?? [])].filter(p => p?.id);
const wornItems = [...new Set(pieces.map(p => p.id))].map(id => itemById.get(id) ?? (() => { throw new Error(`item ${id} is not in public/sim/db.json`); })());
const ilvls = new Set(wornItems.map(i => i.scalingOptions?.['0']?.ilvl));
const database = {
	items: wornItems,
	enchants: [...new Set(pieces.map(p => p.enchant).filter(Boolean))].flatMap(id => enchantsById.get(id) ?? []),
	randomSuffixes: db.randomSuffixes ?? [],
	itemEffectRandPropPoints: db.itemEffectRandPropPoints.filter(r => ilvls.has(r.ilvl)),
	consumables: db.consumables,
	spellEffects: db.spellEffects,
};

function run(trinket, mob) {
	const request = structuredClone(template);
	const player = request.raid.parties[0].players[0];
	if (trinket) player.equipment.items[12] = { id: trinket }; else player.equipment.items[12] = {};
	const ids = [...new Set(player.equipment.items.filter(p => p?.id).map(p => p.id))].map(id => itemById.get(id));
	player.database = { ...database, items: ids, itemEffectRandPropPoints: db.itemEffectRandPropPoints };
	if (mob) for (const t of request.encounter.targets) t.mobType = 'MobType' + mob;
	request.simOptions = { iterations: ITERATIONS, randomSeed: '1' };
	const out = JSON.parse(globalThis.raidSimJson(JSON.stringify(request)));
	const failure = out.error ?? out.errorResult;
	if (failure && (typeof failure !== 'object' || Object.keys(failure).length)) return 'ERR ' + JSON.stringify(failure).slice(0, 200);
	return Math.round(out.raidMetrics.dps.avg * 10) / 10;
}
const ITEMS = (process.env.ITEMS ?? '0,22268,282778,18467').split(',').map(Number);
const MOBS = (process.env.MOBS ?? ',Dragonkin,Demon').split(',');
for (const id of ITEMS) log(id, itemById.get(id)?.name ?? 'empty', MOBS.map(m => `${m || 'none'}=${run(id, m)}`).join('  '));
process.exit(0);
