import { describe, expect, it } from 'vitest';

import specJson from '../specs/enhancement-shaman.json';
import { isThemeChoice, resolveTheme } from './theme';
import type { Character, SpecConfig } from './types';

const spec = specJson as unknown as SpecConfig;
const withRace = (race: string) => ({ race }) as Character;

describe('resolveTheme', () => {
	it('follows the faction of the character when set to auto', () => {
		expect(resolveTheme('auto', withRace('RaceDwarf'), spec)).toBe('alliance');
		expect(resolveTheme('auto', withRace('RaceOrc'), spec)).toBe('horde');
	});

	it('stays neutral without a character or with an unknown race', () => {
		expect(resolveTheme('auto', null, spec)).toBe('forever');
		expect(resolveTheme('auto', withRace('RaceUnknown'), spec)).toBe('forever');
	});

	it('keeps a fixed choice whatever the character is', () => {
		expect(resolveTheme('horde', withRace('RaceDwarf'), spec)).toBe('horde');
		expect(resolveTheme('forever', withRace('RaceOrc'), spec)).toBe('forever');
	});
});

describe('isThemeChoice', () => {
	it('accepts the known choices only', () => {
		expect(isThemeChoice('auto')).toBe(true);
		expect(isThemeChoice('alliance')).toBe(true);
		expect(isThemeChoice('neon')).toBe(false);
		expect(isThemeChoice(null)).toBe(false);
	});
});
