import { describe, expect, it } from 'vitest';

import specJson from '../specs/enhancement-shaman.json';
import simExport from './__fixtures__/sim-export.json';
import { importCharacter } from './importCharacter';
import { addCharacter, characterLabel, decodeShare, EMPTY_ROSTER, encodeShare, removeActive, replaceActive, selectCharacter, sharedCharacter, shareUrl } from './roster';
import type { SpecConfig } from './types';

const spec = specJson as unknown as SpecConfig;
const base = importCharacter(JSON.stringify(simExport), spec).character;
const dwarf = { ...base, race: 'RaceDwarf', plan: { 0: 13404 }, planEnchants: { 0: 2543 } };
const orc = { ...base, race: 'RaceOrc', name: 'Thrallson' };

describe('roster', () => {
	it('adds, switches, replaces and removes characters', () => {
		let roster = addCharacter(addCharacter(EMPTY_ROSTER, dwarf), orc);
		expect(roster.active).toBe(1);
		roster = selectCharacter(roster, 0);
		roster = replaceActive(roster, { ...dwarf, name: 'Bronzebeard' });
		expect(roster.characters.map((c, i) => characterLabel(c, i, spec))).toEqual(['Bronzebeard', 'Thrallson']);
		roster = removeActive(roster);
		expect(roster.characters).toHaveLength(1);
		expect(characterLabel(roster.characters[roster.active], roster.active, spec)).toBe('Thrallson');
		expect(removeActive(roster)).toEqual(EMPTY_ROSTER);
	});

	it('names an unnamed character after its race and position', () => {
		expect(characterLabel(dwarf, 1, spec)).toBe('Dwarf 2');
		expect(characterLabel({ ...dwarf, race: null }, 0, spec)).toBe('Character 1');
	});
});

describe('share links', () => {
	it('carries a character and its plan through a link', () => {
		const url = shareUrl(dwarf, 'https://example.test/planner/#old');
		expect(url.startsWith('https://example.test/planner/#share=')).toBe(true);
		const back = sharedCharacter(new URL(url).hash)!;
		expect(back.gear).toEqual(dwarf.gear);
		expect(back.plan).toEqual({ 0: 13404 });
		expect(back.planEnchants).toEqual({ 0: 2543 });
		expect(back.race).toBe('RaceDwarf');
	});

	it('keeps names with non-Latin letters', () => {
		expect(decodeShare(encodeShare({ ...dwarf, name: 'Größenwahn Żubr' }))!.name).toBe('Größenwahn Żubr');
	});

	it('rejects broken codes and wrong shapes', () => {
		expect(decodeShare('not-a-code')).toBeNull();
		expect(decodeShare(btoa(JSON.stringify({ v: 1, c: { gear: [] } })))).toBeNull();
		expect(decodeShare(btoa(JSON.stringify({ v: 99, c: dwarf })))).toBeNull();
		expect(sharedCharacter('#tab=plan')).toBeNull();
	});

	it('drops fields the app does not know', () => {
		const code = btoa(JSON.stringify({ v: 1, c: { ...dwarf, extra: '<script>' } }));
		expect(decodeShare(code)).not.toHaveProperty('extra');
	});
});

describe('characterFromShareText', () => {
	it('reads a pasted share link and the bare code, and nothing else', async () => {
		const { characterFromShareText, encodeShare, shareUrl } = await import('./roster');
		const character = { name: 'Bogdan', race: 'RaceDwarf', level: 60, talents: '', professions: [], gear: Array.from({ length: 17 }, (_, i) => (i === 0 ? { id: 12640 } : null)), plan: { 1: 19491 } } as never;
		expect(characterFromShareText(shareUrl(character, 'https://example.org/planner/'))?.name).toBe('Bogdan');
		expect(characterFromShareText(` ${encodeShare(character)} `)?.gear[0]?.id).toBe(12640);
		expect(characterFromShareText('{ "class": "shaman" }')).toBeNull();
		expect(characterFromShareText('hello')).toBeNull();
	});
});
