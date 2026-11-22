import { describe, expect, it } from 'vitest';

import specJson from '../specs/enhancement-shaman.json';
import simExport from './__fixtures__/sim-export.json';
import { GEAR_SLOTS } from './constants';
import { loadGameData } from './gameData';
import { guideMarks, guidePlan, specsWithGuide, swapDelta } from './guides';
import { importCharacter } from './importCharacter';
import { plannedGear, scoreSet } from './scoring';
import type { Character, SpecConfig } from './types';

const spec = specJson as unknown as SpecConfig;
const data = await loadGameData();
const imported = importCharacter(JSON.stringify(simExport), spec).character;
const dwarf: Character = { ...imported, race: 'RaceDwarf', professions: ['Skinning', 'Leatherworking'], gear: imported.gear.map(p => (p ? { id: p.id } : null)) };
const guide = (id: string) => data.guides.find(g => g.id === id)!;

describe('guides', () => {
	it('loads the sim set and the Wowhead list, and every listed item exists in the data', () => {
		expect(data.guides.map(g => g.id)).toEqual(['wowsims', 'wowhead']);
		for (const g of data.guides) {
			expect(g.entries.length).toBeGreaterThan(10);
			for (const entry of g.entries) {
				const item = data.itemById.get(entry.itemId);
				expect(item, `${g.id} ${entry.name ?? entry.itemId}`).toBeDefined();
				expect(item!.slot).toBe(entry.slot);
			}
		}
	});

	it('marks items with the guides that list them', () => {
		const marks = guideMarks(data.guides);
		const DON_JULIOS_BAND = 19325;
		expect(marks.get(DON_JULIOS_BAND)!.map(m => `${m.guide.id}:${m.rank}`)).toEqual(['wowsims:Set', 'wowhead:BiS']);
	});
});

describe('guidePlan', () => {
	it('plans the Wowhead list with the top pick per slot, leaving slots the list does not fill', () => {
		const { plan } = guidePlan(guide('wowhead'), dwarf, data, spec);
		const name = (slot: number) => data.itemById.get(plan[slot])?.name;
		expect(name(0)).toBe('Coif of The Five Thunders');
		expect(name(10)).toBe("Don Julio's Band");
		expect(plan[11]).toBeUndefined();
		expect(name(12)).toBe("Blackhand's Breadth");
		expect(plan[13]).toBeUndefined();
		expect(name(14)).toBe('The Unstoppable Force');
		expect(plan[15]).toBeUndefined();
	});

	it('takes the sim set slot by slot', () => {
		const { plan, skipped } = guidePlan(guide('wowsims'), dwarf, data, spec);
		expect(data.itemById.get(plan[0])?.name).toBe('Face of The Five Thunders');
		expect(data.itemById.get(plan[9])?.name).toBe("Premier Centurion's Mail Boots");
		expect(data.itemById.get(plan[14])?.name).toBe('The Blackrock Slicer');
		expect(skipped).toEqual([]);
	});

	it('reports picks the character cannot use and falls back to the next rank', () => {
		const SKYFURY_HELM = 20134; // Horde quest reward
		const MASK = 13404;
		const custom = {
			...guide('wowhead'),
			entries: [
				{ itemId: 999999999, slot: 'neck' as const, rank: 'BiS', name: 'Made-up Amulet' },
				{ itemId: SKYFURY_HELM, slot: 'head' as const, rank: 'BiS' },
				{ itemId: MASK, slot: 'head' as const, rank: 'Great' },
			],
		};
		const { plan, skipped } = guidePlan(custom, dwarf, data, spec);
		expect(plan[0]).toBe(MASK);
		expect(plan[1]).toBeUndefined();
		expect(skipped).toHaveLength(2);
		expect(skipped[0]).toContain('Skyfury Helm');
		expect(skipped[1]).toContain('Made-up Amulet is not in the item data');
	});

	it('gives a plan that scores above the equipped gear', () => {
		for (const g of data.guides) {
			const { plan } = guidePlan(g, dwarf, data, spec);
			const planned = scoreSet(plannedGear({ ...dwarf, plan }), dwarf, data, spec).score;
			expect(planned).toBeGreaterThan(scoreSet(dwarf.gear, dwarf, data, spec).score + 300);
		}
	});

	it('does not plan an item that is already equipped', () => {
		const wearing = { ...dwarf, gear: dwarf.gear.map((p, i) => (i === 3 ? { id: 272411 } : p)) }; // Arcanoweave Cloak
		expect(guidePlan(guide('wowhead'), wearing, data, spec).plan[3]).toBeUndefined();
	});
});

describe('swapDelta', () => {
	it('is the set score change of one swap', () => {
		const MASK = 13404;
		const delta = swapDelta(0, MASK, dwarf.gear, dwarf, data, spec);
		const swapped = dwarf.gear.map((p, i) => (i === 0 ? { id: MASK } : p));
		expect(delta).toBeCloseTo(scoreSet(swapped, dwarf, data, spec).score - scoreSet(dwarf.gear, dwarf, data, spec).score);
		expect(GEAR_SLOTS[0].kind).toBe('head');
	});
});

describe('guide lists for the other builds', () => {
	it('has a Wowhead list for each build Wowhead ranks, and every item is usable by that build', async () => {
		const { SPECS } = await import('./specs');
		const withList = ['enhancement-shaman', 'mage-fire', 'mage-frost', 'priest-shadow', 'warlock-affliction', 'warlock-destruction'];
		expect(specsWithGuide().sort()).toEqual(withList);
		for (const s of SPECS) {
			const specData = await loadGameData(s);
			const wowhead = specData.guides.find(g => g.id === 'wowhead');
			expect(Boolean(wowhead), s.id).toBe(withList.includes(s.id));
			if (!wowhead) continue;
			const missing = wowhead.entries.filter(e => specData.itemById.get(e.itemId)?.slot !== e.slot).map(e => e.name);
			expect(missing, s.id).toEqual([]);
			for (const slot of ['head', 'chest', 'weapon', 'finger', 'trinket']) expect(wowhead.entries.some(e => e.slot === slot && e.rank === 'BiS'), `${s.id} ${slot}`).toBe(true);
		}
	});
});
