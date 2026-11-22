import { describe, expect, it } from 'vitest';

import { GEAR_SLOTS } from '../constants';
import { loadGameData } from '../gameData';
import { DEFAULT_FILTER, plannedGear, scoreSet, suggestPlan } from '../scoring';
import { SPECS } from '../specs';
import type { Character } from '../types';
import { measureWeights, refinePlan, type SimRunner, weightRuns } from './live';

const spec = SPECS.find(s => s.id === 'warrior-fury')!;
const data = await loadGameData(spec);
const character: Character = { specId: spec.id, race: 'RaceOrc', level: 60, talents: '', professions: [], gear: GEAR_SLOTS.map(() => null) };
const outcome = (dps: number) => ({ dps, error: 0.5, iterations: 1 });

describe('measuring stat weights with the simulator', () => {
	it('turns DPS differences into weights, with attack power as the unit', async () => {
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
		expect(weights.stats.attackPower).toBe(1);
		expect(weights.stats.strength).toBe(4);
		expect(weights.stats.hitRating).toBe(3);
		expect(weights.stats.critRating).toBe(0);
		expect(weights.mainHandDps).toBe(12);
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
		const after = scoreSet(plannedGear({ ...character, plan: result.plan }, data), character, data, strengthOnly).score;
		expect(after).toBeCloseTo(result.after, 5);
	});

	it('stops when asked', async () => {
		const runner: SimRunner = { run: async () => outcome(100) };
		let calls = 0;
		const result = await refinePlan({ character, data, spec, filter: DEFAULT_FILTER }, runner, () => calls++, () => calls >= 2);
		expect(calls).toBe(2);
		expect(result.changes).toBe(0);
	});
});
