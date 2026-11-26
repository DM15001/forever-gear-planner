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
	const set = character.set ? ` (${character.set})` : '';
	const name = character.name?.trim();
	if (name) return name + set;
	const race = spec.races.find(r => r.id === character.race)?.name;
	return `${race ?? 'Character'} ${index + 1}${set}`;
}

/** A second copy of the open character under a set name, to change into another build or for another enemy. It becomes the open one. Both carry the same group, so they show as one character with a choice of sets. */
export function addSet(roster: Roster, setName: string): Roster {
	const base = activeCharacter(roster);
	const name = setName.trim().slice(0, 30);
	if (!base || !name) return roster;
	const group = base.group ?? `g${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
	const characters = roster.characters.map((c, i) => (i === roster.active ? { ...c, group } : c));
	// At the end, so the places of the others stay as the group plan remembers them.
	return addCharacter({ ...roster, characters }, { ...structuredClone(base), group, set: name });
}

/** The gear sets of the open character: every saved character of its group, with its place in the list. Just itself when it has no other set. */
export function setsOf(roster: Roster): { index: number; label: string }[] {
	const open = activeCharacter(roster);
	if (!open) return [];
	return roster.characters.flatMap((c, index) => (index === roster.active || (open.group && c.group === open.group) ? [{ index, label: c.set ?? 'Main' }] : []));
}

/** Which saved characters get a tile: one per character. Of a character with several gear sets, the open set, or else its first. */
export function tileIndexes(roster: Roster): number[] {
	const openGroup = activeCharacter(roster)?.group;
	const seen = new Set<string>();
	return roster.characters.flatMap((c, index) => {
		// A friend's character lives under "Group up" only.
		if (c.friend && index !== roster.active) return [];
		if (!c.group) return [index];
		if (seen.has(c.group)) return [];
		seen.add(c.group);
		// The tile stays where the character's first preset is, whichever preset is open.
		return [c.group === openGroup ? roster.active : index];
	});
}

export function addCharacter(roster: Roster, character: Character): Roster {
	return { characters: [...roster.characters, character], active: roster.characters.length };
}

export function replaceActive(roster: Roster, character: Character): Roster {
	if (!roster.characters.length) return addCharacter(roster, character);
	return { ...roster, characters: roster.characters.map((c, i) => (i === roster.active ? character : c)) };
}

export function removeActive(roster: Roster): Roster {
	const gone = roster.characters[roster.active];
	const characters = roster.characters.filter((_, i) => i !== roster.active);
	// Removing one gear set opens another set of the same character, if there is one.
	const sibling = gone?.group ? characters.findIndex(c => c.group === gone.group) : -1;
	// A neighbour opens, and one of your own rather than a friend's.
	const neighbour = Math.max(0, Math.min(roster.active, characters.length - 1));
	const own = characters[neighbour]?.friend ? characters.findIndex(c => !c.friend) : -1;
	return { characters, active: sibling >= 0 ? sibling : own >= 0 ? own : neighbour };
}

/** Removes the saved character at that place. The open one stays open; if it was the one removed, a sibling preset or a neighbour opens. */
export function removeAt(roster: Roster, index: number): Roster {
	if (index === roster.active) return removeActive(roster);
	if (index < 0 || index >= roster.characters.length) return roster;
	return { characters: roster.characters.filter((_, i) => i !== index), active: roster.active - (index < roster.active ? 1 : 0) };
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

/** Keeps only the fields the app knows, so a hand-made link cannot plant anything else in storage. Null when it is not a character. */
function cleanCharacter(value: unknown): Character | null {
	if (!isCharacter(value)) return null;
	const c = value;
	return {
		name: typeof c.name === 'string' ? c.name.slice(0, 60) : undefined,
		...(typeof c.set === 'string' && c.set.trim() ? { set: c.set.trim().slice(0, 30) } : {}),
		specId: typeof c.specId === 'string' && /^[a-z-]{1,40}$/.test(c.specId) ? c.specId : undefined,
		race: c.race,
		level: typeof c.level === 'number' ? c.level : null,
		talents: typeof c.talents === 'string' ? c.talents.slice(0, 200) : '',
		professions: c.professions.slice(0, 2),
		gear: c.gear.map(p => (p ? { id: p.id, ...(Number.isInteger(p.enchant) ? { enchant: p.enchant } : {}), ...(Number.isInteger(p.randomSuffix) ? { randomSuffix: p.randomSuffix } : {}) } : null)),
		plan: c.plan,
		planEnchants: c.planEnchants,
		// Which spell books are learned: it changes what the simulation casts, so a shared character keeps it.
		...(c.bookRanks && typeof c.bookRanks === 'object' ? { bookRanks: Object.fromEntries(Object.entries(c.bookRanks).filter(([id, learned]) => /^\d{1,9}$/.test(id) && typeof learned === 'boolean').slice(0, 20)) } : {}),
	};
}

/** A character with its plan, packed into text that fits in a link. Only what the reader keeps is sent: sim settings stay behind. */
export function encodeShare(character: Character): string {
	return toBase64Url(JSON.stringify({ v: SHARE_VERSION, c: cleanCharacter(character) ?? character }));
}

/** The character from a share code, or null when the code is broken or from an unknown version. */
export function decodeShare(code: string): Character | null {
	try {
		const parsed = JSON.parse(fromBase64Url(code)) as { v?: number; c?: unknown };
		return parsed.v === SHARE_VERSION ? cleanCharacter(parsed.c) : null;
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

const GROUP_PARAM = 'group=';
/** More people than a raid has make no group; a link that claims so is not one of ours. */
const GROUP_LIMIT = 40;

const bytesToBase64Url = (bytes: Uint8Array) => {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const squeeze = async (data: BlobPart, how: 'pack' | 'unpack') => {
	const stream = new Blob([data]).stream().pipeThrough(how === 'pack' ? new CompressionStream('deflate-raw') : new DecompressionStream('deflate-raw'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
};

/** A whole group in one link: every character with its equipped and planned gear, packed small enough for a chat message. */
export async function groupUrl(characters: Character[], pageUrl: string): Promise<string> {
	const packed = await squeeze(JSON.stringify({ v: SHARE_VERSION, g: characters.map(c => cleanCharacter(c) ?? c) }), 'pack');
	return `${pageUrl.split('#')[0]}#${GROUP_PARAM}${bytesToBase64Url(packed)}`;
}

