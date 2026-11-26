import { describe, expect, it } from 'vitest';

import specJson from '../specs/enhancement-shaman.json';
import simExport from './__fixtures__/sim-export.json';
import { contentCatalog, presets, sameFilter, toggled } from './content';
import { loadGameData } from './gameData';
import { importCharacter } from './importCharacter';
import { buildPlan, fallbacks, gotEnchant, gotItem, openSteps, planSteps } from './plan';
import { DEFAULT_FILTER, plannedGear, reputationOf, scoreSet, slotCandidates, type SourceFilter } from './scoring';
import type { Character, SpecConfig } from './types';

const spec = specJson as unknown as SpecConfig;
const data = await loadGameData();
const imported = importCharacter(JSON.stringify(simExport), spec).character;
const dwarf: Character = { ...imported, race: 'RaceDwarf', professions: ['Skinning', 'Leatherworking'], gear: imported.gear.map(p => (p ? { id: p.id } : null)) };
const options = { character: dwarf, data, spec, filter: DEFAULT_FILTER };
const catalog = contentCatalog(data, 'alliance');

describe('content catalog', () => {
	it('lists the level 60 dungeons by wing and lumps the rest together', () => {
		const names = catalog.dungeons.map(d => d.name);
		expect(names).toContain('Blackrock Spire: Lower');
		expect(names).toContain('Scholomance');
		expect(names).not.toContain('The Deadmines');
		expect(catalog.lowDungeonKeys.length).toBeGreaterThan(5);
	});

	it('lists only reputations of the character’s faction', () => {
		const names = catalog.reputations.map(r => r.name);
		expect(names).toContain('Stormpike Guard');
		expect(names).not.toContain('Frostwolf Clan');
		expect(catalog.reputations.find(r => r.name === 'Stormpike Guard')?.battleground).toBe(true);
	});

	it('recognises a preset whatever the order of its lists', () => {
		const noPvp = { ...presets(catalog).find(p => p.id === 'standard')!.filter, excludedReputations: ['Stormpike Guard', 'Argent Dawn'] };
		expect(sameFilter(noPvp, { ...noPvp, excludedReputations: [...noPvp.excludedReputations].reverse() })).toBe(true);
		expect(sameFilter(noPvp, DEFAULT_FILTER)).toBe(false);
		expect(toggled(['a', 'b'], ['b'], true)).toEqual(['a']);
		expect(toggled(['a'], ['b', 'c'], false)).toEqual(['a', 'b', 'c']);
	});
});

describe('content choices change what is offered', () => {
	const lower = catalog.dungeons.find(d => d.name === 'Blackrock Spire: Lower')!;
	const KAYSERS_BOOTS = 22231; // War Master Voone, Lower Blackrock Spire
	const DON_JULIOS_BAND = 19325; // Stormpike Guard quartermaster

	it('skips a dungeon wing that is switched off, and only that one', () => {
		const without = { ...options, filter: { ...DEFAULT_FILTER, excludedDungeons: [lower.key] } };
		expect(slotCandidates(9, dwarf.gear, options).some(c => c.item.id === KAYSERS_BOOTS)).toBe(true);
		expect(slotCandidates(9, dwarf.gear, without).some(c => c.item.id === KAYSERS_BOOTS)).toBe(false);
		const upperItem = slotCandidates(8, dwarf.gear, without).find(c => c.item.sources?.some(s => s.dungeonName === 'Blackrock Spire: Upper'));
		expect(upperItem).toBeDefined();
	});

	it('skips a single reputation', () => {
		const without = { ...options, filter: { ...DEFAULT_FILTER, excludedReputations: ['Stormpike Guard'] } };
		expect(slotCandidates(10, dwarf.gear, without).some(c => c.item.id === DON_JULIOS_BAND)).toBe(false);
		const otherRep = slotCandidates(10, dwarf.gear, without).some(c => c.item.sources?.some(s => reputationOf(s) && reputationOf(s) !== 'Stormpike Guard'));
		expect(otherRep).toBe(true);
	});

	it('the dungeons-only preset plans nothing but dungeon drops and quest rewards', () => {
		const filter = presets(catalog).find(p => p.id === 'dungeons')!.filter;
		const { plan } = buildPlan({ ...options, filter });
		expect(Object.keys(plan!).length).toBeGreaterThan(8);
		for (const id of Object.values(plan!)) {
			const sources = data.itemById.get(id)!.sources ?? [];
			expect(sources.some(s => s.dungeonKey || s.kind === 'quest')).toBe(true);
		}
	});
});

