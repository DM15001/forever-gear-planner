import { buildGuides, type Guide, type SimSet } from './guides';
import wingConfig from '../config/dungeonWings.json';
import type { Enchant, Item, Npc, RandomSuffix, SimValues, SlotKind, Zone } from './types';

export interface GameData {
	itemById: Map<number, Item>;
	enchantsBySlot: Map<SlotKind, Enchant[]>;
	suffixById: Map<number, RandomSuffix>;
	zoneById: Map<number, Zone>;
	npcById: Map<number, Npc>;
	/** Curated lists: the sim maintainers' sets and hand-kept guide lists. */
	guides: Guide[];
	simValues: SimValues;
	builtAt: string;
}

const byId = <T extends { id: number }>(list: unknown) => new Map((list as T[]).map(entry => [entry.id, entry]));

/** Loads the generated data as separate chunks, so the page shell appears before the 2 MB item list. */
export async function loadGameData(): Promise<GameData> {
	const [items, enchants, suffixes, zones, npcs, simSets, simValuesJson, meta] = await Promise.all([
		import('../data/items.json'),
		import('../data/enchants.json'),
		import('../data/randomSuffixes.json'),
		import('../data/zones.json'),
		import('../data/npcs.json'),
		import('../data/simSets.json'),
		import('../data/simValues.json'),
		import('../data/meta.json'),
	]);
	const enchantsBySlot = new Map<SlotKind, Enchant[]>();
	for (const enchant of enchants.default as unknown as Enchant[]) {
		for (const slot of enchant.slots) {
			if (!enchantsBySlot.has(slot)) enchantsBySlot.set(slot, []);
			enchantsBySlot.get(slot)!.push(enchant);
		}
	}
	for (const list of enchantsBySlot.values()) list.sort((a, b) => a.name.localeCompare(b.name));
	const itemById = byId<Item>(items.default);
	const zoneById = byId<Zone>(zones.default);
	const npcById = byId<Npc>(npcs.default);
	tagDungeons([...itemById.values(), ...(enchants.default as unknown as Enchant[])], zoneById, npcById);
	return {
		itemById,
		enchantsBySlot,
		suffixById: byId<RandomSuffix>(suffixes.default),
		zoneById,
		npcById,
		guides: buildGuides(simSets.default as unknown as SimSet[]),
		simValues: readSimValues(simValuesJson.default as unknown as RawSimValues),
		builtAt: meta.default.generatedAt,
	};
}

const WINGS = wingConfig as unknown as Record<string, Record<string, string[]> | string>;

/**
 * Marks every dungeon drop with the dungeon, or the wing of it, that it belongs to. Bosses
 * a wing list does not name, and trash, stay under the dungeon's plain name.
 */
function tagDungeons(entries: { sources?: Item['sources'] }[], zoneById: Map<number, Zone>, npcById: Map<number, Npc>) {
	for (const entry of entries) {
		for (const source of entry.sources ?? []) {
			if (source.kind !== 'drop' || source.zoneKind !== 'dungeon' || !source.zoneId) continue;
			const zone = zoneById.get(source.zoneId);
			if (!zone) continue;
			const boss = ((source.npcId ? npcById.get(source.npcId)?.name : undefined) ?? source.otherName ?? '').trim();
			const wings = WINGS[zone.name];
			const wing = wings && typeof wings !== 'string' ? Object.keys(wings).find(name => wings[name].includes(boss)) : undefined;
			source.dungeonKey = `${zone.id}:${wing ?? ''}`;
			const hasWings = Boolean(wings && typeof wings !== 'string');
			source.dungeonName = wing ? `${zone.name}: ${wing}` : hasWings ? `${zone.name}: trash and other` : zone.name;
		}
	}
}

interface RawSimValues {
	items: Record<string, { ep: number }>;
	enchants: Record<string, { ep: number }>;
	sets: Record<string, { byCount: Record<string, { ep: number }> }>;
	measured: { items: number[]; enchants: number[]; sets: number[] };
}

function readSimValues(raw: RawSimValues): SimValues {
	const epMap = (record: Record<string, { ep: number }>) => new Map(Object.entries(record).map(([id, value]) => [Number(id), value.ep]));
	return {
		items: epMap(raw.items),
		enchants: epMap(raw.enchants),
		sets: new Map(Object.entries(raw.sets).map(([id, set]) => [Number(id), epMap(set.byCount)])),
		measuredItems: new Set(raw.measured.items),
		measuredEnchants: new Set(raw.measured.enchants),
		measuredSets: new Set(raw.measured.sets),
	};
}
