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

/**
 * The request the WoWSims sim takes: the default settings (buffs, rotation, consumables, a
 * raid target) with this character's race, professions, talents and the given gear.
 */
export function buildSimRequest(character: Character, gear: Gear, index: SimIndex, iterations: number): BuiltRequest {
	const { db, template, itemById } = index;
	const request = structuredClone(template) as SimTemplate & { simOptions?: unknown };
	const player = request.raid.parties[0].players[0];

	if (character.race) player.race = character.race;
	if (character.talents) player.talentsString = character.talents;
	if (character.consumables) player.consumables = { ...player.consumables, ...character.consumables };
	player.profession1 = character.professions[0] ?? 'ProfessionUnknown';
	player.profession2 = character.professions[1] ?? 'ProfessionUnknown';

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

export interface SimOutcome {
	dps: number;
	/** Standard error of the average: about two thirds of runs land within this of the true value. */
	error: number;
	iterations: number;
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
	return { dps: dps.avg, error: (dps.stdev ?? 0) / Math.sqrt(iterations), iterations };
}

/** Identifies a run, so the same gear is never simulated twice. */
export const simKey = (character: Character, gear: Gear, iterations: number) =>
	JSON.stringify([character.specId ?? '', character.race, character.talents, character.consumables ?? 0, character.professions, gear.map(p => (p ? [p.id, p.enchant ?? 0, p.randomSuffix ?? 0] : 0)), iterations]);
