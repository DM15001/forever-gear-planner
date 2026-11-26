import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain script without types
import { affected, dbTouches, namesTouches, spellTouches, touches } from '../../scripts/measure-queue.mjs';

describe('which builds a WoWSims update touches', () => {
	it('reads a class from its folder, in the simulator and in the presets', () => {
		expect(touches('sim/mage/fireball.go')).toBe('mage');
		expect(touches('ui/specs/hunter/dps/presets.ts')).toBe('hunter');
	});
	it('counts shared code and the item data as everybody', () => {
		for (const path of ['sim/core/spell.go', 'sim/common/items.go', 'sim/siml/build.go', 'assets/db_inputs/RandPropPoints.json', 'proto/api.proto', 'sim/register_all.go']) expect(touches(path)).toBe('all');
	});
	it('ignores tests, documents and the interface', () => {
		for (const path of ['sim/mage/fire_test.go', 'sim/mage/TestFire.results', 'docs/rulings/x.md', 'ui/features/gear/picker.tsx', 'ui/sim/thing.ts', '.github/workflows/ci.yml', 'tools/database/main.go', 'package.json', 'vite.config.mts']) expect(touches(path)).toBe('none');
	});
	it('takes anything it does not know as everybody', () => {
		expect(touches('brand-new-folder/file.go')).toBe('all');
	});
	it('names the builds of the classes that were touched, and all of them for shared code', () => {
		const mage = affected(['sim/mage/fireball.go', 'ui/features/x.tsx']);
		expect(mage.length).toBeGreaterThan(0);
		expect(mage.every((id: string) => id.startsWith('mage'))).toBe(true);
		expect(affected(['docs/a.md'])).toEqual([]);
		expect(affected(['sim/core/spell.go']).length).toBeGreaterThan(30);
	});

	it('reads the name table of the preset text format class by class, and skips its prose', () => {
		expect(touches('sim/siml/names.json')).toBe('names');
		// On its own, without the contents, the table still counts as everybody.
		expect(affected(['sim/siml/names.json']).length).toBeGreaterThan(30);
		for (const path of ['sim/siml/llm_head.txt', 'sim/siml/gen/repinned.txt']) expect(touches(path)).toBe('none');
		// The code next to them is shared by every class.
		for (const path of ['sim/siml/names.go', 'sim/siml/forms.json', 'sim/siml/gen/generate.go']) expect(touches(path)).toBe('all');
		const table = (change: (t: any) => void = () => {}) => {
			const t = {
				classes: {
					paladin: { spell: { exorcism: { spellId: 10314, registeredBy: ['retribution_paladin'] } }, aura: {} },
					mage: { spell: { fireball: { spellId: 10151, registeredBy: ['mage'] } }, aura: {} },
				},
				shared: { aura: { flask: { spellId: 17628, registeredBy: ['mage', 'retribution_paladin', 'holy_paladin'] } }, spell: {} },
				enchants: { crusader: { effectId: 1900 } },
			} as any;
			change(t);
			return JSON.stringify(t);
		};
		expect(namesTouches(table(), table())).toEqual([]);
		expect(namesTouches(table(), table(t => (t.classes.paladin.spell.judgement = { spellId: 20271, registeredBy: ['retribution_paladin'] })))).toEqual(['paladin']);
		expect(namesTouches(table(), table(t => delete t.classes.mage.spell.fireball))).toEqual(['mage']);
		expect(namesTouches(table(), table(t => ((t.classes.mage.spell.fireball.spellId = 1), (t.classes.paladin.aura.x = { spellId: 2 })))).sort()).toEqual(['mage', 'paladin']);
		// A shared name belongs to the classes of the specs that use it.
		expect(namesTouches(table(), table(t => (t.shared.aura.judgement_increased_damage = { spellId: 1291086, registeredBy: ['holy_paladin', 'protection_paladin', 'retribution_paladin'] })))).toEqual(['paladin']);
		expect(namesTouches(table(), table(t => (t.shared.aura.flask.spellId = 1))).sort()).toEqual(['mage', 'paladin']);
		expect(namesTouches(table(), table(t => (t.shared.aura.flask.registeredBy = ['mage', 'dps_warrior']))).sort()).toEqual(['mage', 'paladin', 'warrior']);
		// A shared name that does not say whose it is: everybody.
		expect(namesTouches(table(), table(t => (t.shared.spell.thing = { spellId: 5, registeredBy: [] })))).toBe('all');
		expect(namesTouches(table(), table(t => (t.shared.spell.thing = { spellId: 5 })))).toBe('all');
		expect(namesTouches(table(), table(t => (t.shared.spell.thing = { spellId: 5, registeredBy: ['some_pet'] })))).toBe('all');
		// Outside the classes, or a class nobody knows: everybody.
		expect(namesTouches(table(), table(t => (t.enchants.crusader.effectId = 1)))).toBe('all');
		expect(namesTouches(table(), table(t => (t.items = {})))).toBe('all');
		expect(namesTouches(table(), table(t => (t.classes.monk = { spell: {} })))).toBe('all');
	});

	it('reads the item database entry by entry', () => {
		expect(touches('assets/database/db.json')).toBe('db');
		expect(touches('assets/database/db.bin')).toBe('db-twin');
		const shaman = { id: 'sham', classId: 7, armorTypes: ['cloth', 'leather', 'mail'], weaponTypes: { oneHand: ['axe'], twoHand: ['axe'], offHand: ['shield'] }, rangedTypes: ['totem'], canDualWield: false };
		const mage = { id: 'mage', classId: 8, armorTypes: ['cloth'], weaponTypes: { oneHand: ['dagger'], twoHand: ['staff'], offHand: ['offHand'] }, rangedTypes: ['wand'], canDualWield: false };
		const wears = { sham: [10], mage: [20] } as Record<string, number[]>;
		const eats = { sham: [500], mage: [600] } as Record<string, number[]>;
		const use = (spec: { id: string }) => ({ items: new Set(wears[spec.id]), enchants: new Set(), suffixes: new Set(), consumables: new Set(eats[spec.id]) });
		const db = (change: object = {}) =>
			JSON.stringify({
				items: [
					{ id: 10, type: 5, armorType: 3, stats: [1] },
					{ id: 20, type: 5, armorType: 1, stats: [1] },
					{ id: 30, type: 13, weaponType: 1, handType: 2, stats: [1] },
					{ id: 40, type: 5, armorType: 3, stats: [1], itemEffects: [{ buffId: 1 }] },
				],
				enchants: [{ effectId: 1, itemId: 2, spellId: 3, stats: [1] }],
				consumables: [{ id: 500, stats: [0] }, { id: 600, stats: [0] }],
				zones: [{ id: 1, name: 'A' }],
				...change,
			});
		const edit = (part: string, id: number, more: object) => {
			const whole = JSON.parse(db());
			whole[part] = whole[part].map((entry: { id?: number; effectId?: number }) => ((entry.id ?? entry.effectId) === id ? { ...entry, ...more } : entry));
			return JSON.stringify(whole);
		};
		const run = (after: string) => dbTouches(db(), after, [shaman, mage], use);
		// A place's name or an item's picture: nobody.
		expect(run(db({ zones: [{ id: 1, name: 'B' }] }))).toEqual({ effects: [], weights: [], weapons: [] });
		expect(run(edit('items', 10, { icon: 'x', sources: [1] }))).toEqual({ effects: [], weights: [], weapons: [] });
		// Food the shaman's set-up eats: the shaman, in every measurement.
		expect(run(edit('consumables', 500, { stats: [10] }))).toEqual({ effects: ['sham'], weights: ['sham'], weapons: ['sham'] });
		// A piece the mage's set-up wears.
		expect(run(edit('items', 20, { stats: [2] }))).toEqual({ effects: ['mage'], weights: ['mage'], weapons: ['mage'] });
		// An axe nobody wears: only the weapon lists of those who can swing it.
		expect(run(edit('items', 30, { stats: [2] }))).toEqual({ effects: [], weights: [], weapons: ['sham'] });
		// A mail piece with an effect: the effects of those who can wear mail.
		expect(run(edit('items', 40, { stats: [2] }))).toEqual({ effects: ['sham'], weights: [], weapons: [] });
		// An enchant for everybody: effects and weapons of all, stat weights of none (nobody's set-up has it).
		expect(run(edit('enchants', 1, { stats: [2] }))).toEqual({ effects: ['sham', 'mage'], weights: [], weapons: ['sham', 'mage'] });
		// A part this script does not know.
		expect(run(db({ spellEffects: [{ id: 1 }] }))).toBe('all');
	});

	it('reads the generated spell data spell by spell', () => {
		expect(touches('sim/core/spelldata/spells_auto_gen.go')).toBe('spells');
		const file = (execute: string, proc: string, head = 'package spelldata') =>
			[head, 'var generatedSpells = []Spell{', `\t{ID: 1, Name: "Execute", ClassFlags: core.ClassFlags{Family: 4, Mask: 1}, X: ${execute},`, '\t\tEffects: []Effect{', '\t\t},', `\t{ID: 2, Name: "Some proc", X: ${proc}},`, '}'].join('\n');
		expect(spellTouches(file('1', '1'), file('1', '1'))).toEqual([]);
		expect(spellTouches(file('1', '1'), file('2', '1'))).toEqual(['warrior']);
		expect(spellTouches(file('1', '1'), file('1', '2'))).toBe('all');
		expect(spellTouches(file('1', '1'), file('1', '1', 'package other'))).toBe('all');
	});
});
