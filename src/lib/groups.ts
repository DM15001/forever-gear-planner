/** The named groups of "Group up": each keeps who is in it, by the character's place among the saved ones. */
export const GROUPS_KEY = 'fgp.groups';
export const GROUPS_EVENT = 'fgp-groups-changed';

export interface NamedGroup {
	name: string;
	/** The characters in this group, by their place among the saved ones. */
	members: number[];
}
export interface GroupsSaved {
	groups: NamedGroup[];
	at: number;
}

export function cleanGroups(saved: unknown): GroupsSaved | null {
	const value = saved as Partial<GroupsSaved> | null;
	if (!value || !Array.isArray(value.groups)) return null;
	const groups = value.groups.filter(group => group && typeof group.name === 'string' && Array.isArray(group.members)).map(group => ({ name: group.name.slice(0, 40), members: group.members.filter(Number.isInteger) }));
	if (groups.length === 0) return null;
	return { groups, at: Number.isInteger(value.at) && value.at! >= 0 && value.at! < groups.length ? value.at! : 0 };
}

export function loadGroups(): GroupsSaved | null {
	try {
		return cleanGroups(JSON.parse(localStorage.getItem(GROUPS_KEY) ?? 'null'));
	} catch {
		return null;
	}
}

/** A saved character was removed: in every group it leaves, and everybody after it moves up one place. */
export function withoutMember(saved: GroupsSaved, index: number): GroupsSaved {
	return { ...saved, groups: saved.groups.map(group => ({ ...group, members: group.members.filter(member => member !== index).map(member => (member > index ? member - 1 : member)) })) };
}

/** Keeps the saved groups right when a character is removed anywhere on the site, and tells the page that shows them. */
export function groupsAfterRemoval(index: number): void {
	try {
		const saved = loadGroups();
		if (saved) localStorage.setItem(GROUPS_KEY, JSON.stringify(withoutMember(saved, index)));
		// The ticks from before there were groups: the same shift.
		const old = JSON.parse(localStorage.getItem('fgp.group') ?? 'null') as { out?: number[] } | null;
		if (old && Array.isArray(old.out)) localStorage.setItem('fgp.group', JSON.stringify({ ...old, out: old.out.filter(i => i !== index).map(i => (i > index ? i - 1 : i)) }));
	} catch {
		// Without storage there is nothing saved to keep right.
	}
	window.dispatchEvent(new Event(GROUPS_EVENT));
}
