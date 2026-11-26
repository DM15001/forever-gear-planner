import { describe, expect, it } from 'vitest';

import { GEAR_SLOTS } from '../constants';
import { loadGameData } from '../gameData';
import { DEFAULT_FILTER, type Gear, plannedGear, scoreSet, slotCandidates, suggestPlan } from '../scoring';
import { SPECS } from '../specs';
import type { Character } from '../types';
import { buildPlan } from '../plan';
import { measureWeights, refinePlan, type SimRunner, weightRuns } from './live';

const spec = SPECS.find(s => s.id === 'warrior-fury')!;
const data = await loadGameData(spec);
const character: Character = { specId: spec.id, race: 'RaceOrc', level: 60, talents: '', professions: [], gear: GEAR_SLOTS.map(() => null) };
const outcome = (dps: number) => ({ dps, error: 0.5, iterations: 1 });

describe('measuring stat weights with the simulator', () => {
	it('turns DPS differences into DPS per point of each stat', async () => {
		// A stand-in simulator: 2 DPS per strength, 0.5 per attack power, 1.5 per hit rating, 6 per point of main hand DPS.
		const truth: Record<number, number> = { 0: 2, 14: 0.5, 17: 1.5 };
		const runner: SimRunner = {
			run: async (_c, _g, _i, bonus) =>
				outcome(800 + Object.entries(bonus?.stats ?? {}).reduce((sum, [k, v]) => sum + (truth[Number(k)] ?? 0) * v, 0) + (bonus?.pseudoStats?.[0] ?? 0) * 6),
		};
		let last = 0;
		const weights = await measureWeights(character, spec, runner, (done, total) => {
			expect(total).toBe(weightRuns(spec));
			last = done;
		});
		expect(last).toBe(weightRuns(spec));
		expect(weights.stats.attackPower).toBe(0.5);
		expect(weights.stats.strength).toBe(2);
		expect(weights.stats.hitRating).toBe(1.5);
		expect(weights.stats.critRating).toBe(0);
		expect(weights.mainHandDps).toBe(6);
		expect(weights.offHandDps).toBe(0);
	});
});

describe('checking the plan with the simulator', () => {
	it('keeps a swap only when the simulator says it is better, and never ends below the start', async () => {
		const planned = { ...character, plan: suggestPlan({ character, data, spec, filter: DEFAULT_FILTER }) };
		// A stand-in simulator that disagrees with the quick score: it only values strength.
		const strengthOnly = { ...spec, weights: { ...spec.weights, mainHandDps: 0, offHandDps: 0, stats: { strength: 1 } } };
		const runner: SimRunner = { run: async (c, gear) => outcome(scoreSet(gear, c, data, strengthOnly).score) };
		const seen: string[] = [];
		const result = await refinePlan({ character: planned, data, spec, filter: DEFAULT_FILTER }, runner, p => seen.push(p.slot));
		expect(seen.length).toBeGreaterThan(10);
		expect(result.after).toBeGreaterThanOrEqual(result.before);
		expect(result.changes).toBeGreaterThan(0);
		const after = scoreSet(plannedGear({ ...character, plan: result.plan, planEnchants: result.planEnchants }, data), character, data, strengthOnly).score;
		expect(after).toBeCloseTo(result.after, 5);
	});

	it('also tries the best items of a score without hit rating', async () => {
		const options = { character, data, spec, filter: DEFAULT_FILTER };
		const planned = { ...character, plan: suggestPlan(options) };
		const noHit = { ...spec, weights: { ...spec.weights, stats: { ...spec.weights.stats, hitRating: 0 } } };
		const tried = new Set<number>();
		const runner: SimRunner = {
			run: async (_c, gear) => {
				for (const piece of gear) if (piece) tried.add(piece.id);
				return outcome(100);
			},
		};
		await refinePlan({ ...options, character: planned }, runner, () => {}, () => false, 1);
		const gear = plannedGear(planned, data);
		const neck = 1;
		const best = slotCandidates(neck, gear, { ...options, character: planned, spec: noHit })[0].item.id;
		expect(tried.has(best)).toBe(true);
	});

	it('leaves a locked slot alone', async () => {
		const options = { character, data, spec, filter: DEFAULT_FILTER };
		const plan = suggestPlan(options);
		const neck = 1;
		const other = [...data.itemById.values()].find(item => item.slot === 'neck' && item.id !== plan[neck])!;
		const pinned = { ...character, plan: { ...plan, [neck]: other.id }, planLocks: [neck] };
		// A stand-in that only values strength: it would swap the neck if it were allowed to.
		const strengthOnly = { ...spec, weights: { ...spec.weights, mainHandDps: 0, offHandDps: 0, stats: { strength: 1 } } };
		const runner: SimRunner = { run: async (c, gear) => outcome(scoreSet(gear, c, data, strengthOnly).score) };
		const result = await refinePlan({ ...options, character: pinned }, runner, () => {});
		expect(result.plan[neck]).toBe(other.id);
	});

	it('stops when asked', async () => {
		const runner: SimRunner = { run: async () => outcome(100) };
		let calls = 0;
		const result = await refinePlan({ character, data, spec, filter: DEFAULT_FILTER }, runner, () => calls++, () => calls >= 2);
		expect(calls).toBe(2);
		expect(result.changes).toBe(0);
	});

	it('never ends below the worn gear, and takes the worn enchant back when the simulator prefers it', async () => {
		const planned = { ...character, ...buildPlan({ character, data, spec, filter: DEFAULT_FILTER }) };
		// A stand-in that likes nothing but exactly what is worn.
		const same = (gear: Gear) => gear.every((piece, slot) => piece?.id === character.gear[slot]?.id && piece?.enchant === character.gear[slot]?.enchant);
		const wornOnly: SimRunner = { run: async (_c, gear) => outcome(same(gear) ? 1000 : 900) };
		const kept = await refinePlan({ character: planned, data, spec, filter: DEFAULT_FILTER }, wornOnly, () => {});
		expect(kept.plan).toEqual({});
		expect(kept.planEnchants).toEqual({});
		expect(kept.after).toBe(1000);

		// A stand-in that pays for one worn enchant: the plan names another one, the check takes the worn one back.
		const dressed = plannedGear(planned, data).map(piece => (piece ? { id: piece.id } : null));
		const slot = 4;
		const [wornEnchant, plannedEnchant] = (data.enchantsBySlot.get('chest') ?? []).filter(enchant => Object.keys(enchant.stats ?? {}).length > 0 && !enchant.only).map(enchant => enchant.effectId);
		const enchanted = { ...character, gear: dressed.map((piece, index) => (index === slot && piece ? { ...piece, enchant: wornEnchant } : piece)) };
		const start = { ...enchanted, plan: {}, planEnchants: { [slot]: plannedEnchant } };
		expect(plannedGear(start, data)[slot]?.enchant).toBe(plannedEnchant);
		const enchantFan: SimRunner = { run: async (_c, gear) => outcome(500 + (gear[slot]?.enchant === wornEnchant ? 50 : 0)) };
		const result = await refinePlan({ character: start, data, spec, filter: DEFAULT_FILTER }, enchantFan, () => {});
		expect(plannedGear({ ...start, plan: result.plan, planEnchants: result.planEnchants }, data)[slot]?.enchant).toBe(wornEnchant);
	});
});
