import atlasConfig from '../config/atlasloot/sources.json';
import classicConfig from '../config/droprates.classic.json';
import encounterConfig from '../config/encounters.json';
import manualConfig from '../config/sources.manual.json';
import lootConfig from '../config/wowhead/loot.json';
import type { Faction, Item, ItemSource, Npc, Zone } from './types';

interface LootEntry {
	/** `count` of `outOf` kills gave the item; left out when only the creature is known. */
	drops?: { npcId: number; count?: number; outOf?: number }[];
	containers?: { name: string; zoneId?: number; count?: number; outOf?: number }[];
	/** `questId` is left out when only the quest's name is known. */
	quests?: { questId?: number; name: string; faction?: Faction }[];
	/** A drop from a creature the data does not have, by name. */
	namedDrops?: { name: string; zoneId?: number }[];
	crafted?: { spellId: number; profession: string };
	/** Drops somewhere in this dungeon or zone; which creature is not known. */
	zoneDrops?: { zoneId: number }[];
	/** A random drop from many creatures (bind on equip): in practice an auction house item. */
	worldDrop?: boolean;
}
interface Encounter {
	chance: number;
	basis: 'mechanic' | 'kills' | 'estimate';
	note?: string;
}

const LOOT = lootConfig as unknown as { fetchedAt: string; items: Record<string, LootEntry>; npcs: Record<string, { name: string; zoneId?: number }> };
const ATLAS = atlasConfig as unknown as { zones: Zone[]; sources: Record<string, { zoneId: number; boss: string; npcId?: number }[]> };
const CLASSIC = (classicConfig as unknown as { rates: Record<string, Record<string, number>> }).rates;
const ENCOUNTERS = encounterConfig as unknown as Record<string, Encounter | string>;

/** Item ids from here on are new in Forever. */
const FIRST_FOREVER_ITEM = 200000;

/** The day the Wowhead loot numbers were read. */
export const LOOT_DATE = LOOT.fetchedAt;

/**
 * Adds what AtlasLoot and Wowhead know to the item data: drop chances on drops the data already has, sources
 * for items that had none, and a spawn chance on bosses that are not there on every run.
 */
export function applyLoot(itemById: Map<number, Item>, npcById: Map<number, Npc>, zoneById: Map<number, Zone>): void {
	// Dungeons the WoWSims data does not know, and the items that drop there (AtlasLoot Classic Forever).
	for (const zone of ATLAS.zones) if (!zoneById.has(zone.id)) zoneById.set(zone.id, zone);
	for (const [id, list] of Object.entries(ATLAS.sources)) {
		const item = itemById.get(Number(id));
		if (!item || item.sources?.length) continue;
		item.sources = list.map(s => ({
			kind: 'drop' as const,
			zoneId: s.zoneId,
			zoneKind: zoneById.get(s.zoneId)?.kind,
			...(s.npcId && npcById.has(s.npcId) ? { npcId: s.npcId } : { otherName: s.boss }),
		}));
	}
	for (const [id, npc] of Object.entries(LOOT.npcs)) {
		if (!npcById.has(Number(id))) npcById.set(Number(id), { id: Number(id), ...npc });
	}
	// Hand-kept sources win over the fetched ones for the same item.
	const manual = manualConfig as unknown as { items: Record<string, LootEntry>; npcs?: Record<string, { name: string; zoneId?: number }> };
	for (const [id, npc] of Object.entries(manual.npcs ?? {})) {
		if (!npcById.has(Number(id))) npcById.set(Number(id), { id: Number(id), ...npc });
	}
	const MANUAL = manual.items;
	for (const [id, entry] of Object.entries({ ...LOOT.items, ...MANUAL })) {
		const item = itemById.get(Number(id));
		if (!item) continue;
		if (!item.sources?.length) {
			const found = sourcesFrom(entry, npcById, zoneById);
			if (found.length) item.sources = found;
		}
		const sources = item.sources ?? [];
		for (const drop of entry.drops ?? []) {
			const source = sources.find(s => s.kind === 'drop' && s.npcId === drop.npcId);
			if (!source || !drop.count || !drop.outOf) continue;
			source.dropChance = drop.count / drop.outOf;
			source.dropBasis = 'forever';
			source.dropSample = drop.outOf;
		}
		for (const box of entry.containers ?? []) {
			// The WoWSims data names chests loosely ("Tribute" for "Gordok Tribute"), so match on the zone and a shared name.
			const source = sources.find(s => s.kind === 'drop' && !s.npcId && Boolean(s.otherName?.trim()) && (box.name.includes(s.otherName!.trim()) || s.otherName!.includes(box.name)) && (!box.zoneId || !s.zoneId || s.zoneId === box.zoneId));
			if (!source || !box.count || !box.outOf) continue;
			source.dropChance = box.count / box.outOf;
			source.dropBasis = 'forever';
			source.dropSample = box.outOf;
		}
		// A chest the WoWSims data files under a boss of the same dungeon (the Gordok Tribute under Cho'Rush).
		for (const box of entry.containers ?? []) {
			const source = box.zoneId ? sources.find(s => s.kind === 'drop' && s.zoneId === box.zoneId && s.dropChance === undefined) : undefined;
			if (!source || !box.count || !box.outOf || sources.some(s => s.dropBasis === 'forever')) continue;
			source.dropChance = box.count / box.outOf;
			source.dropBasis = 'forever';
			source.dropSample = box.outOf;
		}
	}
	for (const item of itemById.values()) {
		for (const source of item.sources ?? []) {
			if (source.kind !== 'drop') continue;
			// No Forever numbers: fall back to the rate the same boss had in WoW Classic.
			const classic = source.npcId ? CLASSIC[source.npcId]?.[item.id] : undefined;
			if (source.dropChance === undefined && classic) {
				source.dropChance = classic / 100;
				source.dropBasis = 'classic';
			}
			const name = ((source.npcId ? npcById.get(source.npcId)?.name : undefined) ?? source.otherName ?? '').trim();
			const encounter = ENCOUNTERS[name];
			if (!encounter || typeof encounter === 'string') continue;
			source.spawnChance = encounter.chance;
			source.spawnBasis = encounter.basis;
			source.spawnNote = encounter.note;
		}
	}
	// What is left without a source and is an item of the original game (ids below 200,000): the WoWSims data only
	// lists bosses, quests, vendors and crafts. A green item with a random suffix ("of the Eagle") is a random drop
	// for certain. Other common and green items are taken as world drops, marked as assumed. Rare and epic items
	// are not guessed: too many of them turned out to be from one creature, a chest, or not in the game at all.
	// They stay "source unknown", like items new in Forever, until src/config/sources.manual.json names a source.
	for (const item of itemById.values()) {
		if (item.sources?.length || item.id >= FIRST_FOREVER_ITEM) continue;
		if (item.randomSuffixOptions?.length) item.sources = [{ kind: 'drop', otherName: 'World drop' }];
		else if (item.quality !== 'rare' && item.quality !== 'epic') item.sources = [{ kind: 'drop', otherName: 'World drop', assumed: true }];
	}
}

