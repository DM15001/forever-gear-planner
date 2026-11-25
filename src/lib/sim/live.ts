import { GEAR_SLOTS } from '../constants';
import { bestEnchants, enchantOverview } from '../enchants';
import { guidePlan } from '../guides';
import { applicableEnchants, type CandidateOptions, EMPTY_SLOT, type Gear, isObtainable, plannedGear, slotCandidates, slotInUse, withItem } from '../scoring';
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

/** A first look: enough to tell a clear loser from a candidate. */
export const ROUGH_ITERATIONS = 250;
/** The run that decides whether a change is kept. */
export const REFINE_ITERATIONS = 1000;
/** The last run, for the winner and the runner-up. */
export const FINAL_ITERATIONS = 5000;
/** How many of a slot's best-scored items get a real run, unless the visitor picks another depth. */
export const REFINE_DEPTH = 3;
/** The depths on offer: fewer runs and a shorter wait, or more of each slot's list tried. */
export const REFINE_DEPTHS = [
	{ depth: 2, label: 'Quick', note: 'the 2 best per slot' },
	{ depth: 3, label: 'Normal', note: 'the 3 best per slot' },
	{ depth: 5, label: 'Thorough', note: 'the 5 best per slot, about a third longer' },
	{ depth: 8, label: 'Very thorough', note: 'the 8 best per slot, about twice as long' },
];
/** A change that is not at least level with the set in the rough run is dropped there. */
const ROUGH_MARGIN = 0;
/**
 * A change has to beat the set by this many DPS in the deciding run. Every run uses the same random seed, so two
 * sets differ by far less than one run's own noise, and a gain this small is real.
 */
const REFINE_MARGIN = 1.5;
/** A gain smaller than this is run again, longer, before it counts. */
const CONFIRM_BELOW = 4;
const CONFIRM_ITERATIONS = 3000;
/** Winner and runner-up within this many DPS in the last run count as equal. */
export const EQUAL_MARGIN = 1;

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

/** What the check found: the plan, and how sure it is. */
export interface RefineResult {
	plan: Record<number, number>;
	planEnchants: Record<number, number>;
	/** The plan as it was, and the set that won, both in the deciding run length (the winner's is its last, long run when there was one). */
	before: number;
	after: number;
	changes: number;
	/** Where the winning set started from: the plan, a guide's set, or the worn gear. */
	startedFrom: string;
	/** The second best whole set and its DPS in the last run; `equal` when the two cannot be told apart. */
	runnerUp?: { label: string; dps: number; equal: boolean };
}

/**
 * Looks for the best set with the simulator and keeps a change only when the real DPS goes up.
 *
 * 0. Starting points: the plan, the set of every guide (as far as the content choice allows) and the worn gear run
 *    against each other; the search goes on from the best. A plan that the estimate got wrong is not the only start.
 * 1. Items: slot by slot, the items the quick score likes best and the worn one; a second time when the first
 *    changed something, so an early slot is judged against the set as it ended up.
 * 2. Enchants: slot by slot, the worn enchant, the proc enchants and the next best stat enchant.
 * 3. Pairs: two slots changed at once, which no single swap finds. Both rings, both trinkets, both hands, and slots
 *    that trade hit rating between them.
 * 4. The winner and the runner-up once more in a long run, so the last word is not a short run's.
 *
 * Every change gets a short run first and the deciding run only when the short one does not rule it out: most
 * candidates are clear losers, and the time goes to the close calls. The result is never below the worn gear.
 */
