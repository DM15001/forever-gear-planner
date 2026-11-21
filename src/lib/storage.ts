import { GEAR_SLOTS } from './constants';
import type { Character } from './types';

const KEY = 'forever-gear-planner.character.v1';

/** The saved character, or null when there is none or it cannot be read. */
export function loadCharacter(): Character | null {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return null;
		const saved = JSON.parse(raw) as Character;
		if (!Array.isArray(saved.gear) || saved.gear.length !== GEAR_SLOTS.length) return null;
		return saved;
	} catch {
		return null; // storage blocked or corrupt: start empty
	}
}

export function saveCharacter(character: Character | null): void {
	try {
		if (character) localStorage.setItem(KEY, JSON.stringify(character));
		else localStorage.removeItem(KEY);
	} catch {
		// storage blocked or full: the character just won't survive a reload
	}
}
