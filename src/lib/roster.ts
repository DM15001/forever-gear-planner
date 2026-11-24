import { GEAR_SLOTS } from './constants';
import type { Character, SpecConfig } from './types';

/** All saved characters and which one is shown. */
export interface Roster {
	characters: Character[];
	active: number;
}

export const EMPTY_ROSTER: Roster = { characters: [], active: 0 };

export const activeCharacter = (roster: Roster): Character | null => roster.characters[roster.active] ?? null;

/** The name to show for a character: its own, or "Dwarf 2" from race and position. */
export function characterLabel(character: Character, index: number, spec: SpecConfig): string {
	const name = character.name?.trim();
	if (name) return name;
	const race = spec.races.find(r => r.id === character.race)?.name;
	return `${race ?? 'Character'} ${index + 1}`;
}

export function addCharacter(roster: Roster, character: Character): Roster {
	return { characters: [...roster.characters, character], active: roster.characters.length };
}

export function replaceActive(roster: Roster, character: Character): Roster {
	if (!roster.characters.length) return addCharacter(roster, character);
	return { ...roster, characters: roster.characters.map((c, i) => (i === roster.active ? character : c)) };
}

export function removeActive(roster: Roster): Roster {
	const characters = roster.characters.filter((_, i) => i !== roster.active);
	return { characters, active: Math.max(0, Math.min(roster.active, characters.length - 1)) };
}

export function selectCharacter(roster: Roster, index: number): Roster {
	return index >= 0 && index < roster.characters.length ? { ...roster, active: index } : roster;
}

/** Whether a value read from storage or a link has the shape of a character. */
export function isCharacter(value: unknown): value is Character {
	if (!value || typeof value !== 'object') return false;
	const c = value as Character;
	if (!Array.isArray(c.gear) || c.gear.length !== GEAR_SLOTS.length) return false;
	if (!c.gear.every(p => p === null || (typeof p === 'object' && Number.isInteger(p.id)))) return false;
	if (!Array.isArray(c.professions) || !c.professions.every(p => typeof p === 'string')) return false;
	if (c.race !== null && typeof c.race !== 'string') return false;
	const ids = (map: unknown) => map === undefined || (typeof map === 'object' && map !== null && Object.values(map).every(Number.isInteger));
	return ids(c.plan) && ids(c.planEnchants);
}

const SHARE_VERSION = 1;

const toBase64Url = (text: string) => {
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (code: string) => {
	const binary = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
	return new TextDecoder().decode(Uint8Array.from(binary, ch => ch.charCodeAt(0)));
};

/** A character with its plan, packed into text that fits in a link. */
export function encodeShare(character: Character): string {
	return toBase64Url(JSON.stringify({ v: SHARE_VERSION, c: character }));
}

/** The character from a share code, or null when the code is broken or from an unknown version. */
export function decodeShare(code: string): Character | null {
	try {
		const parsed = JSON.parse(fromBase64Url(code)) as { v?: number; c?: unknown };
		if (parsed.v !== SHARE_VERSION || !isCharacter(parsed.c)) return null;
		const c = parsed.c;
		// Keep only the fields the app knows, so a hand-made link cannot plant anything else in storage.
		return {
			name: typeof c.name === 'string' ? c.name.slice(0, 60) : undefined,
			specId: typeof c.specId === 'string' && /^[a-z-]{1,40}$/.test(c.specId) ? c.specId : undefined,
			race: c.race,
			level: typeof c.level === 'number' ? c.level : null,
			talents: typeof c.talents === 'string' ? c.talents.slice(0, 200) : '',
			professions: c.professions.slice(0, 2),
			gear: c.gear.map(p => (p ? { id: p.id, ...(Number.isInteger(p.enchant) ? { enchant: p.enchant } : {}), ...(Number.isInteger(p.randomSuffix) ? { randomSuffix: p.randomSuffix } : {}) } : null)),
			plan: c.plan,
			planEnchants: c.planEnchants,
		};
	} catch {
		return null;
	}
}

const SHARE_PARAM = 'share=';

/** The link that opens this character on another device. */
export const shareUrl = (character: Character, pageUrl: string) => `${pageUrl.split('#')[0]}#${SHARE_PARAM}${encodeShare(character)}`;

/** The character in a pasted share link, or in the bare code after "share=". Null for anything else. */
export function characterFromShareText(text: string): Character | null {
	const trimmed = text.trim();
	if (!trimmed || /\s/.test(trimmed)) return null;
	const at = trimmed.indexOf(SHARE_PARAM);
	if (at >= 0) return decodeShare(trimmed.slice(at + SHARE_PARAM.length));
	return /^[A-Za-z0-9_-]{40,}$/.test(trimmed) ? decodeShare(trimmed) : null;
}

/** The character a page address carries in its "#share=" part, if any. */
export function sharedCharacter(hash: string): Character | null {
	const at = hash.indexOf(SHARE_PARAM);
	return at < 0 ? null : decodeShare(hash.slice(at + SHARE_PARAM.length));
}
