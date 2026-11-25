// The list of builds whose measured numbers are behind the simulator: src/data/measureQueue.json.
//
// A simulator update does not change every build. WoWSims keeps each class in its own folder, so a commit that
// only touches the mage needs new numbers for the mage builds alone, and a commit that only touches the
// interface needs none. This script works out which builds an update touches, keeps them in a queue per kind of
// measurement, starts the measurements for what is queued, and takes builds off the queue when they are measured.
//
//   node scripts/measure-queue.mjs add --repo <wowsims checkout> --from <commit> --to <commit>
//   node scripts/measure-queue.mjs add --specs "mage-fire mage-frost"     builds changed by a preset update
//   node scripts/measure-queue.mjs add --all                              everything, when in doubt
//   node scripts/measure-queue.mjs seq                                    the number of the last update queued
//   node scripts/measure-queue.mjs pending <effects|weights|weapons>      the builds waiting, space separated
//   node scripts/measure-queue.mjs done <kind> --seq <n> [--specs "..."]  measured: off the queue (all of the kind without --specs)
//   node scripts/measure-queue.mjs start [--self <kind>]                  start a run for every kind with builds waiting
//
// Every "add" raises a counter and stamps the builds with it. A measurement notes the counter when it starts and,
// when it ends, only takes off the builds stamped up to that number: a build queued again while it ran stays queued.
// "start" needs the gh command and GH_TOKEN; it leaves a kind alone while a run of that kind is going, except the
// one given with --self (a run that starts its own successor as its last step).
//
// The nightly full run measures everything whatever this list says, so a wrong guess here costs a day at most.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const FILE = root + 'src/data/measureQueue.json';
const KINDS = { effects: 'measure.yml', weights: 'weights.yml', weapons: 'weapons.yml' };
const CLASSES = ['druid', 'hunter', 'mage', 'paladin', 'priest', 'rogue', 'shaman', 'warlock', 'warrior'];

const specs = readdirSync(root + 'src/specs')
	.filter(name => name.endsWith('.json'))
	.map(name => JSON.parse(readFileSync(root + 'src/specs/' + name, 'utf8')));
/** Which builds a kind of measurement covers: the same rule as the "list" job of its workflow. */
const covers = {
	effects: () => true,
	weights: spec => spec.role !== 'healer',
	weapons: spec => spec.role !== 'healer' && ((spec.weights?.mainHandDps ?? 0) > 0 || (spec.weights?.rangedDps ?? 0) > 0),
};
const idsOf = kind => specs.filter(covers[kind]).map(spec => spec.id);

const load = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { seq: 0, effects: {}, weights: {}, weapons: {} });
const save = queue => writeFileSync(FILE, JSON.stringify(queue, null, '\t') + '\n');

/**
 * What one changed file of WoWSims means for the measurements: 'none', 'all', or the name of a class.
 * Anything not known here counts as 'all': a wasted run is cheaper than a missed change.
 */
