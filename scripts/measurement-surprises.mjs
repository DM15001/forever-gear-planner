#!/usr/bin/env node
// Looks through the measured numbers for things that deserve a second look, and prints them as a report.
//
// The measurements (item effects, proc enchants, set bonuses, weapons, stat weights) are made by the simulator
// without anybody watching. Most surprises in them are real: WoWSims changed how something works. Some are a
// mistake, in WoWSims or here, and nobody notices until a player asks why an important enchant is worth nothing.
// This script cannot tell which is which. It only finds the candidates:
//
//   1. Jumps: a value that changed a lot since an earlier state of the repository.
//   2. Odd ones out: an item or enchant worth a lot to one build of a class and nothing to another of the same role.
//   3. Preset picks worth nothing: something WoWSims' own set for a build wears, whose effect measured as nothing.
//
//   node scripts/measurement-surprises.mjs                      against the state of 26 hours ago
//   node scripts/measurement-surprises.mjs --since "3 days ago"
//   node scripts/measurement-surprises.mjs --all                also the odd ones out and preset picks that were there before
//   node scripts/measurement-surprises.mjs --json               the findings as JSON instead of text
//
// Exit code 0 always; the last line of the text says how many things were found.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const since = flag('--since') ?? '26 hours ago';

/** A jump counts from this many DPS, and only if it is also this share of the bigger of the two values. */
const JUMP_DPS = 5;
const JUMP_SHARE = 0.5;
/** A whole weapon moves more easily than an effect: its bar is higher. */
const WEAPON_JUMP_DPS = 10;
/** A stat weight counts from this change, as a share and in absolute terms. */
const WEIGHT_SHARE = 0.25;
const WEIGHT_ABS = 0.1;
/** "A lot" and "nothing" for the odd one out. */
const SIBLING_HIGH = 8;
const SIBLING_LOW = 1;
/** How many findings of each kind the report lists; the rest is counted. */
const LIST = 20;

const readJson = path => JSON.parse(readFileSync(root + path, 'utf8'));
const before = (() => {
	try {
		return execFileSync('git', ['-C', root, 'rev-list', '-1', `--before=${since}`, 'HEAD'], { encoding: 'utf8' }).trim();
	} catch {
		return '';
	}
})();
/** The file as it was at the earlier state, or null when it did not exist or there is no history to read. */
const readOld = path => {
	if (!before) return null;
	try {
		return JSON.parse(execFileSync('git', ['-C', root, 'show', `${before}:${path}`], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }));
	} catch {
		return null;
	}
};

const specs = readdirSync(root + 'src/specs')
	.filter(name => name.endsWith('.json'))
	.map(name => ({ file: `src/specs/${name}`, ...readJson(`src/specs/${name}`) }));
const itemName = new Map(readJson('src/data/items.json').map(item => [item.id, item.name]));
const enchantName = new Map(readJson('src/data/enchants.json').map(enchant => [enchant.effectId, enchant.name]));
const enchantHasEffect = new Set(readJson('src/data/enchants.json').filter(enchant => enchant.hasEffect).map(enchant => enchant.effectId));
const round = value => Math.round(value * 10) / 10;

const jumps = [];
const oddOnes = [];
const presetNothing = [];

/** value -> number, where a missing entry is 0. */
const dpsOf = entry => (typeof entry === 'number' ? entry : (entry?.dps ?? 0));
const jumped = (was, is, bar) => Math.abs(is - was) >= bar && Math.abs(is - was) >= JUMP_SHARE * Math.max(Math.abs(was), Math.abs(is));

