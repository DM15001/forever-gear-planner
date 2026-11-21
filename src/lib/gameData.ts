import type { Enchant, Item, SlotKind } from './types';

export interface GameData {
	itemById: Map<number, Item>;
	enchantsBySlot: Map<SlotKind, Enchant[]>;
	builtAt: string;
}

/** Loads the generated data as separate chunks, so the page shell appears before the 2 MB item list. */
export async function loadGameData(): Promise<GameData> {
	const [items, enchants, meta] = await Promise.all([import('../data/items.json'), import('../data/enchants.json'), import('../data/meta.json')]);
	const itemById = new Map((items.default as unknown as Item[]).map(item => [item.id, item]));
	const enchantsBySlot = new Map<SlotKind, Enchant[]>();
	for (const enchant of enchants.default as unknown as Enchant[]) {
		for (const slot of enchant.slots) {
			if (!enchantsBySlot.has(slot)) enchantsBySlot.set(slot, []);
			enchantsBySlot.get(slot)!.push(enchant);
		}
	}
	for (const list of enchantsBySlot.values()) list.sort((a, b) => a.name.localeCompare(b.name));
	return { itemById, enchantsBySlot, builtAt: meta.default.generatedAt };
}