export function touches(path) {
	if (/(_test\.go|\.results|\.md|\.test\.tsx?)$/.test(path)) return 'none';
	const [top, second, third] = path.split('/');
	if (path === SPELL_FILE) return 'spells'; // read spell by spell (spellTouches below)
	if (path.startsWith('sim/siml/testdata/') || path === 'proto/ui.proto') return 'none'; // test set-ups; what the interface saves
	if (top === 'sim') {
		if (CLASSES.includes(second)) return second;
		return 'all'; // core, common, siml, encounters, lib, wasm, register_all.go: shared by every class
	}
	if (top === 'ui') return second === 'specs' && CLASSES.includes(third) ? third : 'none'; // a class's presets; the rest is interface
	// The item database is read entry by entry (dbTouches below); its binary twin and the leftovers say nothing more.
	if (path === DB_FILE) return 'db';
	if (top === 'assets' && second === 'database') return /^(db\.bin|leftover_db\.(json|bin)|item_first_seen\.json)$/.test(third) ? 'db-twin' : 'all';
	// What the generated files are made from. Quests, loot tables and raw spell records only count through those files,
	// which are judged themselves; base stats and the like count as everybody.
	if (top === 'assets' && second === 'db_inputs') return /^(questie_db|questie_quests|atlasloot_db|spell_store_inputs)\.json$/.test(third) ? 'none' : 'all';
	if (top === 'assets') return 'none';
	if (top === 'proto' || path === 'go.mod' || path === 'go.sum') return 'all';
	const harmless = ['docs', '.github', 'cmd', 'tools', 'schemas', '.vscode', '.devcontainer'];
	const harmlessFiles = /^(skills-lock\.json|package(-lock)?\.json|makefile|Dockerfile|docker-compose\.yml|tsconfig\.json|buf\.yaml|LICENSE|gitconfig|pre-commit|upgrade\.sh|\.gitignore|\.gitattributes|\.editorconfig|\.prettierrc.*|[\w.-]+\.config\.m?[jt]s|vitest\.[\w.]+|test-locales\.mjs)$/;
	if (harmless.includes(top) || (second === undefined && harmlessFiles.test(top))) return 'none';
	return 'all';
}

/** The builds an update touches, from the list of changed files. A change of the item database alone counts as every build here. */
export function affected(paths) {
	const hit = new Set(paths.map(touches));
	if (['all', 'db', 'db-twin', 'spells'].some(kind => hit.has(kind))) return specs.map(spec => spec.id);
	return specs.filter(spec => hit.has(String(spec.className).toLowerCase())).map(spec => spec.id);
}

const DB_FILE = 'assets/database/db.json';
const SPELL_FILE = 'sim/core/spelldata/spells_auto_gen.go';
// The game's number for the class a spell belongs to.
const SPELL_FAMILY = { 3: 'mage', 4: 'warrior', 5: 'warlock', 6: 'priest', 7: 'druid', 8: 'rogue', 9: 'hunter', 10: 'paladin', 11: 'shaman' };

/**
 * Which classes a change of the generated spell data touches: the classes of the spells that differ, or 'all' when
 * one of them belongs to no class (item effects, enchants, racials) or the file changed outside the list of spells.
 */
