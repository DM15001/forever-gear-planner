import { GEAR_SLOTS } from './constants';
import type { GameData } from './gameData';
import quests from '../config/quests.json';
import { addStats, type HitSummary, hitSummary, pieceStats, vendorCurrency, vendorReputation } from './stats';

const RAID_QUESTS: Record<string, string> = quests.raidQuests;
import type { Character, Faction, GearPiece, Item, ItemSource, SpecConfig, Stats } from './types';

export type Gear = (GearPiece | null)[];

const MAIN_HAND = GEAR_SLOTS.findIndex(s => s.key === 'mainHand');
const OFF_HAND = GEAR_SLOTS.findIndex(s => s.key === 'offHand');
/** Slots that come in pairs; a unique item can only sit in one of them. */
const PAIRED: Record<number, number> = { 10: 11, 11: 10, 12: 13, 13: 12 };

/**
 * The gear the plan aims for: equipped gear with the planned items swapped in and the planned
 * enchants applied. A swapped-in item keeps the slot's enchant unless the plan names another.
 */
export function plannedGear(character: Character): Gear {
	return character.gear.map((piece, index) => {
		const plannedId = character.plan?.[index];
		const id = plannedId ?? piece?.id;
		if (!id) return null;
		const enchant = character.planEnchants?.[index] ?? piece?.enchant;
		const randomSuffix = id === piece?.id ? piece?.randomSuffix : undefined;
		return { id, ...(enchant ? { enchant } : {}), ...(randomSuffix ? { randomSuffix } : {}) };
	});
}

export interface SetTotals {
	stats: Stats;
	hit: HitSummary;
	/** Attack-power equivalents: stats by weight, plus measured effect, enchant-proc and set-bonus values. */
	score: number;
	/** The part of the score that comes from measured effects and set bonuses. */
	effectScore: number;
}

/**
 * Scores a whole set, so hit rating beyond the cap is valued at the over-cap weight. Procs,
 * on-use effects, proc enchants and set bonuses count with the values the simulator measured
 * for them (data.simValues); an effect nobody measured counts as zero.
 */
export function scoreSet(gear: Gear, character: Character, data: GameData, spec: SpecConfig): SetTotals {
	const stats: Stats = {};
	const { simValues } = data;
	const setCounts = new Map<number, number>();
	let mainHandDps = 0;
	let effectScore = 0;
	gear.forEach((piece, index) => {
		if (!piece) return;
		const item = data.itemById.get(piece.id);
		if (item) {
			addStats(stats, pieceStats(item, piece, data));
			if (index === MAIN_HAND) mainHandDps = item.weapon?.dps ?? 0;
			effectScore += simValues.items.get(item.id) ?? 0;
			if (item.setId) setCounts.set(item.setId, (setCounts.get(item.setId) ?? 0) + 1);
		}
		if (piece.enchant) {
			addStats(stats, data.enchantsBySlot.get(GEAR_SLOTS[index].kind)?.find(e => e.effectId === piece.enchant)?.stats);
			effectScore += simValues.enchants.get(piece.enchant) ?? 0;
		}
	});
	for (const [setId, count] of setCounts) {
		const byCount = simValues.sets.get(setId);
		if (!byCount) continue;
		// The bonuses active at this many pieces: the value measured at the highest count reached.
		let best = 0;
		for (const [pieces, ep] of byCount) if (pieces <= count) best = Math.max(best, ep);
		effectScore += best;
	}

	const hit = hitSummary(stats, character, spec);
	const { weights } = spec;
	let score = mainHandDps * weights.mainHandDps + effectScore;
	for (const [key, value] of Object.entries(stats)) {
		if (key === 'hitRating') score += (value - hit.ratingOver) * (weights.stats.hitRating ?? 0) + hit.ratingOver * weights.hitRatingOverCap;
		else score += value * (weights.stats[key] ?? 0);
	}
	return { stats, hit, score, effectScore };
}

/** Which kinds of item sources the upgrade lists include. */
export interface SourceFilter {
	drop: boolean;
	quest: boolean;
	crafted: boolean;
	vendor: boolean; // plain vendors
	currency: boolean; // vendors that take a special currency
	rep: boolean; // reputation rewards, including battleground quartermasters
	pvp: boolean;
	unknown: boolean; // items the data has no source for
	tier05: boolean; // the class's Tier 0.5 set (spec.tier05Set)
	ownCraftsOnly: boolean; // crafted items only from the character's own professions
	/** Dungeons and wings to skip, by `dungeonKey`. Dungeon drops are on unless listed here. */
	excludedDungeons: string[];
	/** Reputations to skip, by faction name. Only looked at while `rep` is on. */
	excludedReputations: string[];
}

export const DEFAULT_FILTER: SourceFilter = {
	drop: true,
	quest: true,
	crafted: true,
	vendor: true,
	currency: true,
	rep: true,
	pvp: false,
	unknown: true,
	tier05: true,
	ownCraftsOnly: false,
	excludedDungeons: [],
	excludedReputations: [],
};

export type SourceKindKey = Exclude<keyof SourceFilter, 'tier05' | 'ownCraftsOnly' | 'excludedDungeons' | 'excludedReputations'>;

/** The reputation a source needs, if any: a reputation reward or a quartermaster's goods. */
export const reputationOf = (source: ItemSource): string | undefined => (source.kind === 'rep' ? source.repFaction : vendorReputation(source));

/** The filter switch a source falls under. `drop` stands for world drops; dungeons are switched one by one. */
export const filterKey = (source: ItemSource): SourceKindKey => {
	if (reputationOf(source)) return 'rep';
	if (source.kind === 'vendor' && vendorCurrency(source)) return 'currency';
	return source.kind;
};

