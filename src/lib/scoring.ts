import { GEAR_SLOTS } from './constants';
import type { GameData } from './gameData';
import notAvailable from '../config/not-available.json';
import quests from '../config/quests.json';
import tierSetsJson from '../config/tierSets.json';
import vendors from '../config/vendors.json';
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
	if (item.unreleased) return 'WoWSims does not list this item as released yet (later raids and events, old PvP ranks). If you can get it in the game, tell us';
	if (item.tag && CLOSED_TAGS[item.tag]) return CLOSED_TAGS[item.tag];
	const byIcon = item.icon ? CLOSED_ICON_WORDS.find(([word]) => item.icon!.includes(word)) : undefined;
	if (byIcon) return byIcon[1];
	const sources = item.sources ?? [];
	if (sources.length === 0) return undefined;
	const closed = sources.map(source => (source.npcId ? CLOSED_NPCS[source.npcId] : undefined) ?? (source.kind === 'drop' && source.zoneId ? CLOSED_ZONES[source.zoneId] : undefined));
	return closed.every(Boolean) ? closed[0] : undefined;
}
import type { Character, Enchant, Faction, GearPiece, Item, ItemSource, SpecConfig, Stats } from './types';

export type Gear = (GearPiece | null)[];

const MAIN_HAND = GEAR_SLOTS.findIndex(s => s.key === 'mainHand');
const OFF_HAND = GEAR_SLOTS.findIndex(s => s.key === 'offHand');
const RANGED = GEAR_SLOTS.findIndex(s => s.key === 'ranged');
/** Slots that come in pairs; a unique item can only sit in one of them. */
const PAIRED: Record<number, number> = { 10: 11, 11: 10, 12: 13, 13: 12, [MAIN_HAND]: OFF_HAND, [OFF_HAND]: MAIN_HAND };

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

