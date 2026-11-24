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
function dps(index, delta) {
	const request = structuredClone(template);
	const player = request.raid.parties[0].players[0];
	const stats = Array.from({ length: 39 }, (_, i) => player.bonusStats?.stats?.[i] ?? 0);
	if (index !== undefined) stats[index] += delta;
	player.bonusStats = { ...(player.bonusStats ?? {}), stats };
	player.database = database;
	request.simOptions = { iterations: ITERATIONS, randomSeed: '1' };
	const out = JSON.parse(globalThis.raidSimJson(JSON.stringify(request)));
	const failure = out.error ?? out.errorResult;
	if (failure && (typeof failure !== 'object' || Object.keys(failure).length)) throw new Error(JSON.stringify(failure).slice(0, 300));
	const value = out.raidMetrics?.dps?.avg;
	if (typeof value !== 'number') throw new Error('the simulator returned no DPS');
	return value;
}

/** Hit rating on the preset's gear, enchants and random suffixes, added up the way the planner does (src/lib/stats.ts). */
function hitRatingWorn() {
	const list = file => {
		const loaded = readJson(join(ROOT, 'src', 'data', file));
		return Array.isArray(loaded) ? loaded : (loaded.items ?? loaded.enchants ?? loaded.suffixes ?? []);
	};
	const itemsById = new Map(list('items.json').map(item => [item.id, item]));
	const enchantHit = new Map(list('enchants.json').map(enchant => [enchant.effectId, enchant.stats?.hitRating ?? 0]));
	const suffixes = new Map(list('randomSuffixes.json').map(suffix => [suffix.id, suffix]));
	let total = 0;
	for (const piece of template.raid.parties[0].players[0].equipment.items) {
		const item = piece?.id ? itemsById.get(piece.id) : undefined;
		if (!item) continue;
		total += item.stats?.hitRating ?? 0;
		total += enchantHit.get(piece.enchant) ?? 0;
		const share = suffixes.get(piece.randomSuffix)?.stats?.hitRating;
		if (share && item.randPropPoints) total += Math.floor((item.randPropPoints * share) / 10000);
	}
	return total;
}

// ---------------------------------------------------------------- measure

const started = Date.now();
const base = dps();
/**
 * The straight line that fits best through measured (change in the stat, change in DPS) points; its steepness is the
 * worth of one point. One step alone is not enough: a rotation reacts in jumps (a cast more or fewer per fight, a
 * dot refreshed a tick early), so a single step can land on a jump and give a worth that is far off, even negative.
 */
function slope(points) {
	const n = points.length;
	const meanX = points.reduce((sum, [x]) => sum + x, 0) / n;
	const meanY = points.reduce((sum, [, y]) => sum + y, 0) / n;
	const spread = points.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
	return points.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0) / spread;
}
const perPoint = {};
for (const name of Object.keys(spec.weights.stats)) {
	if (!STATS[name] || name === 'hitRating') continue; // hit has its own measurement below
	const [index, delta] = STATS[name];
	perPoint[name] = slope([[0, 0], ...[-delta, delta, 2 * delta].map(step => [step, dps(index, step) - base])]);
}
// Hit is not one number: below the cap a point is worth a lot, past it little or nothing. Six more
// runs find the worth on either side and where the bend is, so the planner knows the cap the
// simulator really has (it depends on the target's level and on hit from talents and race).
// The low runs sit well below the preset and the high ones well above it, because a preset is often
// a little over or under the cap: runs close to it would straddle the bend and give half a worth.
let hitCurve;
if (spec.weights.stats.hitRating !== undefined) {
	const at = delta => dps(STATS.hitRating[0], delta) - base;
	const [low2, low1, mid, high1, high2] = [at(-80), at(-60), at(-20), at(60), at(80)];
	const below = (low1 - low2) / 20;
	const above = (high2 - high1) / 20;
	perPoint.hitRating = below;
	if (below > 0 && above < 0.7 * below) {
		// Where the line through the two low points meets the line through the two high ones, in rating from the preset.
		const toCap = (high1 - 60 * above - low1 - 60 * below) / (below - above);
		if (toCap > -60 && toCap < 60) hitCurve = { below, above: Math.max(0, above), toCap };
	} else {
		// No bend in reach: the preset is far from the cap, and hit is worth the same all the way.
		perPoint.hitRating = slope([[-80, low2], [-60, low1], [-20, mid], [0, 0], [60, high1], [80, high2]]);
	}
}
const unitWorth = perPoint[unit];
if (!(unitWorth > 0)) {
	console.log = log;
	console.error(`${specId}: one point of ${unit} came out at ${unitWorth} DPS; cannot build weights on that.`);
	process.exit(1);
}
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
const stats = Object.fromEntries(Object.entries(perPoint).map(([name, value]) => [name, round(value / unitWorth, 2)]));
stats[unit] = 1;
const dpsPerPoint = round(unitWorth, 4);