for (const spec of specs) {
	// 1a. Item effects, proc enchants, set bonuses.
	const path = `src/data/simValues/${spec.id}.json`;
	const now = existsSync(root + path) ? readJson(path) : null;
	const old = readOld(path);
	if (now && old) {
		for (const [kind, label] of [
			['items', id => itemName.get(Number(id)) ?? `item ${id}`],
			['enchants', id => enchantName.get(Number(id)) ?? `enchant ${id}`],
		]) {
			for (const id of new Set([...Object.keys(old[kind] ?? {}), ...Object.keys(now[kind] ?? {})])) {
				// Not measured on one of the two sides is no jump: the list of what gets measured changed.
				if (!old.measured?.[kind]?.includes(Number(id)) || !now.measured?.[kind]?.includes(Number(id))) continue;
				const [was, is] = [dpsOf(old[kind][id]), dpsOf(now[kind][id])];
				if (jumped(was, is, JUMP_DPS)) jumps.push({ build: spec.id, what: `${kind === 'items' ? 'item effect' : 'enchant'}: ${label(id)}`, was: round(was), is: round(is) });
			}
		}
		for (const id of new Set([...Object.keys(old.sets ?? {}), ...Object.keys(now.sets ?? {})])) {
			const top = set => Math.max(0, ...Object.values(set?.byCount ?? {}).map(dpsOf));
			const [was, is] = [top(old.sets?.[id]), top(now.sets?.[id])];
			if (old.measured?.sets?.includes(Number(id)) && now.measured?.sets?.includes(Number(id)) && jumped(was, is, JUMP_DPS)) jumps.push({ build: spec.id, what: `set bonus: ${now.sets?.[id]?.name ?? old.sets?.[id]?.name ?? id}`, was: round(was), is: round(is) });
		}
	}
	// 1b. Weapons as a whole.
	const weaponPath = `src/data/weaponValues/${spec.id}.json`;
	const weaponsNow = existsSync(root + weaponPath) ? readJson(weaponPath) : null;
	const weaponsOld = readOld(weaponPath);
	if (weaponsNow && weaponsOld) {
		for (const id of Object.keys(weaponsNow.weapons ?? {})) {
			for (const hand of ['mainHand', 'offHand', 'ranged']) {
				const [was, is] = [weaponsOld.weapons?.[id]?.[hand], weaponsNow.weapons[id][hand]];
				if (typeof was === 'number' && typeof is === 'number' && jumped(was, is, WEAPON_JUMP_DPS)) jumps.push({ build: spec.id, what: `weapon (${hand}): ${itemName.get(Number(id)) ?? id}`, was: round(was), is: round(is) });
			}
		}
	}
	// 1c. Stat weights.
	const oldSpec = readOld(spec.file);
	if (oldSpec?.weights?.stats) {
		for (const [stat, is] of Object.entries(spec.weights.stats)) {
			const was = oldSpec.weights.stats[stat];
			if (typeof was !== 'number') continue;
			if (Math.abs(is - was) >= WEIGHT_ABS && Math.abs(is - was) >= WEIGHT_SHARE * Math.max(Math.abs(was), Math.abs(is))) jumps.push({ build: spec.id, what: `stat weight: ${stat}`, was: Math.round(was * 100) / 100, is: Math.round(is * 100) / 100 });
		}
	}
}

/** How a build fights, from what its weights value: the odd one out is only looked for among builds that fight alike. */
const styleOf = spec => {
	const stats = spec.weights?.stats ?? {};
	if ((stats.spellDamage ?? 0) >= (stats.attackPower ?? 0) && (stats.spellDamage ?? 0) > 0) return 'caster';
	return (spec.weights?.rangedDps ?? 0) > (spec.weights?.mainHandDps ?? 0) ? 'ranged' : 'melee';
};
const closedEnchants = new Set(Object.keys(readJson('src/config/not-available.json').enchants ?? {}).map(Number));
const closedEffects = new Set(readJson('src/data/enchants.json').filter(enchant => closedEnchants.has(enchant.itemId)).map(enchant => enchant.effectId));
const itemSlot = new Map(readJson('src/data/items.json').map(item => [item.id, item.slot]));

/**
 * The findings that do not come from a change: the odd ones out and the preset picks worth nothing, for the
 * measurement files as `read` returns them (today's, or an earlier state's to see which findings are new).
 */
