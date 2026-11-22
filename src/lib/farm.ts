import { GEAR_SLOTS } from './constants';
import { runChance } from './loot';
import { type CandidateOptions, EVERYTHING, filterKey, plannedGear, scoreSet, slotCandidates, usableSources } from './scoring';
import type { Item, ItemSource, Zone } from './types';

export interface FarmDrop {
	item: Item;
	/** The slot where this item is the bigger upgrade (matters for rings and trinkets). */
	slotIndex: number;
	/** Change in set score when this item alone replaces the equipped one. */
	delta: number;
	/** The item is part of the saved plan. */
	planned: boolean;
}

export interface FarmBoss {
	name: string;
	drops: FarmDrop[];
	/** Per item id: the source of the drop at this boss, with drop and spawn chances where known. */
	sources: Map<number, ItemSource>;
	/** Set when the boss is not there on every run. */
	spawnChance?: number;
	spawnBasis?: ItemSource['spawnBasis'];
	spawnNote?: string;
}

export interface FarmDungeon {
	/** Unique per ranking entry: a zone, or one wing of it. */
	key: string;
	/** "Blackrock Spire: Lower", or the plain zone name. */
	name: string;
	zone: Zone;
	bosses: FarmBoss[];
	/** Sum of the best upgrade per slot. An upper bound: hit past the cap is not netted out across slots. */
	value: number;
	/**
	 * Expected gain from one run: per slot, the best of (gain x chance to see the item), added up.
	 * Counts only drops with a known drop chance, so it is a lower bound where chances are missing.
	 */
	perRun: number;
	/** How many of the upgrades have a known drop chance. */
	knownChances: number;
	upgradeCount: number;
	plannedCount: number;
}

/** Every upgrade over the equipped gear, once per item, in the slot where it gains most. */
export function allUpgrades(options: CandidateOptions): FarmDrop[] {
	const { character, spec } = options;
	const planned = new Set(Object.values(character.plan ?? {}));
	const best = new Map<number, FarmDrop>();
	GEAR_SLOTS.forEach((slot, slotIndex) => {
		if (spec.weaponSetup === 'twoHand' && slot.key === 'offHand') return;
		for (const { item, delta } of slotCandidates(slotIndex, character.gear, options)) {
			if (delta <= 0) break; // sorted best first
			const known = best.get(item.id);
			if (!known || delta > known.delta) best.set(item.id, { item, slotIndex, delta, planned: planned.has(item.id) });
		}
	});
	return [...best.values()];
}

