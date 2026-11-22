import { GEAR_SLOTS } from './constants';
import type { GameData } from './gameData';
import notAvailable from '../config/not-available.json';
import quests from '../config/quests.json';
import { addStats, type HitSummary, hitSummary, pieceStats, vendorCurrency, vendorReputation } from './stats';

const RAID_QUESTS: Record<string, string> = quests.raidQuests;
const CLOSED_NPCS: Record<string, string> = notAvailable.npcs;
const CLOSED_ZONES: Record<string, string> = notAvailable.zones;
const CLOSED_TAGS: Record<string, string> = notAvailable.tags;
const CLOSED_ICON_WORDS = Object.entries(notAvailable.iconWords as Record<string, string>);
const CLOSED_ITEMS: Record<string, string> = notAvailable.items;

/** Why an item cannot be had in the game yet, or undefined when nothing is known against it. */
export function notYetAvailable(item: Item): string | undefined {
	if (CLOSED_ITEMS[item.id]) return CLOSED_ITEMS[item.id];
	if (item.tag && CLOSED_TAGS[item.tag]) return CLOSED_TAGS[item.tag];
	const byIcon = item.icon ? CLOSED_ICON_WORDS.find(([word]) => item.icon!.includes(word)) : undefined;
	if (byIcon) return byIcon[1];
	const sources = item.sources ?? [];
	if (sources.length === 0) return undefined;
	const closed = sources.map(source => (source.npcId ? CLOSED_NPCS[source.npcId] : undefined) ?? (source.kind === 'drop' && source.zoneId ? CLOSED_ZONES[source.zoneId] : undefined));
	return closed.every(Boolean) ? closed[0] : undefined;
}
import type { Character, Faction, GearPiece, Item, ItemSource, SpecConfig, Stats } from './types';

export type Gear = (GearPiece | null)[];

const MAIN_HAND = GEAR_SLOTS.findIndex(s => s.key === 'mainHand');
const OFF_HAND = GEAR_SLOTS.findIndex(s => s.key === 'offHand');
/** Slots that come in pairs; a unique item can only sit in one of them. */
const PAIRED: Record<number, number> = { 10: 11, 11: 10, 12: 13, 13: 12 };

/** True if the two items cannot be worn at the same time: the same unique item, or one limit category. */
export function clash(a: Item | undefined, b: Item | undefined): boolean {
	if (!a || !b) return false;
	if (a.id === b.id) return Boolean(a.unique || a.limitCategory);
	return a.limitCategory !== undefined && a.limitCategory === b.limitCategory;
}

/**
 * The gear the plan aims for: equipped gear with the planned items swapped in and the planned
 * enchants applied. A swapped-in item keeps the slot's enchant unless the plan names another.
 */
/** In a plan: the slot is to be left empty (a two-hander takes the place of main hand and off hand). */
export const EMPTY_SLOT = 0;

export function plannedGear(character: Character, data?: Pick<GameData, 'itemById'>): Gear {
	const gear = character.gear.map((piece, index) => {
		const plannedId = character.plan?.[index];
		if (plannedId === EMPTY_SLOT) return null;
		const id = plannedId ?? piece?.id;
		if (!id) return null;
		const enchant = character.planEnchants?.[index] ?? piece?.enchant;
		// The equipped item keeps the suffix it has; a planned one counts with the suffix that suits the spec best.
		const randomSuffix = id === piece?.id ? piece?.randomSuffix : data?.itemById.get(id)?.bestSuffix;
		return { id, ...(enchant ? { enchant } : {}), ...(randomSuffix ? { randomSuffix } : {}) };
	});
	if (!data) return gear;
	// Two rings or trinkets that cannot be worn together: the second slot falls back to what is equipped.
	for (const [first, second] of [
		[10, 11],
		[12, 13],
	]) {
		const itemOf = (index: number) => data.itemById.get(gear[index]?.id ?? -1);
		if (!clash(itemOf(first), itemOf(second))) continue;
		const revert = character.plan?.[second] !== undefined ? second : character.plan?.[first] !== undefined ? first : undefined;
		if (revert !== undefined) gear[revert] = character.gear[revert];
	}
	return gear;
}

