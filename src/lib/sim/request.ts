import type { Gear } from '../scoring';
import type { Character } from '../types';

/** Raw records in the shape the sim's protobuf takes. Only the fields used here are typed. */
export interface SimDb {
	items: { id: number; scalingOptions?: Record<string, { ilvl?: number }> }[];
	enchants: { effectId: number; type?: number; extraTypes?: number[] }[];
	randomSuffixes: { id: number }[];
	itemEffectRandPropPoints: { ilvl: number }[];
	consumables: unknown[];
	spellEffects: unknown[];
}

/** A sim request with one player; everything except the player's gear and identity comes from the sim's defaults. */
export interface SimTemplate {
	raid: { parties: { players: Record<string, any>[]; buffs: unknown }[]; numActiveParties: number; buffs: unknown; debuffs: unknown };
	encounter: unknown;
	type: string;
}

export interface SimIndex {
	db: SimDb;
	itemById: Map<number, SimDb['items'][number]>;
	template: SimTemplate;
}

export const indexSimDb = (db: SimDb, template: SimTemplate): SimIndex => ({ db, template, itemById: new Map(db.items.map(i => [i.id, i])) });

export interface BuiltRequest {
	request: Record<string, unknown>;
	/** Item ids the sim has no data for; they are left out of the request. */
	missingItems: number[];
}

/** Puts the character's race, professions, talents, consumables and buffs over the build's own. */
function personalize(request: SimTemplate, character: Character): void {
	const player = request.raid.parties[0].players[0];
	if (character.race) player.race = character.race;
	if (character.talents) player.talentsString = character.talents;
	if (character.consumables) player.consumables = { ...player.consumables, ...character.consumables };
	if (character.buffs) {
		const party = request.raid.parties[0];
		request.raid.buffs = { ...(request.raid.buffs as object), ...character.buffs.raid };
		request.raid.debuffs = { ...(request.raid.debuffs as object), ...character.buffs.debuffs };
		party.buffs = { ...(party.buffs as object), ...character.buffs.party };
		player.buffs = { ...player.buffs, ...character.buffs.player };
	}
	player.profession1 = character.professions[0] ?? 'ProfessionUnknown';
	player.profession2 = character.professions[1] ?? 'ProfessionUnknown';
}

/**
 * The same settings in the form wowsims.com imports and exports ("Import" > "JSON"): buffs, debuffs,
 * the player with gear, talents, consumables and rotation, and the fight. Pasting it there runs the
 * sim this page runs, on their copy of the simulator.
 */
export function wowsimsSettings(character: Character, gear: Gear, template: SimTemplate): Record<string, unknown> {
	const request = structuredClone(template);
	personalize(request, character);
	const party = request.raid.parties[0];
	const player = party.players[0];
	player.equipment = { items: gear.map(piece => piece ?? {}) };
	return { apiVersion: 2, raidBuffs: request.raid.buffs, partyBuffs: party.buffs, debuffs: request.raid.debuffs, player, encounter: request.encounter };
}

/**
 * The request the WoWSims sim takes: the default settings (buffs, rotation, consumables, a
 * raid target) with this character's race, professions, talents and the given gear.
 */
/** Extra stats put on the character for one run, by the simulator's stat numbers: how a stat's worth is measured. */
export interface BonusStats {
	stats?: Record<number, number>;
	pseudoStats?: Record<number, number>;
}

export function buildSimRequest(character: Character, gear: Gear, index: SimIndex, iterations: number, bonus?: BonusStats): BuiltRequest {
	const { db, template, itemById } = index;
	const request = structuredClone(template) as SimTemplate & { simOptions?: unknown };
	const player = request.raid.parties[0].players[0];

	personalize(request, character);
	if (bonus) {
		const fill = (base: number[] | undefined, extra: Record<number, number> | undefined, length: number) => {
			const list = Array.from({ length: Math.max(length, base?.length ?? 0) }, (_, i) => base?.[i] ?? 0);
			for (const [key, value] of Object.entries(extra ?? {})) list[Number(key)] = (list[Number(key)] ?? 0) + value;
			return list;
		};
		player.bonusStats = { ...player.bonusStats, stats: fill(player.bonusStats?.stats, bonus.stats, 39), pseudoStats: fill(player.bonusStats?.pseudoStats, bonus.pseudoStats, 3) };
	}

	const missingItems: number[] = [];
	player.equipment = {
		items: gear.map(piece => {
			if (!piece) return {};
			if (!itemById.has(piece.id)) {
				missingItems.push(piece.id);
				return {};
			}
			return piece;
		}),
	};

	// The sim carries no item data of its own: attach every record this request refers to.
	const swapPieces: { id?: number; enchant?: number; randomSuffix?: number }[] = player.itemSwap?.items ?? [];
	const pieces = [...(player.equipment.items as typeof swapPieces), ...swapPieces].filter(p => p.id && itemById.has(p.id));
	const items = [...new Set(pieces.map(p => p.id!))].map(id => itemById.get(id)!);
	const enchantIds = new Set(pieces.map(p => p.enchant).filter(Boolean));
	const suffixIds = new Set(pieces.map(p => p.randomSuffix).filter(Boolean));
	const ilvls = new Set(items.map(i => i.scalingOptions?.['0']?.ilvl));
	player.database = {
		items,
		enchants: db.enchants.filter(e => enchantIds.has(e.effectId)),
		randomSuffixes: db.randomSuffixes.filter(s => suffixIds.has(s.id)),
		itemEffectRandPropPoints: db.itemEffectRandPropPoints.filter(r => ilvls.has(r.ilvl)),
		consumables: db.consumables,
		spellEffects: db.spellEffects,
	};

	// A fixed seed keeps two runs comparable: much of the random noise cancels out between them.
	request.simOptions = { iterations, randomSeed: '1' };
	return { request: request as unknown as Record<string, unknown>, missingItems };
}

