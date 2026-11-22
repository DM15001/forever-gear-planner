import { GEAR_SLOTS } from '../constants';
import { type CandidateOptions, EMPTY_SLOT, type Gear, plannedGear, slotCandidates, slotInUse, withItem } from '../scoring';
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
		const amount = key === 'hitRating' ? -30 : key.endsWith('Rating') ? 30 : key === 'attackPower' || key === 'feralAttackPower' || key === 'rangedAttackPower' ? 100 : 50;
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

/**
 * Checks the plan against the simulator. Slot by slot, the items the quick score likes best are
 * each simulated in the planned set, and the one with the highest real DPS stays. This catches
 * procs, on-use effects and set bonuses the quick score cannot see. Returns the new plan and the
 * DPS before and after.
 */
export async function refinePlan(
	options: CandidateOptions,
	runner: SimRunner,
	onProgress: (progress: RefineProgress) => void,
	cancelled: () => boolean = () => false,
): Promise<{ plan: Record<number, number>; before: number; after: number; changes: number }> {
	const { character, data, spec } = options;
	const slots = GEAR_SLOTS.map((_, slot) => slot).filter(slot => slotInUse(slot, spec));
	let gear = plannedGear(character, data);
	let best = (await runner.run(character, gear, REFINE_ITERATIONS)).dps;
	const before = best;
	let changes = 0;
	for (const [position, slot] of slots.entries()) {
		if (cancelled()) break;
		onProgress({ slot: GEAR_SLOTS[slot].label, done: position, total: slots.length, dps: best });
		// The best-scored items, and what is worn now: the plan may have dropped an item whose proc the score cannot see.
		const ids = slotCandidates(slot, gear, options)
			.slice(0, REFINE_DEPTH)
			.map(candidate => candidate.item.id);
		const worn = character.gear[slot]?.id;
		if (worn !== undefined && worn !== gear[slot]?.id && !ids.includes(worn)) ids.push(worn);
		for (const id of ids) {
			if (cancelled()) break;
			const variant = withItem(gear, slot, id, data).map((piece, index) => (index === slot && id === worn ? (character.gear[slot] ?? piece) : piece));
			const dps = (await runner.run(character, variant, REFINE_ITERATIONS)).dps;
			if (dps > best + REFINE_MARGIN) {
				best = dps;
				gear = variant;
				changes++;
			}
		}
	}
	const plan: Record<number, number> = {};
	for (const slot of slots) {
		const id = gear[slot]?.id;
		if (id !== undefined && id !== character.gear[slot]?.id) plan[slot] = id;
		else if (id === undefined && character.gear[slot]) plan[slot] = EMPTY_SLOT;
	}
	return { plan, before, after: best, changes };
}
