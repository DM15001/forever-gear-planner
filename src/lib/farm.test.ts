import { describe, expect, it } from 'vitest';

import specJson from '../specs/enhancement-shaman.json';
import simExport from './__fixtures__/sim-export.json';
import { dungeonRanking, planShoppingList } from './farm';
import { loadGameData } from './gameData';
import { importCharacter } from './importCharacter';
import { DEFAULT_FILTER, suggestPlan } from './scoring';
import type { Character, SpecConfig } from './types';

const spec = specJson as unknown as SpecConfig;
const data = await loadGameData();
const imported = importCharacter(JSON.stringify(simExport), spec).character;
const dwarf: Character = { ...imported, race: 'RaceDwarf', professions: ['Skinning', 'Leatherworking'], gear: imported.gear.map(p => (p ? { id: p.id } : null)) };
const options = { character: dwarf, data, spec, filter: DEFAULT_FILTER };

describe('dungeonRanking', () => {
	const ranking = dungeonRanking(options);

	it('ranks dungeons by value, best first', () => {
		expect(ranking.length).toBeGreaterThan(3);
		expect(ranking.every(d => d.zone.kind === 'dungeon')).toBe(true);
		for (let i = 1; i < ranking.length; i++) expect(ranking[i - 1].value).toBeGreaterThanOrEqual(ranking[i].value);
	});

	it('lists only upgrades that really drop in that dungeon', () => {
		for (const dungeon of ranking) {
			for (const boss of dungeon.bosses) {
				expect(boss.drops.length).toBeGreaterThan(0);
				for (const drop of boss.drops) {
					expect(drop.delta).toBeGreaterThan(0);
					expect(drop.item.sources?.some(s => s.kind === 'drop' && s.zoneId === dungeon.zone.id)).toBe(true);
				}
			}
		}
	});

	it('counts each slot once in the value', () => {
		const dungeon = ranking[0];
		const drops = new Set(dungeon.bosses.flatMap(b => b.drops));
		const sumOfAll = [...drops].reduce((sum, d) => sum + d.delta, 0);
		expect(dungeon.upgradeCount).toBe(drops.size);
		expect(dungeon.value).toBeLessThanOrEqual(sumOfAll + 0.001);
	});

	it('marks the planned items', () => {
		const plan = suggestPlan(options);
		const withPlan = dungeonRanking({ ...options, character: { ...dwarf, plan } });
		const marked = new Set(withPlan.flatMap(d => d.bosses.flatMap(b => b.drops.filter(x => x.planned).map(x => x.item.id))));
		for (const id of marked) expect(Object.values(plan)).toContain(id);
		expect(withPlan.reduce((sum, d) => sum + d.plannedCount, 0)).toBeGreaterThan(0);
	});
});

describe('dungeon wings', () => {
	const ranking = dungeonRanking(options);

	it('splits Blackrock Spire into Lower and Upper', () => {
		const names = ranking.map(d => d.name);
		expect(names).toContain('Blackrock Spire: Lower');
		expect(names).toContain('Blackrock Spire: Upper');
		const lower = ranking.find(d => d.name === 'Blackrock Spire: Lower')!;
		expect(lower.bosses.map(b => b.name)).toContain('Highlord Omokk');
		expect(lower.bosses.map(b => b.name)).not.toContain('The Beast');
		expect(new Set(ranking.map(d => d.key)).size).toBe(ranking.length);
	});

	it('keeps trash and unsorted bosses in an entry of their own', () => {
		const plain = ranking.find(d => d.name === 'Blackrock Spire: trash and other');
		expect(plain?.bosses.every(b => b.name === 'Trash' || b.name === 'Multiple NPCs')).toBe(true);
	});
});

describe('planShoppingList', () => {
	it('files every planned item under exactly one group', () => {
		const plan = suggestPlan(options);
		const groups = planShoppingList({ ...options, character: { ...dwarf, plan } });
		const ids = [...groups.values()].flat().map(e => e.item.id);
		expect(ids.sort()).toEqual(Object.values(plan).sort());
	});

	it('knows which crafted items the character can make', () => {
		const plan = suggestPlan(options);
		const crafted = planShoppingList({ ...options, character: { ...dwarf, plan } }).get('crafted') ?? [];
		expect(crafted.length).toBeGreaterThan(0);
		for (const entry of crafted) expect(entry.craftable).toBe(entry.source?.profession === 'Leatherworking');
	});

	it('is empty without a plan', () => {
		expect(planShoppingList(options).size).toBe(0);
	});
});
