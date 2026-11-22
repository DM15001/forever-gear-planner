// Reads the loot tables of the "AtlasLoot Classic Forever" addon (CurseForge, GPL v2) and writes
// src/config/atlasloot/sources.json: where items come from that the WoWSims data has no source for.
//
//   node scripts/import-atlasloot.mjs path/to/AddOns
//
// path/to/AddOns is the folder that holds AtlasLootClassic_DungeonsAndRaids. Run it again after the
// addon updates: its authors add Forever loot as players find it.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
			const name = text.match(/^name\s*=\s*"([^"]+)"/);
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

const folder = join(addons, 'AtlasLootClassic_DungeonsAndRaids');
const instances = [...parse(join(folder, 'data.lua')), ...parse(join(folder, 'forever.lua'))];
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

const usedZones = new Set(Object.values(sources).flatMap(list => list.map(s => s.zoneId)));
const out = {
	_comment:
		'Sources for items the WoWSims data has none for, from the loot tables of the AtlasLoot Classic Forever addon (CurseForge, by Sliccer, GPL v2). Written by scripts/import-atlasloot.mjs; do not edit by hand. "zones" are dungeons and raids the WoWSims data does not know, with made-up ids.',
	importedAt: new Date().toISOString().slice(0, 10),
	zones: [...newZones.values()].filter(z => usedZones.has(z.id)),
	sources,
};
mkdirSync(join(root, 'src/config/atlasloot'), { recursive: true });
writeFileSync(join(root, 'src/config/atlasloot/sources.json'), JSON.stringify(out, null, '\t') + '\n');
console.log(`${Object.keys(sources).length} items got a source, ${out.zones.length} new zones: ${out.zones.map(z => z.name).join(', ')}`);
