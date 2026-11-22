import { GEAR_SLOTS } from './constants';
import { DEFAULT_FILTER, type SourceFilter } from './scoring';
import { EMPTY_ROSTER, isCharacter, type Roster } from './roster';
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

const FILTER_KEY = 'forever-gear-planner.content.v1';

/** The saved content choice. Settings added in a later version fall back to their defaults. */
export function loadFilter(): SourceFilter {
	try {
		const raw = localStorage.getItem(FILTER_KEY);
		const saved = raw ? (JSON.parse(raw) as Partial<SourceFilter>) : null;
		if (!saved || typeof saved !== 'object') return DEFAULT_FILTER;
		const merged = { ...DEFAULT_FILTER, ...saved };
		if (!Array.isArray(merged.excludedDungeons) || !Array.isArray(merged.excludedReputations) || !Array.isArray(merged.hiddenItems)) return DEFAULT_FILTER;
		return merged;
	} catch {
		return DEFAULT_FILTER;
	}
}

export function saveFilter(filter: SourceFilter): void {
	try {
		localStorage.setItem(FILTER_KEY, JSON.stringify(filter));
	} catch {
		// storage blocked or full: the choice just won't survive a reload
	}
}

const ROSTER_KEY = 'forever-gear-planner.characters.v1';

/** All saved characters. A single character saved by an earlier version is taken over. */
export function loadRoster(): Roster {
	try {
		const raw = localStorage.getItem(ROSTER_KEY);
		if (raw) {
			const saved = JSON.parse(raw) as Roster;
			const characters = Array.isArray(saved.characters) ? saved.characters.filter(isCharacter) : [];
			const active = Number.isInteger(saved.active) && saved.active >= 0 && saved.active < characters.length ? saved.active : 0;
			return { characters, active };
		}
	} catch {
		return EMPTY_ROSTER; // storage blocked or corrupt: start empty
	}
	const single = loadCharacter();
	return single ? { characters: [single], active: 0 } : EMPTY_ROSTER;
}

export function saveRoster(roster: Roster): void {
	try {
		localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
		localStorage.removeItem(KEY); // the single-character entry of earlier versions
	} catch {
		// storage blocked or full: the characters just won't survive a reload
	}
}
