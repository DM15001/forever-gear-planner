import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { GEAR_SLOTS } from '../constants';
import { SPECS } from '../specs';
import type { Character } from '../types';
import { bookChoices, buildSimRequest, indexSimDb, simKey } from './request';

const read = (name: string) => JSON.parse(readFileSync(`public/sim/${name}`, 'utf8'));
const spec = SPECS.find(s => s.id === 'enhancement-shaman')!;
const index = indexSimDb(read('db.json'), read('template.enhancement-shaman.json'));
const character = { specId: spec.id, race: 'RaceOrc', level: 60, talents: spec.talents, professions: [], gear: GEAR_SLOTS.map(() => null) } as unknown as Character;
const spellIds = (value: unknown): number[] => (value && typeof value === 'object' ? Object.entries(value).flatMap(([key, inner]) => (key === 'spellId' && typeof inner === 'number' ? [inner] : spellIds(inner))) : []);
const cast = (c: Character) => new Set(spellIds((buildSimRequest(c, c.gear, index, 10).request as any).raid.parties[0].players[0].rotation));

describe('spell ranks from books', () => {
	const flame = bookChoices(character).find(choice => choice.book.spell === 'Flame Shock')!;

	it('knows the books whose spell the rotation casts and takes them as learned: the best rank there is', () => {
		expect(flame.book.item).toBe('Tablet of Flame Shock VI');
		expect(flame.shipped).toBe(false);
		expect(flame.learned).toBe(true);
		expect(cast(character).has(flame.id)).toBe(true);
		expect(cast(character).has(flame.book.below!)).toBe(false);
	});

	it('casts the trained rank once the book is unticked, and a new simulation is run for it', () => {
		const without = { ...character, bookRanks: { [flame.id]: false } };
		expect(bookChoices(without).find(choice => choice.id === flame.id)!.learned).toBe(false);
		expect(cast(without).has(flame.book.below!)).toBe(true);
		expect(cast(without).has(flame.id)).toBe(false);
		expect(simKey(without, without.gear, 100)).not.toBe(simKey(character, character.gear, 100));
	});
});
