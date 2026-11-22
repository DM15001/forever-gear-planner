import { describe, expect, it } from 'vitest';

import { loadGameData } from './gameData';
import { effortLine, runChance } from './loot';
import type { ItemSource } from './types';

describe('applyLoot', () => {
	it("puts Wowhead's drop chance on a drop the data already has", async () => {
		const data = await loadGameData();
		const jewel = data.itemById.get(11933)!; // Imperial Jewel, Emperor Dagran Thaurissan
		const source = jewel.sources!.find(s => s.kind === 'drop')!;
		expect(source.dropChance).toBeCloseTo(250 / 1278, 5);
		expect(source.dropSample).toBe(1278);
		expect(source.dropBasis).toBe('forever');
		expect(source.spawnChance).toBeUndefined();
	});

	it('marks the Ring of Law bosses as one in six', async () => {
		const data = await loadGameData();
		const drops = [...data.itemById.values()].flatMap(i => i.sources ?? []).filter(s => s.npcId === 9027); // Gorosh the Dervish
		expect(drops.length).toBeGreaterThan(0);
		for (const s of drops) expect(s.spawnChance).toBeCloseTo(1 / 6, 3);
	});

	it('leaves every item with a drop chance between 0 and 1', async () => {
		const data = await loadGameData();
		const chances = [...data.itemById.values()].flatMap(i => i.sources ?? []).filter(s => s.dropChance !== undefined);
		expect(chances.length).toBeGreaterThan(80);
		for (const s of chances) {
			expect(s.dropChance!).toBeGreaterThan(0);
			expect(s.dropChance!).toBeLessThanOrEqual(1);
		}
	});
});

describe('runChance and effortLine', () => {
	const drop = (extra: Partial<ItemSource>): ItemSource => ({ kind: 'drop', ...extra });

	it('multiplies drop chance and spawn chance', () => {
		expect(runChance(drop({ dropChance: 0.2 }))).toBeCloseTo(0.2);
		expect(runChance(drop({ dropChance: 0.3, spawnChance: 1 / 6 }))).toBeCloseTo(0.05);
		expect(runChance(drop({}))).toBeUndefined();
		expect(runChance(undefined)).toBeUndefined();
	});

	it('writes the effort as a line', () => {
		expect(effortLine(drop({ dropChance: 0.2 }))).toBe('20% drop, about 5 runs');
		expect(effortLine(drop({ dropChance: 0.3, spawnChance: 1 / 6, spawnBasis: 'mechanic' }))).toBe('30% drop, boss there 1 in 6 runs, about 20 runs');
		expect(effortLine(drop({ dropChance: 0.12, dropBasis: 'classic' }))).toBe('12% drop (Classic rate), about 8 runs');
		expect(effortLine(drop({ dropChance: 0.004 }))).toBe('0.4% drop, about 250 runs');
		expect(effortLine(drop({ spawnChance: 0.15, spawnBasis: 'estimate' }))).toBe('boss there 1 in 7 runs (estimate)');
		expect(effortLine(drop({}))).toBeUndefined();
		expect(effortLine({ kind: 'quest' })).toBeUndefined();
	});
});
