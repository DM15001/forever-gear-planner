import { GEAR_SLOTS } from '../constants';
import { enchantOverview } from '../enchants';
import { applicableEnchants, type CandidateOptions, EMPTY_SLOT, type Gear, plannedGear, slotCandidates, slotInUse, withItem } from '../scoring';
import type { Character, SpecConfig } from '../types';
import type { BonusStats, SimOutcome } from './request';

/** Anything that can run the simulator; the page passes its SimClient, tests a stand-in. */
export interface SimRunner {
	run(character: Character, gear: Gear, iterations: number, bonus?: BonusStats): Promise<SimOutcome>;
}

/** The simulator's number for each stat the planner scores. */
const STAT_INDEX: Record<string, number> = {
	strength: 0,
	agility: 1,
	stamina: 2,
	intellect: 3,
	healingPower: 4,
	spellDamage: 5,
	arcaneDamage: 6,
	fireDamage: 7,
	frostDamage: 8,
	holyDamage: 9,
	natureDamage: 10,
	shadowDamage: 11,
	spellPiercing: 12,
	spirit: 13,
	attackPower: 14,
	rangedAttackPower: 15,
	feralAttackPower: 16,
	hitRating: 17,
	critRating: 18,
	hasteRating: 19,
	armorPenetration: 20,
	expertiseRating: 21,
	mp5: 31,
};
const MAIN_HAND_DPS = 0;
const OFF_HAND_DPS = 1;

export const WEIGHT_ITERATIONS = 3000;

/** How many simulator runs measuring a spec's weights takes. */
export const weightRuns = (spec: SpecConfig) => 1 + Object.keys(spec.weights.stats).filter(key => key in STAT_INDEX).length + (spec.weights.mainHandDps ? 1 : 0) + (spec.weights.offHandDps ? 1 : 0);

/**
 * Stat weights for this character as it stands: one run per stat with a little of that stat added,
 * each compared with the plain run. The result is DPS per point of each stat. Hit is
 * measured by taking some away, so a character at the cap still gets its value below the cap.
 */
export async function measureWeights(character: Character, spec: SpecConfig, runner: SimRunner, onProgress: (done: number, total: number) => void): Promise<SpecConfig['weights']> {
	const gear = character.gear;
	const total = weightRuns(spec);
	let done = 0;
	const step = () => onProgress(++done, total);
	const base = await runner.run(character, gear, WEIGHT_ITERATIONS);
	step();
	const perPoint = async (bonus: BonusStats, amount: number) => {
		const outcome = await runner.run(character, gear, WEIGHT_ITERATIONS, bonus);
		step();
		return (outcome.dps - base.dps) / amount;
	};
	const raw: Record<string, number> = {};
	for (const key of Object.keys(spec.weights.stats)) {
		if (!(key in STAT_INDEX)) continue;
		const amount = key === 'hitRating' ? -30 : key.endsWith('Rating') ? 30 : key === 'mp5' ? 20 : key === 'attackPower' || key === 'feralAttackPower' || key === 'rangedAttackPower' ? 100 : 50;
		raw[key] = await perPoint({ stats: { [STAT_INDEX[key]]: amount } }, amount);
	}
	const mainHand = spec.weights.mainHandDps ? await perPoint({ pseudoStats: { [MAIN_HAND_DPS]: 5 } }, 5) : 0;
	const offHand = spec.weights.offHandDps ? await perPoint({ pseudoStats: { [OFF_HAND_DPS]: 5 } }, 5) : 0;

	// The weights are DPS per point of each stat, as the simulator gave them.
	const scaled = (value: number) => Math.max(0, Math.round(value * 1000) / 1000);
	const stats: Record<string, number> = { ...spec.weights.stats };
	for (const [key, value] of Object.entries(raw)) stats[key] = scaled(value);
	return {
		...spec.weights,
		source: `Measured for this character in the browser with the WoWSims simulator (${WEIGHT_ITERATIONS} iterations per stat).`,
		mainHandDps: spec.weights.mainHandDps ? scaled(mainHand) : 0,
		...(spec.weights.offHandDps ? { offHandDps: scaled(offHand) } : {}),
		stats,
	};
}