/** A quest reward that needs a raid kill; treated like a raid drop. */
const isRaidQuest = (source: ItemSource) => source.kind === 'quest' && source.questId !== undefined && String(source.questId) in RAID_QUESTS;

/**
 * Sources this character can actually use, given faction and the filter. Raid drops and raid
 * quest rewards never count. Pass `professions` to apply the "own crafts only" switch.
 */
export function usableSources(item: Item, faction: Faction | undefined, filter: SourceFilter, professions?: string[]): ItemSource[] {
	return (item.sources ?? []).filter(s => {
		if (s.zoneKind === 'raid' || isRaidQuest(s)) return false;
		if (s.dungeonKey) {
			if (filter.excludedDungeons.includes(s.dungeonKey)) return false;
		} else if (!filter[filterKey(s)]) return false;
		const reputation = reputationOf(s);
		if (reputation && filter.excludedReputations.includes(reputation)) return false;
		if (s.faction && faction && s.faction !== faction) return false;
		if (s.kind === 'crafted' && filter.ownCraftsOnly && professions && !professions.includes(s.profession ?? '')) return false;
		return true;
	});
}

/** A filter that lets every source kind through. */
export const EVERYTHING: SourceFilter = { ...DEFAULT_FILTER, pvp: true };

/** Can this character get and use the item at all, given faction, professions and the filter? */
export function isObtainable(item: Item, character: Character, faction: Faction | undefined, filter: SourceFilter, spec: SpecConfig): boolean {
	if (!filter.tier05 && item.setId !== undefined && item.setId === spec.tier05Set?.setId) return false;
	if (item.faction && faction && item.faction !== faction) return false;
	if (item.requiredProfession && !character.professions.includes(item.requiredProfession)) return false;
	if (!item.sources?.length) return filter.unknown;
	return usableSources(item, faction, filter, character.professions).length > 0;
}

function fitsSlot(item: Item, slotIndex: number, spec: SpecConfig): boolean {
	if (item.slot !== GEAR_SLOTS[slotIndex].kind) return false;
	if (item.slot !== 'weapon') return true;
	if (spec.weaponSetup === 'twoHand') return slotIndex === MAIN_HAND && item.weapon?.hand === 'twoHand';
	if (slotIndex === OFF_HAND) return item.weapon?.hand === 'offHand';
	return item.weapon?.hand === 'mainHand' || item.weapon?.hand === 'oneHand';
}

/** True when part of the item's worth is unknown: an unmeasured effect or set, or a random suffix. */
export function isUnmeasured(item: Item, data: GameData): boolean {
	const { simValues } = data;
	if (item.randomSuffixOptions?.length) return true;
	if (item.effects?.length && !simValues.measuredItems.has(item.id)) return true;
	return Boolean(item.setId && !simValues.measuredSets.has(item.setId));
}

export interface Candidate {
	item: Item;
	/** Change in set score when this item replaces the slot's current one. */
	delta: number;
	/** The score leaves something out: an effect or set bonus nobody measured, or an unpicked random suffix. */
	incomplete: boolean;
}

export interface CandidateOptions {
	character: Character;
	data: GameData;
	spec: SpecConfig;
	filter: SourceFilter;
}

/** All items that could go into a slot of `gear`, best first. */
export function slotCandidates(slotIndex: number, gear: Gear, { character, data, spec, filter }: CandidateOptions): Candidate[] {
	const faction = spec.races.find(r => r.id === character.race)?.faction;
	const base = scoreSet(gear, character, data, spec).score;
	const current = gear[slotIndex];
	const pairedId = PAIRED[slotIndex] !== undefined ? gear[PAIRED[slotIndex]]?.id : undefined;
	const result: Candidate[] = [];
	for (const item of data.itemById.values()) {
		if (!fitsSlot(item, slotIndex, spec) || item.id === current?.id) continue;
		if (item.unique && item.id === pairedId) continue;
		if (!isObtainable(item, character, faction, filter, spec)) continue;
		const swapped = gear.map((piece, i) => (i === slotIndex ? (current?.enchant ? { id: item.id, enchant: current.enchant } : { id: item.id }) : piece));
		result.push({
			item,
			delta: scoreSet(swapped, character, data, spec).score - base,
			incomplete: isUnmeasured(item, data),
		});
	}
	return result.sort((a, b) => b.delta - a.delta || a.item.name.localeCompare(b.item.name));
}

/**
 * Builds a plan by repeatedly making the single best swap until none helps. Because every
 * swap is scored on the whole set, the result does not stack hit rating past the cap.
 */
export function suggestPlan(options: CandidateOptions): Record<number, number> {
	const { character, spec } = options;
	let gear: Gear = character.gear.map(piece => piece);
	const plan: Record<number, number> = {};
	for (let round = 0; round < 60; round++) {
		let best: { slot: number; candidate: Candidate } | null = null;
		for (let slot = 0; slot < GEAR_SLOTS.length; slot++) {
			if (spec.weaponSetup === 'twoHand' && slot === OFF_HAND) continue;
			const top = slotCandidates(slot, gear, options)[0];
			if (top && top.delta > 0.01 && (!best || top.delta > best.candidate.delta)) best = { slot, candidate: top };
		}
		if (!best) break;
		const { slot, candidate } = best;
		const enchant = gear[slot]?.enchant;
		gear = gear.map((piece, i) => (i === slot ? (enchant ? { id: candidate.item.id, enchant } : { id: candidate.item.id }) : piece));
		plan[slot] = candidate.item.id;
	}
	return plan;
}