function standing(read) {
	const odd = [];
	const nothing = [];
	const families = new Map();
	for (const spec of specs) {
		const values = read(`src/data/simValues/${spec.id}.json`);
		if (!values) continue;
		const key = `${spec.className}|${spec.role ?? 'damage'}|${styleOf(spec)}`;
		families.set(key, [...(families.get(key) ?? []), { id: spec.id, values }]);
		// What the build's own WoWSims set wears, and what its effect measured as.
		const local = (spec.simBuilds ?? []).map(build => build.local).find(file => file && existsSync(root + file));
		if (!local) continue;
		const seen = new Set();
		for (const piece of readJson(local).player?.equipment?.items ?? []) {
			for (const [kind, id, name] of [
				['items', piece?.id, itemName.get(piece?.id)],
				['enchants', enchantHasEffect.has(piece?.enchant) ? piece.enchant : undefined, enchantName.get(piece?.enchant)],
			]) {
				if (!id || seen.has(kind + id) || !values.measured?.[kind]?.includes(id) || dpsOf(values[kind]?.[id]) > 0) continue;
				seen.add(kind + id);
				nothing.push({ key: `${spec.id}|${kind}|${id}`, build: spec.id, what: `${kind === 'items' ? 'item effect' : 'enchant'}: ${name ?? id}` });
			}
		}
	}
	for (const [family, builds] of families) {
		if (builds.length < 2) continue;
		for (const [kind, label] of [
			['items', id => itemName.get(Number(id)) ?? `item ${id}`],
			['enchants', id => enchantName.get(Number(id)) ?? `enchant ${id}`],
		]) {
			for (const id of new Set(builds.flatMap(build => Object.keys(build.values[kind] ?? {})))) {
				// A weapon's own proc is part of the weapon as a whole, and an enchant the game does not have is not offered.
				if (kind === 'items' && ['weapon', 'ranged'].includes(itemSlot.get(Number(id)))) continue;
				if (kind === 'enchants' && closedEffects.has(Number(id))) continue;
				const measured = builds.filter(build => build.values.measured?.[kind]?.includes(Number(id)));
				if (measured.length < 2) continue;
				const rated = measured.map(build => ({ id: build.id, dps: dpsOf(build.values[kind]?.[id]) })).sort((x, y) => y.dps - x.dps);
				const low = rated.filter(entry => entry.dps < SIBLING_LOW);
				if (rated[0].dps >= SIBLING_HIGH && low.length) odd.push({ key: `${family}|${kind}|${id}|${low.map(entry => entry.id).join(',')}`, family: family.split('|')[0], what: `${kind === 'items' ? 'item effect' : 'enchant'}: ${label(id)}`, high: `${rated[0].id} ${round(rated[0].dps)}`, nothing: low.map(entry => entry.id), top: rated[0].dps });
			}
		}
	}
	return { odd, nothing };
}
const today = standing(path => (existsSync(root + path) ? readJson(path) : null));
// Only what is new since the earlier state, unless everything is asked for: the same list every night is no report.
const earlier = args.includes('--all') || !before ? { odd: [], nothing: [] } : standing(readOld);
const known = new Set([...earlier.odd, ...earlier.nothing].map(entry => entry.key));
oddOnes.push(...today.odd.filter(entry => !known.has(entry.key)));
presetNothing.push(...today.nothing.filter(entry => !known.has(entry.key)));

// Many jumps of one kind in one build are one event: its preset or its own weapon changed and everything moved.
const grouped = new Map();
for (const jump of jumps) {
	const key = `${jump.build}|${jump.what.split(':')[0]}`;
	grouped.set(key, [...(grouped.get(key) ?? []), jump]);
}
jumps.length = 0;
for (const [key, list] of grouped) {
	if (list.length <= 5) {
		jumps.push(...list);
		continue;
	}
	const shifts = list.map(jump => jump.is - jump.was).sort((x, y) => x - y);
	const [build, kind] = key.split('|');
	jumps.push({ build, what: `${list.length} values of the kind "${kind}" moved together (the build's preset or its own weapon changed)`, was: 0, is: round(shifts[Math.floor(shifts.length / 2)]), group: true });
}

jumps.sort((x, y) => Math.abs(y.is - y.was) - Math.abs(x.is - x.was));
oddOnes.sort((x, y) => y.top - x.top);
const total = jumps.length + oddOnes.length + presetNothing.length;

if (args.includes('--json')) {
	console.log(JSON.stringify({ since, comparedWith: before || null, jumps, oddOnes, presetNothing }, null, '\t'));
} else {
	const lines = [];
	const more = (list, shown) => (list.length > shown ? [`- ... and ${list.length - shown} more`] : []);
	lines.push(`Measured numbers that deserve a second look. Compared with the repository ${before ? `of ${since} (${before.slice(0, 7)})` : 'as it is (no earlier state to compare with)'}.`);
	lines.push('', `## Jumps (${jumps.length})`, 'A value that changed by a lot. Usually WoWSims changed how it works; sometimes it broke.');
	for (const jump of jumps.slice(0, LIST)) lines.push(jump.group ? `- ${jump.build}: ${jump.what}, by ${jump.is} in the middle` : `- ${jump.build}, ${jump.what}: ${jump.was} to ${jump.is}`);
	lines.push(...more(jumps, LIST));
	lines.push('', `## Odd ones out (${oddOnes.length})`, `Worth a lot to one build of a class and nothing to another that fights the same way${args.includes('--all') ? '' : '; only what is new'}. Often right (another rotation), sometimes a gap in the simulator.`);
	for (const odd of oddOnes.slice(0, LIST)) lines.push(`- ${odd.family}, ${odd.what}: ${odd.high}, but nothing for ${odd.nothing.join(', ')}`);
	lines.push(...more(oddOnes, LIST));
	lines.push('', `## Preset picks worth nothing (${presetNothing.length})`, `Something WoWSims' own set for the build wears, whose effect measured as nothing${args.includes('--all') ? '' : '; only what is new'}. A contradiction worth checking.`);
	for (const pick of presetNothing.slice(0, LIST)) lines.push(`- ${pick.build}, ${pick.what}`);
	lines.push(...more(presetNothing, LIST));
	lines.push('', `${total} thing${total === 1 ? '' : 's'} found.`);
	console.log(lines.join('\n'));
}
