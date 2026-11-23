import vendors from '../config/vendors.json';
import type { GameData } from './gameData';
import { DEFAULT_FILTER, reputationOf, type SourceFilter } from './scoring';
import type { Faction } from './types';

const BATTLEGROUND_REPUTATIONS: string[] = vendors.battlegroundReputations;
/** Item level from which a dungeon counts as a level 60 dungeon. */
const LEVEL_60_ITEM_LEVEL = 55;

export interface DungeonOption {
	key: string;
	name: string;
}

export interface ReputationOption {
	name: string;
	battleground: boolean;
}

/** The content a character can pick from, read off the item data. */
export interface ContentCatalog {
	/** Level 60 dungeons and wings, each switchable on its own. */
	dungeons: DungeonOption[];
	/** Everything below level 60, switched as one. */
	lowDungeonKeys: string[];
	reputations: ReputationOption[];
}

export function contentCatalog(data: GameData, faction: Faction | undefined): ContentCatalog {
	const dungeons = new Map<string, { name: string; maxItemLevel: number }>();
	const reputations = new Set<string>();
	for (const item of data.itemById.values()) {
		for (const source of item.sources ?? []) {
			if (source.dungeonKey) {
				const known = dungeons.get(source.dungeonKey) ?? { name: source.dungeonName ?? source.dungeonKey, maxItemLevel: 0 };
				known.maxItemLevel = Math.max(known.maxItemLevel, item.ilvl ?? 0);
				dungeons.set(source.dungeonKey, known);
			}
			const reputation = reputationOf(source);
			if (reputation && (item.ilvl ?? 0) >= 50 && (!source.faction || !faction || source.faction === faction)) reputations.add(reputation);
		}
	}
	const entries = [...dungeons].map(([key, d]) => ({ key, ...d }));
	return {
		dungeons: entries
			.filter(d => d.maxItemLevel >= LEVEL_60_ITEM_LEVEL)
			.map(({ key, name }) => ({ key, name }))
			.sort((a, b) => a.name.localeCompare(b.name)),
		lowDungeonKeys: entries.filter(d => d.maxItemLevel < LEVEL_60_ITEM_LEVEL).map(d => d.key),
		reputations: [...reputations].sort().map(name => ({ name, battleground: BATTLEGROUND_REPUTATIONS.includes(name) })),
	};
}

export interface Preset {
	id: string;
	label: string;
	/** One line on what the preset leaves out. */
	hint: string;
	filter: SourceFilter;
}

/** Ready-made content choices. The catalog is needed to name what a preset switches off. */
export function presets(_catalog: ContentCatalog): Preset[] {
	return [
		{ id: 'standard', label: 'Everything but PvP', hint: 'All content except PvP (no rank rewards, no battleground reputations or quests) and The Watchers reputation.', filter: DEFAULT_FILTER },
		{ id: 'all', label: 'Everything', hint: 'Nothing left out.', filter: { ...DEFAULT_FILTER, pvp: true, excludedReputations: [] } },
		{
			id: 'dungeons',
			label: 'Dungeons and quests only',
			hint: 'No crafting, vendors, reputations, Tier 0.5 or world drops.',
			filter: { ...DEFAULT_FILTER, drop: false, crafted: false, vendor: false, currency: false, rep: false, unknown: false, tier05: false },
		},
	];
}

const sorted = (list: string[]) => [...list].sort();

/** Whether two content choices are the same, whatever the order of their lists. */
export function sameFilter(a: SourceFilter, b: SourceFilter): boolean {
	const normal = (f: SourceFilter) => JSON.stringify({ ...f, excludedDungeons: sorted(f.excludedDungeons), excludedReputations: sorted(f.excludedReputations) }, Object.keys(f).sort());
	return normal(a) === normal(b);
}

/** Adds or removes entries of an exclusion list. */
export function toggled(list: string[], keys: string[], include: boolean): string[] {
	const without = list.filter(key => !keys.includes(key));
	return include ? without : [...without, ...keys];
}
