import { GEAR_SLOTS } from './constants';
import type { Character, SpecConfig } from './types';

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

type Weights = SpecConfig['weights'];
const weightsKey = (specId: string) => `forever-gear-planner.weights.${specId}.v1`;

/** The user's own stat weights for a spec, or null to use the spec's defaults. */
export function loadWeights(specId: string): Weights | null {
	try {
		const raw = localStorage.getItem(weightsKey(specId));
		const saved = raw ? (JSON.parse(raw) as Weights) : null;
		return saved && typeof saved.mainHandDps === 'number' && saved.stats ? saved : null;
	} catch {
		return null;
	}
}

export function saveWeights(specId: string, weights: Weights | null): void {
	try {
		if (weights) localStorage.setItem(weightsKey(specId), JSON.stringify(weights));
		else localStorage.removeItem(weightsKey(specId));
	} catch {
		// storage blocked or full: the weights just won't survive a reload
	}
}
