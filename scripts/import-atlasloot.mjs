// Reads the loot tables of the "AtlasLoot Classic Forever" addon (CurseForge, GPL v2) and writes
// src/config/atlasloot/sources.json: where items come from that the WoWSims data has no source for.
//
//   node scripts/import-atlasloot.mjs path/to/AddOns
//
// path/to/AddOns is the folder that holds AtlasLootClassic_DungeonsAndRaids. Run it again after the
// addon updates: its authors add Forever loot as players find it.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const addons = process.argv[2];
if (!addons) {
	console.error('Usage: node scripts/import-atlasloot.mjs path/to/AddOns');
	process.exit(1);
}
const root = new URL('..', import.meta.url).pathname;

/** The instances of one AtlasLoot data file: name, kind and per boss the item ids. */
function parse(path) {
	const instances = [];
	let instance = null;
	let boss = null;
	let inLoot = false;
	for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
		const text = line.trim();
		if (text.startsWith('--')) continue;
		const start = line.match(/^data\["([^"]+)"\]\s*=\s*\{/);
		if (start) {
			instance = { key: start[1], name: null, mapId: null, raid: false, bosses: [] };
			instances.push(instance);
			boss = null;
			continue;
		}
		if (!instance) continue;
		const indent = line.length - line.replace(/^\t+/, '').length;
		if (indent === 1) {
			// Plain or through the addon's translation table: name = "…" or name = AL["…"].
			const name = text.match(/^name\s*=\s*(?:AL\[)?"([^"]+)"/);
			if (name) instance.name = name[1];
			const map = text.match(/^MapID\s*=\s*(\d+)/);
			if (map) instance.mapId = Number(map[1]);
			if (/^ContentType\s*=\s*\w*RAID/.test(text)) instance.raid = true;
		} else if (indent === 2 && text.startsWith('{')) {
			boss = { name: null, npcId: null, items: [] };
			instance.bosses.push(boss);
			inLoot = false;
		} else if (boss && indent === 3) {
			const name = text.match(/^name\s*=\s*(?:AL\[)?"([^"]+)"/);
			if (name) boss.name = name[1].trim();
			const npc = text.match(/^npcID\s*=\s*\{?\s*(\d+)/);
			if (npc) boss.npcId = Number(npc[1]);
			inLoot = /^\[\w+\]\s*=\s*\{/.test(text) ? true : inLoot;
		} else if (boss && inLoot && indent >= 4) {
			const item = text.match(/^\{\s*\d+\s*,\s*(\d{3,6})\s*[,}]/);
			if (item) boss.items.push(Number(item[1]));
		}
	}
	return instances;
}

// Two addons carry these tables in the same format under different names: "AtlasLoot Classic Forever"
// (AtlasLootClassic_DungeonsAndRaids, forever.lua) and "AtlasLoot Continued" (AtlasLootContinued_DungeonsAndRaids,
// data-forever.lua). Whichever is in the folder is read.
const folder = ['AtlasLootClassic_DungeonsAndRaids', 'AtlasLootContinued_DungeonsAndRaids'].map(name => join(addons, name)).find(path => existsSync(join(path, 'data.lua')));
if (!folder) {
	console.error(`No AtlasLoot dungeon data in ${addons}: expected AtlasLootClassic_DungeonsAndRaids or AtlasLootContinued_DungeonsAndRaids with a data.lua.`);
	process.exit(1);
}
const foreverFile = ['forever.lua', 'data-forever.lua'].map(name => join(folder, name)).find(path => existsSync(path));
const instances = [...parse(join(folder, 'data.lua')), ...(foreverFile ? parse(foreverFile) : [])];
console.log(`Read ${folder.split(/[\\/]/).pop()}${foreverFile ? ` with ${foreverFile.split(/[\\/]/).pop()}` : ', without a Forever file'}.`);
const items = JSON.parse(readFileSync(join(root, 'src/data/items.json'), 'utf8'));
const zones = JSON.parse(readFileSync(join(root, 'src/data/zones.json'), 'utf8'));
const plain = name => name.replace(/^The /, '').toLowerCase();
const zoneByName = new Map(zones.map(z => [plain(z.name), z]));
const zoneById = new Map(zones.map(z => [z.id, z]));
const withoutSource = new Set(items.filter(i => !i.sources?.length).map(i => i.id));

// Dungeons and raids the WoWSims data does not know get an id of their own, far from real zone ids.
const newZones = new Map();
const zoneOf = instance => {
	if (instance.mapId && zoneById.has(instance.mapId)) return instance.mapId;
	if (!instance.name) return undefined;
	const known = zoneByName.get(plain(instance.name));
	if (known) return known.id;
	const key = plain(instance.name);
	if (!newZones.has(key)) newZones.set(key, { id: 9_900_000 + newZones.size + 1, name: instance.name, kind: instance.raid ? 'raid' : 'dungeon' });
	return newZones.get(key).id;
};

const sources = {};
for (const instance of instances) {
	for (const boss of instance.bosses) {
		// The addon uses boss names as notes where it has no loot yet.
		if (!boss.name || /no drops discovered|will be updated/i.test(boss.name)) continue;
		for (const id of boss.items) {
			if (!withoutSource.has(id)) continue;
			const zoneId = zoneOf(instance);
			if (!zoneId) continue;
			const list = (sources[id] ??= []);
			if (!list.some(s => s.zoneId === zoneId && s.boss === boss.name)) list.push({ zoneId, boss: boss.name, ...(boss.npcId ? { npcId: boss.npcId } : {}) });
		}
	}
}

// Two addons, not the same tables: an item an earlier import placed in a real dungeon stays there when this one
// does not list it and nothing else names a source for it. Made-up zones are not carried over: their ids are reused.
let carried = 0;
const outPath = join(root, 'src/config/atlasloot/sources.json');
if (existsSync(outPath)) {
	const before = JSON.parse(readFileSync(outPath, 'utf8')).sources ?? {};
	for (const [id, list] of Object.entries(before)) {
		if (sources[id] || !withoutSource.has(Number(id)) || !list.every(source => zoneById.has(source.zoneId))) continue;
		sources[id] = list;
		carried++;
	}
}

const usedZones = new Set(Object.values(sources).flatMap(list => list.map(s => s.zoneId)));
const out = {
	_comment:
		'Sources for items the WoWSims data has none for, from the loot tables of the addons AtlasLoot Classic Forever (CurseForge, by Sliccer, GPL v2) and AtlasLoot Continued (by Okrah and Lag, GPL v2). Written by scripts/import-atlasloot.mjs; do not edit by hand. "zones" are dungeons and raids the WoWSims data does not know, with made-up ids.',
	importedAt: new Date().toISOString().slice(0, 10),
	zones: [...newZones.values()].filter(z => usedZones.has(z.id)),
	sources,
};
mkdirSync(join(root, 'src/config/atlasloot'), { recursive: true });
writeFileSync(join(root, 'src/config/atlasloot/sources.json'), JSON.stringify(out, null, '\t') + '\n');
console.log(`${Object.keys(sources).length} items got a source (${carried} kept from the import before), ${out.zones.length} new zones: ${out.zones.map(z => z.name).join(', ')}`);
