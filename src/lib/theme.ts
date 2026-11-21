import type { Character, SpecConfig } from './types';

/** The looks the site can wear. "forever" is the neutral one. */
export const THEMES = ['forever', 'alliance', 'horde'] as const;
export type Theme = (typeof THEMES)[number];

/** What the user picked: a fixed look, or "auto" to follow the character's faction. */
export type ThemeChoice = Theme | 'auto';

export const THEME_CHOICES: { id: ThemeChoice; label: string }[] = [
	{ id: 'auto', label: 'Match my faction' },
	{ id: 'forever', label: 'Forever' },
	{ id: 'alliance', label: 'Alliance' },
	{ id: 'horde', label: 'Horde' },
];

export function isThemeChoice(value: unknown): value is ThemeChoice {
	return THEME_CHOICES.some(c => c.id === value);
}

/** The look to show. "auto" follows the character's race and stays neutral without a character or a known race. */
export function resolveTheme(choice: ThemeChoice, character: Character | null, spec: SpecConfig): Theme {
	if (choice !== 'auto') return choice;
	const faction = spec.races.find(r => r.id === character?.race)?.faction;
	return faction === 'alliance' || faction === 'horde' ? faction : 'forever';
}
