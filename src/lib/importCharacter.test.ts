import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import specJson from '../specs/enhancement-shaman.json';
import addonExport from './__fixtures__/addon-export.json';
import simExport from './__fixtures__/sim-export.json';
import simSettingsExport from './__fixtures__/sim-settings-export.json';
import { GEAR_SLOTS } from './constants';
import { importCharacter, ImportError } from './importCharacter';
import type { SpecConfig } from './types';

const spec = specJson as unknown as SpecConfig;

describe('importCharacter', () => {
	it('reads the sim export', () => {
		const { character, format, warnings } = importCharacter(JSON.stringify(simExport), spec);
		expect(format).toBe('sim');
		expect(character.race).toBe('RaceOrc');
		expect(character.professions).toEqual(['Engineering', 'Leatherworking']);
		expect(character.talents).toBe('053303102-053030310051012251-02');
		expect(character.gear).toHaveLength(GEAR_SLOTS.length);
		expect(character.gear[0]).toEqual({ id: 17740, enchant: 2543 });
		expect(character.gear[14]).toEqual({ id: 14531, enchant: 1900 });
		expect(character.gear[15]).toBeNull(); // off hand is {} with a two-hander
		expect(character.gear[16]).toEqual({ id: 249443 });
		expect(character.name).toBeUndefined(); // "Player" is the sim's placeholder
		expect(warnings.some(w => w.includes('sim export'))).toBe(true);
	});

	it('keeps the settings of a sim export, so the sim runs what wowsims.com runs', () => {
		const text = JSON.stringify({
			raidBuffs: { battleShout: 1 },
			debuffs: { sunderArmor: true },
			encounter: { duration: 90 },
			player: { ...(simSettingsExport as { player: object }).player, consumables: { foodId: 250072, mhImbueId: 12404 }, rotation: { type: 'TypeAPL' } },
		});
		const { character } = importCharacter(text);
		expect(character.simSettings?.specId).toBe(character.specId);
		expect(character.simSettings?.player.consumables).toEqual({ foodId: 250072, mhImbueId: 12404 });
		expect(character.simSettings?.raidBuffs).toEqual({ battleShout: 1 });
		expect(character.simSettings?.encounter).toEqual({ duration: 90 });
		// Gear, race, talents and professions stay the character's own fields.
		expect(character.simSettings?.player).not.toHaveProperty('equipment');
		expect(character.simSettings?.player).not.toHaveProperty('talentsString');
		// A different export is a different run.
		const other = importCharacter(text.replace('12404', '12643')).character;
		expect(other.simSettings?.id).not.toBe(character.simSettings?.id);
	});

	it('reads the sim settings export (top-level player)', () => {
		const { character, format, warnings } = importCharacter(JSON.stringify(simSettingsExport), spec);
		expect(format).toBe('sim');
		expect(character.race).toBe('RaceOrc');
		expect(character.professions).toEqual(['Engineering', 'Leatherworking']);
		expect(character.talents).toBe('053303102-053030310051012251-02');
		expect(character.gear[0]).toEqual({ id: 17740, enchant: 2543 });
		expect(character.gear[15]).toBeNull();
		expect(character.gear[16]).toEqual({ id: 249443 });
		expect(warnings.some(w => w.includes('sim export'))).toBe(true);
	});

	it('reads a bare sim player', () => {
		const { character, format } = importCharacter(JSON.stringify(simSettingsExport.player), spec);
		expect(format).toBe('sim');
		expect(character.gear[14]).toEqual({ id: 14531, enchant: 1900 });
	});

	it('reads the addon export and pads missing slots', () => {
		const { character, format, warnings } = importCharacter(JSON.stringify(addonExport), spec);
		expect(format).toBe('addon');
		expect(character.name).toBe('Testchar');
		expect(character.race).toBe('RaceDwarf');
		expect(character.level).toBe(60);
		expect(character.professions).toEqual(['Skinning', 'Leatherworking']);
		expect(character.gear).toHaveLength(GEAR_SLOTS.length);
		expect(character.gear[2]).toBeNull();
		expect(character.gear[3]).toEqual({ id: 11626, enchant: 7667 });
		expect(character.gear[16]).toBeNull();
		expect(warnings).toEqual([]);
	});

	it('rejects text that is not JSON', () => {
		expect(() => importCharacter('hello', spec)).toThrow(ImportError);
	});

	it('rejects JSON without a character', () => {
		expect(() => importCharacter('{"foo": 1}', spec)).toThrow(/no character/);
		expect(() => importCharacter('[1, 2]', spec)).toThrow(/not a character export/);
	});

	it('rejects another class', () => {
		expect(() => importCharacter(JSON.stringify({ ...addonExport, class: 'warrior' }), spec)).toThrow(/warrior/);
	});

	it('rejects an export from another game version', () => {
		expect(() => importCharacter(JSON.stringify({ ...addonExport, flavor: 'sod' }), spec)).toThrow(/not from WoW: Forever/);
	});

	it('asks for the race when the export has one the class cannot be', () => {
		const { character, warnings } = importCharacter(JSON.stringify({ ...addonExport, race: 'Gnome' }), spec);
		expect(character.race).toBeNull();
		expect(warnings.some(w => w.includes('Gnome'))).toBe(true);
	});

	it('warns below level 60', () => {
		const { warnings } = importCharacter(JSON.stringify({ ...addonExport, level: 52 }), spec);
		expect(warnings.some(w => w.includes('level 52'))).toBe(true);
	});
});

describe('the build follows the talent tree of an addon export', () => {
	const warlock = (spec: string, talents = '') => JSON.stringify({ class: 'warlock', flavor: 'forever', gear: { items: [{ id: 9470 }] }, level: 60, race: 'Human', spec, talents });
	it('picks the affliction, destruction or demonology build', () => {
		expect(importCharacter(warlock('affliction')).character.specId).toBe('warlock-affliction');
		expect(importCharacter(warlock('destruction')).character.specId).toBe('warlock-destruction');
		expect(importCharacter(warlock('demonology')).character.specId).toBe('warlock-demo-fire');
		expect(importCharacter(warlock('')).character.specId).toBe('warlock-sm-ruin');
		// With talents in the export, they decide, whatever the tree is called.
		expect(importCharacter(warlock('destruction', '25500020135201351-0050203001-05')).character.specId).toBe('warlock-affliction');
	});
});

describe('shaman exports', () => {
	const shaman = (spec: string) => JSON.stringify({ class: 'shaman', flavor: 'forever', gear: { items: [{ id: 9470 }] }, level: 60, race: 'Orc', spec, talents: spec === 'elemental' ? '5500331023001351-05500001-053' : spec === 'enhancement' ? '053303102-053030310051012251-02' : '' });
	it('lands on Elemental or Enhancement by talent tree, Enhancement when the tree is not named', () => {
		expect(importCharacter(shaman('elemental')).character.specId).toBe('elemental-shaman');
		expect(importCharacter(shaman('enhancement')).character.specId).toBe('enhancement-shaman');
		expect(importCharacter(shaman('')).character.specId).toBe('enhancement-shaman');
	});
});

describe('a sim export lands on the build with its talents', () => {
	it.each(['warrior-arms', 'warrior-fury', 'druid-cat', 'druid-balance', 'rogue-asn-muti', 'rogue-sub-hemo', 'mage-frost', 'warlock-destruction'])('%s', id => {
		const text = readFileSync(new URL(`../../scripts/builds/${id}.build.json`, import.meta.url), 'utf8');
		expect(importCharacter(text).character.specId).toBe(id);
	});
});