export const REFINE_ITERATIONS = 1000;
/** How many of a slot's best-scored items get a real run. */
export const REFINE_DEPTH = 3;
/** A swap has to beat the set by this many DPS to count; less is noise at this run length. */
const REFINE_MARGIN = 3;

export interface RefineProgress {
	slot: string;
	done: number;
	total: number;
	dps: number;
}

/** Slots whose items are picked together: both rings, both trinkets, both hands. */
const TWIN_SLOTS: [number, number, string][] = [
	[10, 11, 'Both rings'],
	[12, 13, 'Both trinkets'],
	[14, 15, 'Both hands'],
];
/** How many proc enchants of a slot get a real run. */
const REFINE_PROCS = 3;
/** How many pairs of hit-rating slots are tried together. */
const REFINE_HIT_PAIRS = 3;

/**
 * Checks the plan against the simulator, in four passes, and keeps a change only when the real DPS goes up.
 *
 * 1. Items: slot by slot, the items the quick score likes best and the worn one.
 * 2. Enchants: slot by slot, the worn enchant, the proc enchants (the score only knows them roughly) and the next
 *    best stat enchant.
 * 3. Pairs: two slots changed at once, which no single swap finds. Both rings, both trinkets, both hands, and slots
 *    that trade hit rating between them: each pair with the worn items back in, and with each slot's next best item.
 * 4. The worn gear as a whole: the result is never below what the character wears.
 *
 * Returns the new plan with its enchants and the DPS before and after.
 */