/** The characters in a group link or in the text after "group=". Null for anything else. */
export async function groupFromShareText(text: string): Promise<Character[] | null> {
	const trimmed = text.trim();
	const at = trimmed.indexOf(GROUP_PARAM);
	if (at < 0 || /\s/.test(trimmed)) return null;
	try {
		const binary = atob(trimmed.slice(at + GROUP_PARAM.length).replace(/-/g, '+').replace(/_/g, '/'));
		const json = new TextDecoder().decode(await squeeze(Uint8Array.from(binary, ch => ch.charCodeAt(0)), 'unpack'));
		const parsed = JSON.parse(json) as { v?: number; g?: unknown };
		if (parsed.v !== SHARE_VERSION || !Array.isArray(parsed.g) || parsed.g.length === 0 || parsed.g.length > GROUP_LIMIT) return null;
		const characters = parsed.g.map(cleanCharacter);
		return characters.every((c): c is Character => c !== null) ? characters : null;
	} catch {
		return null;
	}
}

/** Adds a shared group to the saved characters, as friends: they count under "Group up" and get no tile. A character that is already saved exactly like that is not added twice. The open character stays open. */
export function addGroup(roster: Roster, characters: Character[]): { roster: Roster; added: number } {
	// Whether it is saved as a friend's or as one's own makes no difference to "already here".
	const plain = ({ friend: _friend, ...rest }: Character) => JSON.stringify(rest);
	const known = new Set(roster.characters.map(plain));
	const fresh = characters.filter(c => !known.has(plain(c))).map(c => ({ ...c, friend: true }));
	return { roster: { characters: [...roster.characters, ...fresh], active: roster.active }, added: fresh.length };
}
