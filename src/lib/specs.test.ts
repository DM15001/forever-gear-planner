import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { loadGameData } from './gameData';
import { importCharacter, ImportError } from './importCharacter';
import { buildPlan } from './plan';
import { DEFAULT_FILTER, EMPTY_SLOT, plannedGear, scoreSet, withItem } from './scoring';
import { SPECS, specById, specOf, specsOfClass, usableBy } from './specs';
import { hitSummary } from './stats';

const build = (id: string) => readFileSync(`scripts/builds/${id}.build.json`, 'utf8');
const MAIN_HAND = 14;
const OFF_HAND = 15;

describe('spec registry', () => {
	it('knows every spec file and falls back to the Enhancement Shaman', () => {
		expect(SPECS.map(spec => spec.id)).toContain('warlock-sm-ruin');
		expect(specById('nope').id).toBe('enhancement-shaman');
		expect(specOf(null).id).toBe('enhancement-shaman');
		expect(specsOfClass('warlock')).toHaveLength(5);
		expect(specsOfClass('mage').map(spec => spec.id)).toEqual(['mage-fire', 'mage-frost', 'mage-frost-incin', 'mage-arcane', 'mage-arcane-fire', 'mage-ffb']);
	});

	it('has measured weights and a sim template for every spec', () => {
		for (const spec of SPECS) {
			expect(Object.keys(spec.weights.stats).length, spec.id).toBeGreaterThan(3);
			expect(spec.weights.source, spec.id).not.toBe('pending');
			expect(() => readFileSync(`public/sim/template.${spec.id}.json`), spec.id).not.toThrow();
		}
	});
});

describe('importing other classes', () => {
	it('plans a warlock export as a warlock', () => {
		const result = importCharacter(build('warlock-sm-ruin'));
		expect(result.character.specId).toBe('warlock-sm-ruin');
		expect(result.character.race).toBe('RaceOrc');
		expect(result.warnings.join(' ')).toContain('Pick another build');
	});

	it('plans priest and mage exports as their class', () => {
		expect(importCharacter(build('priest-shadow')).character.specId).toBe('priest-shadow');
		expect(importCharacter(build('mage-frost')).character.specId).toBe('mage-frost'); // the build whose talents match
	});

	it('refuses a spec of a known class that is not covered', () => {
		const healer = JSON.parse(build('priest-shadow'));
		healer.player.healingPriest = healer.player.dpsPriest;
		delete healer.player.dpsPriest;
		expect(() => importCharacter(JSON.stringify(healer))).toThrow(ImportError);
	});

	it('covers every class of the game', () => {
		expect(new Set(SPECS.map(spec => spec.className))).toEqual(new Set(['druid', 'hunter', 'mage', 'paladin', 'priest', 'rogue', 'shaman', 'warlock', 'warrior']));
		// A Hunter's preset comes in as the Hunter build with those talents, a Paladin's as Retribution.
		expect(importCharacter(build('hunter-bm')).character.specId).toBe('hunter-bm');
		expect(importCharacter(build('paladin-ret-holy-shock')).character.specId).toBe('paladin-ret-holy-shock');
	});
});

describe('set bonuses per build', async () => {
	it('knows what the Sorcerer set is worth to a Fire Mage, so a plan does not break it for a few stats', async () => {
		const data = await loadGameData(specById('mage-fire'));
		const sorcerer = data.simValues.sets.get(1671);
		expect(sorcerer?.get(6)).toBeGreaterThan(5);
		expect(sorcerer?.get(5)).toBeUndefined();
		expect(data.simValues.measuredSets.has(1671)).toBe(true);
	});
});

describe('a caster in the planner', async () => {
	const spec = specById('warlock-sm-ruin');
	const data = await loadGameData(spec);
	const character = { ...importCharacter(build('warlock-sm-ruin')).character, gear: importCharacter(build('warlock-sm-ruin')).character.gear.map(p => (p ? { id: p.id } : null)) };

	it('sees only what a warlock can use', () => {
		const items = [...data.itemById.values()];
		expect(items.every(item => usableBy(item, spec))).toBe(true);
		expect(items.some(item => item.rangedType === 'wand')).toBe(true);
		expect(items.some(item => item.rangedType === 'totem')).toBe(false);
		expect(items.some(item => item.armorType === 'mail')).toBe(false);
		expect(items.filter(item => item.slot === 'weapon').every(item => ['dagger', 'sword', 'staff', 'offHand'].includes(item.weapon?.type ?? ''))).toBe(true);
	});

	it('counts the hit its talents give', () => {
		const priest = specById('priest-shadow');
		expect(priest.hitBonusPercent).toBeGreaterThan(0);
		expect(hitSummary({ hitRating: 50 }, character, priest).total).toBeCloseTo(5 + (priest.hitBonusPercent ?? 0));
	});

	it('never plans a two-hander together with an off-hand item', () => {
		const planned = { ...character, ...buildPlan({ character, data, spec, filter: DEFAULT_FILTER }) };
		const gear = plannedGear(planned);
		const mainHand = gear[MAIN_HAND] ? data.itemById.get(gear[MAIN_HAND]!.id) : undefined;
		if (mainHand?.weapon?.hand === 'twoHand') expect(gear[OFF_HAND]).toBeNull();
		expect(scoreSet(gear, planned, data, spec).score).toBeGreaterThanOrEqual(scoreSet(character.gear, character, data, spec).score);
	});

	it('pushes the off hand out when a staff goes in, and the staff out when an off hand goes in', () => {
		const staff = [...data.itemById.values()].find(item => item.weapon?.hand === 'twoHand')!;
		const orb = [...data.itemById.values()].find(item => item.weapon?.hand === 'offHand')!;
		const dagger = [...data.itemById.values()].find(item => item.weapon?.hand === 'mainHand' || item.weapon?.hand === 'oneHand')!;
		const base = character.gear.map((piece, index) => (index === MAIN_HAND ? { id: dagger.id } : index === OFF_HAND ? { id: orb.id } : piece));
		const withStaff = withItem(base, MAIN_HAND, staff.id, data);
		expect(withStaff[OFF_HAND]).toBeNull();
		const back = withItem(withStaff, OFF_HAND, orb.id, data);
		expect(back[MAIN_HAND]).toBeNull();
		expect(back[OFF_HAND]).toEqual({ id: orb.id });
	});

	it('reads an emptied slot from the plan', () => {
		const gear = plannedGear({ ...character, plan: { [OFF_HAND]: EMPTY_SLOT } });
		expect(gear[OFF_HAND]).toBeNull();
	});
});
