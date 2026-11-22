import wowheadGuide from '../config/guides/enhancement-shaman.wowhead.json';
import { GEAR_SLOTS } from './constants';
import type { GameData } from './gameData';
import { EVERYTHING, type Gear, isObtainable, scoreSet, slotInUse } from './scoring';
import type { Character, SlotKind, SpecConfig } from './types';

const WOWHEAD_GUIDE_SPEC = 'enhancement-shaman';

export interface GuideEntry {
	itemId: number;
	slot: SlotKind;
	/** The guide's own label: "BiS", "Great" ... or "Set" for a fixed set. */
	rank: string;
	/** Set for fixed sets, where each item belongs to one exact slot. */
	slotIndex?: number;
	/** Where the guide says the item comes from, when it says so. */
	source?: string;
	/** Item name as the guide wrote it, for items missing from the data. */
	name?: string;
}

export interface Guide {
	id: string;
	label: string;
	title: string;
	url: string;
	author?: string;
	updated?: string;
	/** A fixed set (one item per slot) rather than a ranked list per slot. */
	fixedSet: boolean;
	entries: GuideEntry[];
}

export interface SimSet {
	/** The spec this set is for. */
	spec: string;
	id: string;
	label: string;
	title: string;
	url: string;
	gear: ({ id: number; enchant?: number } | null)[];
}

/** Hand-kept guide lists plus the sets the sim maintainers ship. */
export function buildGuides(simSets: SimSet[], specId: string = WOWHEAD_GUIDE_SPEC): Guide[] {
	const fromSim: Guide[] = simSets.map(set => ({
		id: set.id,
		label: set.label,
		title: set.title,
		url: set.url,
		fixedSet: true,
		entries: set.gear.flatMap((piece, slotIndex) => (piece ? [{ itemId: piece.id, slot: GEAR_SLOTS[slotIndex].kind, rank: 'Set', slotIndex }] : [])),
	}));
	const wowhead: Guide = {
		id: wowheadGuide.id,
		label: wowheadGuide.label,
		title: wowheadGuide.title,
		url: wowheadGuide.url,
		author: wowheadGuide.author,
		updated: wowheadGuide.updated,
		fixedSet: false,
		entries: wowheadGuide.items.map(item => ({ itemId: item.id, slot: item.slot as SlotKind, rank: item.rank, source: 'source' in item ? item.source : undefined, name: item.name })),
	};
	// The hand-kept Wowhead list exists for one spec so far.
	return specId === WOWHEAD_GUIDE_SPEC ? [...fromSim, wowhead] : fromSim;
}

export interface GuideMark {
	guide: Guide;
	rank: string;
	source?: string;
}

/** For every item id: which guides list it, and how. */
export function guideMarks(guides: Guide[]): Map<number, GuideMark[]> {
	const marks = new Map<number, GuideMark[]>();
	for (const guide of guides) {
		for (const entry of guide.entries) {
			if (!marks.has(entry.itemId)) marks.set(entry.itemId, []);
			const list = marks.get(entry.itemId)!;
			if (!list.some(m => m.guide === guide)) list.push({ guide, rank: entry.rank, source: entry.source });
		}
	}
	return marks;
}

/** "BiS" for a ranked list, nothing extra for a fixed set. */
export const markLabel = (mark: GuideMark) => (mark.guide.fixedSet ? mark.guide.label : `${mark.guide.label} ${mark.rank}`);

export interface GuidePlan {
	plan: Record<number, number>;
	/** Guide picks that could not be planned, with the reason. */
	skipped: string[];
}

/**
 * Turns a guide into a plan for this character. A ranked list gives each slot its best-ranked
 * item the character can use (two for rings and trinkets); a fixed set is taken slot by slot.
 */
export function guidePlan(guide: Guide, character: Character, data: GameData, spec: SpecConfig): GuidePlan {
	const faction = spec.races.find(r => r.id === character.race)?.faction;
	const plan: Record<number, number> = {};
	const skipped: string[] = [];
	const used = new Set<number>();

	const usable = (entry: GuideEntry): string | null => {
		const item = data.itemById.get(entry.itemId);
		if (!item) return 'is not in the item data';
		if (!isObtainable(item, character, faction, EVERYTHING, spec)) return `is not available to ${faction === 'horde' ? 'Horde' : 'Alliance'} or needs a profession you lack`;
		return null;
	};
	const nameOf = (entry: GuideEntry) => data.itemById.get(entry.itemId)?.name ?? entry.name ?? `Item #${entry.itemId}`;

	GEAR_SLOTS.forEach((slot, slotIndex) => {
		if (!slotInUse(slotIndex, spec)) return;
		const candidates = guide.fixedSet ? guide.entries.filter(e => e.slotIndex === slotIndex) : guide.entries.filter(e => e.slot === slot.kind && !used.has(e.itemId));
		for (const entry of candidates) {
			const problem = usable(entry);
			if (problem) {
				// For a ranked list, only report the top pick; lower ranks are fallbacks anyway.
				if (guide.fixedSet || entry.rank === 'BiS') skipped.push(`${slot.label}: ${nameOf(entry)} ${problem}`);
				used.add(entry.itemId);
				continue;
			}
			used.add(entry.itemId);
			if (entry.itemId !== character.gear[slotIndex]?.id) plan[slotIndex] = entry.itemId;
			return;
		}
	});
	return { plan, skipped: [...new Set(skipped)] };
}

/** Change in set score when `itemId` replaces what `gear` has in the slot. */
export function swapDelta(slotIndex: number, itemId: number, gear: Gear, character: Character, data: GameData, spec: SpecConfig): number {
	const current = gear[slotIndex];
	const swapped = gear.map((piece, i) => (i === slotIndex ? (current?.enchant ? { id: itemId, enchant: current.enchant } : { id: itemId }) : piece));
	return scoreSet(swapped, character, data, spec).score - scoreSet(gear, character, data, spec).score;
}