/** Dungeons ranked by how much their drops could improve the equipped gear. */
export function dungeonRanking(options: CandidateOptions): FarmDungeon[] {
	const { character, data, spec, filter } = options;
	const faction = spec.races.find(r => r.id === character.race)?.faction;
	const dungeons = new Map<string, { key: string; name: string; zone: Zone; bosses: Map<string, FarmDrop[]>; sources: Map<string, Map<number, ItemSource>> }>();

	for (const drop of allUpgrades(options)) {
		for (const source of usableSources(drop.item, faction, filter, character.professions)) {
			if (!source.dungeonKey || !source.zoneId) continue;
			const zone = data.zoneById.get(source.zoneId);
			if (!zone) continue;
			const bossName = ((source.npcId ? data.npcById.get(source.npcId)?.name : undefined) ?? source.otherName ?? 'Unknown').trim();
			const key = source.dungeonKey;
			if (!dungeons.has(key)) dungeons.set(key, { key, name: source.dungeonName ?? zone.name, zone, bosses: new Map(), sources: new Map() });
			const { bosses, sources } = dungeons.get(key)!;
			if (!bosses.has(bossName)) bosses.set(bossName, []);
			if (!sources.has(bossName)) sources.set(bossName, new Map());
			sources.get(bossName)!.set(drop.item.id, source);
			if (!bosses.get(bossName)!.includes(drop)) bosses.get(bossName)!.push(drop);
		}
	}

	return [...dungeons.values()]
		.map(({ key, name, zone, bosses, sources }) => {
			const drops = new Set([...bosses.values()].flat());
			const bestPerSlot = new Map<number, number>();
			for (const drop of drops) bestPerSlot.set(drop.slotIndex, Math.max(bestPerSlot.get(drop.slotIndex) ?? 0, drop.delta));
			const bestOf = (list: FarmDrop[]) => Math.max(...list.map(d => d.delta));
			// Per slot only one item ends up worn, so a run is worth the best expected gain per slot.
			const perRunBySlot = new Map<number, number>();
			const known = new Set<number>();
			for (const [bossName, list] of bosses) {
				for (const drop of list) {
					const chance = runChance(sources.get(bossName)!.get(drop.item.id));
					if (chance === undefined) continue;
					known.add(drop.item.id);
					perRunBySlot.set(drop.slotIndex, Math.max(perRunBySlot.get(drop.slotIndex) ?? 0, drop.delta * chance));
				}
			}
			return {
				key,
				name,
				zone,
				bosses: [...bosses.entries()]
					.map(([name, list]) => {
						const bossSources = sources.get(name)!;
						const random = [...bossSources.values()].find(source => source.spawnChance !== undefined);
						return { name, drops: list.sort((a, b) => b.delta - a.delta), sources: bossSources, spawnChance: random?.spawnChance, spawnBasis: random?.spawnBasis, spawnNote: random?.spawnNote };
					})
					.sort((a, b) => bestOf(b.drops) - bestOf(a.drops)),
				value: [...bestPerSlot.values()].reduce((sum, v) => sum + v, 0),
				perRun: [...perRunBySlot.values()].reduce((sum, v) => sum + v, 0),
				knownChances: known.size,
				upgradeCount: drops.size,
				plannedCount: [...drops].filter(d => d.planned).length,
			};
		})
		.sort((a, b) => b.value - a.value);
}

export type PlanGroupKind = 'dungeon' | 'world' | 'quest' | 'crafted' | 'vendor' | 'rep' | 'pvp' | 'unknown';

export interface PlanEntry {
	item: Item;
	slotIndex: number;
	/** Change in set score from this one swap, on top of the equipped gear. */
	delta: number;
	/** The source the item is filed under; undefined when the data has none. */
	source?: ItemSource;
	/** A crafted item whose profession the character has. */
	craftable: boolean;
}

export const PLAN_GROUP_ORDER: PlanGroupKind[] = ['dungeon', 'quest', 'crafted', 'vendor', 'rep', 'world', 'pvp', 'unknown'];

const groupOf = (source: ItemSource | undefined): PlanGroupKind => {
	if (!source) return 'unknown';
	if (source.kind === 'drop') return source.zoneKind === 'dungeon' ? 'dungeon' : 'world';
	const key = filterKey(source);
	return key === 'currency' ? 'vendor' : (key as PlanGroupKind);
};

/** The planned items, grouped by how to get them. Each item is filed under its first usable source. */
export function planShoppingList(options: CandidateOptions): Map<PlanGroupKind, PlanEntry[]> {
	const { character, data, spec } = options;
	const faction = spec.races.find(r => r.id === character.race)?.faction;
	const base = scoreSet(character.gear, character, data, spec).score;
	const planned = plannedGear(character);
	const groups = new Map<PlanGroupKind, PlanEntry[]>();

	for (const [slotKey, itemId] of Object.entries(character.plan ?? {})) {
		const slotIndex = Number(slotKey);
		const item = data.itemById.get(itemId);
		if (!item || itemId === character.gear[slotIndex]?.id) continue;
		// The plan is the user's choice, so look at every source kind, not just the filtered ones.
		const source = usableSources(item, faction, EVERYTHING)[0];
		const single = character.gear.map((piece, i) => (i === slotIndex ? planned[i] : piece));
		const entry: PlanEntry = {
			item,
			slotIndex,
			delta: scoreSet(single, character, data, spec).score - base,
			source,
			craftable: source?.kind === 'crafted' && character.professions.includes(source.profession ?? ''),
		};
		const kind = groupOf(source);
		if (!groups.has(kind)) groups.set(kind, []);
		groups.get(kind)!.push(entry);
	}
	for (const list of groups.values()) list.sort((a, b) => b.delta - a.delta);
	return groups;
}
