import { describe, expect, it } from 'vitest';

import specJson from '../specs/enhancement-shaman.json';
import simExport from './__fixtures__/sim-export.json';
import { GEAR_SLOTS } from './constants';
import { loadGameData } from './gameData';
import { importCharacter } from './importCharacter';
import { clash, DEFAULT_FILTER, notYetAvailable, type Gear, oneRandomRoll, plannedGear, scoreSet, setChanges, setStandings, slotCandidates, type SourceFilter, suggestPlan, usableSources } from './scoring';
import { vendorReputation } from './stats';
import type { Character, Item, SpecConfig } from './types';

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

	const withPvp = { ...options, filter: { ...DEFAULT_FILTER, pvp: true } };
	const has = (list: { item: { id: number } }[], id: number) => list.some(c => c.item.id === id);

	it('treats battleground quartermasters as reputation, and as PvP', () => {
		expect(has(slotCandidates(10, dwarf.gear, withPvp), DON_JULIOS_BAND)).toBe(true);
		expect(has(slotCandidates(10, dwarf.gear, { ...withPvp, filter: { ...withPvp.filter, rep: false } }), DON_JULIOS_BAND)).toBe(false);
		expect(has(slotCandidates(10, dwarf.gear, { ...withPvp, filter: { ...withPvp.filter, excludedReputations: ['Stormpike Guard'] } }), DON_JULIOS_BAND)).toBe(false);
		// Without the PvP switch nothing from a battleground is offered.
		expect(has(slotCandidates(10, dwarf.gear, options), DON_JULIOS_BAND)).toBe(false);
	});

	it('counts quests done inside a battleground as PvP of that battleground', () => {
		// Alterac Valley quest rewards, listed as plain quests: Ice Barbed Spear, Cold Forged Hammer.
		const spear = [19106, 20648].map(id => data.itemById.get(id)).find(Boolean)!;
		expect(usableSources(spear, 'alliance', DEFAULT_FILTER)).toHaveLength(0);
		expect(usableSources(spear, 'alliance', withPvp.filter).length).toBeGreaterThan(0);
		expect(usableSources(spear, 'alliance', { ...withPvp.filter, excludedReputations: ['Stormpike Guard'] })).toHaveLength(0);
	});

	it('says when a swap breaks or activates a set bonus', () => {
		const setItems = [...data.itemById.values()].filter(i => i.setId !== undefined && data.simValues.sets.has(i.setId!));
		const setId = setItems[0].setId!;
		const steps = [...data.simValues.sets.get(setId)!.keys()].sort((a, b) => a - b);
		const pieces = setItems.filter(i => i.setId === setId);
		const bySlot = new Map<number, number>();
		for (const item of pieces) {
			const slot = GEAR_SLOTS.findIndex((s, i) => s.kind === item.slot && !bySlot.has(i));
			if (slot >= 0 && bySlot.size < steps[0]) bySlot.set(slot, item.id);
		}
		expect(bySlot.size).toBe(steps[0]);
		const full: Gear = GEAR_SLOTS.map((_, i) => (bySlot.has(i) ? { id: bySlot.get(i)! } : null));
		const oneOut = full.map((piece, i) => (i === [...bySlot.keys()][0] ? null : piece));
		expect(setStandings(full, data).get(setId)?.reached).toBe(steps[0]);
		expect(setChanges(full, oneOut, data)).toMatchObject([{ kind: 'breaks', step: steps[0] }]);
		expect(setChanges(oneOut, full, data)).toMatchObject([{ kind: 'activates', step: steps[0] }]);
		expect(setChanges(full, full, data)).toEqual([]);
	});

	it('keeps one row for random-suffix items and holds the others of level 50 to 60 for it', () => {
		const row = (id: number, delta: number, random: boolean, reqLvl = 55) => ({ item: { id, reqLvl, ...(random ? { randomSuffixOptions: [1] } : {}) } as unknown as Item, delta, incomplete: false });
		const { list, others } = oneRandomRoll([row(1, 9.04, true), row(2, 9.01, true), row(3, 8, false), row(4, 7.5, true), row(7, 7.2, true, 44), row(5, 7, false), row(6, 1, true)], 6);
		expect(list.map(c => c.item.id)).toEqual([1, 3, 5, 6]);
		expect(others.get(1)?.map(c => c.item.id)).toEqual([2, 4]);
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
		// The Spiritcaller set is not in the game yet, so it only shows with that switch on.
		expect(slotCandidates(9, dwarf.gear, { ...own, filter: { ...own.filter, notYetAvailable: true } }).some(c => c.item.id === SPIRITCALLER_TREADS)).toBe(true);
		expect(slotCandidates(9, dwarf.gear, own).some(c => c.item.id === SPIRITCALLER_TREADS)).toBe(false);
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

describe('measured effects in the score', () => {
	const BLACKHANDS_BREADTH = 13965;
	const worth = data.simValues.items.get(BLACKHANDS_BREADTH)!;

	it('adds the worth of an item\u2019s effect', () => {
		expect(worth).toBeGreaterThan(8);
		const withTrinket = dwarf.gear.map((p, i) => (i === 13 ? { id: BLACKHANDS_BREADTH } : p));
		const without = dwarf.gear.map((p, i) => (i === 13 ? null : p));
		const totals = scoreSet(withTrinket, dwarf, data, spec);
		expect(totals.effectScore).toBeCloseTo(worth);
		expect(totals.score - scoreSet(without, dwarf, data, spec).score).toBeCloseTo(worth);
	});

	it('adds a set bonus once enough pieces are worn', () => {
		const setId = spec.tier05Set!.setId;
		const bonus = data.simValues.sets.get(setId)!;
		const smallest = Math.min(...bonus.keys());
		const pieces = [...data.itemById.values()].filter(i => i.setId === setId);
		const bySlot = new Map(pieces.map(i => [i.slot, i]));
		const slotIndex: Record<string, number> = { head: 0, shoulder: 2, chest: 4, wrist: 5, hands: 6, waist: 7, legs: 8, feet: 9 };
		const wear = (count: number) => {
			const chosen = [...bySlot].slice(0, count);
			return dwarf.gear.map((p, i) => chosen.find(([slot]) => slotIndex[slot] === i)?.[1] ?? p).map(x => (x ? { id: x.id } : null));
		};
		expect(scoreSet(wear(smallest - 1), dwarf, data, spec).effectScore).toBe(0);
		expect(scoreSet(wear(smallest), dwarf, data, spec).effectScore).toBeCloseTo(bonus.get(smallest)!);
	});

	it('no longer flags a measured item as incomplete', () => {
		const trinkets = slotCandidates(12, dwarf.gear, options);
		expect(trinkets.find(c => c.item.id === BLACKHANDS_BREADTH)?.incomplete).toBe(false);
	});
});

describe('plannedGear', () => {
	it('keeps the enchant of the slot when an item is swapped in', () => {
		const withEnchant: Character = { ...dwarf, gear: dwarf.gear.map((p, i) => (i === HEAD && p ? { ...p, enchant: 2543 } : p)), plan: { [HEAD]: 13404 } };
		expect(plannedGear(withEnchant)[HEAD]).toEqual({ id: 13404, enchant: 2543 });
	});
});

describe('random suffix items', () => {
	it('stay out unless switched on, and count with the suffix that suits the spec best', async () => {
		const { SPECS } = await import('./specs');
		const warlock = SPECS.find(s => s.id === 'warlock-affliction')!;
		const lockData = await loadGameData(warlock);
		const TEARFALL_BRACERS = 13409;
		const bracers = lockData.itemById.get(TEARFALL_BRACERS)!;
		expect(bracers.bestSuffixName).toBe('of Shadow Wrath');
		const lock: Character = { specId: warlock.id, race: 'RaceHuman', level: 60, talents: '', professions: [], gear: GEAR_SLOTS.map(() => null) };
		const wrist = GEAR_SLOTS.findIndex(s => s.kind === 'wrist');
		const ids = (filter: SourceFilter) => slotCandidates(wrist, lock.gear, { character: lock, data: lockData, spec: warlock, filter }).map(c => c.item.id);
		expect(ids({ ...DEFAULT_FILTER, randomSuffix: false })).not.toContain(TEARFALL_BRACERS);
		expect(ids({ ...DEFAULT_FILTER, randomSuffix: true })).toContain(TEARFALL_BRACERS);
		const planned = plannedGear({ ...lock, plan: { [wrist]: TEARFALL_BRACERS } }, lockData);
		expect(planned[wrist]).toEqual({ id: TEARFALL_BRACERS, randomSuffix: bracers.bestSuffix });
		expect(scoreSet(planned, lock, lockData, warlock).stats.shadowDamage).toBeGreaterThan(10);
	});
});

describe('items that are not in the game yet', () => {
	it('stay out of every list until switched on', async () => {
		const { SPECS } = await import('./specs');
		const mage = SPECS.find(s => s.id === 'mage-fire')!;
		const mageData = await loadGameData(mage);
		const ELEMENTAL_FOCUS_BAND = 20682;
		expect(notYetAvailable(mageData.itemById.get(ELEMENTAL_FOCUS_BAND)!)).toMatch(/Skaldrenox/);
		const char: Character = { specId: mage.id, race: 'RaceHuman', level: 60, talents: '', professions: [], gear: GEAR_SLOTS.map(() => null) };
		const ring = GEAR_SLOTS.findIndex(s => s.kind === 'finger');
		const ids = (filter: SourceFilter) => slotCandidates(ring, char.gear, { character: char, data: mageData, spec: mage, filter }).map(c => c.item.id);
		expect(ids(DEFAULT_FILTER)).not.toContain(ELEMENTAL_FOCUS_BAND);
		expect(ids({ ...DEFAULT_FILTER, notYetAvailable: true })).toContain(ELEMENTAL_FOCUS_BAND);
	});

	it('leaves out the crafted class sets and items with raid artwork, by what the data says about them', () => {
		const closed = [...data.itemById.values()].filter(item => notYetAvailable(item));
		const names = closed.map(item => item.name);
		expect(names).toContain('Spiritcaller Leggings');
		expect(names).toContain('Spiritcaller Mantle');
		expect(names).toContain("Forest Defender's Axe");
		expect(names).not.toContain('The Unstoppable Force');
		expect(closed.filter(item => item.tag === 'Crafted').every(item => item.setId !== undefined && item.quality === 'epic')).toBe(true);
		const plan = suggestPlan({ character: dwarf, data, spec, filter: DEFAULT_FILTER });
		for (const id of Object.values(plan)) expect(notYetAvailable(data.itemById.get(id)!) ?? '', data.itemById.get(id)?.name).toBe('');
	});
});

describe('items that exclude each other', () => {
	it('treats two rings of one limit category as a clash', () => {
		const ring = (id: number, limitCategory?: number, unique?: boolean) => ({ id, limitCategory, unique }) as Item;
		expect(clash(ring(1, 710), ring(2, 710))).toBe(true);
		expect(clash(ring(1, 710), ring(1, 710))).toBe(true);
		expect(clash(ring(1, 710), ring(2, 475))).toBe(false);
		expect(clash(ring(1), ring(1))).toBe(false);
		expect(clash(ring(1, undefined, true), ring(1, undefined, true))).toBe(true);
	});
});