/** Sources for an item the WoWSims data has none for. Drops under 1% are left out: nobody farms those on purpose. */
function sourcesFrom(entry: LootEntry, npcById: Map<number, Npc>, zoneById: Map<number, Zone>): ItemSource[] {
	const sources: ItemSource[] = [];
	for (const drop of entry.drops ?? []) {
		if (drop.count && drop.outOf && drop.count / drop.outOf < 0.01) continue;
		const zoneId = npcById.get(drop.npcId)?.zoneId;
		sources.push({ kind: 'drop', npcId: drop.npcId, zoneId, zoneKind: zoneId ? zoneById.get(zoneId)?.kind : undefined });
	}
	for (const box of entry.containers ?? []) {
		if (!box.zoneId || (box.count && box.outOf && box.count / box.outOf < 0.01)) continue;
		sources.push({ kind: 'drop', otherName: box.name, zoneId: box.zoneId, zoneKind: zoneById.get(box.zoneId)?.kind });
	}
	for (const drop of entry.namedDrops ?? []) sources.push({ kind: 'drop', otherName: drop.name, zoneId: drop.zoneId, zoneKind: drop.zoneId ? zoneById.get(drop.zoneId)?.kind : undefined });
	for (const drop of entry.zoneDrops ?? []) sources.push({ kind: 'drop', zoneId: drop.zoneId, zoneKind: zoneById.get(drop.zoneId)?.kind });
	for (const quest of entry.quests ?? []) sources.push({ kind: 'quest', questId: quest.questId, name: quest.name, faction: quest.faction });
	if (entry.crafted) sources.push({ kind: 'crafted', profession: entry.crafted.profession, spellId: entry.crafted.spellId });
	// Only tiny chances from many creatures or chests: a random world drop, in practice an auction house item.
	if (!sources.length && (entry.worldDrop || entry.drops?.length || entry.containers?.length)) sources.push({ kind: 'drop', otherName: 'World drop' });
	return sources;
}

/** Chance per run to see the item: its drop chance times the chance that the boss is there. Undefined without a known drop chance. */
export function runChance(source: ItemSource | undefined): number | undefined {
	if (!source || source.dropChance === undefined) return undefined;
	return source.dropChance * (source.spawnChance ?? 1);
}

const percent = (value: number) => (value >= 0.1 ? `${Math.round(value * 100)}%` : `${(value * 100).toFixed(1).replace(/\.0$/, '')}%`);
const oneIn = (chance: number) => `1 in ${Math.max(1, Math.round(1 / chance))}`;

/** "20% drop, about 5 runs", with the spawn chance for bosses that are not always there. Undefined when nothing is known. */
/** The short form for narrow rows: "4.3% drop" and "about 23 runs", each undefined when unknown. */
export function effortParts(source: ItemSource | undefined): { chance?: string; runs?: string } {
	if (!source || source.kind !== 'drop') return {};
	const chance = runChance(source);
	if (chance === undefined) return {};
	const runs = Math.max(1, Math.round(1 / chance));
	return { chance: `${percent(source.dropChance!)} drop${source.dropBasis === 'classic' ? '*' : ''}`, runs: `about ${runs.toLocaleString('en')} run${runs === 1 ? '' : 's'}` };
}

export function effortLine(source: ItemSource | undefined): string | undefined {
	if (!source || source.kind !== 'drop') return undefined;
	const spawn = source.spawnChance !== undefined ? `boss there ${oneIn(source.spawnChance)} runs${source.spawnBasis === 'estimate' ? ' (estimate)' : ''}` : undefined;
	const chance = runChance(source);
	if (chance === undefined) return spawn;
	const runs = Math.max(1, Math.round(1 / chance));
	return [`${percent(source.dropChance!)} drop${source.dropBasis === 'classic' ? ' (Classic rate)' : ''}`, spawn, `about ${runs.toLocaleString('en')} run${runs === 1 ? '' : 's'}`].filter(Boolean).join(', ');
}
