#!/usr/bin/env node
// Builds the game data in src/data/ and the simulator files in public/sim/ from WoWSims Forever.
//
//   npm run build-data                             download everything from GitHub
//   npm run build-data -- --pages path/to/pages-deploy   use a local clone of wowsims/pages-deploy
//   npm run build-data -- --repo path/to/forever         use a local clone of wowsims/forever
//   npm run build-data -- --db path/to/db.json           use a local item database only
//   npm run build-data -- --spec <spec-id>               spec config in src/specs/ (default: enhancement-shaman)
//
// The item database and the simulator (lib.wasm.gz) come from wowsims/pages-deploy, the files
// behind wowsims.com, so the two always match. Gear presets come from wowsims/forever.
// No dependencies; needs Node 20+. Safe to re-run at any time: it overwrites its outputs.
// Source: https://github.com/wowsims/forever (MIT). Keep the link back to WoWSims in the app.

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'src', 'data');
const REPO = 'wowsims/forever';
const BRANCH = 'master';
const SIM_DIR = join(ROOT, 'public', 'sim');
const RAW_URL = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
const PAGES_REPO = 'wowsims/pages-deploy';
const PAGES_RAW_URL = `https://raw.githubusercontent.com/${PAGES_REPO}/main/forever`;
const DB_PATH = 'assets/database/db.json';
const DB_URL = `${PAGES_RAW_URL}/${DB_PATH}`;
const COMMIT_URL = `https://api.github.com/repos/${PAGES_REPO}/commits/main`;

// ---- Enums, copied from proto/common.proto and proto/ui.proto in wowsims/forever ----

const STATS = [
	'strength', 'agility', 'stamina', 'intellect', 'healingPower', 'spellDamage', 'arcaneDamage', 'fireDamage',
	'frostDamage', 'holyDamage', 'natureDamage', 'shadowDamage', 'spellPiercing', 'spirit', 'attackPower',
	'rangedAttackPower', 'feralAttackPower', 'hitRating', 'critRating', 'hasteRating', 'armorPenetration',
	'expertiseRating', 'defenseRating', 'blockRating', 'blockValue', 'dodgeRating', 'parryRating', 'armor',
	'bonusArmor', 'health', 'mana', 'mp5', 'arcaneResistance', 'fireResistance', 'frostResistance',
	'natureResistance', 'shadowResistance', 'physicalDamage', 'armorNoMods',
];
const ITEM_TYPES = [null, 'head', 'neck', 'shoulder', 'back', 'chest', 'wrist', 'hands', 'waist', 'legs', 'feet', 'finger', 'trinket', 'weapon', 'ranged'];
const ARMOR_TYPES = [null, 'cloth', 'leather', 'mail', 'plate'];
const WEAPON_TYPES = [null, 'axe', 'dagger', 'fist', 'mace', 'offHand', 'polearm', 'shield', 'staff', 'sword'];
const HAND_TYPES = [null, 'mainHand', 'oneHand', 'offHand', 'twoHand'];
const RANGED_TYPES = [null, 'bow', 'crossbow', 'gun', 'thrown', 'wand', 'idol', 'libram', 'totem', 'sigil'];
const QUALITIES = ['junk', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'artifact', 'heirloom'];
const PROFESSIONS = { 1: 'Alchemy', 2: 'Blacksmithing', 3: 'Enchanting', 4: 'Engineering', 5: 'Herbalism', 6: 'Inscription', 8: 'Leatherworking', 9: 'Mining', 10: 'Skinning', 11: 'Tailoring' };
const FACTIONS = { 1: 'alliance', 2: 'horde' };
const REP_LEVELS = [null, 'Hated', 'Hostile', 'Unfriendly', 'Neutral', 'Friendly', 'Honored', 'Revered', 'Exalted'];
const ARMOR_SLOTS = new Set(['head', 'shoulder', 'chest', 'wrist', 'hands', 'waist', 'legs', 'feet']);
const ENCHANT_TYPES = [null, 'twoHand', 'shield', 'kit', 'staff', 'offHand']; // unset = any item of the slot
const DIFFICULTY_RAID = 2; // drop.difficulty: 1 = dungeon, 2 = raid, unset = open world
const PHASE_RELEASED = 1; // phase 2 means "unknown" upstream (old PvP ranks, unreleased raids)