export function spellTouches(beforeText, afterText) {
	const read = text => {
		const spells = new Map();
		let rest = '';
		let id = null;
		for (const line of text.split('\n')) {
			const head = /^\t\{ID: (\d+),/.exec(line);
			if (head) {
				id = head[1];
				spells.set(id, { family: /ClassFlags: core\.ClassFlags\{Family: (\d+)/.exec(line)?.[1], text: line });
			} else if (id !== null && line.startsWith('\t\t')) spells.get(id).text += '\n' + line;
			else {
				id = null;
				rest += line + '\n';
			}
		}
		return { spells, rest };
	};
	const [before, after] = [read(beforeText), read(afterText)];
	if (before.rest !== after.rest) return 'all';
	const classes = new Set();
	for (const id of new Set([...before.spells.keys(), ...after.spells.keys()])) {
		const [a, b] = [before.spells.get(id), after.spells.get(id)];
		if (a?.text === b?.text) continue;
		for (const spell of [a, b]) {
			if (!spell) continue;
			const name = SPELL_FAMILY[spell.family];
			if (!name) return 'all';
			classes.add(name);
		}
	}
	return [...classes];
}
// Parts of the database no measurement reads: names of places and creatures, pictures.
const DB_QUIET = new Set(['zones', 'npcs', 'factions', 'itemIcons', 'spellIcons']);
// The numbers WoWSims uses for kinds of items, as in scripts/build-data.mjs.
const ITEM_TYPES = [null, 'head', 'neck', 'shoulder', 'back', 'chest', 'wrist', 'hands', 'waist', 'legs', 'feet', 'finger', 'trinket', 'weapon', 'ranged'];
const ARMOR_TYPES = [null, 'cloth', 'leather', 'mail', 'plate'];
const WEAPON_TYPES = [null, 'axe', 'dagger', 'fist', 'mace', 'offHand', 'polearm', 'shield', 'staff', 'sword'];
const HAND_TYPES = [null, 'mainHand', 'oneHand', 'offHand', 'twoHand'];
const RANGED_TYPES = [null, 'bow', 'crossbow', 'gun', 'thrown', 'wand', 'idol', 'libram', 'totem', 'sigil'];
const ARMOR_SLOTS = new Set(['head', 'shoulder', 'chest', 'wrist', 'hands', 'waist', 'legs', 'feet']);

/** Can this build wear the item? The rule of src/lib/specs.ts on the raw database entry; anything unclear counts as yes. */
function usable(item, spec) {
	if (item.classAllowlist?.length && !item.classAllowlist.includes(spec.classId)) return false;
	const slot = ITEM_TYPES[item.type];
	if (ARMOR_SLOTS.has(slot)) return !item.armorType || spec.armorTypes.includes(ARMOR_TYPES[item.armorType]);
	if (slot === 'weapon') {
		const type = WEAPON_TYPES[item.weaponType] ?? '';
		const hand = HAND_TYPES[item.handType];
		if (hand === 'twoHand') return spec.weaponTypes.twoHand.includes(type);
		if (hand === 'offHand') return spec.weaponTypes.offHand.includes(type) || (spec.canDualWield && spec.weaponTypes.oneHand.includes(type));
		return spec.weaponTypes.oneHand.includes(type);
	}
	if (slot === 'ranged') return spec.rangedTypes.includes(RANGED_TYPES[item.rangedType] ?? '');
	return true;
}

/** What a build's own set-up uses: the ids in its WoWSims settings (scripts/builds). Null when there is no such file. */
function buildUse(spec) {
	const files = (spec.simBuilds ?? []).map(build => build.local).filter(Boolean);
	if (!files.length) return null;
	const use = { items: new Set(), enchants: new Set(), suffixes: new Set(), consumables: new Set() };
	const numbers = (value, into) => {
		if (typeof value === 'number') into.add(value);
		else if (value && typeof value === 'object') for (const inner of Object.values(value)) numbers(inner, into);
	};
	for (const file of files) {
		if (!existsSync(root + file)) return null;
		const player = JSON.parse(readFileSync(root + file, 'utf8')).player ?? {};
		for (const piece of [...(player.equipment?.items ?? []), ...(player.itemSwap?.items ?? [])]) {
			if (piece?.id) use.items.add(piece.id);
			if (piece?.enchant) use.enchants.add(piece.enchant);
			if (piece?.randomSuffix) use.suffixes.add(piece.randomSuffix);
		}
		numbers(player.consumables, use.consumables);
	}
	return use;
}

/**
 * Which builds a change of the item database touches, per kind of measurement. Takes the file's text before and
 * after. Stat weights only depend on what the build's own set-up wears and eats. Item effects also depend on every
 * item with an effect or a set that the build can wear, and on every enchant it can use; weapons on every weapon.
 * A change in a part not known here returns 'all'.
 */
export function dbTouches(beforeText, afterText, list = specs, useOf = buildUse) {
	const [before, after] = [JSON.parse(beforeText), JSON.parse(afterText)];
	const changed = { items: [], enchants: [], consumables: [], randomSuffixes: [] };
	const keyOf = entry => String(entry?.id ?? `${entry?.effectId}/${entry?.itemId}/${entry?.spellId}`);
	// Pictures and where an item comes from do not change what it is worth.
	const text = entry => JSON.stringify(entry, (key, value) => (key === 'icon' || key === 'sources' ? undefined : value));
	for (const part of new Set([...Object.keys(before), ...Object.keys(after)])) {
		if (DB_QUIET.has(part)) continue;
		const [old, now] = [before[part], after[part]];
		if (JSON.stringify(old) === JSON.stringify(now)) continue;
		if (!changed[part] || !Array.isArray(old) || !Array.isArray(now)) return 'all';
		const was = new Map(old.map(entry => [keyOf(entry), entry]));
		const is = new Map(now.map(entry => [keyOf(entry), entry]));
		if (was.size !== old.length || is.size !== now.length) return 'all'; // two entries under one key: cannot pair them
		for (const key of new Set([...was.keys(), ...is.keys()])) {
			const [a, b] = [was.get(key), is.get(key)];
			if (!a || !b || text(a) !== text(b)) changed[part].push(...[a, b].filter(Boolean));
		}
	}
	const result = { effects: [], weights: [], weapons: [] };
	const special = item => item.itemEffects?.length || item.pseudoStats?.some(Boolean) || item.setId;
	const isWeapon = item => ['weapon', 'ranged'].includes(ITEM_TYPES[item.type]);
	for (const spec of list) {
		const use = useOf(spec);
		const own =
			!use ||
			changed.items.some(item => use.items.has(item.id)) ||
			changed.enchants.some(enchant => use.enchants.has(enchant.effectId)) ||
			changed.consumables.some(entry => use.consumables.has(entry.id)) ||
			changed.randomSuffixes.some(suffix => use.suffixes.has(suffix.id));
		const enchant = changed.enchants.some(entry => !entry.classAllowlist?.length || entry.classAllowlist.includes(spec.classId));
		const wide = enchant || changed.randomSuffixes.length > 0;
		if (own) result.weights.push(spec.id);
		if (own || wide || changed.items.some(item => special(item) && usable(item, spec))) result.effects.push(spec.id);
		if (own || wide || changed.items.some(item => isWeapon(item) && usable(item, spec))) result.weapons.push(spec.id);
	}
	return result;
}

// Only when run as a script: the rules above are also imported by the tests.
const isMain = Boolean(process.argv[1]?.endsWith('measure-queue.mjs'));
const [command, ...args] = isMain ? process.argv.slice(2) : [];
const flag = name => {
	const at = args.indexOf(name);
	return at >= 0 ? (args[at + 1] ?? '') : undefined;
};
const kindArg = () => {
	const kind = args[0];
	if (!KINDS[kind]) throw new Error(`Unknown kind "${kind}": effects, weights or weapons.`);
	return kind;
};

if (command === 'add') {
	let ids;
	let why;
	let byKind; // set when the kinds of measurement differ in what they need
	if (args.includes('--all')) {
		ids = specs.map(spec => spec.id);
		why = 'asked for all';
	} else if (flag('--specs') !== undefined) {
		const known = new Set(specs.map(spec => spec.id));
		ids = flag('--specs').split(/\s+/).filter(id => known.has(id));
		why = 'named';
	} else {
		const [repo, from, to] = [flag('--repo'), flag('--from'), flag('--to')];
		try {
			if (!repo || !from || !to) throw new Error('--repo, --from and --to are needed');
			const paths = execFileSync('git', ['-C', repo, 'diff', '--name-only', from, to], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
			const kinds = [...new Set(paths.map(touches))].filter(kind => kind !== 'none');
			let spellNote = '';
			const show = (commit, file) => execFileSync('git', ['-C', repo, 'show', `${commit}:${file}`], { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
			const rest = paths.filter(path => !['db', 'db-twin', 'spells'].includes(touches(path)));
			ids = affected(rest);
			if (kinds.includes('spells') && ids.length < specs.length) {
				const classes = spellTouches(show(from, SPELL_FILE), show(to, SPELL_FILE));
				const more = classes === 'all' ? specs : specs.filter(spec => classes.includes(String(spec.className).toLowerCase()));
				ids = [...new Set([...ids, ...more.map(spec => spec.id)])];
				spellNote = classes === 'all' ? 'a spell of no class changed' : `spells changed for ${classes.join(', ') || 'nobody'}`;
			}
			why = `${paths.length} files changed; touching: ${kinds.length ? kinds.join(', ') : 'nothing that is measured'}`;
			if (spellNote) why += `; ${spellNote}`;
			if (kinds.includes('db-twin') && !kinds.includes('db')) {
				// The binary database changed without the readable one: no way to tell what, so everything.
				ids = specs.map(spec => spec.id);
				why += '; the binary database changed alone';
			} else if (kinds.includes('db') && ids.length < specs.length) {
				const hit = dbTouches(show(from, DB_FILE), show(to, DB_FILE));
				if (hit === 'all') {
					ids = specs.map(spec => spec.id);
					why += '; the database changed in a part every build reads';
				} else {
					byKind = Object.fromEntries(Object.keys(KINDS).map(kind => [kind, [...new Set([...ids, ...hit[kind]])]]));
					why += `; database entries changed for ${new Set(Object.values(hit).flat()).size} builds`;
				}
			}
		} catch (error) {
			// No history to compare (a shallow checkout, an unknown commit): measure everything.
			ids = specs.map(spec => spec.id);
			why = `could not compare (${String(error.message).split('\n')[0]}), so everything`;
		}
	}
	byKind ??= Object.fromEntries(Object.keys(KINDS).map(kind => [kind, ids]));
	const queue = load();
	if (Object.values(byKind).some(list => list.length)) {
		queue.seq += 1;
		for (const kind of Object.keys(KINDS)) for (const id of idsOf(kind)) if (byKind[kind].includes(id)) queue[kind][id] = queue.seq;
	}
	save(queue);
	const said = list => (list.length === specs.length ? 'every build' : list.length ? list.join(' ') : 'nothing');
	const same = Object.values(byKind).every(list => list.length === ids.length);
	console.log(`${why}. Queued: ${same ? said(ids) : Object.entries(byKind).map(([kind, list]) => `${kind}: ${said(list)}`).join('; ')}.`);
} else if (command === 'seq') {
	console.log(load().seq);
} else if (command === 'pending') {
	console.log(Object.keys(load()[kindArg()]).sort().join(' '));
} else if (command === 'done') {
	const kind = kindArg();
	const seq = Number(flag('--seq'));
	if (!Number.isFinite(seq)) throw new Error('--seq <number> is needed: the counter from when the measurement started.');
	const named = flag('--specs')?.split(/\s+/).filter(Boolean);
	const ids = named?.length ? named : idsOf(kind);
	const queue = load();
	const cleared = ids.filter(id => queue[kind][id] !== undefined && queue[kind][id] <= seq);
	for (const id of cleared) delete queue[kind][id];
	save(queue);
	console.log(`${kind}: ${cleared.length} off the queue, ${Object.keys(queue[kind]).length} still waiting.`);
} else if (command === 'start') {
	const self = flag('--self');
	const queue = load();
	const repo = process.env.GITHUB_REPOSITORY;
	for (const [kind, workflow] of Object.entries(KINDS)) {
		const waiting = Object.keys(queue[kind]).sort();
		if (!waiting.length) {
			console.log(`${kind}: nothing waiting.`);
			continue;
		}
		if (kind !== self) {
			const busy = ['in_progress', 'queued', 'pending', 'requested', 'waiting']
				.map(status => Number(execFileSync('gh', ['api', `repos/${repo}/actions/workflows/${workflow}/runs?status=${status}&per_page=1`, '--jq', '.total_count'], { encoding: 'utf8' }).trim()))
				.reduce((sum, count) => sum + count, 0);
			if (busy) {
				console.log(`${kind}: a run is going; it starts the next one itself when it ends.`);
				continue;
			}
		}
		// Everything of the kind waiting: a plain full run, which also covers builds added since.
		const everything = waiting.length === idsOf(kind).length;
		execFileSync('gh', ['workflow', 'run', workflow, '--ref', 'main', ...(everything ? [] : ['-f', `specs=${waiting.join(' ')}`])], { stdio: 'inherit' });
		console.log(`${kind}: started for ${everything ? 'every build' : waiting.join(' ')}.`);
	}
} else if (isMain) {
	console.error('Usage: measure-queue.mjs add|seq|pending|done|start (see the top of the file).');
	process.exit(1);
}
