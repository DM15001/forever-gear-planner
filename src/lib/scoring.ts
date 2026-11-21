import { GEAR_SLOTS } from './constants';
import type { GameData } from './gameData';
import quests from '../config/quests.json';
import { addStats, type HitSummary, hitSummary, pieceStats, vendorReputation } from './stats';

const RAID_QUESTS: Record<string, string> = quests.raidQuests;
import type { Character, Faction, GearPiece, Item, ItemSource, SpecConfig, Stats } from './types';

export type Gear = (GearPiece | null)[];

const MAIN_HAND = GEAR_SLOTS.findIndex(s => s.key === 'mainHand');
const OFF_HAND = GEAR_SLOTS.findIndex(s => s.key === 'offHand');
/** Slots that come in pairs; a unique item can only sit in one of them. */
const PAIRED: Record<number, number> = { 10: 11, 11: 10, 12: 13, 13: 12 };

/** Equipped gear with the what-if swaps applied. A swapped-in item keeps the slot's enchant. */
export function plannedGear(character: Character): Gear {
	return character.gear.map((piece, index) => {
		const plannedId = character.plan?.[index];
		if (!plannedId || plannedId === piece?.id) return piece;
		return piece?.enchant ? { id: plannedId, enchant: piece.enchant } : { id: plannedId };
	});
}

export interface SetTotals {
	stats: Stats;
	hit: HitSummary;
	/** Attack-power equivalents. Procs, on-use effects and set bonuses are not counted. */
	score: number;
}

/** Scores a whole set, so hit rating beyond the cap is valued at the over-cap weight. */
export function scoreSet(gear: Gear, character: Character, data: GameData, spec: SpecConfig): SetTotals {
	const stats: Stats = {};
	let mainHandDps = 0;
	gear.forEach((piece, index) => {
		if (!piece) return;
		const item = data.itemById.get(piece.id);
		if (item) {
			addStats(stats, pieceStats(item, piece, data));
			if (index === MAIN_HAND) mainHandDps = item.weapon?.dps ?? 0;
		}
		if (piece.enchant) addStats(stats, data.enchantsBySlot.get(GEAR_SLOTS[index].kind)?.find(e => e.effectId === piece.enchant)?.stats);
	});

	const hit = hitSummary(stats, character, spec);
	const { weights } = spec;
	let score = mainHandDps * weights.mainHandDps;
	for (const [key, value] of Object.entries(stats)) {
		if (key === 'hitRating') score += (value - hit.ratingOver) * (weights.stats.hitRating ?? 0) + hit.ratingOver * weights.hitRatingOverCap;
		else score += value * (weights.stats[key] ?? 0);
	}
	return { stats, hit, score };
}

/** Which kinds of item sources the upgrade lists include. */
export interface SourceFilter {
	drop: boolean;
	quest: boolean;
	crafted: boolean;
	vendor: boolean; // plain and currency vendors
	rep: boolean; // reputation rewards, including battleground quartermasters
	pvp: boolean;
	unknown: boolean; // items the data has no source for
	tier05: boolean; // the class's Tier 0.5 set (spec.tier05Set)
	ownCraftsOnly: boolean; // crafted items only from the character's own professions
}

export const DEFAULT_FILTER: SourceFilter = { drop: true, quest: true, crafted: true, vendor: true, rep: true, pvp: false, unknown: true, tier05: true, ownCraftsOnly: false };

export type SourceKindKey = Exclude<keyof SourceFilter, 'tier05' | 'ownCraftsOnly'>;

/** The filter switch a source falls under. */
export const filterKey = (source: ItemSource): SourceKindKey => {
	if (source.kind === 'rep' || vendorReputation(source)) return 'rep';
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
		if (!filter[filterKey(s)] || s.zoneKind === 'raid' || isRaidQuest(s)) return false;
		if (s.faction && faction && s.faction !== faction) return false;
		if (s.kind === 'crafted' && filter.ownCraftsOnly && professions && !professions.includes(s.profession ?? '')) return false;
		return true;
	});
}

/** A filter that lets every source kind through. */
export const EVERYTHING: SourceFilter = { drop: true, quest: true, crafted: true, vendor: true, rep: true, pvp: true, unknown: true, tier05: true, ownCraftsOnly: false };

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

export interface Candidate {
	item: Item;
	/** Change in set score when this item replaces the slot's current one. */
	delta: number;
	/** The score leaves out a proc, on-use effect, set bonus or unpicked random suffix. */
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
			incomplete: Boolean(item.effects?.length || item.setId || item.randomSuffixOptions?.length),
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
