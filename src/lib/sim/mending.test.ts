import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { castingShare, countsMending, hasMendingTalent, mendingEstimate, mendingWeights, readMending } from './mending';

describe('Prayer of Mending, estimated', () => {
	it('finds the talent where the talent tree has it', () => {
		const trees = JSON.parse(readFileSync('public/sim/setup.json', 'utf8')).trees.priest;
		expect(trees[1].talents[16].name).toBe('Prayer of Mending');
		expect(hasMendingTalent('025005001330011-03505103030020531')).toBe(true);
		expect(hasMendingTalent('025005001330011-0350510303002053')).toBe(false);
		expect(hasMendingTalent(undefined)).toBe(false);
	});

	it('can be switched off', () => {
		const talents = '-00000000000000001';
		expect(countsMending({ talents })).toBe(true);
		expect(countsMending({ talents, healing: { mending: false } })).toBe(false);
	});

	it('adds the jumps and takes off the casts it displaces', () => {
		// 5 jumps of 413 + 0.429 x 700 = 3566.5 per cast without crit.
		const e = mendingEstimate(413, 700, 0, 600, 0.5);
		expect(e.perCast).toBeCloseTo(3566.5);
		expect(e.gross).toBeCloseTo(178.3, 1);
		expect(e.displaced).toBeCloseTo(90);
		expect(e.hps).toBeCloseTo(88.3, 1);
		expect(castingShare({ healing: { pressure: 'burst' } })).toBe(1);
	});

	it('reads the rank and stats from the simulator and is absent without the spell', () => {
		const stats = (spells: number[]) =>
			JSON.stringify({ raidStats: { parties: [{ players: [{ metadata: { spells: spells.map(spellId => ({ id: { spellId } })) }, finalStats: { stats: [0, 0, 0, 0, 700], pseudoStats: Array(16).fill(0) } }] }] } });
		expect(readMending(stats([25314, 401859, 1240827, 1240826]), 600, 0.5)?.hps).toBeCloseTo(88.3, 1);
		expect(readMending(stats([25314]), 600, 0.5)).toBeUndefined();
	});

	it('moves the weights towards healing power', () => {
		const w = mendingWeights({ healingPower: 0.2, spirit: 0.4 }, 0.5);
		expect(w.spirit).toBeCloseTo(0.34);
		expect(w.healingPower).toBeCloseTo(0.17 + 0.10725);
	});
});
