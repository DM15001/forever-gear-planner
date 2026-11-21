import { describe, expect, it } from 'vitest';

import specJson from '../specs/enhancement-shaman.json';
import simExport from './__fixtures__/sim-export.json';
import { GEAR_SLOTS } from './constants';
import { loadGameData } from './gameData';
import { importCharacter } from './importCharacter';
import { DEFAULT_FILTER, plannedGear, scoreSet, slotCandidates, suggestPlan } from './scoring';
import { vendorReputation } from './stats';
import type { Character, SpecConfig } from './types';

const spec = specJson as unknown as SpecConfig;
const data = await loadGameData();
const imported = importCharacter(JSON.stringify(simExport), spec).character;
const dwarf: Character = { ...imported, race: 'RaceDwarf', professions: ['Skinning', 'Leatherworking'], gear: imported.gear.map(p => (p ? { id: p.id } : null)) };
const options = { character: dwarf, data, spec, filter: DEFAULT_FILTER };
const HEAD = 0;
const MAIN_HAND = 14;

describe('scoreSet', () => {
	it('matches the hand-checked score of the test character', () => {
		// 1291 from the stat weights, checked by hand when the data script was written.
		expect(Math.round(scoreSet(dwarf.gear, dwarf, data, spec).score)).toBe(1291);
	});

	it('stops valuing hit rating at the cap', () => {
		// Two made-up items with 50 hit rating each. A Dwarf needs 7% from gear, so only 70 of the 100 count.
		const fake = (id: number, slot: 'neck' | 'back') => ({ id, name: `Fake ${id}`, slot, quality: 'rare', stats: { hitRating: 50 } });
		const fakeData = { ...data, itemById: new Map([[1, fake(1, 'neck')], [2, fake(2, 'back')]]) } as typeof data;
		const gearOf = (...ids: (number | null)[]) => GEAR_SLOTS.map((_, i) => (ids[i] ? { id: ids[i]! } : null));
		const weight = spec.weights.stats.hitRating;
		expect(scoreSet(gearOf(null, 1), dwarf, fakeData, spec).score).toBeCloseTo(50 * weight);
		const both = scoreSet(gearOf(null, 1, null, 2), dwarf, fakeData, spec);
		expect(both.score).toBeCloseTo(70 * weight);
		expect(both.hit.ratingOver).toBe(30);
		// An Orc has no racial hit and needs the full 8%.
		expect(scoreSet(gearOf(null, 1, null, 2), { ...dwarf, race: 'RaceOrc' }, fakeData, spec).score).toBeCloseTo(80 * weight);
	});
});

describe('slotCandidates', () => {
	const head = slotCandidates(HEAD, dwarf.gear, options);

	it('only offers items for that slot, best first, without the equipped one', () => {
		expect(head.length).toBeGreaterThan(50);
		expect(head.every(c => c.item.slot === 'head')).toBe(true);
		expect(head.some(c => c.item.id === dwarf.gear[HEAD]!.id)).toBe(false);
		expect(head[0].delta).toBeGreaterThanOrEqual(head[1].delta);
		expect(head[0].delta).toBeGreaterThan(0);
	});

	it('hides Horde-only items from an Alliance character and the reverse', () => {
		const horde = slotCandidates(HEAD, dwarf.gear, { ...options, character: { ...dwarf, race: 'RaceOrc' } });
		const skyfury = 20134; // Skyfury Helm, Horde quest reward
		expect(head.some(c => c.item.id === skyfury)).toBe(false);
		expect(horde.some(c => c.item.id === skyfury)).toBe(true);
	});

	it('leaves out PvP rewards unless asked for', () => {
		const withPvp = slotCandidates(MAIN_HAND, dwarf.gear, { ...options, filter: { ...DEFAULT_FILTER, pvp: true } });
		const without = slotCandidates(MAIN_HAND, dwarf.gear, options);
		expect(withPvp.length).toBeGreaterThan(without.length);
		expect(without.every(c => c.item.sources?.some(s => s.kind !== 'pvp') ?? true)).toBe(true);
	});

	it('offers only two-handers for the main hand and nothing for the off hand', () => {
		expect(slotCandidates(MAIN_HAND, dwarf.gear, options).every(c => c.item.weapon?.hand === 'twoHand')).toBe(true);
		expect(slotCandidates(15, dwarf.gear, options)).toEqual([]);
	});

	it('does not offer a unique ring that already sits in the other ring slot', () => {
		const uniqueRing = slotCandidates(10, dwarf.gear, options).find(c => c.item.unique)!.item;
		const wearingIt = dwarf.gear.map((p, i) => (i === 11 ? { id: uniqueRing.id } : p));
		expect(slotCandidates(10, wearingIt, options).some(c => c.item.id === uniqueRing.id)).toBe(false);
	});
});

