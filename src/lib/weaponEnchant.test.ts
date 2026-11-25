import { expect, it } from 'vitest';

import specJson from '../specs/mage-fire.json';
import { loadGameData } from './gameData';
import { scoreSet, withItem } from './scoring';
import type { Character, SpecConfig } from './types';

const spec = specJson as unknown as SpecConfig;

it('counts a staff with a two-hand enchant, not with the one-hand enchant of the weapon it replaces', async () => {
	const data = await loadGameData(spec);
	const weaponEnchants = data.enchantsBySlot.get('weapon') ?? [];
	const dagger = [...data.itemById.values()].find(i => i.slot === 'weapon' && i.weapon?.type === 'dagger' && (i.stats?.spellDamage ?? 0) > 0)!;
	const oneHand = weaponEnchants.filter(e => !e.only && !/2H/.test(e.name) && (e.stats?.intellect ?? 0) > 0).sort((a, b) => (b.stats!.intellect ?? 0) - (a.stats!.intellect ?? 0))[0];
	const staff = [...data.itemById.values()].find(i => i.weapon?.hand === 'twoHand' && i.weapon.type === 'staff' && (i.stats?.spellDamage ?? 0) > 20)!;
	const gear = Array(17).fill(null);
	gear[14] = { id: dagger.id, enchant: oneHand.effectId };
	const character = { name: 'x', race: spec.races[0].id, professions: [], gear } as unknown as Character;

	const carried = withItem(gear, 14, staff.id, data);
	const fitted = withItem(gear, 14, staff.id, data, { character, spec });
	expect(carried[14]?.enchant).toBe(oneHand.effectId);
	const chosen = weaponEnchants.find(e => e.effectId === fitted[14]?.enchant && (e.only === 'twoHand' || /2H/.test(e.name)));
	expect(chosen).toBeDefined();
	expect(scoreSet(fitted, character, data, spec).score).toBeGreaterThan(scoreSet(carried, character, data, spec).score);
	// Without an enchant on the old weapon nothing is added: bare against bare.
	const bare = withItem([...gear.slice(0, 14), { id: dagger.id }, null, null], 14, staff.id, data, { character, spec });
	expect(bare[14]?.enchant).toBeUndefined();
});
