import { GEAR_SLOTS } from './constants';
import { runChance } from './loot';
import { type CandidateOptions, EVERYTHING, filterKey, plannedGear, scoreSet, slotCandidates, slotInUse, tierSets, usableSources } from './scoring';
import type { Item, ItemSource, Zone } from './types';

export interface FarmDrop {
	item: Item;
	/** The slot where this item is the bigger upgrade (matters for rings and trinkets). */
	slotIndex: number;
	/** Change in set score when this item alone replaces the equipped one. */
	delta: number;
	/** The item is part of the saved plan. */
	planned: boolean;
	/** Its place among the upgrades for that slot with the content that counts: 1 is the best of them. */
	rank: number;
	/** True if nothing in the game is better for this character in that slot, whatever content is switched on. */
	best?: boolean;
	/** For a Tier 0 piece: the Tier 0.5 piece it is handed in for, when that one is the upgrade wanted. */
	leadsTo?: Item;
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
	GEAR_SLOTS.forEach((_slot, slotIndex) => {
		if (!slotInUse(slotIndex, spec)) return;
		let rank = 0;
		for (const { item, delta } of slotCandidates(slotIndex, character.gear, options)) {
			if (delta <= 0) break; // sorted best first
			rank++;
			const known = best.get(item.id);
			if (!known || delta > known.delta) best.set(item.id, { item, slotIndex, delta, planned: planned.has(item.id), rank });
		}
	});
	return [...best.values()];
}

/** Dungeons ranked by how much their drops could improve the equipped gear. */
/** Which drops a farm list shows: every upgrade, only each slot's best in the game, or only what is in the plan. */
export type FarmShow = 'all' | 'bis' | 'plan';

/** True for the drop that nothing in the game beats in its slot: the measure is every source there is, not the content picked. */
export function markBest(drops: FarmDrop[], options: CandidateOptions): FarmDrop[] {
	const top = new Map<number, number>();
	for (const drop of allUpgrades({ ...options, filter: { ...EVERYTHING, excludedDungeons: [] } })) top.set(drop.slotIndex, Math.max(top.get(drop.slotIndex) ?? 0, drop.delta));
	for (const drop of drops) drop.best = drop.delta >= (top.get(drop.slotIndex) ?? Infinity) - 0.05;
	return drops;
}

/**
 * The Tier 0 pieces behind the Tier 0.5 upgrades. A Tier 0.5 piece comes from a questline that takes the Tier 0
 * piece of the same slot, so that one is what gets farmed: it is listed where it drops, with what it turns into,
 * and counts for as much as the piece it becomes. Left out when the character already wears it.
 */
export function withTierZero(drops: FarmDrop[], options: CandidateOptions): FarmDrop[] {
	const { character, data, spec } = options;
	const sets = tierSets(spec);
	if (!sets) return drops;
	const faction = spec.races.find(r => r.id === character.race)?.faction;
	const worn = new Set(character.gear.flatMap(piece => (piece ? [piece.id] : [])));
	const byId = new Map(drops.map(drop => [drop.item.id, drop]));
	// The planned piece first, then the biggest gain: a Tier 0 piece is listed for one Tier 0.5 piece only.
	const upgrades = drops.filter(drop => drop.item.setId === sets.tier05).sort((x, y) => Number(y.planned) - Number(x.planned) || y.delta - x.delta);
	for (const upgrade of upgrades) {
		const base = [...data.itemById.values()].find(item => item.setId === sets.tier0 && item.slot === upgrade.item.slot && !(item.faction && faction && item.faction !== faction));
		if (!base || worn.has(base.id)) continue;
		const known = byId.get(base.id);
		if (known?.leadsTo) continue;
		if (known) {
			known.leadsTo = upgrade.item;
			known.planned ||= upgrade.planned;
			if (upgrade.delta > known.delta) Object.assign(known, { delta: upgrade.delta, rank: upgrade.rank, best: upgrade.best, slotIndex: upgrade.slotIndex });
		} else byId.set(base.id, { ...upgrade, item: base, leadsTo: upgrade.item });
	}
	return [...byId.values()];
}

export function dungeonRanking(options: CandidateOptions, show: FarmShow = 'all'): FarmDungeon[] {
	const { character, data, spec, filter } = options;
	const faction = spec.races.find(r => r.id === character.race)?.faction;
	const dungeons = new Map<string, { key: string; name: string; zone: Zone; bosses: Map<string, FarmDrop[]>; sources: Map<string, Map<number, ItemSource>> }>();

	for (const drop of withTierZero(markBest(allUpgrades(options), options), options)) {
		if ((show === 'bis' && !drop.best) || (show === 'plan' && !drop.planned)) continue;
		// A Tier 0 piece that is only farmed for its upgrade counts whatever the slot ticks say about wearing it.
		for (const source of usableSources(drop.item, faction, drop.leadsTo ? { ...filter, tierSlots: EVERYTHING.tierSlots } : filter, character.professions)) {
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

/** The kind of source an item comes from, as the farm plan groups them. */
export const sourceKind = (source: ItemSource | undefined): PlanGroupKind => groupOf(source);

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
	const planned = plannedGear(character, data);
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

/** Planned dungeon drops split by dungeon (or dungeon wing), the one with the most to gain first. */
export function byDungeon(entries: PlanEntry[], zoneName: (zoneId: number) => string | undefined): { key: string; name: string; entries: PlanEntry[] }[] {
	const groups = new Map<string, { key: string; name: string; entries: PlanEntry[] }>();
	for (const entry of entries) {
		const source = entry.source;
		const name = source?.dungeonName ?? (source?.zoneId ? zoneName(source.zoneId) : undefined) ?? 'Other dungeons';
		const key = source?.dungeonKey ?? name;
		if (!groups.has(key)) groups.set(key, { key, name, entries: [] });
		groups.get(key)!.entries.push(entry);
	}
	const gain = (group: { entries: PlanEntry[] }) => group.entries.reduce((sum, entry) => sum + entry.delta, 0);
	return [...groups.values()].sort((a, b) => gain(b) - gain(a));
}