// ---- Helpers ----

function parseArgs(argv) {
	const args = { spec: 'enhancement-shaman', db: null, repo: null, pages: null };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--db') args.db = argv[++i];
		else if (argv[i] === '--spec') args.spec = argv[++i];
		else if (argv[i] === '--repo') args.repo = argv[++i];
		else if (argv[i] === '--pages') args.pages = argv[++i];
		else throw new Error(`Unknown argument: ${argv[i]}`);
	}
	return args;
}

async function loadDb(localPath) {
	if (localPath) {
		return { db: JSON.parse(await readFile(localPath, 'utf8')), origin: `local file ${localPath}`, commit: null };
	}
	console.log(`Downloading ${DB_URL}`);
	const hint = `Download db.json yourself from ${DB_URL} and pass it with --db <path>.`;
	const res = await fetch(DB_URL).catch(err => {
		throw new Error(`Download failed (${err.cause?.code ?? err.message}). ${hint}`);
	});
	if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}. ${hint}`);
	const db = await res.json();
	// The commit is only for the record; the build does not depend on it.
	let commit = null;
	try {
		const c = await fetch(COMMIT_URL, { headers: { accept: 'application/vnd.github+json' } });
		if (c.ok) {
			const j = await c.json();
			commit = { sha: j.sha, date: j.commit?.committer?.date ?? null, message: j.commit?.message?.split('\n')[0] ?? null };
		}
	} catch {
		// offline or rate-limited: leave the commit unknown
	}
	return { db, origin: DB_URL, commit };
}

/** {"0": 10, "17": 5} or [10, 0, ...] -> { strength: 10, hitRating: 5 } */
function namedStats(raw) {
	const out = {};
	if (!raw) return out;
	const entries = Array.isArray(raw) ? raw.map((v, i) => [i, v]) : Object.entries(raw);
	for (const [index, value] of entries) {
		if (!value) continue;
		out[STATS[index] ?? `stat${index}`] = value;
	}
	return out;
}

function round(value, digits = 2) {
	return value == null ? undefined : Number(value.toFixed(digits));
}

/** Drops keys whose value is undefined, null, false, an empty array or an empty object. */
function compact(obj) {
	const out = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v == null || v === false) continue;
		if (Array.isArray(v) && v.length === 0) continue;
		if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
		out[k] = v;
	}
	return out;
}

// ---- Main ----

const args = parseArgs(process.argv.slice(2));

// Icon names the WoWSims database lacks, looked up on Wowhead (see the file's comment).
const ICON_OVERRIDES = JSON.parse(readFileSync(new URL('../src/config/wowhead/icons.json', import.meta.url), 'utf8')).icons;
// Every spec the app knows. The item list is the union of what they can equip; the app narrows it per spec.
const specs = readdirSync(join(ROOT, 'src', 'specs'))
	.filter(name => name.endsWith('.json'))
	.sort()
	.map(name => JSON.parse(readFileSync(join(ROOT, 'src', 'specs', name), 'utf8')));
const localDb = args.db ?? (args.pages ? join(args.pages, 'forever', DB_PATH) : args.repo ? join(args.repo, DB_PATH) : null);
const { db, origin, commit } = await loadDb(localDb);

/** A file from the wowsims repo: from the local clone if --repo was given, else from GitHub. null if unavailable. */
async function readRepoJson(path) {
	try {
		if (args.repo) return JSON.parse(await readFile(join(args.repo, path), 'utf8'));
		if (args.db && !args.pages) return null; // a bare db.json copy has no builds next to it
		const res = await fetch(`${RAW_URL}/${path}`);
		return res.ok ? await res.json() : null;
	} catch {
		return null;
	}
}

const zoneById = new Map(db.zones.map(z => [z.id, z]));
const npcById = new Map(db.npcs.map(n => [n.id, n]));
const factionById = new Map(db.factions.map(f => [f.id, f.name]));

// A zone is a raid or a dungeon if any drop in it is flagged that way upstream.
const zoneKind = new Map();
for (const entry of [...db.items, ...db.enchants]) {
	for (const s of entry.sources ?? []) {
		if (!s.drop?.zoneId || !s.drop.difficulty) continue;
		const kind = s.drop.difficulty === DIFFICULTY_RAID ? 'raid' : 'dungeon';
		if (zoneKind.get(s.drop.zoneId) !== 'raid') zoneKind.set(s.drop.zoneId, kind);
	}
}

const usedZones = new Set();
const usedNpcs = new Set();
const usedSuffixes = new Set();

function convertSource(s) {
	if (s.drop) {
		const d = s.drop;
		if (d.zoneId) usedZones.add(d.zoneId);
		if (d.npcId) usedNpcs.add(d.npcId);
		return compact({
			kind: 'drop',
			zoneId: d.zoneId,
			npcId: d.npcId,
			otherName: d.otherName, // e.g. "Trash" when no single NPC drops it
			category: d.category,
			zoneKind: zoneKind.get(d.zoneId) ?? 'world',
		});
	}
	if (s.quest) return compact({ kind: 'quest', questId: s.quest.id, name: s.quest.name, faction: FACTIONS[s.quest.faction] });
	if (s.crafted) return compact({ kind: 'crafted', profession: PROFESSIONS[s.crafted.profession] ?? `Profession ${s.crafted.profession}`, spellId: s.crafted.spellId });
	if (s.rep) return compact({ kind: 'rep', repFaction: factionById.get(s.rep.repFactionId) ?? `Faction ${s.rep.repFactionId}`, repLevel: REP_LEVELS[s.rep.repLevel], faction: FACTIONS[s.rep.factionId] });
	if (s.soldBy) {
		if (s.soldBy.zoneId) usedZones.add(s.soldBy.zoneId);
		return compact({ kind: 'vendor', npcId: s.soldBy.npcId, npcName: s.soldBy.npcName, zoneId: s.soldBy.zoneId, faction: FACTIONS[s.soldBy.faction] });
	}
	if (s.pvp) return { kind: 'pvp' };
	return { kind: 'unknown' };
}

/** Can this spec equip the item at all? Faction, professions and raid/PvP are filtered in the app. */
function usableBy(item, spec) {
	const slot = ITEM_TYPES[item.type];
	if (item.classAllowlist?.length && !item.classAllowlist.includes(spec.classId)) return false;
	if (ARMOR_SLOTS.has(slot)) {
		// Armor without an armor type (a few cosmetic pieces) is wearable by everyone.
		return !item.armorType || spec.armorTypes.includes(ARMOR_TYPES[item.armorType]);
	}
	if (slot === 'weapon') {
		const type = WEAPON_TYPES[item.weaponType];
		const hand = HAND_TYPES[item.handType];
		if (hand === 'twoHand') return spec.weaponTypes.twoHand.includes(type);
		if (hand === 'offHand') return spec.weaponTypes.offHand.includes(type) || (spec.canDualWield && spec.weaponTypes.oneHand.includes(type));
		return spec.weaponTypes.oneHand.includes(type); // mainHand and oneHand
	}
	if (slot === 'ranged') return spec.rangedTypes.includes(RANGED_TYPES[item.rangedWeaponType]);
	return true; // neck, back, finger, trinket
}

function isUsable(item) {
	if (!ITEM_TYPES[item.type]) return false;
	if (item.phase !== PHASE_RELEASED) return false;
	if ((item.reqLvl ?? 0) > 60) return false;
	if ((item.quality ?? 0) < 2) return false; // uncommon and better
	return specs.some(spec => usableBy(item, spec));
}

function convertItem(item) {
	const scaling = item.scalingOptions?.['0'] ?? {};
	const slot = ITEM_TYPES[item.type];
	for (const id of item.randomSuffixOptions ?? []) usedSuffixes.add(id);
	const weapon =
		slot === 'weapon'
			? compact({
					type: WEAPON_TYPES[item.weaponType],
					hand: HAND_TYPES[item.handType],
					speed: item.weaponSpeed,
					dps: round(scaling.unroundedDps),
					damageMin: scaling.weaponDamageMin,
					damageMax: scaling.weaponDamageMax,
				})
			: undefined;
	return compact({
		id: item.id,
		name: item.name,
		icon: item.icon || ICON_OVERRIDES[item.id],
		slot,
		armorType: ARMOR_TYPES[item.armorType ?? 0],
		rangedType: RANGED_TYPES[item.rangedWeaponType ?? 0],
		quality: QUALITIES[item.quality],
		ilvl: scaling.ilvl,
		reqLvl: item.reqLvl,
		stats: namedStats(scaling.stats),
		weapon,
		unique: item.unique,
		// Class ids that may use the item; unset = every class.
		classes: item.classAllowlist?.length ? item.classAllowlist : undefined,
		faction: FACTIONS[item.factionRestriction],
		requiredProfession: PROFESSIONS[item.requiredProfession],
		setId: item.setId,
		setName: item.setName,
		// Procs and on-use effects. A stat score cannot value these; the app shows a "sim it" badge.
		effects: (item.itemEffects ?? []).map(e =>
			compact({
				name: e.buffName,
				kind: e.proc ? 'proc' : e.onUse ? 'onUse' : 'passive',
				durationMs: e.effectDurationMs,
				stats: namedStats(e.scalingOptions?.['0']?.stats),
				ppm: e.proc?.ppm,
				procChance: e.proc?.procChance,
				icdMs: e.proc?.icdMs,
			}),
		),
		// Random-suffix items ("... of the Eagle"): stat = floor(randPropPoints * suffix.stats[i] / 10000).
		randomSuffixOptions: item.randomSuffixOptions,
		randPropPoints: item.randomSuffixOptions?.length ? scaling.randPropPoints : undefined,
		sources: (item.sources ?? []).map(convertSource),
	});
}

function convertEnchant(e) {
	return compact({
		effectId: e.effectId, // the id used in character exports ("enchant": 1900)
		itemId: e.itemId,
		spellId: e.spellId,
		classes: e.classAllowlist?.length ? e.classAllowlist : undefined,
		name: e.name,
		icon: e.icon,
		slots: [e.type, ...(e.extraTypes ?? [])].map(t => ITEM_TYPES[t]).filter(Boolean),
		quality: QUALITIES[e.quality],
		// Restricts a weapon enchant to two-handers, shields, staves or off-hand items.
		only: ENCHANT_TYPES[e.enchantType ?? 0],
		stats: namedStats(e.stats),
		hasEffect: Boolean(e.enchantEffects?.length || e.procKind || e.pseudoStats?.some(Boolean)),
		effects: (e.enchantEffects ?? []).map(x =>
			compact({ name: x.buffName, durationMs: x.effectDurationMs, stats: namedStats(x.scalingOptions?.['0']?.stats), ppm: x.proc?.ppm }),
		),
		sources: (e.sources ?? []).map(convertSource),
	});
}

const items = db.items.filter(isUsable).map(convertItem).sort((a, b) => a.id - b.id);

const enchants = db.enchants
	.filter(e => e.phase === PHASE_RELEASED)
	.filter(e => !e.classAllowlist?.length || specs.some(spec => e.classAllowlist.includes(spec.classId)))
	.map(convertEnchant)
	.sort((a, b) => a.effectId - b.effectId);

const zones = [...usedZones]
	.filter(id => zoneById.has(id))
	.map(id => ({ id, name: zoneById.get(id).name, kind: zoneKind.get(id) ?? 'world' }))
	.sort((a, b) => a.id - b.id);

const npcs = [...usedNpcs]
	.filter(id => npcById.has(id))
	.map(id => compact({ id, name: npcById.get(id).name, zoneId: npcById.get(id).zoneId }))
	.sort((a, b) => a.id - b.id);

const randomSuffixes = db.randomSuffixes
	.filter(s => usedSuffixes.has(s.id))
	.map(s => ({ id: s.id, name: s.name, stats: namedStats(s.stats) }))
	.sort((a, b) => a.id - b.id);

// Gear sets the sim maintainers ship as presets, per spec. Kept as-is, even if an item is filtered out above.
// A build is read from the wowsims repo (`path`) or from this repo (`local`, for specs where the
// sim project ships its presets in pieces and scripts/builds/ holds the assembled request).
const simSets = [];
const simTemplates = new Map();
const templateGear = [];
for (const spec of specs) {
	for (const [index, build] of (spec.simBuilds ?? []).entries()) {
		const json = build.local ? JSON.parse(await readFile(join(ROOT, build.local), 'utf8').catch(() => 'null')) : await readRepoJson(build.path);
		const gear = json?.player?.equipment?.items;
		if (!Array.isArray(gear)) {
			console.warn(`Sim build not read: ${build.local ?? build.path}. Use --repo with a local clone, or run without --db.`);
			continue;
		}
		simSets.push({
			spec: spec.id,
			id: build.id,
			label: build.label,
			title: build.title,
			url: build.local ? `https://github.com/${REPO}/tree/${BRANCH}/ui/specs` : `https://github.com/${REPO}/blob/${BRANCH}/${build.path}`,
			gear: gear.map(piece => (piece?.id ? compact({ id: piece.id, enchant: piece.enchant, randomSuffix: piece.randomSuffix }) : null)),
		});
		if (index > 0) continue;
		// The sim's saved settings, reshaped into the request the sim takes. The app swaps in gear, race,
		// professions and talents.
		simTemplates.set(spec.id, {
			raid: { parties: [{ players: [json.player], buffs: json.partyBuffs ?? {} }], numActiveParties: 1, buffs: json.raidBuffs ?? {}, debuffs: json.debuffs ?? {} },
			encounter: json.encounter,
			type: 'SimTypeIndividual',
		});
		templateGear.push(...(json.player.equipment?.items ?? []), ...(json.player.itemSwap?.items ?? []));
	}
}

