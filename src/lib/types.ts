export type Faction = 'alliance' | 'horde';

export type SlotKind = 'head' | 'neck' | 'shoulder' | 'back' | 'chest' | 'wrist' | 'hands' | 'waist' | 'legs' | 'feet' | 'finger' | 'trinket' | 'weapon' | 'ranged';

export type Stats = Record<string, number>;

export interface ItemSource {
	kind: 'drop' | 'quest' | 'crafted' | 'rep' | 'vendor' | 'pvp' | 'unknown';
	zoneId?: number;
	npcId?: number;
	npcName?: string;
	otherName?: string;
	/** Not in any data: worked out from what the item is (see `applyLoot`). */
	assumed?: boolean;
	zoneKind?: 'dungeon' | 'raid' | 'world';
	/** Set when the data is loaded: the dungeon or dungeon wing a drop belongs to, e.g. "1583:Lower". */
	dungeonKey?: string;
	/** "Blackrock Spire: Lower" */
	dungeonName?: string;
	name?: string;
	questId?: number;
	profession?: string;
	spellId?: number;
	repFaction?: string;
	repLevel?: string;
	faction?: Faction;
	/** Share of kills or openings that gave this item, from Wowhead's loot records. */
	dropChance?: number;
	/** "forever": Wowhead's Forever loot records. "classic": the rate from WoW Classic, which Forever may have changed. */
	dropBasis?: 'forever' | 'classic';
	/** How many kills or openings the drop chance rests on. */
	dropSample?: number;
	/** Set for a boss that is not there on every run: the share of runs in which it is. */
	spawnChance?: number;
	/** Where the spawn chance comes from: the encounter's rules, Wowhead kill counts, or a guess. */
	spawnBasis?: 'mechanic' | 'kills' | 'estimate';
	spawnNote?: string;
}

export interface Item {
	id: number;
	name: string;
	icon?: string;
	slot: SlotKind;
	armorType?: string;
	rangedType?: string;
	quality: string;
	ilvl?: number;
	reqLvl?: number;
	stats?: Stats;
	weapon?: { type?: string; hand?: string; speed?: number; dps?: number; damageMin?: number; damageMax?: number };
	unique?: boolean;
	/** Stats that only count against these kinds of enemy. */
	versus?: { mobTypes: string[]; stats: Stats }[];
	/** Stats that only count in this kind of terrain. */
	inArea?: { area: string; stats: Stats }[];
	/** Every terrain, enemy type and creature the item's stats or effects name, procs and on-use effects included. */
	fightTags?: { areas?: string[]; mobTypes?: string[]; families?: string[] };
	/** Items with the same limit category cannot be worn together. */
	limitCategory?: number;
	/** Class ids that may use the item; unset = every class. */
	classes?: number[];
	faction?: Faction;
	requiredProfession?: string;
	/** WoWSims does not list the item as released (its "phase 2": later raids and events, old PvP ranks). */
	unreleased?: boolean;
	setId?: number;
	setName?: string;
	effects?: { name?: string; kind: string }[];
	/** The line under the name in the tooltip, when the item has one ("Crafted"). */
	tag?: string;
	randomSuffixOptions?: number[];
	/** Set when the data is loaded: the random suffix that is worth most to the spec, and its name ("of Shadow Wrath"). */
	bestSuffix?: number;
	bestSuffixName?: string;
	randPropPoints?: number;
	sources?: ItemSource[];
}

export interface Enchant {
	effectId: number;
	itemId?: number;
	spellId?: number;
	name: string;
	icon?: string;
	slots: SlotKind[];
	classes?: number[];
	quality?: string;
	/** Restricts a weapon enchant to two-handers, shields, staves or off-hand items. */
	only?: 'twoHand' | 'shield' | 'kit' | 'staff' | 'offHand';
	stats?: Stats;
	hasEffect?: boolean;
	sources?: ItemSource[];
}

/** One equipped item. `enchant` is the enchant's effectId, as in the exports. */
export interface GearPiece {
	id: number;
	enchant?: number;
	randomSuffix?: number;
}

/** The simulator's names, without their prefix: "Undead", "ForestGrassland". */
export interface Fight {
	mobType?: string;
	area?: string;
	/** A creature group inside an enemy type: "Orc", "Troll", "Murloc". */
	family?: string;
}

