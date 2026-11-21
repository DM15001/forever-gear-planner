import { buildGuides, type Guide, type SimSet } from './guides';
import type { Enchant, Item, Npc, RandomSuffix, SlotKind, Zone } from './types';

export interface GameData {
	itemById: Map<number, Item>;
	enchantsBySlot: Map<SlotKind, Enchant[]>;
	suffixById: Map<number, RandomSuffix>;
	zoneById: Map<number, Zone>;
	npcById: Map<number, Npc>;
	/** Curated lists: the sim maintainers' sets and hand-kept guide lists. */
	guides: Guide[];
	builtAt: string;
}

const byId = <T extends { id: number }>(list: unknown) => new Map((list as T[]).map(entry => [entry.id, entry]));

/** Loads the generated data as separate chunks, so the page shell appears before the 2 MB item list. */
export async function loadGameData(): Promise<GameData> {
	const [items, enchants, suffixes, zones, npcs, simSets, meta] = await Promise.all([
		import('../data/items.json'),
		import('../data/enchants.json'),
		import('../data/randomSuffixes.json'),
		import('../data/zones.json'),
		import('../data/npcs.json'),
		import('../data/simSets.json'),
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
	return {
		itemById: byId<Item>(items.default),
		enchantsBySlot,
		suffixById: byId<RandomSuffix>(suffixes.default),
		zoneById: byId<Zone>(zones.default),
		npcById: byId<Npc>(npcs.default),
		guides: buildGuides(simSets.default as unknown as SimSet[]),
		builtAt: meta.default.generatedAt,
	};
}