describe('suggestPlan', () => {
	const plan = suggestPlan(options);
	const planned = plannedGear({ ...dwarf, plan });
	const totals = scoreSet(planned, dwarf, data, spec);

	it('improves the set and leaves no single swap that helps', () => {
		expect(totals.score).toBeGreaterThan(scoreSet(dwarf.gear, dwarf, data, spec).score + 500);
		for (let slot = 0; slot < GEAR_SLOTS.length; slot++) {
			const top = slotCandidates(slot, planned, options)[0];
			if (top) expect(top.delta).toBeLessThanOrEqual(0.01);
		}
	});

	it('does not stack hit far past the cap', () => {
		expect(totals.hit.ratingOver).toBeLessThan(10);
	});

	it('never plans the same unique item twice', () => {
		const ids = planned.filter(p => p && data.itemById.get(p.id)?.unique).map(p => p!.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe('Tier 0.5 filter', () => {
	const setId = spec.tier05Set!.setId;
	const without = { ...options, filter: { ...DEFAULT_FILTER, tier05: false } };

	it('offers the set by default and hides it when switched off', () => {
		const SHOULDER = 2;
		expect(slotCandidates(SHOULDER, dwarf.gear, options).some(c => c.item.setId === setId)).toBe(true);
		expect(slotCandidates(SHOULDER, dwarf.gear, without).some(c => c.item.setId === setId)).toBe(false);
	});

	it('plans a set without any Tier 0.5 piece when switched off', () => {
		const plan = suggestPlan(without);
		expect(Object.values(plan).some(id => data.itemById.get(id)?.setId === setId)).toBe(false);
		expect(Object.values(suggestPlan(options)).some(id => data.itemById.get(id)?.setId === setId)).toBe(true);
	});
});

describe('reputation filter', () => {
	const noRep = { ...options, filter: { ...DEFAULT_FILTER, rep: false } };
	const DON_JULIOS_BAND = 19325; // sold by the Alterac Valley quartermasters, listed as a plain vendor item

	it('treats battleground quartermasters as reputation', () => {
		expect(slotCandidates(10, dwarf.gear, options).some(c => c.item.id === DON_JULIOS_BAND)).toBe(true);
		expect(slotCandidates(10, dwarf.gear, noRep).some(c => c.item.id === DON_JULIOS_BAND)).toBe(false);
	});

	it('keeps plain vendors when reputation is off', () => {
		const ARCANOWEAVE_CLOAK = 272411; // Pix Xizzix, a currency vendor
		expect(slotCandidates(3, dwarf.gear, noRep).some(c => c.item.id === ARCANOWEAVE_CLOAK)).toBe(true);
	});

	it('plans a set without reputation rewards when switched off', () => {
		const plan = suggestPlan(noRep);
		for (const id of Object.values(plan)) {
			const sources = data.itemById.get(id)?.sources ?? [];
			if (sources.length) expect(sources.some(s => s.kind !== 'rep' && !vendorReputation(s))).toBe(true);
		}
	});
});

describe('own crafts only', () => {
	const own = { ...options, filter: { ...DEFAULT_FILTER, ownCraftsOnly: true } };
	const BELT_OF_THE_ARCHMAGE = 18405; // Tailoring
	const SPIRITCALLER_TREADS = 273935; // Leatherworking

	it('hides crafts of other professions but keeps the character\u2019s own', () => {
		expect(slotCandidates(7, dwarf.gear, options).some(c => c.item.id === BELT_OF_THE_ARCHMAGE)).toBe(true);
		expect(slotCandidates(7, dwarf.gear, own).some(c => c.item.id === BELT_OF_THE_ARCHMAGE)).toBe(false);
		expect(slotCandidates(9, dwarf.gear, own).some(c => c.item.id === SPIRITCALLER_TREADS)).toBe(true);
	});
});

describe('raid quest rewards', () => {
	it('are never offered, like raid drops', () => {
		const ONYXIA_TOOTH_PENDANT = 18404;
		expect(data.itemById.has(ONYXIA_TOOTH_PENDANT)).toBe(true);
		expect(slotCandidates(1, dwarf.gear, options).some(c => c.item.id === ONYXIA_TOOTH_PENDANT)).toBe(false);
		expect(Object.values(suggestPlan(options))).not.toContain(ONYXIA_TOOTH_PENDANT);
	});
});

describe('custom weights', () => {
	it('change the score', () => {
		const strengthOnly = { ...spec, weights: { ...spec.weights, mainHandDps: 0, stats: { strength: 1 } } };
		expect(scoreSet(dwarf.gear, dwarf, data, strengthOnly).score).toBe(scoreSet(dwarf.gear, dwarf, data, spec).stats.strength);
	});
});

describe('plannedGear', () => {
	it('keeps the enchant of the slot when an item is swapped in', () => {
		const withEnchant: Character = { ...dwarf, gear: dwarf.gear.map((p, i) => (i === HEAD && p ? { ...p, enchant: 2543 } : p)), plan: { [HEAD]: 13404 } };
		expect(plannedGear(withEnchant)[HEAD]).toEqual({ id: 13404, enchant: 2543 });
	});
});
