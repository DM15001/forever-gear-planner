import { describe, expect, it } from 'vitest';

import specJson from '../specs/enhancement-shaman.json';
import simExport from './__fixtures__/sim-export.json';
import { applicableEnchants, bestEnchants, enchantOverview, professionValues } from './enchants';
import { loadGameData } from './gameData';
import { importCharacter } from './importCharacter';
import { DEFAULT_FILTER, scoreSet } from './scoring';
import type { Character, SpecConfig } from './types';

const spec = specJson as unknown as SpecConfig;
const data = await loadGameData();
const imported = importCharacter(JSON.stringify(simExport), spec).character;
const dwarf: Character = { ...imported, race: 'RaceDwarf', professions: ['Skinning', 'Leatherworking'], gear: imported.gear.map(p => (p ? { id: p.id } : null)) };
const itemIn = (slot: number) => data.itemById.get(dwarf.gear[slot]!.id);

describe('applicableEnchants', () => {
	it('offers two-hand enchants on a two-hander but no shield or off-hand ones', () => {
		const names = applicableEnchants(14, itemIn(14), data).map(e => e.name);
		expect(names.some(n => n.includes('2H Weapon'))).toBe(true);
		expect(names.some(n => n.includes('Shield') || n.includes('Off-Hand'))).toBe(false);
	});

	it('offers nothing for a totem, a ring or an empty slot', () => {
		expect(applicableEnchants(16, itemIn(16), data)).toEqual([]);
		expect(applicableEnchants(10, itemIn(10), data)).toEqual([]);
		expect(applicableEnchants(15, undefined, data)).toEqual([]);
	});
});

describe('enchantOverview', () => {
	const overview = enchantOverview(dwarf.gear, dwarf, data, spec);

	it('ranks stat enchants and measured procs together, best first', () => {
		const weapon = overview.find(s => s.slotIndex === 14)!;
		expect(weapon.options.length).toBeGreaterThan(0);
		for (let i = 1; i < weapon.options.length; i++) expect(weapon.options[i - 1].delta).toBeGreaterThanOrEqual(weapon.options[i].delta);
		// Crusader has no stats; its worth comes from the simulator measurement.
		const crusader = weapon.options.find(o => o.enchant.name.includes('Crusader'))!;
		expect(crusader.delta).toBeCloseTo(data.simValues.enchants.get(crusader.enchant.effectId)!);
		expect(crusader.delta).toBeGreaterThan(40);
	});

	it('keeps procs nobody measured apart', () => {
		for (const slot of overview) {
			for (const enchant of slot.unscored) expect(data.simValues.measuredEnchants.has(enchant.effectId)).toBe(false);
		}
	});

	it('reports the current enchant and its value', () => {
		const cloak = { ...dwarf, gear: dwarf.gear.map((p, i) => (i === 3 && p ? { ...p, enchant: 7667 } : p)) };
		const back = enchantOverview(cloak.gear, cloak, data, spec).find(s => s.slotIndex === 3)!;
		expect(back.current?.name).toBe('Enchant Cloak - Agility');
		expect(back.currentDelta).toBeCloseTo(5 * spec.weights.stats.agility);
	});
});

describe('bestEnchants', () => {
	it('raises the score and leaves no better stat enchant', () => {
		const chosen = bestEnchants(dwarf.gear, dwarf, data, spec);
		const enchanted = dwarf.gear.map((p, i) => (p && chosen[i] ? { ...p, enchant: chosen[i] } : p));
		expect(scoreSet(enchanted, dwarf, data, spec).score).toBeGreaterThan(scoreSet(dwarf.gear, dwarf, data, spec).score + 50);
		for (const slot of enchantOverview(enchanted, dwarf, data, spec)) {
			if (slot.options[0]) expect(slot.options[0].delta).toBeLessThanOrEqual(slot.currentDelta + 0.01);
		}
	});
});

describe('professionValues', () => {
	const values = professionValues({ character: dwarf, data, spec, filter: DEFAULT_FILTER });

	it('puts the character’s own professions first', () => {
		expect(values[0].profession).toBe('Leatherworking');
		expect(values[0].mine).toBe(true);
		expect(values.filter(v => v.mine).length).toBe(1); // Skinning crafts nothing
	});

	it('lists only upgrades that the profession crafts', () => {
		for (const { profession, items, value } of values) {
			expect(value).toBeGreaterThan(0);
			for (const drop of items) expect(drop.item.sources?.some(s => s.kind === 'crafted' && s.profession === profession)).toBe(true);
		}
	});
});