// ---- Simulator files (public/sim/) ----
// The WebAssembly sim carries no item data: every request brings the items it uses. The app
// builds requests from these raw records, trimmed to the fields the sim's protobuf accepts.

const SIM_ITEM_FIELDS = ['id', 'name', 'type', 'armorType', 'weaponType', 'handType', 'rangedWeaponType', 'qualityModifier', 'weaponSpeed', 'setName', 'setId', 'scalingOptions', 'itemEffects', 'limitCategory', 'unique', 'pseudoStats', 'classAllowlist', 'spellSchool'];
const SIM_ENCHANT_FIELDS = ['effectId', 'name', 'type', 'stats', 'enchantEffects', 'enchantType', 'extraTypes', 'pseudoStats', 'weaponDamage', 'procKind'];
const pick = (obj, fields) => Object.fromEntries(fields.filter(f => obj[f] !== undefined).map(f => [f, obj[f]]));

const simItemIds = new Set(items.map(i => i.id));
for (const set of simSets) for (const piece of set.gear) if (piece) simItemIds.add(piece.id);
for (const piece of templateGear) if (piece?.id) simItemIds.add(piece.id);
const simDb = {
	items: db.items.filter(i => simItemIds.has(i.id)).map(i => pick(i, SIM_ITEM_FIELDS)),
	enchants: db.enchants.map(e => pick(e, SIM_ENCHANT_FIELDS)),
	randomSuffixes: db.randomSuffixes.filter(s => usedSuffixes.has(s.id) || templateGear.some(piece => piece?.randomSuffix === s.id)),
	itemEffectRandPropPoints: db.itemEffectRandPropPoints,
	consumables: db.consumables,
	spellEffects: db.spellEffects,
};

