import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SPECS } from '../specs';
import type { Character } from '../types';
import { buildSimRequest, indexSimDb, simKey, wowsimsSettings } from './request';
import { buffValue, clashingGroups, describeFlags, describeRotation, parseTalents, rotationSourceUrl, serializeTalents, type SimSetupData, talentPointsSpent } from './setup';

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

describe('buffs in the request', () => {
	const spec = SPECS.find(s => s.id === 'enhancement-shaman')!;
	const index = indexSimDb(read('db.json'), template(spec.id));
	const character: Character = { specId: spec.id, race: 'RaceDwarf', level: 60, talents: '', professions: [], gear: [] };

	it('lists every buff WoWSims knows, with its steps', () => {
		expect(setup.buffs!.raid.find(f => f.key === 'battleShout')!.steps).toHaveLength(3);
		expect(setup.buffs!.debuffs.find(f => f.key === 'curseOfElements')).toEqual({ key: 'curseOfElements', label: 'Curse of the Elements' });
		for (const s of SPECS) {
			const t = template(s.id);
			const used = { raid: t.raid.buffs, party: t.raid.parties[0].buffs, player: t.raid.parties[0].players[0].buffs, debuffs: t.raid.debuffs };
			for (const [scope, flags] of Object.entries(used)) for (const key of Object.keys(flags ?? {})) expect(setup.buffs![scope as 'raid'].some(f => f.key === key) || key.endsWith('SpellPower'), `${s.id} ${key}`).toBe(true);
		}
	});

	it('switches single buffs and debuffs and leaves the rest of the build alone', () => {
		const changed = { ...character, buffs: { raid: { battleShout: 0, windfuryTotem: true }, debuffs: { sunderArmor: false }, player: { greaterBlessingOfKings: false } } };
		const request = buildSimRequest(changed, changed.gear, index, 10).request as any;
		expect(request.raid.buffs).toMatchObject({ battleShout: 0, windfuryTotem: true, markOfTheWild: true });
		expect(request.raid.debuffs).toMatchObject({ sunderArmor: false, faerieFire: true });
		expect(request.raid.parties[0].players[0].buffs.greaterBlessingOfKings).toBe(false);
		expect(simKey(changed, changed.gear, 10)).not.toBe(simKey(character, character.gear, 10));
		expect(buffValue({ a: true, b: 2, c: 'TristateEffectImproved' }, 'c')).toBe(2);
		expect(clashingGroups([13452, 3390], setup.consumables)).toEqual([{ group: 'Agility', names: ['Elixir of the Mongoose', 'Elixir of Lesser Agility'] }]);
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

describe('settings for wowsims.com', () => {
	it('carries exactly what the sim request carries, in the form WoWSims imports', () => {
		const spec = SPECS.find(s => s.id === 'warlock-affliction')!;
		const tpl = template(spec.id);
		const index = indexSimDb(read('db.json'), tpl);
		const gear = player(spec.id).equipment.items.map((p: { id?: number; enchant?: number }) => (p.id ? { id: p.id, ...(p.enchant ? { enchant: p.enchant } : {}) } : null));
		const character: Character = { specId: spec.id, race: 'RaceHuman', level: 60, talents: '25500020135201351-0050203001-05', professions: ['Herbalism', 'Tailoring'], gear, consumables: { flaskId: 0 }, buffs: { debuffs: { curseOfElements: false } } };
		const settings = wowsimsSettings(character, gear, tpl) as any;
		const request = buildSimRequest(character, gear, index, 10).request as any;
		const sent = request.raid.parties[0].players[0];
		expect(Object.keys(settings)).toEqual(['apiVersion', 'raidBuffs', 'partyBuffs', 'debuffs', 'player', 'encounter']);
		expect(settings.player.database).toBeUndefined();
		for (const field of ['race', 'talentsString', 'profession1', 'profession2', 'consumables', 'buffs', 'rotation']) expect(settings.player[field], field).toEqual(sent[field]);
		expect(settings.player.equipment.items.map((p: { id?: number }) => p.id)).toEqual(sent.equipment.items.map((p: { id?: number }) => p.id));
		expect(settings.debuffs).toEqual(request.raid.debuffs);
		expect(settings.debuffs.curseOfElements).toBe(false);
		expect(settings.encounter).toEqual(request.encounter);
	});
});