export async function refinePlan(
	options: CandidateOptions,
	runner: SimRunner,
	onProgress: (progress: RefineProgress) => void,
	cancelled: () => boolean = () => false,
	/** How many of a slot's best-scored items get a real run: the visitor's choice between quick and thorough. */
	depth: number = REFINE_DEPTH,
): Promise<RefineResult> {
	const { character, data, spec, filter } = options;
	const slots = GEAR_SLOTS.map((_, slot) => slot).filter(slot => slotInUse(slot, spec));
	const itemOf = (set: Gear, slot: number) => (set[slot] ? data.itemById.get(set[slot]!.id) : undefined);
	const run = async (set: Gear, iterations: number) => (await runner.run(character, set, iterations)).dps;
	const keyOf = (set: Gear) => set.map(piece => (piece ? `${piece.id}.${piece.enchant ?? 0}.${piece.randomSuffix ?? 0}` : '-')).join('|');
	const faction = spec.races.find(race => race.id === character.race)?.faction;

	// 0. Starting points.
	const planned = plannedGear(character, data);
	const starts: { label: string; gear: Gear }[] = [{ label: 'the plan', gear: planned }];
	for (const guide of data.guides) {
		const { plan } = guidePlan(guide, character, data, spec);
		for (const [slot, id] of Object.entries(plan)) {
			const item = data.itemById.get(id);
			if (!item || !isObtainable(item, character, faction, filter, spec)) delete plan[Number(slot)];
		}
		const blank: Character = { ...character, plan, planEnchants: {} };
		const gear = plannedGear({ ...blank, planEnchants: bestEnchants(plannedGear(blank, data), blank, data, spec) }, data);
		starts.push({ label: `the ${guide.title}`, gear });
	}
	starts.push({ label: 'what you wear', gear: character.gear });
	const distinct = starts.filter((start, index) => starts.findIndex(other => keyOf(other.gear) === keyOf(start.gear)) === index);

	const before = await run(planned, REFINE_ITERATIONS);
	const total = 1 + slots.length * 3 + 3 + REFINE_HIT_PAIRS + 1;
	let done = 0;
	let best = before;
	const step = (label: string) => onProgress({ slot: label, done: Math.min(done++, total - 1), total, dps: best });
	// Whole sets that were measured in the deciding run: the runner-up comes from these.
	const measured = new Map<string, { label: string; gear: Gear; dps: number }>([[keyOf(planned), { label: 'the plan as it was', gear: planned, dps: before }]]);

	step('Starting points');
	let gear = planned;
	let startedFrom = 'the plan';
	let changes = 0;
	if (distinct.length > 1 && !cancelled()) {
		const rough: { label: string; gear: Gear; dps: number }[] = [];
		for (const start of distinct) {
			if (cancelled()) break;
			rough.push({ ...start, dps: await run(start.gear, ROUGH_ITERATIONS) });
		}
		const plannedRough = rough[0]?.dps ?? 0;
		// Every start that is not clearly behind the plan gets the deciding run.
		for (const start of rough.slice(1)) {
			if (cancelled() || start.dps < plannedRough - ROUGH_MARGIN) continue;
			const dps = await run(start.gear, REFINE_ITERATIONS);
			measured.set(keyOf(start.gear), { label: start.label, gear: start.gear, dps });
			if (dps > best + REFINE_MARGIN) {
				best = dps;
				gear = start.gear;
				startedFrom = start.label;
			}
		}
		if (gear !== planned) changes++;
	}

	// The set in the short run: what every candidate is compared with before it earns the deciding run.
	let roughBest = cancelled() ? best : await run(gear, ROUGH_ITERATIONS);
	// The set in the confirming run, once one was needed.
	let sure: number | undefined;
	/** A short run first; the deciding run only when the short one does not rule the change out. */
	const attempt = async (variant: Gear) => {
		if (keyOf(variant) === keyOf(gear)) return false;
		const rough = await run(variant, ROUGH_ITERATIONS);
		if (rough < roughBest + ROUGH_MARGIN) return false;
		const dps = await run(variant, REFINE_ITERATIONS);
		if (dps <= best + REFINE_MARGIN) return false;
		// A small gain has to hold in a longer run of both sets, or a lucky run would be taken for a better item.
		if (dps <= best + CONFIRM_BELOW) {
			sure ??= await run(gear, CONFIRM_ITERATIONS);
			const again = await run(variant, CONFIRM_ITERATIONS);
			if (again <= sure + REFINE_MARGIN / 2) return false;
			sure = again;
		} else sure = undefined;
		measured.set(keyOf(gear), { label: 'the set before the last change', gear, dps: best });
		best = dps;
		roughBest = rough;
		gear = variant;
		changes++;
		return true;
	};
	/** The slot as the character wears it, item and enchant. */
	const wornIn = (set: Gear, slot: number): Gear => withItem(set, slot, character.gear[slot]?.id ?? null, data).map((piece, index) => (index === slot ? (character.gear[slot] ?? null) : piece));
	const nextBest = (set: Gear, slot: number) => slotCandidates(slot, set, options)[0]?.item.id;

	// 1. Items. Twice when the first time changed something: a slot decided early is looked at again against the set
	// as it ended up (a helm taken for its hit rating, before a ring brought the cap).
	for (let sweep = 0; sweep < 2; sweep++) {
		const changesBefore = changes;
		for (const slot of slots) {
			if (cancelled()) break;
			step(sweep === 0 ? GEAR_SLOTS[slot].label : `${GEAR_SLOTS[slot].label}, second look`);
			const ids = slotCandidates(slot, gear, options)
				.slice(0, depth)
				.map(candidate => candidate.item.id);
			for (const id of ids) {
				if (cancelled()) break;
				await attempt(withItem(gear, slot, id, data, { character, spec }));
			}
			// What is worn now: the plan may have dropped an item whose proc the score cannot see.
			if (!cancelled() && character.gear[slot] && gear[slot]?.id !== character.gear[slot]?.id) await attempt(wornIn(gear, slot));
		}
		if (changes === changesBefore || cancelled()) {
			if (sweep === 0) done += slots.length;
			break;
		}
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

	// 3. Pairs: the twins, and slots that trade hit rating (as the set stands now).
	const hitSlots = slots.filter(slot => (itemOf(gear, slot)?.stats?.hitRating ?? 0) > 0 || (itemOf(character.gear, slot)?.stats?.hitRating ?? 0) > 0);
	const hitPairs: [number, number, string][] = [];
	for (const a of hitSlots)
		for (const b of hitSlots)
			if (a < b && !TWIN_SLOTS.some(([x, y]) => x === a && y === b) && hitPairs.length < REFINE_HIT_PAIRS && (gear[a]?.id !== character.gear[a]?.id || gear[b]?.id !== character.gear[b]?.id))
				hitPairs.push([a, b, `${GEAR_SLOTS[a].label} and ${GEAR_SLOTS[b].label} (hit)`]);
	for (const [a, b, label] of [...TWIN_SLOTS.filter(([x, y]) => slots.includes(x) && slots.includes(y)), ...hitPairs]) {
		if (cancelled()) break;
		step(label);
		// Both as worn, where the set changed at least one of them.
		if (gear[a]?.id !== character.gear[a]?.id || gear[b]?.id !== character.gear[b]?.id) await attempt(wornIn(wornIn(gear, a), b));
		if (cancelled()) break;
		// Each slot's next best item, together.
		const first = nextBest(gear, a);
		const half = first !== undefined ? withItem(gear, a, first, data, { character, spec }) : gear;
		const second = nextBest(half, b);
		if (first !== undefined && second !== undefined) await attempt(withItem(half, b, second, data, { character, spec }));
	}

	// 4. The last word: the winner and the best other whole set in a long run. Never below what is worn.
	let runnerUp: RefineResult['runnerUp'];
	if (!cancelled()) {
		done = total - 1;
		step('Winner and runner-up, long run');
		if (!measured.has(keyOf(character.gear)) && keyOf(character.gear) !== keyOf(gear)) measured.set(keyOf(character.gear), { label: 'what you wear', gear: character.gear, dps: await run(character.gear, REFINE_ITERATIONS) });
		const second = [...measured.entries()].filter(([key]) => key !== keyOf(gear)).sort((x, y) => y[1].dps - x[1].dps)[0]?.[1];
		if (second) {
			const winner = await run(gear, FINAL_ITERATIONS);
			const other = await run(second.gear, FINAL_ITERATIONS);
			if (other > winner) {
				// The long run turned it around: the runner-up is the answer.
				runnerUp = { label: startedFrom === 'the plan' && changes === 0 ? 'the plan' : 'the set the search ended on', dps: winner, equal: other - winner <= EQUAL_MARGIN };
				gear = second.gear;
				best = other;
				changes++;
			} else {
				runnerUp = { label: second.label, dps: other, equal: winner - other <= EQUAL_MARGIN };
				best = winner;
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
	return { plan, planEnchants, before, after: best, changes, startedFrom, runnerUp };
}
