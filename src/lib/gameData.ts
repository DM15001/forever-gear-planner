import { buildGuides, type Guide, type SimSet } from './guides';
import wingConfig from '../config/dungeonWings.json';
import { applyLoot } from './loot';
import { DEFAULT_SPEC, enchantUsableBy, usableBy } from './specs';
import type { Enchant, Item, Npc, RandomSuffix, SimValues, SlotKind, SpecConfig, Zone, Fight } from './types';

export interface GameData {
	/** The enemy kind and terrain the scores assume, from the character. */
	fight?: Fight;
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

/**
 * Loads the generated data as separate chunks, so the page shell appears before the 2 MB item list,
 * and narrows it to what one spec can use: its items, its enchants, its guide lists.
 */
export async function loadGameData(spec: SpecConfig = DEFAULT_SPEC): Promise<GameData> {
	const [items, enchants, suffixes, zones, npcs, simSets, simValuesJson, setValuesJson, meta] = await Promise.all([
		import('../data/items.json'),
		import('../data/enchants.json'),
		import('../data/randomSuffixes.json'),
		import('../data/zones.json'),
		import('../data/npcs.json'),
		import('../data/simSets.json'),
		import('../data/simValues.json'),
		import('../data/setValues.json'),
		import('../data/meta.json'),
	]);
	const enchantsBySlot = new Map<SlotKind, Enchant[]>();
	const specEnchants = (enchants.default as unknown as Enchant[]).filter(enchant => enchantUsableBy(enchant, spec));
	for (const enchant of specEnchants) {
		for (const slot of enchant.slots) {
			if (!enchantsBySlot.has(slot)) enchantsBySlot.set(slot, []);
			enchantsBySlot.get(slot)!.push(enchant);
		}
	}
	for (const list of enchantsBySlot.values()) list.sort((a, b) => a.name.localeCompare(b.name));
	// The item records are copied: loading adds dungeon names and drop chances to their sources.
	const itemById = new Map((items.default as unknown as Item[]).filter(item => usableBy(item, spec)).map(item => [item.id, { ...item, sources: item.sources?.map(source => ({ ...source })) }]));
	const zoneById = byId<Zone>(zones.default);
	const npcById = byId<Npc>(npcs.default);
	// An item with a random suffix is planned with the suffix that is worth most to this spec.
	const suffixById = byId<RandomSuffix>(suffixes.default);
	for (const item of itemById.values()) {
		if (!item.randomSuffixOptions?.length || !item.randPropPoints) continue;
		let best: { id: number; name: string; worth: number } | null = null;
		for (const id of item.randomSuffixOptions) {
			const suffix = suffixById.get(id);
			if (!suffix) continue;
			let worth = 0;
			for (const [key, share] of Object.entries(suffix.stats)) worth += Math.floor((item.randPropPoints * share) / 10000) * (spec.weights.stats[key] ?? 0);
			if (!best || worth > best.worth) best = { id, name: suffix.name, worth };
		}
		if (best && best.worth > 0) {
			item.bestSuffix = best.id;
			item.bestSuffixName = best.name;
		}
	}
	applyLoot(itemById, npcById, zoneById);
	tagDungeons([...itemById.values(), ...specEnchants], zoneById, npcById);
	return {
		itemById,
		enchantsBySlot,
		suffixById,
		zoneById,
		npcById,
		guides: buildGuides((simSets.default as unknown as SimSet[]).filter(set => set.spec === spec.id), spec.id),
		// Effects, proc enchants and set bonuses have only been measured for the Enhancement Shaman so far.
		simValues: withSetValues(
			readSimValues(spec.id === DEFAULT_SPEC.id ? (simValuesJson.default as unknown as RawSimValues) : EMPTY_SIM_VALUES, spec.weights.dpsPerPoint ?? 1),
			(setValuesJson.default as unknown as RawSetValues).specs[spec.id],
		),
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

const EMPTY_SIM_VALUES = { items: {}, enchants: {}, sets: {}, measured: { items: [], enchants: [], sets: [] } } as unknown as RawSimValues;

interface RawSimValues {
	items: Record<string, { ep: number }>;
	enchants: Record<string, { ep: number }>;
	sets: Record<string, { byCount: Record<string, { ep: number }> }>;
	measured: { items: number[]; enchants: number[]; sets: number[] };
}

interface RawSetValues {
	specs: Record<string, { sets: Record<string, { byCount: Record<string, number> }>; measured: number[] } | undefined>;
}

/**
 * Adds the set bonuses measured for this build (scripts/build-set-values.mjs, already in DPS).
 * Where the big measurement (simValues.json, Enhancement only) has a set too, that one stays.
 */
function withSetValues(values: SimValues, own: RawSetValues['specs'][string]): SimValues {
	if (!own) return values;
	for (const [id, set] of Object.entries(own.sets)) {
		if (!values.sets.has(Number(id))) values.sets.set(Number(id), new Map(Object.entries(set.byCount).map(([count, dps]) => [Number(count), dps])));
	}
	for (const id of own.measured) values.measuredSets.add(id);
	return values;
}

/** The measured values are stored in the spec's points; `factor` turns them into estimated DPS like the weights. */
function readSimValues(raw: RawSimValues, factor: number): SimValues {
	const epMap = (record: Record<string, { ep: number }>) => new Map(Object.entries(record).map(([id, value]) => [Number(id), value.ep * factor]));
	return {
		items: epMap(raw.items),
		enchants: epMap(raw.enchants),
		sets: new Map(Object.entries(raw.sets).map(([id, set]) => [Number(id), epMap(set.byCount)])),
		measuredItems: new Set(raw.measured.items),
		measuredEnchants: new Set(raw.measured.enchants),
		measuredSets: new Set(raw.measured.sets),
	};
}
