import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SPECS } from '../specs';
import type { Character } from '../types';
import { buildSimRequest, indexSimDb, simKey } from './request';
import { describeFlags, describeRotation, parseTalents, rotationSourceUrl, serializeTalents, type SimSetupData, talentPointsSpent } from './setup';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../public/sim/${name}`, import.meta.url), 'utf8'));
const setup: SimSetupData = read('setup.json');
const template = (specId: string) => read(`template.${specId}.json`);
const player = (specId: string) => template(specId).raid.parties[0].players[0];

describe('talents', () => {
	it('reads and writes the talent string of every build without changing it', () => {
		for (const spec of SPECS) {
			const trees = setup.trees[spec.className.toLowerCase()];
			expect(trees, spec.id).toHaveLength(3);
			const talents: string = player(spec.id).talentsString;
			const points = parseTalents(talents, trees);
			expect(serializeTalents(points), spec.id).toBe(talents);
			expect(talentPointsSpent(points), spec.id).toBeLessThanOrEqual(51);
			expect(talentPointsSpent(points), spec.id).toBeGreaterThan(40);
		}
	});

	it('caps a talent at its maximum and drops trailing zeros', () => {
		const trees = setup.trees.shaman;
		expect(parseTalents('9', trees)[0][0]).toBe(trees[0].talents[0].max);
		expect(serializeTalents([[5, 0, 0], [0, 0], [0]])).toBe('5');
		expect(serializeTalents([[0, 0], [0, 3, 0], [0]])).toBe('-03');
	});
});

describe('rotation in words', () => {
	it('names every spell and leaves no raw data in the text', () => {
		for (const spec of SPECS) {
			const text = describeRotation(player(spec.id).rotation, setup);
			expect(text.priority.length, spec.id).toBeGreaterThan(2);
			const all = JSON.stringify(text, (key, v) => (key === 'raw' ? undefined : v));
			expect(all, spec.id).not.toMatch(/\[object|undefined|Spell #|Item #|\{\}/);
		}
	});

	it('describes the enhancement rotation', () => {
		const text = describeRotation(player('enhancement-shaman').rotation, setup);
		expect(text.prepull[0]).toMatchObject({ text: 'Cast Water Shield', when: 'the pull timer is at -5.5s' });
		expect(text.priority[0]).toMatchObject({ text: 'Cast resource potion', when: 'current mana percent < 80%' });
		expect(text.priority[2]).toMatchObject({ text: 'Cast Water Shield', when: 'not aura is active: Water Shield' });
	});
});

describe('rotation source', () => {
	it('knows the WoWSims file of every build and keeps the original rule with each step', () => {
		for (const spec of SPECS) expect(rotationSourceUrl(spec.id), spec.id).toMatch(/^https:\/\/github\.com\/wowsims\/forever\/blob\/master\/ui\/specs\//);
		const text = describeRotation(player('enhancement-shaman').rotation, setup);
		expect(JSON.parse(text.priority[2].raw!)).toEqual(player('enhancement-shaman').rotation.priorityList[2].action);
	});
});

describe('buffs', () => {
	it('lists the buffs that are on', () => {
		expect(describeFlags({ battleShout: 2, markOfTheWild: true, bloodPact: 0, graceOfAirTotem: 1 })).toEqual(['Battle shout (improved)', 'Mark of the wild', 'Grace of air totem']);
	});
});

describe('consumables in the request', () => {
	const spec = SPECS.find(s => s.id === 'enhancement-shaman')!;
	const index = indexSimDb(read('db.json'), template(spec.id));
	const character: Character = { specId: spec.id, race: 'RaceDwarf', level: 60, talents: '', professions: [], gear: player(spec.id).equipment.items.map((p: { id?: number }) => (p.id ? { id: p.id } : null)) };

	it('keeps the build picks unless the character changes them', () => {
		const base = buildSimRequest(character, character.gear, index, 10).request as any;
		expect(base.raid.parties[0].players[0].consumables.flaskId).toBe(13512);
		const changed = { ...character, consumables: { flaskId: 0, elixirIds: [13452] } };
		const consumables = (buildSimRequest(changed, changed.gear, index, 10).request as any).raid.parties[0].players[0].consumables;
		expect(consumables.flaskId).toBe(0);
		expect(consumables.elixirIds).toEqual([13452]);
		expect(consumables.foodId).toBe(20452);
		expect(simKey(changed, changed.gear, 10)).not.toBe(simKey(character, character.gear, 10));
	});
});