/** The slot paired with a ring or trinket slot, if any. */
export const pairedSlot = (slotIndex: number): number | undefined => PAIRED[slotIndex];

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
	let offHandDps = 0;
	let effectScore = 0;
	gear.forEach((piece, index) => {
		if (!piece) return;
		const item = data.itemById.get(piece.id);
		if (item) {
			addStats(stats, pieceStats(item, piece, data));
			if (index === MAIN_HAND) mainHandDps = item.weapon?.dps ?? 0;
			if (index === OFF_HAND) offHandDps = item.weapon?.dps ?? 0;
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
	let score = mainHandDps * weights.mainHandDps + offHandDps * (weights.offHandDps ?? 0) + effectScore;
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
	/** Items that drop with a random suffix ("of Shadow Wrath"), counted with the suffix that suits the spec best. */
	randomSuffix: boolean;
	/** Items from content that is in the data but not open in the game yet (src/config/not-available.json). */
	notYetAvailable: boolean;
	/** Items the user has hidden by hand, by id. */
	hiddenItems: number[];
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
	randomSuffix: true,
	notYetAvailable: false,
	hiddenItems: [],
	ownCraftsOnly: false,
	excludedDungeons: [],
	excludedReputations: [],
};

export type SourceKindKey = Exclude<keyof SourceFilter, 'tier05' | 'randomSuffix' | 'notYetAvailable' | 'hiddenItems' | 'ownCraftsOnly' | 'excludedDungeons' | 'excludedReputations'>;

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
export const EVERYTHING: SourceFilter = { ...DEFAULT_FILTER, pvp: true, randomSuffix: true };

/** Can this character get and use the item at all, given faction, professions and the filter? */
export function isObtainable(item: Item, character: Character, faction: Faction | undefined, filter: SourceFilter, spec: SpecConfig): boolean {
	if (!filter.tier05 && item.setId !== undefined && item.setId === spec.tier05Set?.setId) return false;
	if (!filter.randomSuffix && item.randomSuffixOptions?.length) return false;
	if (!filter.notYetAvailable && notYetAvailable(item)) return false;
	if (filter.hiddenItems.includes(item.id)) return false;
	if (item.faction && faction && item.faction !== faction) return false;
	if (item.requiredProfession && !character.professions.includes(item.requiredProfession)) return false;
	if (!item.sources?.length) return filter.unknown;
	return usableSources(item, faction, filter, character.professions).length > 0;
}

/** False for a slot this spec never fills: the off hand of a spec that only uses two-handers. */
export const slotInUse = (slotIndex: number, spec: SpecConfig): boolean => !(spec.weaponSetup === 'twoHand' && slotIndex === OFF_HAND);

function fitsSlot(item: Item, slotIndex: number, spec: SpecConfig): boolean {
	if (item.slot !== GEAR_SLOTS[slotIndex].kind) return false;
	if (item.slot !== 'weapon') return true;
	const hand = item.weapon?.hand;
	if (spec.weaponSetup === 'twoHand') return slotIndex === MAIN_HAND && hand === 'twoHand';
	if (slotIndex === OFF_HAND) return hand === 'offHand' || (spec.canDualWield && hand === 'oneHand');
	return hand === 'mainHand' || hand === 'oneHand' || (spec.weaponSetup === 'either' && hand === 'twoHand');
}

/**
 * `gear` with one slot changed (null empties it). The slot's enchant stays. A two-hander pushes
 * the off hand out, and an off-hand item pushes a two-hander out.
 */
export function withItem(gear: Gear, slotIndex: number, itemId: number | null, data: GameData): Gear {
	const isTwoHand = (id: number | undefined) => (id !== undefined ? data.itemById.get(id)?.weapon?.hand === 'twoHand' : false);
	return gear.map((piece, index) => {
		if (index === slotIndex) {
			if (itemId === null) return null;
			const randomSuffix = data.itemById.get(itemId)?.bestSuffix;
			return { id: itemId, ...(piece?.enchant ? { enchant: piece.enchant } : {}), ...(randomSuffix ? { randomSuffix } : {}) };
		}
		if (itemId !== null && slotIndex === MAIN_HAND && index === OFF_HAND && isTwoHand(itemId)) return null;
		if (itemId !== null && slotIndex === OFF_HAND && index === MAIN_HAND && isTwoHand(piece?.id)) return null;
		return piece;
	});
}

/** True when part of the item's worth is unknown: an unmeasured effect or set, or a random suffix. */
export function isUnmeasured(item: Item, data: GameData): boolean {
	const { simValues } = data;
	if (item.randomSuffixOptions?.length && !item.bestSuffix) return true;
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
	const paired = pairedId !== undefined ? data.itemById.get(pairedId) : undefined;
	const result: Candidate[] = [];
	for (const item of data.itemById.values()) {
		if (!fitsSlot(item, slotIndex, spec) || item.id === current?.id) continue;
		if (clash(item, paired)) continue;
		if (!isObtainable(item, character, faction, filter, spec)) continue;
		const swapped = withItem(gear, slotIndex, item.id, data);
		result.push({
			item,
			delta: scoreSet(swapped, character, data, spec).score - base,
			incomplete: isUnmeasured(item, data),
		});
	}
	return result.sort((a, b) => b.delta - a.delta || a.item.name.localeCompare(b.item.name));
}

/** How many of a slot's best candidates the pair search looks at. */
const PAIR_DEPTH = 6;
/** A set-seeded start is only followed up when it scores within this many DPS of the best set so far. */
const SEED_MARGIN = 20;
/** How many set-seeded starts get a full improvement pass. */
const SEED_STARTS = 3;

/**
 * Builds a plan in three steps. It repeatedly makes the single best swap until none helps, then
 * tries changing two slots at once (dropping a hit item because another slot now covers the cap),
 * and last restarts from every full item set to catch set bonuses. Every set is scored as a whole,
 * so hit rating is never stacked past the cap.
 */
export function suggestPlan(options: CandidateOptions): Record<number, number> {
	const { character, data, spec, filter } = options;
	const faction = spec.races.find(r => r.id === character.race)?.faction;
	const slots = GEAR_SLOTS.map((_, slot) => slot).filter(slot => slotInUse(slot, spec));
	const put = (set: Gear, slot: number, id: number): Gear => withItem(set, slot, id, data);
	const scoreOf = (set: Gear) => scoreSet(set, character, data, spec).score;

	/** Improves a set until no single swap helps, and with `pairs` until no swap of two slots helps either. */
	const climb = (start: Gear, pairs: boolean): Gear => {
		let gear = start;
		for (let round = 0; round < 60; round++) {
			let best: { slot: number; candidate: Candidate } | null = null;
			for (const slot of slots) {
				const top = slotCandidates(slot, gear, options)[0];
				if (top && top.delta > 0.01 && (!best || top.delta > best.candidate.delta)) best = { slot, candidate: top };
			}
			if (!best) break;
			gear = put(gear, best.slot, best.candidate.item.id);
		}
		for (let round = 0; pairs && round < 20; round++) {
			const base = scoreOf(gear);
			const tops = new Map(slots.map(slot => [slot, slotCandidates(slot, gear, options).slice(0, PAIR_DEPTH)]));
			let best: { gear: Gear; score: number } | null = null;
			for (const a of slots) {
				for (const b of slots) {
					if (b <= a) continue;
					for (const first of tops.get(a)!) {
						for (const second of tops.get(b)!) {
							// The same unique ring or trinket cannot sit in both slots of a pair.
							if (PAIRED[a] === b && clash(first.item, second.item)) continue;
							const tried = put(put(gear, a, first.item.id), b, second.item.id);
							const score = scoreOf(tried);
							if (score > base + 0.01 && (!best || score > best.score)) best = { gear: tried, score };
						}
					}
				}
			}
			if (!best) break;
			gear = best.gear;
		}
		return gear;
	};

	let gear = climb(character.gear.map(piece => piece), true);
	let score = scoreOf(gear);

	// Set bonuses need several pieces at once, which swaps of one or two slots never reach. So
	// for every set the character can get, start again with all its pieces in and improve from there.
	const sets = new Map<number, Map<number, number>>();
	for (const item of data.itemById.values()) {
		if (item.setId === undefined || !isObtainable(item, character, faction, filter, spec)) continue;
		const slot = slots.find(index => fitsSlot(item, index, spec) && !sets.get(item.setId!)?.has(index));
		if (slot === undefined) continue;
		if (!sets.has(item.setId)) sets.set(item.setId, new Map());
		sets.get(item.setId)!.set(slot, item.id);
	}
	const starts: { gear: Gear; score: number }[] = [];
	for (const pieces of sets.values()) {
		if (pieces.size < 2) continue;
		let seeded = gear;
		for (const [slot, id] of pieces) seeded = put(seeded, slot, id);
		// Not every piece is worth it: hand slots back to the best set so far while that raises the score.
		let seededScore = scoreOf(seeded);
		for (;;) {
			let best: { gear: Gear; score: number } | null = null;
			for (const slot of pieces.keys()) {
				if (seeded[slot]?.id === gear[slot]?.id) continue;
				const tried = seeded.map((piece, index) => (index === slot ? gear[slot] : piece));
				const triedScore = scoreOf(tried);
				if (triedScore > seededScore + 0.01 && (!best || triedScore > best.score)) best = { gear: tried, score: triedScore };
			}
			if (!best) break;
			seeded = best.gear;
			seededScore = best.score;
		}
		if (seededScore > score - SEED_MARGIN && seeded.some((piece, index) => piece?.id !== gear[index]?.id)) starts.push({ gear: seeded, score: seededScore });
	}
	// Follow up only the most promising starts: each full improvement pass is slow.
	for (const start of starts.sort((a, b) => b.score - a.score).slice(0, SEED_STARTS)) {
		const improved = climb(start.gear, false);
		const improvedScore = scoreOf(improved);
		if (improvedScore > score + 0.01) {
			gear = improved;
			score = improvedScore;
		}
	}
	gear = climb(gear, true);

	const plan: Record<number, number> = {};
	for (const slot of slots) {
		const id = gear[slot]?.id;
		if (id !== undefined && id !== character.gear[slot]?.id) plan[slot] = id;
		// A slot the plan empties: the off hand under a planned two-hander, or the reverse.
		else if (id === undefined && character.gear[slot]) plan[slot] = EMPTY_SLOT;
	}
	return plan;
}
