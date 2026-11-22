import { GEAR_SLOTS } from './constants';
import type { GameData } from './gameData';
import vendors from '../config/vendors.json';
import type { Character, GearPiece, Item, ItemSource, SpecConfig, Stats, Fight } from './types';

const REPUTATION_VENDORS: Record<string, string> = vendors.reputationVendors;
const CURRENCY_VENDORS: Record<string, string> = vendors.currencyVendors;

/** The currency a vendor takes, for vendors that do not sell for gold. */
export const vendorCurrency = (source: ItemSource): string | undefined => (source.kind === 'vendor' && source.npcId ? CURRENCY_VENDORS[source.npcId] : undefined);

/** The reputation a vendor's goods need, for vendors the data lists without one. */
export const vendorReputation = (source: ItemSource): string | undefined => (source.kind === 'vendor' && source.npcId ? REPUTATION_VENDORS[source.npcId] : undefined);


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
	['shadowDamage', 'Shadow dmg', 'Shadow damage'],
	['fireDamage', 'Fire dmg', 'Fire damage'],
	['frostDamage', 'Frost dmg', 'Frost damage'],
	['arcaneDamage', 'Arcane dmg', 'Arcane damage'],
	['holyDamage', 'Holy dmg', 'Holy damage'],
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
export const MOB_TYPES = ['Beast', 'Demon', 'Dragonkin', 'Elemental', 'Giant', 'Humanoid', 'Mechanical', 'Undead'];
export const AREAS: [string, string][] = [
	['ForestGrassland', 'Forest or grassland'],
	['Mountainous', 'Mountains'],
	['Snowy', 'Snow'],
	['Desert', 'Desert'],
	['Swamp', 'Swamp'],
	['Wasteland', 'Wasteland'],
	['Haunted', 'Haunted'],
	['Cavernous', 'Caves'],
	['Volcanic', 'Volcanic'],
	['StrongholdsCities', 'Strongholds and cities'],
];
const areaLabel = (area: string) => AREAS.find(([key]) => key === area)?.[1] ?? area;

export const FAMILIES = ['Aquatic', 'Dinosaur', 'Dwarf', 'EarthElemental', 'FireElemental', 'Furbolg', 'MountainGiant', 'Murloc', 'Naga', 'Ogre', 'Orc', 'Plant', 'Satyr', 'Serpentine', 'Swine', 'Troll', 'Wolf', 'Worgen'];
/** "EarthElemental" as "Earth elemental". */
export const spaced = (name: string) => name.replace(/([a-z])([A-Z])/g, (_all, a: string, b: string) => `${a} ${b.toLowerCase()}`);

/** True if the item has a bonus (stats or an effect) for the enemy type, creature or terrain of the fight. */
export function matchesFight(item: Item, fight: Fight | undefined): boolean {
	const tags = item.fightTags;
	if (!tags || !fight) return false;
	return Boolean((fight.mobType && tags.mobTypes?.includes(fight.mobType)) || (fight.family && tags.families?.includes(fight.family)) || (fight.area && tags.areas?.includes(fight.area)));
}

/** What the item's effects name beyond its plain conditional stats: only the simulator can value those. */
export function effectTags(item: Item): string[] {
	const tags = item.fightTags;
	if (!tags) return [];
	const inStats = new Set([...(item.versus ?? []).flatMap(entry => entry.mobTypes), ...(item.inArea ?? []).map(entry => entry.area)]);
	return [...(tags.mobTypes ?? []), ...(tags.families ?? []), ...(tags.areas ?? [])].filter(tag => !inStats.has(tag));
}

/** An item's stats that depend on the fight, each with when it counts and how to say so. */
export function conditionalStats(item: Item): { label: string; stats: Stats; active: (fight: Fight | undefined) => boolean }[] {
	return [
		...(item.versus ?? []).map(entry => ({ label: `vs ${entry.mobTypes.join(', ')}`, stats: entry.stats, active: (fight: Fight | undefined) => Boolean(fight?.mobType && entry.mobTypes.includes(fight.mobType)) })),
		...(item.inArea ?? []).map(entry => ({ label: `in ${areaLabel(entry.area).toLowerCase()}`, stats: entry.stats, active: (fight: Fight | undefined) => fight?.area === entry.area })),
	];
}

/** "vs Undead: +12 Spell dmg" for each conditional bonus, with whether it counts in the current fight. */
export function conditionalLines(item: Item, fight: Fight | undefined): { text: string; active: boolean }[] {
	const effects = effectTags(item);
	const named = (tag: string) => AREAS.find(([key]) => key === tag)?.[1].toLowerCase() ?? spaced(tag);
	return [
		...conditionalStats(item).map(line => ({ text: `${line.label}: ${statLine(line.stats)}`, active: line.active(fight) })),
		...(effects.length ? [{ text: `Effect for ${effects.map(named).join(', ')}: only the simulator can value it`, active: effects.some(tag => tag === fight?.mobType || tag === fight?.family || tag === fight?.area) }] : []),
	];
}

export function pieceStats(item: Item, piece: GearPiece, data: GameData): Stats {
	const stats = addStats({}, item.stats);
	for (const line of conditionalStats(item)) if (line.active(data.fight)) addStats(stats, line.stats);
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
	/** Hit the build's default talents give. */
	fromTalents: number;
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
	const fromTalents = spec.hitBonusPercent ?? 0;
	const total = fromGear + fromRace + fromTalents;
	const diffRating = Math.round((spec.hitCapPercent - total) * perPercent);
	return { fromGear, fromRace, fromTalents, total, cap: spec.hitCapPercent, ratingMissing: Math.max(0, diffRating), ratingOver: Math.max(0, -diffRating) };
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
			if (!zone) return from && !/^world drop$/i.test(from.trim()) ? `World drop: ${from.trim()}` : 'World drop';
			return [zone, from?.trim()].filter(Boolean).join(': ');
		}
		case 'quest':
			return `Quest: ${source.name ?? 'unknown'}`;
		case 'crafted':
			return `Crafted: ${source.profession}`;
		case 'rep':
			return `Reputation: ${source.repFaction}${source.repLevel ? ` (${source.repLevel})` : ''}`;
		case 'vendor': {
			const reputation = vendorReputation(source);
			const currency = vendorCurrency(source);
			if (reputation) return `Reputation: ${reputation} (${source.npcName})`;
			return `Vendor: ${source.npcName ?? 'unknown'}${currency ? ` (${currency})` : ''}`;
		}
		case 'pvp':
			return 'PvP reward';
		default:
			return 'Source unknown';
	}
}

export const wowheadItemUrl = (id: number) => `https://www.wowhead.com/forever/item=${id}`;
export const wowheadSpellUrl = (id: number) => `https://www.wowhead.com/forever/spell=${id}`;
/** An enchanter's enchant is a spell on Wowhead; a kit, oil or arcanum is the item that applies it. */
export const wowheadEnchantUrl = (enchant: { name: string; itemId?: number; spellId?: number }) =>
	enchant.spellId && (enchant.name.startsWith('Enchant ') || !enchant.itemId) ? wowheadSpellUrl(enchant.spellId) : enchant.itemId ? wowheadItemUrl(enchant.itemId) : undefined;