// ---------------------------------------------------------------- guard

// Compared with what the planner uses now: the last applied measurement, else the build file.
const inUse = previous && !previous.held ? { hitCapPercent: spec.hitCapPercent, ...previous } : { stats: spec.weights.stats, dpsPerPoint: spec.weights.dpsPerPoint, hitCapPercent: spec.hitCapPercent };
const reasons = [];
const far = (now, before) => Math.abs(now - before) > FAR * Math.max(Math.abs(before), MATTERS);
for (const [name, now] of Object.entries(stats)) {
	const before = inUse.stats[name];
	if (before === undefined || name === unit) continue;
	if (Math.max(Math.abs(now), Math.abs(before)) >= MATTERS && far(now, before)) reasons.push(`${name}: ${before} in use, ${now} measured`);
}
if (inUse.dpsPerPoint && Math.abs(dpsPerPoint - inUse.dpsPerPoint) > FAR * inUse.dpsPerPoint) reasons.push(`DPS per point of ${unit}: ${inUse.dpsPerPoint} in use, ${dpsPerPoint} measured`);

// The cap in the planner's own terms: hit from gear, race and talents, as src/lib/stats.ts adds them.
let hitCap;
if (hitCurve) {
	const race = template.raid.parties[0].players[0].race;
	const fromRace = spec.raceBonuses?.[race]?.hitPercent ?? 0;
	const capPercent = (hitRatingWorn() + hitCurve.toCap) / spec.ratingPerPercent.hitRating + fromRace + (spec.hitBonusPercent ?? 0);
	hitCap = { hitCapPercent: round(capPercent, 1), hitRatingOverCap: round(hitCurve.above / unitWorth, 2) };
	if (inUse.hitCapPercent !== undefined && Math.abs(hitCap.hitCapPercent - inUse.hitCapPercent) > 4) reasons.push(`hit cap: ${inUse.hitCapPercent}% in use, ${hitCap.hitCapPercent}% measured`);
}

const held = reasons.length > 0 && !args.includes('--accept');

const out = {
	note: 'Stat weights of this build, measured with the WoWSims simulator on its preset by scripts/build-weights.mjs. The planner uses them instead of the weights in src/specs, unless "held" is true: then a weight moved so far that a person should look first.',
	inputs,
	measuredOn: new Date().toISOString().slice(0, 10),
	iterations: ITERATIONS,
	unit,
	referenceDps: round(base, 1),
	dpsPerPoint,
	stats,
	...(hitCap ?? {}),
	...(held ? { held: true, reasons } : {}),
	...(reasons.length > 0 && !held ? { accepted: reasons } : {}),
};
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(out, null, '\t') + '\n');
console.log = log;
console.log(`${specId}: ${round(base, 1)} DPS, 1 ${unit} = ${dpsPerPoint} DPS, ${JSON.stringify(stats)}${hitCap ? `, hit cap ${hitCap.hitCapPercent}% (was ${spec.hitCapPercent}%), past it ${hitCap.hitRatingOverCap}` : ''} (${Math.round((Date.now() - started) / 1000)} s)`);
if (held) console.log(`${specId}: HELD, not applied:\n  ${reasons.join('\n  ')}`);
process.exit(0);