export function plannedGear(character: Character, data?: Pick<GameData, 'itemById'> & Partial<Pick<GameData, 'enchantsBySlot'>>): Gear {
	const gear = character.gear.map((piece, index) => {
		const plannedId = character.plan?.[index];
		if (plannedId === EMPTY_SLOT) return null;
		const id = plannedId ?? piece?.id;
		if (!id) return null;
		// The worn enchant moves to a planned item only if it can sit on it.
		const worn = id === piece?.id || !data?.enchantsBySlot ? piece?.enchant : carriedEnchant(piece?.enchant, index, data.itemById.get(id), data as Pick<GameData, 'enchantsBySlot'>);
		const enchant = character.planEnchants?.[index] ?? worn;
		// The equipped item keeps the suffix it has; a planned one counts with the suffix that suits the spec best.
		const randomSuffix = id === piece?.id ? piece?.randomSuffix : data?.itemById.get(id)?.bestSuffix;
		return { id, ...(enchant ? { enchant } : {}), ...(randomSuffix ? { randomSuffix } : {}) };
	});
	if (!data) return gear;
	// Two rings, trinkets or weapons that cannot be worn together: the second slot falls back to what is equipped.
	for (const [first, second] of [
		[10, 11],
		[12, 13],
		[MAIN_HAND, OFF_HAND],
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
 * Whole-weapon values are DPS against the preset's weapon in that hand. Weapons nobody measured are
 * scored by weight instead, so both need one zero point: the preset weapon's own score by weight is
 * added to every measured value of its hand.
 */
function weaponAnchor(hand: 'mainHand' | 'offHand' | 'ranged', data: GameData, spec: SpecConfig): number {
	const id = data.simValues.weapons?.reference[hand];
	const item = id !== undefined ? data.itemById.get(id) : undefined;
	if (!item) return 0;
	const { weights } = spec;
	const perDps = hand === 'mainHand' ? weights.mainHandDps : hand === 'offHand' ? (weights.offHandDps ?? 0) : (weights.rangedDps ?? 0);
	let score = (item.weapon?.dps ?? 0) * perDps + (data.simValues.items.get(item.id) ?? 0);
	for (const [key, value] of Object.entries(pieceStats(item, { id: item.id }, data))) score += value * (weights.stats[key] ?? 0);
	return score;
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
	let rangedDps = 0;
	let effectScore = 0;
	// Weapons the simulator measured as a whole, and their stats, which the weights must not count again.
	let weaponScore = 0;
	const unscored: Stats = {};
	let capShift = 0;
	gear.forEach((piece, index) => {
		if (!piece) return;
		const item = data.itemById.get(piece.id);
		if (item) {
			const worn = pieceStats(item, piece, data);
			addStats(stats, worn);
			const hand = index === MAIN_HAND ? 'mainHand' : index === OFF_HAND ? 'offHand' : index === RANGED ? 'ranged' : undefined;
			// The preset's own weapon is the zero point of its hand: measured too, at 0.
			const whole = hand ? (simValues.weapons?.byItem.get(item.id)?.[hand] ?? (simValues.weapons?.reference[hand] === item.id ? 0 : undefined)) : undefined;
			if (hand && whole !== undefined) {
				// Measured as a whole: its own stats, damage and proc are in that number already. What a
				// random suffix adds on top is still scored by weight.
				weaponScore += whole + weaponAnchor(hand, data, spec);
				const own = piece.randomSuffix ? pieceStats(item, { id: item.id }, data) : worn;
				for (const [key, value] of Object.entries(own)) unscored[key] = (unscored[key] ?? 0) + value;
				// For the cap, a measured weapon counts with the hit of the preset's weapon in that hand: its
				// value was measured against that weapon, in gear that had that much hit.
				const reference = data.itemById.get(simValues.weapons?.reference[hand] ?? -1);
				capShift += (reference?.stats?.hitRating ?? 0) - (own.hitRating ?? 0);
			} else {
				if (index === MAIN_HAND) mainHandDps = item.weapon?.dps ?? 0;
				if (index === OFF_HAND) offHandDps = item.weapon?.dps ?? 0;
				if (index === RANGED) rangedDps = item.weapon?.dps ?? 0;
				effectScore += simValues.items.get(item.id) ?? 0;
			}
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
		let reached = 0;
		let worth = 0;
		for (const [pieces, ep] of byCount) {
			if (pieces <= count && pieces > reached) {
				reached = pieces;
				worth = ep;
			}
		}
		effectScore += worth;
	}

	const hit = hitSummary(stats, character, spec);
	const { weights } = spec;
	// An empty off hand next to a one-handed main hand, where the simulator measured what that costs.
	const mainHand = gear[MAIN_HAND] ? data.itemById.get(gear[MAIN_HAND]!.id) : undefined;
	if (!gear[OFF_HAND] && mainHand && mainHand.weapon?.hand !== 'twoHand' && simValues.weapons?.emptyOffHand !== undefined && slotInUse(OFF_HAND, spec)) {
		weaponScore += simValues.weapons.emptyOffHand + weaponAnchor('offHand', data, spec);
	}
	// A race that multiplies a stat gets that much more out of the stat on gear.
	const raceStats = character.race ? spec.raceBonuses[character.race]?.statPercent : undefined;
	let score = mainHandDps * weights.mainHandDps + offHandDps * (weights.offHandDps ?? 0) + rangedDps * (weights.rangedDps ?? 0) + effectScore + weaponScore;
	// How much of the scored hit lies past the cap, never more than there is to score.
	const over = capShift === 0 ? hit.ratingOver : Math.min(Math.max(0, (stats.hitRating ?? 0) - (unscored.hitRating ?? 0)), hitSummary({ ...stats, hitRating: (stats.hitRating ?? 0) + capShift }, character, spec).ratingOver);
	for (const [key, total] of Object.entries(stats)) {
		const value = total - (unscored[key] ?? 0);
		if (key === 'hitRating') score += (value - over) * (weights.stats.hitRating ?? 0) + over * weights.hitRatingOverCap;
		else score += value * (weights.stats[key] ?? 0) * (1 + (raceStats?.[key] ?? 0) / 100);
	}
	return { stats, hit, score, effectScore: effectScore + weaponScore };
}

/** Where a gear set stands on one item set. */
export interface SetStanding {
	setId: number;
	name: string;
	/** Pieces worn. */
	count: number;
	/** The highest measured bonus step reached (0 = none), and what the bonuses up to it are worth. */
	reached: number;
	worth: number;
	/** The steps at which this build's measurement found a bonus worth something. */
	steps: number[];
	/** False if nobody measured this set for the build: its bonuses are not in the score. */
	measured: boolean;
}

/** Every item set `gear` has pieces of, with the bonus step it reaches. */
export function setStandings(gear: Gear, data: GameData): Map<number, SetStanding> {
	const out = new Map<number, SetStanding>();
	for (const piece of gear) {
		const item = piece ? data.itemById.get(piece.id) : undefined;
		if (!item?.setId) continue;
		const known = out.get(item.setId) ?? { setId: item.setId, name: item.setName ?? 'a set', count: 0, reached: 0, worth: 0, steps: [], measured: data.simValues.measuredSets.has(item.setId) || data.simValues.sets.has(item.setId) };
		known.count++;
		out.set(item.setId, known);
	}
	for (const standing of out.values()) {
		const byCount = data.simValues.sets.get(standing.setId);
		if (!byCount) continue;
		// A step counts only where the worth changes: a measurement may list 6, 7 and 8 pieces with one value.
		let last = 0;
		for (const pieces of [...byCount.keys()].sort((x, y) => x - y)) {
			const worth = byCount.get(pieces)!;
			if (Math.abs(worth - last) < 0.05) continue;
			last = worth;
			standing.steps.push(pieces);
			if (pieces <= standing.count) {
				standing.reached = pieces;
				standing.worth = worth;
			}
		}
	}
	return out;
}

/** What swapping `base` for `variant` does to set bonuses. */
export interface SetChange {
	name: string;
	/** 'breaks' a bonus that was active, 'activates' one, or 'loosens' a set nobody measured. */
	kind: 'breaks' | 'activates' | 'loosens';
	/** The bonus step lost or gained; for 'loosens' the piece count left. */
	step: number;
	/** Change in score from the bonus, already part of the swap's number. 0 for 'loosens'. */
	worth: number;
	before: number;
	after: number;
}

export function setChanges(base: Gear, variant: Gear, data: GameData): SetChange[] {
	const before = setStandings(base, data);
	const after = setStandings(variant, data);
	const changes: SetChange[] = [];
	for (const setId of new Set([...before.keys(), ...after.keys()])) {
		const was = before.get(setId);
		const now = after.get(setId);
		const name = (was ?? now)!.name;
		const counts = { before: was?.count ?? 0, after: now?.count ?? 0 };
		if (counts.before === counts.after) continue;
		const measured = (was ?? now)!.measured;
		const reachedBefore = was?.reached ?? 0;
		const reachedAfter = now?.reached ?? 0;
		if (reachedAfter < reachedBefore) changes.push({ name, kind: 'breaks', step: reachedBefore, worth: (now?.worth ?? 0) - (was?.worth ?? 0), ...counts });
		else if (reachedAfter > reachedBefore) changes.push({ name, kind: 'activates', step: reachedAfter, worth: (now?.worth ?? 0) - (was?.worth ?? 0), ...counts });
		else if (!measured && counts.after < counts.before && counts.before >= 2) changes.push({ name, kind: 'loosens', step: counts.after, worth: 0, ...counts });
	}
	return changes;
}

/** The eight slots a dungeon set has a piece for. */
export const TIER_SLOTS: [kind: string, label: string][] = [
	['head', 'Head'],
	['shoulder', 'Shoulders'],
	['chest', 'Chest'],
	['wrist', 'Wrists'],
	['hands', 'Hands'],
	['waist', 'Waist'],
	['legs', 'Legs'],
	['feet', 'Feet'],
];

const TIER_SETS: Record<string, { tier0: number; tier05: number } | undefined> = tierSetsJson.byClass;

/** The class's Tier 0 and Tier 0.5 set ids, if it has them. */
export const tierSets = (spec: Pick<SpecConfig, 'classId'>) => TIER_SETS[String(spec.classId)];

/** True for a piece of the class's Tier 0 or Tier 0.5 set. */
export function isTierPiece(item: Item, spec: Pick<SpecConfig, 'classId'>): boolean {
	const sets = tierSets(spec);
	return item.setId !== undefined && !!sets && (item.setId === sets.tier0 || item.setId === sets.tier05);
}

/** Which kinds of item sources the upgrade lists include. */
export interface SourceFilter {
	drop: boolean;
	quest: boolean;
	crafted: boolean;
	vendor: boolean; // plain vendors
	currency: boolean; // vendors that take a special currency
	rep: boolean; // reputation rewards and quartermasters
	pvp: boolean; // rank rewards and everything from battlegrounds: their reputations and quests
	unknown: boolean; // items the data has no source for
	/** The slots that may hold a piece of the class's Tier 0 or Tier 0.5 set (TIER_SLOTS). All = the planner takes what is best; none = no set piece at all. */
	tierSlots: string[];
	/** False = no piece of the Tier 0.5 set at all, for someone who will not do its questline. */
	tier05: boolean;
	/** How many pieces of one dungeon set the plan must hold at least (0 = whatever is best), to reach a bonus the score does not value enough. */
	tierMinimum: number;
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
	tierSlots: ['head', 'shoulder', 'chest', 'wrist', 'hands', 'waist', 'legs', 'feet'],
	tier05: true,
	tierMinimum: 0,
	randomSuffix: true,
	notYetAvailable: false,
	hiddenItems: [],
	ownCraftsOnly: false,
	excludedDungeons: [],
	// Off unless asked for: the grind is long and few play it.
	excludedReputations: ['The Watchers'],
};

export type SourceKindKey = Exclude<keyof SourceFilter, 'tierSlots' | 'tier05' | 'tierMinimum' | 'randomSuffix' | 'notYetAvailable' | 'hiddenItems' | 'ownCraftsOnly' | 'excludedDungeons' | 'excludedReputations'>;

/** The reputation a source needs, if any: a reputation reward or a quartermaster's goods. */
export const reputationOf = (source: ItemSource): string | undefined => (source.kind === 'rep' ? source.repFaction : vendorReputation(source));

const BATTLEGROUND_REPUTATIONS: string[] = vendors.battlegroundReputations;
const BATTLEGROUND_QUESTS: Record<string, string> = vendors.battlegroundQuests;

/** The battleground reputation a source belongs to: a quartermaster, a reputation reward or a quest done inside the battleground. */
export function battlegroundOf(source: ItemSource): string | undefined {
	if (source.kind === 'quest' && source.questId !== undefined) return BATTLEGROUND_QUESTS[String(source.questId)];
	const reputation = reputationOf(source);
	return reputation && BATTLEGROUND_REPUTATIONS.includes(reputation) ? reputation : undefined;
}

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
	// What a PvP rank or a battleground pays for is PvP, and so is the vendor who hands it over.
	const pvpItem = (item.sources ?? []).some(s => s.kind === 'pvp' || battlegroundOf(s));
	return (item.sources ?? []).filter(s => {
		if (s.zoneKind === 'raid' || isRaidQuest(s)) return false;
		if (pvpItem && s.kind === 'vendor' && !filter.pvp) return false;
		if (s.dungeonKey) {
			if (filter.excludedDungeons.includes(s.dungeonKey)) return false;
		} else if (!filter[filterKey(s)]) return false;
		// Everything earned in a battleground is PvP, whether a rank, a reputation or a quest pays for it.
		const battleground = battlegroundOf(s);
		if (battleground && !filter.pvp) return false;
		const reputation = reputationOf(s) ?? battleground;
		if (reputation && filter.excludedReputations.includes(reputation)) return false;
		if (s.faction && faction && s.faction !== faction) return false;
		if (s.kind === 'crafted' && filter.ownCraftsOnly && professions && !professions.includes(s.profession ?? '')) return false;
		return true;
	});
}

/** A filter that lets every source kind through. */
export const EVERYTHING: SourceFilter = { ...DEFAULT_FILTER, pvp: true, randomSuffix: true, excludedReputations: [] };

/** Can this character get and use the item at all, given faction, professions and the filter? */
export function isObtainable(item: Item, character: Character, faction: Faction | undefined, filter: SourceFilter, spec: SpecConfig): boolean {
	if (isTierPiece(item, spec) && !filter.tierSlots.includes(item.slot)) return false;
	if (!filter.tier05 && item.setId !== undefined && item.setId === tierSets(spec)?.tier05) return false;
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
	// The build's main ability may need a weapon type in this hand.
	const needed = slotIndex === OFF_HAND ? spec.weaponNeeds?.offHand : spec.weaponNeeds?.mainHand;
	if (needed && !needed.includes(item.weapon?.type ?? '')) return false;
	if (spec.weaponSetup === 'twoHand') return slotIndex === MAIN_HAND && hand === 'twoHand';
	if (slotIndex === OFF_HAND) return hand === 'offHand' || (spec.canDualWield && hand === 'oneHand');
	return hand === 'mainHand' || hand === 'oneHand' || (spec.weaponSetup === 'either' && hand === 'twoHand');
}

/** Enchants that can go on this item in this slot. */
export function applicableEnchants(slotIndex: number, item: Item | undefined, data: Pick<GameData, 'enchantsBySlot'>): Enchant[] {
	if (!item || item.rangedType === 'totem' || item.rangedType === 'idol') return []; // relics cannot be enchanted
	const kind = GEAR_SLOTS[slotIndex].kind;
	// Scopes go on bows, guns and crossbows; wands and thrown weapons take nothing.
	if (kind === 'ranged' && !['bow', 'gun', 'crossbow'].includes(item.rangedType ?? '')) return [];
	return (data.enchantsBySlot.get(kind) ?? []).filter(enchant => {
		if (/fishing line/i.test(enchant.name)) return false; // fishing poles only
		// The data marks most two-hand enchants; the name catches the rest.
		const only = enchant.only ?? (/^Enchant 2H Weapon/.test(enchant.name) ? 'twoHand' : undefined);
		switch (only) {
			case undefined:
				// A plain weapon enchant needs a real weapon: not a shield, not an item held in the off hand.
				return kind !== 'weapon' || (!!item.weapon && item.weapon.type !== 'shield' && item.weapon.type !== 'offHand');
			case 'twoHand':
				return item.weapon?.hand === 'twoHand';
			case 'staff':
				return item.weapon?.type === 'staff';
			case 'shield':
				return item.weapon?.type === 'shield';
			case 'offHand':
				return item.weapon?.type === 'offHand';
			default:
				return false; // armor kits and anything new: not offered until checked
		}
	});
}

/**
 * The enchant a slot keeps when another item goes into it: the same one if it can sit on the new
 * item, none if it cannot (a two-hand enchant on a sword, a weapon enchant on a held off-hand).
 * An enchant the data does not know for this slot at all is kept: nothing says it does not fit.
 */
export function carriedEnchant(enchant: number | undefined, slotIndex: number, item: Item | undefined, data: Pick<GameData, 'enchantsBySlot'>): number | undefined {
	if (!enchant) return undefined;
	const known = data.enchantsBySlot.get(GEAR_SLOTS[slotIndex].kind)?.some(e => e.effectId === enchant);
	return !known || applicableEnchants(slotIndex, item, data).some(e => e.effectId === enchant) ? enchant : undefined;
}

/**
 * `gear` with one slot changed (null empties it). The slot's enchant stays if it fits the new item. A two-hander pushes
 * the off hand out, and an off-hand item pushes a two-hander out.
 */
export function withItem(gear: Gear, slotIndex: number, itemId: number | null, data: GameData): Gear {
	const isTwoHand = (id: number | undefined) => (id !== undefined ? data.itemById.get(id)?.weapon?.hand === 'twoHand' : false);
	return gear.map((piece, index) => {
		if (index === slotIndex) {
			if (itemId === null) return null;
			const randomSuffix = data.itemById.get(itemId)?.bestSuffix;
			const enchant = piece?.id === itemId ? piece.enchant : carriedEnchant(piece?.enchant, slotIndex, data.itemById.get(itemId), data);
			return { id: itemId, ...(enchant ? { enchant } : {}), ...(randomSuffix ? { randomSuffix } : {}) };
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
	if (item.effects?.length && !simValues.measuredItems.has(item.id) && !simValues.weapons?.byItem.has(item.id)) return true;
	return Boolean(item.setId && !simValues.measuredSets.has(item.setId));
}

export interface Candidate {
	item: Item;
	/** Change in set score when this item replaces the slot's current one. */
	delta: number;
	/** The score leaves something out: an effect or set bonus nobody measured, or an unpicked random suffix. */
	incomplete: boolean;
}

/** The required levels a slot's random-suffix section lists: endgame items only. */
const RANDOM_ROLL_LEVELS = [50, 60];

/**
 * A list with one row for random-suffix items ("of Shadow Wrath"). Many base items roll the same
 * suffix and would fill a short list with near-copies. The best one stays in the list; `others`
 * holds the rest for it, best first, to be shown on request: those of required level 50 to 60.
 * `keep` names an item that always stays in the list, such as the worn one.
 */
export function oneRandomRoll(list: Candidate[], keep?: number): { list: Candidate[]; others: Map<number, Candidate[]> } {
	const others = new Map<number, Candidate[]>();
	let best: Candidate | undefined;
	const out = list.filter(candidate => {
		if (!candidate.item.randomSuffixOptions?.length || candidate.item.id === keep) return true;
		if (!best) {
			best = candidate;
			return true;
		}
		const level = candidate.item.reqLvl;
		if (level === undefined || (level >= RANDOM_ROLL_LEVELS[0] && level <= RANDOM_ROLL_LEVELS[1])) others.set(best.item.id, [...(others.get(best.item.id) ?? []), candidate]);
		return false;
	});
	return { list: out, others };
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
/** A plan and, when a number of set pieces was asked for, what that costs against the free choice. */
export interface PlanResult {
	plan: Record<number, number>;
	/** Set pieces of the chosen dungeon set in the plan, when a minimum was asked for. */
	tierCount?: number;
	/** Score given up to hold that many set pieces (0 or more). */
	tierCost?: number;
}

export function suggestPlan(options: CandidateOptions): Record<number, number> {
	return planWithCost(options).plan;
}

export function planWithCost(options: CandidateOptions): PlanResult {
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

	// A number of dungeon set pieces was asked for: put the cheapest ones in until it is reached.
	let tier: { count: number; cost: number } | undefined;
	const tiers = tierSets(spec);
	if (filter.tierMinimum > 0 && tiers) {
		const free = scoreOf(gear);
		let best: { gear: Gear; count: number; score: number } | undefined;
		for (const setId of [tiers.tier05, tiers.tier0]) {
			const pieces = [...data.itemById.values()].filter(item => item.setId === setId && isObtainable(item, character, faction, filter, spec));
			let forced = gear;
			const count = () => forced.filter(piece => piece && data.itemById.get(piece.id)?.setId === setId).length;
			while (count() < filter.tierMinimum) {
				let step: { gear: Gear; score: number } | undefined;
				for (const item of pieces) {
					const slot = slots.find(index => fitsSlot(item, index, spec));
					if (slot === undefined || data.itemById.get(forced[slot]?.id ?? -1)?.setId === setId) continue;
					const tried = put(forced, slot, item.id);
					const triedScore = scoreOf(tried);
					if (!step || triedScore > step.score) step = { gear: tried, score: triedScore };
				}
				if (!step) break; // no ticked slot left for this set
				forced = step.gear;
			}
			const result = { gear: forced, count: count(), score: scoreOf(forced) };
			const reached = (r: typeof result) => Math.min(r.count, filter.tierMinimum);
			if (!best || reached(result) > reached(best) || (reached(result) === reached(best) && result.score > best.score)) best = result;
		}
		if (best) {
			gear = best.gear;
			tier = { count: best.count, cost: Math.max(0, free - best.score) };
		}
	}

	const plan: Record<number, number> = {};
	for (const slot of slots) {
		const id = gear[slot]?.id;
		if (id !== undefined && id !== character.gear[slot]?.id) plan[slot] = id;
		// A slot the plan empties: the off hand under a planned two-hander, or the reverse.
		else if (id === undefined && character.gear[slot]) plan[slot] = EMPTY_SLOT;
	}
	return { plan, ...(tier ? { tierCount: tier.count, tierCost: tier.cost } : {}) };
}