/** A spell, item or other action as the sim names it. */
export interface SimActionId {
	spellId?: number;
	itemId?: number;
	otherId?: string;
	rank?: number;
	tag?: number;
}

export interface SimActionRow {
	id: SimActionId;
	/** Set when a pet does it. */
	pet?: string;
	/** Per fight, on average. */
	casts: number;
	dps: number;
	/** Part of all damage, 0 to 1. */
	share: number;
	/** Crits among everything that landed, 0 to 1. */
	crit: number;
	/** Misses per cast, 0 to 1; undefined for effects that are not cast. */
	miss?: number;
}

export interface SimAuraRow {
	id: SimActionId;
	/** Part of the fight the effect was up, 0 to 1. */
	uptime: number;
}

/** What a run is made of, beyond its average. */
export interface SimBreakdown {
	min: number;
	max: number;
	stdev: number;
	/** Average fight length in seconds. */
	seconds: number;
	/** Seconds per fight spent out of mana. */
	oomSeconds: number;
	actions: SimActionRow[];
	/** Buffs and procs on the character. */
	auras: SimAuraRow[];
	/** Debuffs on the target. */
	targetAuras: SimAuraRow[];
}

export interface SimOutcome {
	dps: number;
	/** Standard error of the average: about two thirds of runs land within this of the true value. */
	error: number;
	iterations: number;
	breakdown?: SimBreakdown;
}

type RawAction = { id: SimActionId; targets?: Record<string, number>[] };
type RawAura = { id: SimActionId; uptimeSecondsAvg?: number };
type RawUnit = { name?: string; actions?: RawAction[]; auras?: RawAura[]; pets?: RawUnit[]; secondsOomAvg?: number };

function readBreakdown(result: any, iterations: number): SimBreakdown | undefined {
	const dps = result.raidMetrics?.dps;
	const player: RawUnit | undefined = result.raidMetrics?.parties?.[0]?.players?.[0];
	const seconds: number = result.avgIterationDuration;
	if (!player || !seconds) return undefined;
	const rows: (SimActionRow & { damage: number })[] = [];
	const collect = (unit: RawUnit, pet?: string) => {
		for (const action of unit.actions ?? []) {
			const sum = (field: string) => (action.targets ?? []).reduce((total, target) => total + (target[field] ?? 0), 0);
			const damage = sum('damage');
			if (damage <= 0) continue;
			const landed = sum('hits') + sum('crits') + sum('ticks') + sum('critTicks');
			const casts = sum('casts');
			rows.push({
				id: action.id,
				...(pet ? { pet } : {}),
				casts: casts / iterations,
				damage,
				dps: damage / iterations / seconds,
				share: 0,
				crit: landed ? (sum('crits') + sum('critTicks')) / landed : 0,
				...(casts ? { miss: Math.min(1, sum('misses') / casts) } : {}),
			});
		}
		for (const petUnit of unit.pets ?? []) collect(petUnit, petUnit.name ?? 'Pet');
	};
	collect(player);
	const total = rows.reduce((sum, row) => sum + row.damage, 0) || 1;
	const auras = (list: RawAura[] | undefined): SimAuraRow[] =>
		(list ?? [])
			.map(aura => ({ id: aura.id, uptime: Math.min(1, (aura.uptimeSecondsAvg ?? 0) / seconds) }))
			.filter(aura => aura.uptime > 0.001)
			.sort((x, y) => y.uptime - x.uptime);
	return {
		min: dps.min,
		max: dps.max,
		stdev: dps.stdev ?? 0,
		seconds,
		oomSeconds: player.secondsOomAvg ?? 0,
		actions: rows.sort((x, y) => y.damage - x.damage).map(({ damage, ...row }) => ({ ...row, share: damage / total })),
		auras: auras(player.auras),
		targetAuras: auras(result.encounterMetrics?.targets?.[0]?.auras),
	};
}

/** Reads the sim's JSON answer. Throws with the sim's message when it reports an error. */
export function readSimResult(json: string | null | undefined, iterations: number): SimOutcome {
	if (!json) throw new Error('The simulator rejected the request.');
	const result = JSON.parse(json);
	const failure = result.error ?? result.errorResult;
	if (failure && (typeof failure !== 'object' || Object.keys(failure).length > 0)) {
		throw new Error(typeof failure === 'string' ? failure : (failure.message ?? JSON.stringify(failure)));
	}
	const dps = result.raidMetrics?.dps;
	if (typeof dps?.avg !== 'number') throw new Error('The simulator returned no DPS.');
	return { dps: dps.avg, error: (dps.stdev ?? 0) / Math.sqrt(iterations), iterations, breakdown: readBreakdown(result, iterations) };
}

/** Identifies a run, so the same gear is never simulated twice. */
export const simKey = (character: Character, gear: Gear, iterations: number, bonus?: BonusStats) =>
	JSON.stringify([bonus ?? 0, character.specId ?? '', character.race, character.talents, character.consumables ?? 0, character.buffs ?? 0, character.professions, gear.map(p => (p ? [p.id, p.enchant ?? 0, p.randomSuffix ?? 0] : 0)), iterations]);