/** The prebuilt simulator. Copied from a pages-deploy clone or downloaded; kept as is when neither works. */
async function fetchWasm() {
	const target = join(SIM_DIR, 'lib.wasm.gz');
	try {
		if (args.pages) {
			await copyFile(join(args.pages, 'forever', 'lib.wasm.gz'), target);
			return 'copied';
		}
		if (args.db || args.repo) return 'kept'; // offline build: do not mix a local database with a downloaded sim
		const res = await fetch(`${PAGES_RAW_URL}/lib.wasm.gz`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		await writeFile(target, Buffer.from(await res.arrayBuffer()));
		return 'downloaded';
	} catch (err) {
		console.warn(`Simulator not updated (${err.message}). The existing public/sim/lib.wasm.gz stays.`);
		return 'kept';
	}
}

const count = (list, keyFn) => list.reduce((acc, x) => ((acc[keyFn(x)] = (acc[keyFn(x)] ?? 0) + 1), acc), {});
const meta = {
	generatedAt: new Date().toISOString(),
	specs: specs.map(spec => spec.id),
	source: { repo: `https://github.com/${REPO}`, license: 'MIT', origin, commit },
	counts: {
		items: items.length,
		itemsBySlot: count(items, i => i.slot),
		itemsWithoutSource: items.filter(i => !i.sources).length,
		itemsWithEffects: items.filter(i => i.effects).length,
		enchants: enchants.length,
		zones: count(zones, z => z.kind),
		npcs: npcs.length,
		randomSuffixes: randomSuffixes.length,
		simSets: simSets.length,
		simItems: simDb.items.length,
	},
};

await mkdir(OUT_DIR, { recursive: true });
await mkdir(SIM_DIR, { recursive: true });
const wasmStatus = await fetchWasm();
// The sim files are fetched by the browser on demand, so they are written compact.
await writeFile(join(SIM_DIR, 'db.json'), JSON.stringify(simDb));
for (const [specId, template] of simTemplates) await writeFile(join(SIM_DIR, `template.${specId}.json`), JSON.stringify(template));

// What the "Sim setup" tab needs to show and change the sim's settings in words: talent trees per
// class, spell and item names for the rotation, and the consumables the sim knows.
const talentTrees = {};
for (const className of new Set(specs.map(spec => spec.className))) {
	const trees = await readRepoJson(`ui/sim/talents/trees/${className.toLowerCase()}.json`);
	if (!Array.isArray(trees)) {
		console.warn(`Talent trees for ${className} not read.`);
		continue;
	}
	talentTrees[className] = trees.map(tree => ({
		name: tree.name,
		talents: tree.talents.map(t => ({ name: t.fancyName, max: t.maxPoints, row: t.location.rowIdx, col: t.location.colIdx })),
	}));
}
const CONSUMABLE_KINDS = { 1: 'potion', 2: 'flask', 3: 'food', 4: 'scroll', 5: 'explosive', 6: 'imbue', 7: 'other', 11: 'elixir', 12: 'conjured', 13: 'weaponImbue' };
// Names for the rotation text. The database names the spells and items the sim UI shows icons for; a
// rotation also asks about hidden effects and gear, which are named from the sim's own spell table
// and the item list.
const spellNames = Object.fromEntries((db.spellIcons ?? []).map(spell => [spell.id, spell.name]));
const itemNames = Object.fromEntries((db.itemIcons ?? []).map(item => [item.id, item.name]));
const rotationIds = { spell: new Set(), item: new Set() };
const collectIds = node => {
	if (Array.isArray(node)) return node.forEach(collectIds);
	if (!node || typeof node !== 'object') return;
	if (typeof node.spellId === 'number') rotationIds.spell.add(node.spellId);
	if (typeof node.itemId === 'number') rotationIds.item.add(node.itemId);
	Object.values(node).forEach(collectIds);
};
for (const template of simTemplates.values()) collectIds(template.raid.parties[0].players[0].rotation);
for (const id of rotationIds.item) itemNames[id] ??= db.items.find(item => item.id === id)?.name;
const unnamedSpells = [...rotationIds.spell].filter(id => !spellNames[id]);
if (unnamedSpells.length) {
	const spellTable = args.repo ? await readFile(join(args.repo, 'sim/core/spelldata/spells_auto_gen.go'), 'utf8').catch(() => '') : '';
	for (const id of unnamedSpells) {
		const name = spellTable.match(new RegExp(`\\{ID: ${id}, Name: "([^"]*)"`))?.[1];
		if (name) spellNames[id] = name;
		else console.warn(`No name for spell ${id} used in a rotation${args.repo ? '' : ' (run with --repo to read the sim\'s spell table)'}.`);
	}
}
// Every buff and debuff the sim knows, from its proto definition, with the labels and steps of the
// sim's own settings page.
const readRepoText = async path => (args.repo ? readFile(join(args.repo, path), 'utf8').catch(() => '') : fetch(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path}`).then(res => (res.ok ? res.text() : ''), () => ''));
const buffsProto = await readRepoText('proto/buffs.proto');
const buffInputs = await readRepoText('ui/features/settings/model/buffs_debuffs_auto_gen.ts');
const buffLabels = new Map();
for (const block of buffInputs.split(/\nexport const /).slice(1)) {
	const fieldName = block.match(/fieldName: '([^']+)'/)?.[1];
	if (!fieldName) continue;
	const ranks = [...block.matchAll(/\{ actionId: [^}]*label: (['"])(.*?)\1 \}/g)].map(m => m[2]);
	const label = [...block.matchAll(/\n\tlabel: (['"])(.*?)\1/g)].pop()?.[2];
	buffLabels.set(fieldName, { label, ranks, numStates: Number(block.match(/numStates: (\d+)/)?.[1] ?? 0) });
}
const HAND_KEPT_STEPS = {
	battleShout: ['Rank 6', 'Rank 7 (Manual of Battle Shout VII)', 'Rank 7 with three pieces of Battlegear of Wrath'],
	punctureArmor: ['Bashguuder', 'Rivenspike', 'Vibroblade'],
};
const camel = name => name.replace(/_(\w)/g, (_, c) => c.toUpperCase());
const titled = key => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
const buffFields = message => {
	const body = buffsProto.match(new RegExp(`message ${message} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
	return [...body.matchAll(/^\s*(bool|int32|TristateEffect)\s+(\w+)\s*=/gm)].map(([, type, name]) => {
		const key = camel(name);
		const known = buffLabels.get(key);
		const label = known?.label ?? titled(key);
		if (type === 'bool') return { key, label };
		if (type === 'TristateEffect') return { key, label, steps: ['On', 'Improved'] };
		const steps = HAND_KEPT_STEPS[key] ?? (known?.ranks.length ? known.ranks.map(rank => rank.replace(`${label} `, '')) : known?.numStates ? Array.from({ length: known.numStates - 1 }, (_, i) => String(i + 1)) : null);
		return steps ? { key, label, steps } : { key, label, count: true };
	});
};
const simBuffs = { raid: buffFields('RaidBuffs'), party: buffFields('PartyBuffs'), player: buffFields('IndividualBuffs'), debuffs: buffFields('Debuffs') };
if (!simBuffs.raid.length) console.warn('Buff definitions not read: the Sim setup tab will list only the buffs a build uses.');
const simSetup = {
	buffs: simBuffs,
	trees: talentTrees,
	spells: spellNames,
	items: Object.fromEntries(Object.entries(itemNames).filter(([, name]) => name)),
	consumables: (db.consumables ?? [])
		.filter(c => CONSUMABLE_KINDS[c.type])
		.map(c => compact({ id: c.id, name: c.name, kind: CONSUMABLE_KINDS[c.type], level: c.lvl, resource: c.potionClasses?.includes(1) || undefined, group: c.groupName, groupKey: c.groupKey })),
};
if (Object.keys(talentTrees).length) await writeFile(join(SIM_DIR, 'setup.json'), JSON.stringify(simSetup));
for (const spec of specs) if (!simTemplates.has(spec.id)) console.warn(`Sim template for ${spec.id} not written: its build could not be read. The existing file stays.`);
const write = (name, data) => writeFile(join(OUT_DIR, name), JSON.stringify(data, null, '\t') + '\n');
await Promise.all([
	write('items.json', items),
	write('enchants.json', enchants),
	write('zones.json', zones),
	write('npcs.json', npcs),
	write('randomSuffixes.json', randomSuffixes),
	...(simSets.length ? [write('simSets.json', simSets)] : []),
	write('meta.json', meta),
]);

console.log(`Wrote ${OUT_DIR} and ${SIM_DIR} (simulator: ${wasmStatus})`);
console.log(JSON.stringify(meta.counts, null, 2));