export async function refinePlan(
	options: CandidateOptions,
	runner: SimRunner,
	onProgress: (progress: RefineProgress) => void,
	cancelled: () => boolean = () => false,
): Promise<{ plan: Record<number, number>; planEnchants: Record<number, number>; before: number; after: number; changes: number }> {
	const { character, data, spec } = options;
	const slots = GEAR_SLOTS.map((_, slot) => slot).filter(slot => slotInUse(slot, spec));
	const itemOf = (set: Gear, slot: number) => (set[slot] ? data.itemById.get(set[slot]!.id) : undefined);
	let gear = plannedGear(character, data);
	let best = (await runner.run(character, gear, REFINE_ITERATIONS)).dps;
	const before = best;
	let changes = 0;

	// What is still to come, for the progress bar: every slot twice (item, enchant), the pairs, the worn gear.
	const hitSlots = slots.filter(slot => (itemOf(gear, slot)?.stats?.hitRating ?? 0) > 0 || (itemOf(character.gear, slot)?.stats?.hitRating ?? 0) > 0);
	const hitPairs: [number, number, string][] = [];
	for (const a of hitSlots)
		for (const b of hitSlots)
			if (a < b && !TWIN_SLOTS.some(([x, y]) => x === a && y === b) && hitPairs.length < REFINE_HIT_PAIRS && (gear[a]?.id !== character.gear[a]?.id || gear[b]?.id !== character.gear[b]?.id))
				hitPairs.push([a, b, `${GEAR_SLOTS[a].label} and ${GEAR_SLOTS[b].label} (hit)`]);
	const pairs = [...TWIN_SLOTS.filter(([a, b]) => slots.includes(a) && slots.includes(b)), ...hitPairs];
	const total = slots.length * 2 + pairs.length + 1;
	let done = 0;
	const step = (label: string) => onProgress({ slot: label, done: done++, total, dps: best });
	/** Runs a set and keeps it when it is really better. */
	const attempt = async (variant: Gear) => {
		const dps = (await runner.run(character, variant, REFINE_ITERATIONS)).dps;
		if (dps <= best + REFINE_MARGIN) return false;
		best = dps;
		gear = variant;
		changes++;
		return true;
	};
	/** The slot as the character wears it, item and enchant. */
	const wornIn = (set: Gear, slot: number): Gear => withItem(set, slot, character.gear[slot]?.id ?? null, data).map((piece, index) => (index === slot ? (character.gear[slot] ?? null) : piece));
	const nextBest = (set: Gear, slot: number) => slotCandidates(slot, set, options)[0]?.item.id;

	// 1. Items.
	for (const slot of slots) {
		if (cancelled()) break;
		step(GEAR_SLOTS[slot].label);
		const ids = slotCandidates(slot, gear, options)
			.slice(0, REFINE_DEPTH)
			.map(candidate => candidate.item.id);
		for (const id of ids) {
			if (cancelled()) break;
			await attempt(withItem(gear, slot, id, data, { character, spec }));
		}
		// What is worn now: the plan may have dropped an item whose proc the score cannot see.
		if (!cancelled() && character.gear[slot] && gear[slot]?.id !== character.gear[slot]?.id) await attempt(wornIn(gear, slot));
	}

	// 2. Enchants.
	for (const slot of slots) {
		if (cancelled()) break;
		step(`${GEAR_SLOTS[slot].label} enchant`);
		const piece = gear[slot];
		if (!piece) continue;
		const fitting = applicableEnchants(slot, itemOf(gear, slot), data);
		const overview = enchantOverview(gear, character, data, spec).find(entry => entry.slotIndex === slot);
		const worn = character.gear[slot]?.enchant;
		const procs = fitting
			.filter(enchant => enchant.hasEffect && data.simValues.enchants.has(enchant.effectId))
			.sort((x, y) => (data.simValues.enchants.get(y.effectId) ?? 0) - (data.simValues.enchants.get(x.effectId) ?? 0))
			.slice(0, REFINE_PROCS)
			.map(enchant => enchant.effectId);
		const nextStat = overview?.options.find(option => option.enchant.effectId !== piece.enchant && !option.enchant.hasEffect)?.enchant.effectId;
		const tries = [...new Set([worn && fitting.some(enchant => enchant.effectId === worn) ? worn : undefined, ...procs, nextStat])].filter((id): id is number => id !== undefined && id !== piece.enchant);
		for (const effectId of tries) {
			if (cancelled()) break;
			await attempt(gear.map((p, index) => (index === slot && p ? { ...p, enchant: effectId } : p)));
		}
	}

	// 3. Pairs.
	for (const [a, b, label] of pairs) {
		if (cancelled()) break;
		step(label);
		// Both as worn, where the plan changed at least one of them.
		if (gear[a]?.id !== character.gear[a]?.id || gear[b]?.id !== character.gear[b]?.id) await attempt(wornIn(wornIn(gear, a), b));
		if (cancelled()) break;
		// Each slot's next best item, together.
		const first = nextBest(gear, a);
		const half = first !== undefined ? withItem(gear, a, first, data, { character, spec }) : gear;
		const second = nextBest(half, b);
		if (first !== undefined && second !== undefined) await attempt(withItem(half, b, second, data, { character, spec }));
	}

	// 4. Never below what is worn.
	if (!cancelled()) {
		step('Your worn gear');
		if (gear.some((piece, slot) => piece?.id !== character.gear[slot]?.id || piece?.enchant !== character.gear[slot]?.enchant)) {
			const worn = (await runner.run(character, character.gear, REFINE_ITERATIONS)).dps;
			if (worn > best) {
				best = worn;
				gear = character.gear;
				changes++;
			}
		}
	}

	const plan: Record<number, number> = {};
	const planEnchants: Record<number, number> = {};
	for (const slot of slots) {
		const id = gear[slot]?.id;
		if (id !== undefined && id !== character.gear[slot]?.id) plan[slot] = id;
		else if (id === undefined && character.gear[slot]) plan[slot] = EMPTY_SLOT;
		const enchant = gear[slot]?.enchant;
		if (enchant && (id !== character.gear[slot]?.id || enchant !== character.gear[slot]?.enchant)) planEnchants[slot] = enchant;
	}
	return { plan, planEnchants, before, after: best, changes };
}