export interface Character {
	name?: string;
	/** The spec this character is planned as (src/specs). Unset on characters saved before there was a choice. */
	specId?: string;
	/** Race id from the spec config, e.g. "RaceDwarf". null until the user picks one. */
	race: string | null;
	level: number | null;
	talents: string;
	/** Consumables changed on the Sim setup tab. Missing fields keep the build's own picks. */
	consumables?: import('./sim/setup').ConsumablePicks;
	/** Buffs and debuffs changed on the Sim setup tab. Missing fields keep the build's own. */
	buffs?: import('./sim/setup').BuffPicks;
	/** A healer's spell mix and how much mana matters in the fight (src/lib/sim/healing.ts). Unset = the default scenario. */
	healing?: { style?: string; pressure?: string; /** False = leave the Prayer of Mending estimate out (src/lib/sim/mending.ts). */ mending?: boolean };
	/** What the character fights: an enemy kind and a terrain, for items that are only strong there. Unset = a plain raid target. */
	fight?: Fight;
	/** Up to two profession names. */
	professions: string[];
	/** Always GEAR_SLOTS.length entries, in GEAR_SLOTS order. null = empty slot. */
	gear: (GearPiece | null)[];
	/** What-if swaps on top of the equipped gear: slot index -> item id. */
	plan?: Record<number, number>;
	/** Enchants the plan aims for: slot index -> enchant effectId. They apply to the planned gear only. */
	planEnchants?: Record<number, number>;
}

export interface SpecConfig {
	id: string;
	name: string;
	classId: number;
	className: string;
	/** The key of this spec's options in a sim export ("enhancementShaman", "warlock" ...). */
	simKey: string;
	/** Healers are scored in healing per second over a fight, not in DPS. */
	role?: 'healer';
	/** A healer's stat weights for each scenario ("tank.balanced"), measured with the simulator on the preset gear. */
	healing?: { scenarios: Record<string, { hps: number; oomSeconds: number; weights: Record<string, number> }> };
	/** The name of the WoWSims preset configuration this build is. */
	preset?: string;
	/** The preset's talent string, used to tell the builds of one class apart on import. */
	talents?: string;
	races: { id: string; name: string; faction: Faction }[];
	armorTypes: string[];
	weaponTypes: { oneHand: string[]; twoHand: string[]; offHand: string[] };
	rangedTypes: string[];
	canDualWield: boolean;
	hitCapPercent: number;
	/** Hit the default talents of this build give on top of gear, in percent. */
	hitBonusPercent?: number;
	ratingPerPercent: Record<string, number>;
	/** Racials that change what gear is worth: hit that counts toward the cap, and stats the race multiplies (Human: 10% more Spirit). */
	raceBonuses: Record<string, { hitPercent?: number; statPercent?: Record<string, number> }>;
	/**
	 * 'twoHand': the main hand takes two-handers only and the off hand stays empty. 'either': a
	 * two-hander, or a one-hander with something in the off hand.
	 */
	/** Weapon types the build's main ability cannot do without, per hand (a Mutilate Rogue: daggers). Other types are not offered. */
	weaponNeeds?: { mainHand?: string[]; offHand?: string[]; why?: string };
	weaponSetup: 'twoHand' | 'oneHand' | 'either';
	/** The class's Tier 0.5 set, which pre-raid lists often show with and without. */
	tier05Set?: { setId: number; name: string };
	weights: {
		source: string;
		mainHandDps: number;
		/** DPS that one point of the spec file's own unit is worth; the loaded weights are already multiplied by it. */
		dpsPerPoint?: number;
		/** Worth of one point of off-hand weapon DPS, for dual wielders. */
		offHandDps?: number;
		/** Worth of one point of ranged weapon DPS, for Hunters. */
		rangedDps?: number;
		/** Value of hit rating beyond the cap. */
		hitRatingOverCap: number;
		stats: Record<string, number>;
	};
}

export interface RandomSuffix {
	id: number;
	name: string;
	/** Share of the item's randPropPoints per stat, in 1/10000. */
	stats: Stats;
}

export interface Zone {
	id: number;
	name: string;
	kind: 'dungeon' | 'raid' | 'world';
}

export interface Npc {
	id: number;
	name: string;
	zoneId?: number;
}

/** What the stat score cannot see, measured with the simulator (scripts/build-sim-values.mjs). In attack-power equivalents. */
export interface SimValues {
	/** Item id -> worth of its procs, on-use effects and special stats. */
	items: Map<number, number>;
	/** Enchant effectId -> worth of its proc or effect. */
	enchants: Map<number, number>;
	/** Set id -> piece count -> worth of the bonuses active at that count. */
	sets: Map<number, Map<number, number>>;
	/** What was measured at all; anything else with an effect is still unknown. */
	measuredItems: Set<number>;
	measuredEnchants: Set<number>;
	measuredSets: Set<number>;
	/**
	 * Weapons measured as a whole for this build (scripts/build-weapon-values.mjs): item id -> DPS per
	 * hand, against the weapon the build's preset holds there. Covers damage, speed, stats and proc.
	 */
	weapons?: WeaponValues;
}

export interface WeaponValues {
	byItem: Map<number, { mainHand?: number; offHand?: number; ranged?: number }>;
	/** The preset's weapons: the zero point of each hand. */
	reference: { mainHand?: number; offHand?: number; ranged?: number };
	/** What an empty off hand is worth next to a one-handed main hand (negative). */
	emptyOffHand?: number;
}