describe('buildPlan and planSteps', () => {
	const built = buildPlan(options);
	const planned: Character = { ...dwarf, ...built };
	const steps = planSteps({ ...options, character: planned });

	it('plans items and enchants that raise the score', () => {
		expect(Object.keys(built.plan!).length).toBeGreaterThan(10);
		expect(Object.keys(built.planEnchants!).length).toBeGreaterThan(5);
		const withItems = scoreSet(plannedGear({ ...dwarf, plan: built.plan }), dwarf, data, spec).score;
		expect(scoreSet(plannedGear(planned), dwarf, data, spec).score).toBeGreaterThan(withItems + 50);
	});

	it('groups every planned change into exactly one step, enchants last', () => {
		const itemSteps = steps.filter(s => s.kind !== 'enchant');
		expect(itemSteps.flatMap(s => s.items).length).toBe(Object.keys(built.plan!).length);
		expect(steps[steps.length - 1].kind).toBe('enchant');
		expect(steps[steps.length - 1].items.length).toBe(Object.keys(built.planEnchants!).length);
		for (let i = 1; i < itemSteps.length; i++) expect(itemSteps[i - 1].gain).toBeGreaterThanOrEqual(itemSteps[i].gain);
		expect(openSteps(planned, data)).toBe(steps.flatMap(s => s.items).length);
	});

	it('marks an enchant as not ready until its item is equipped', () => {
		const enchantStep = steps.find(s => s.kind === 'enchant')!;
		const pending = enchantStep.items.find(e => built.plan![e.slotIndex] !== undefined)!;
		expect(pending.ready).toBe(false);
		const afterItem = gotItem(planned, pending.slotIndex);
		const again = planSteps({ ...options, character: afterItem }).find(s => s.kind === 'enchant')!.items.find(e => e.slotIndex === pending.slotIndex)!;
		expect(again.ready).toBe(true);
	});

	it('offers fallbacks that are neither the goal nor the equipped item', () => {
		const slot = Number(Object.keys(built.plan!)[0]);
		const others = fallbacks(slot, { ...options, character: planned });
		expect(others).toHaveLength(2);
		for (const c of others) {
			expect(c.item.id).not.toBe(built.plan![slot]);
			expect(c.item.id).not.toBe(dwarf.gear[slot]?.id);
		}
	});
});

describe('ticking things off', () => {
	const planned: Character = { ...dwarf, ...buildPlan(options) };
	const slot = Number(Object.keys(planned.plan!)[0]);

	it('equips the item and removes it from the plan', () => {
		const after = gotItem(planned, slot);
		expect(after.gear[slot]).toEqual({ id: planned.plan![slot] });
		expect(after.plan![slot]).toBeUndefined();
		expect(openSteps(after, data)).toBe(openSteps(planned, data) - 1);
	});

	it('keeps the old piece’s enchant as a to-do when the plan names none', () => {
		const enchanted: Character = { ...planned, gear: planned.gear.map((p, i) => (i === slot && p ? { ...p, enchant: 7667 } : p)), planEnchants: {} };
		expect(gotItem(enchanted, slot).planEnchants![slot]).toBe(7667);
	});

	it('applies an enchant once the item is there', () => {
		const withItem = gotItem(planned, slot);
		const enchantSlot = Number(Object.keys(withItem.planEnchants!).find(s => withItem.gear[Number(s)])!);
		const after = gotEnchant(withItem, enchantSlot);
		expect(after.gear[enchantSlot]!.enchant).toBe(withItem.planEnchants![enchantSlot]);
		expect(after.planEnchants![enchantSlot]).toBeUndefined();
	});
});

describe('buildPlan and item sets', () => {
	it('never plans worse with more content to pick from', () => {
		const scoreWith = (filter: SourceFilter) => {
			const planned = { ...dwarf, ...buildPlan({ character: dwarf, data, spec, filter }) };
			return scoreSet(plannedGear(planned), planned, data, spec).score;
		};
		// Without battleground reputations the planner used to find a Tier 0.5 set that the full
		// content choice missed, because set bonuses need several pieces at once.
		const withoutBattlegrounds = scoreWith({ ...DEFAULT_FILTER, excludedReputations: ['Silverwing Sentinels', 'Stormpike Guard', 'The League of Arathor'] });
		expect(scoreWith(DEFAULT_FILTER)).toBeGreaterThanOrEqual(withoutBattlegrounds * 0.995);
	}, 60000);

	it('plans less hit when the hit target is lowered', () => {
		const hitOf = (character: Character) => scoreSet(plannedGear({ ...character, ...buildPlan({ ...options, character }) }, data), character, data, spec).hit.fromGear;
		const toCap = hitOf(dwarf);
		const none = hitOf({ ...dwarf, hitTarget: 0 });
		expect(none).toBeLessThanOrEqual(toCap);
		expect(none).toBeLessThan(Math.max(toCap, 0.01));
	});

	it('keeps a locked slot and builds the rest around it', () => {
		const free = buildPlan(options);
		const freePlan = free.plan ?? {};
		const neck = 1;
		// Any neck item the free plan did not choose.
		const other = [...data.itemById.values()].find(item => item.slot === 'neck' && item.id !== freePlan[neck] && item.id !== dwarf.gear[neck]?.id)!;
		const pinned: Character = { ...dwarf, ...free, plan: { ...freePlan, [neck]: other.id }, planLocks: [neck] };
		expect(buildPlan({ ...options, character: pinned }).plan?.[neck]).toBe(other.id);
		// Without the lock the rebuild goes back to the free choice.
		expect(buildPlan({ ...options, character: { ...pinned, planLocks: undefined } }).plan?.[neck]).toBe(freePlan[neck]);
	});
});
