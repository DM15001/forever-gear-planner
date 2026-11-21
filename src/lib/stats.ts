import { GEAR_SLOTS } from './constants';
import type { GameData } from './gameData';
import type { Character, GearPiece, Item, ItemSource, SpecConfig, Stats } from './types';

/** Short labels for item stat lines, in display order. */
export const STAT_LABELS: [key: string, short: string, long: string][] = [
	['strength', 'Str', 'Strength'],
	['agility', 'Agi', 'Agility'],
	['stamina', 'Sta', 'Stamina'],
	['intellect', 'Int', 'Intellect'],
	['spirit', 'Spi', 'Spirit'],
	['attackPower', 'AP', 'Attack power'],
	['hitRating', 'Hit', 'Hit rating'],
	['critRating', 'Crit', 'Crit rating'],
	['hasteRating', 'Haste', 'Haste rating'],
	['expertiseRating', 'Expertise', 'Expertise rating'],
	['armorPenetration', 'Armor pen', 'Armor penetration'],
	['spellDamage', 'Spell dmg', 'Spell damage'],
	['natureDamage', 'Nature dmg', 'Nature damage'],
	['healingPower', 'Healing', 'Healing power'],
	['spellPiercing', 'Spell pierce', 'Spell piercing'],
	['mp5', 'MP5', 'Mana per 5 sec'],
	['defenseRating', 'Defense', 'Defense rating'],
	['armor', 'Armor', 'Armor'],
];

export function addStats(target: Stats, extra: Stats | undefined): Stats {
	for (const [key, value] of Object.entries(extra ?? {})) target[key] = (target[key] ?? 0) + value;
	return target;
}

/** An item's stats including its random suffix, if one is chosen. */
export function pieceStats(item: Item, piece: GearPiece, data: GameData): Stats {
	const stats = addStats({}, item.stats);
	const suffix = piece.randomSuffix ? data.suffixById.get(piece.randomSuffix) : undefined;
	if (suffix && item.randPropPoints) {
		for (const [key, share] of Object.entries(suffix.stats)) {
			const value = Math.floor((item.randPropPoints * share) / 10000);
			if (value) stats[key] = (stats[key] ?? 0) + value;
		}
	}
	return stats;
}

/** Stats from all equipped items and their enchants. Base stats, talents and buffs are not included. */
export function gearStats(character: Character, data: GameData): Stats {
	const total: Stats = {};
	character.gear.forEach((piece, index) => {
		if (!piece) return;
		const item = data.itemById.get(piece.id);
		if (item) addStats(total, pieceStats(item, piece, data));
		if (piece.enchant) {
			const enchant = data.enchantsBySlot.get(GEAR_SLOTS[index].kind)?.find(e => e.effectId === piece.enchant);
			addStats(total, enchant?.stats);
		}
	});
	return total;
}

export interface HitSummary {
	fromGear: number;
	fromRace: number;
	total: number;
	cap: number;
	/** Rating still missing to reach the cap; 0 when capped. */
	ratingMissing: number;
	/** Rating beyond the cap; 0 when not over. */
	ratingOver: number;
}

export function hitSummary(stats: Stats, character: Character, spec: SpecConfig): HitSummary {
	const perPercent = spec.ratingPerPercent.hitRating;
	const fromGear = (stats.hitRating ?? 0) / perPercent;
	const fromRace = (character.race && spec.raceBonuses[character.race]?.hitPercent) || 0;
	const total = fromGear + fromRace;
	const diffRating = Math.round((spec.hitCapPercent - total) * perPercent);
	return { fromGear, fromRace, total, cap: spec.hitCapPercent, ratingMissing: Math.max(0, diffRating), ratingOver: Math.max(0, -diffRating) };
}

/** "+20 Sta, +32 AP, +10 Hit" */
export function statLine(stats: Stats): string {
	return STAT_LABELS.filter(([key]) => key !== 'armor' && stats[key])
		.map(([key, short]) => `+${stats[key]} ${short}`)
		.join(', ');
}

/** Where an item comes from, as one short line. */
export function sourceLine(source: ItemSource | undefined, data: GameData): string {
	if (!source) return 'Source unknown';
	switch (source.kind) {
		case 'drop': {
			const zone = source.zoneId ? data.zoneById.get(source.zoneId)?.name : undefined;
			const from = (source.npcId ? data.npcById.get(source.npcId)?.name : undefined) ?? source.otherName;
			return [zone ?? 'World drop', from?.trim()].filter(Boolean).join(': ');
		}
		case 'quest':
			return `Quest: ${source.name ?? 'unknown'}`;
		case 'crafted':
			return `Crafted: ${source.profession}`;
		case 'rep':
			return `Reputation: ${source.repFaction}${source.repLevel ? ` (${source.repLevel})` : ''}`;
		case 'vendor':
			return `Vendor: ${source.npcName ?? 'unknown'}`;
		case 'pvp':
			return 'PvP reward';
		default:
			return 'Source unknown';
	}
}

export const wowheadItemUrl = (id: number) => `https://www.wowhead.com/forever/item=${id}`;
export const iconUrl = (icon: string) => `https://wow.zamimg.com/images/wow/icons/large/${icon}.jpg`;
