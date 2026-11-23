import type { Character } from '../types';
import type { SimOutcome } from './request';
import { HEALING_PRESSURES, healingChoice } from './healing';
import type { RotationLine } from './setup';

/**
 * Prayer of Mending, worked out by hand. TEMPORARY: the WoWSims engine (wowsims/forever 7322fc0
 * and c83d90c) stops with "CritDamageMultiplier() called for {SpellID: 1240827} which has no
 * DefenseType" when the spell is cast, so the simulator cannot play it. Until that is fixed
 * upstream, its healing is added on top of the simulator's number with the spell's own data
 * (sim/core/spelldata/spells_auto_gen.go). Once the engine can cast it: put it into the rotation
 * in healing.ts and delete this file and everything that uses it.
 */
export const MENDING = {
	/** Healing per jump before healing power, by the spell id of the highest rank the character knows. */
	base: { 401859: 172, 1240826: 298, 1240827: 413 } as Record<number, number>,
	/** Part of the healing power each jump gets. */
	coefficient: 0.429,
	jumps: 5,
	/** Seconds. */
	cooldown: 10,
	globalCooldown: 1.5,
};

/** Where the talent sits in the talent string: the last talent of the Holy tree (the second tree). */
const TALENT = { tree: 1, index: 16 };

export const hasMendingTalent = (talents: string | undefined) => Number(talents?.split('-')[TALENT.tree]?.[TALENT.index] ?? 0) > 0;

/**
 * Whether the estimate is counted for this character: it has the talent and has not switched it
 * off. A character without talents of its own plays with the build's (`presetTalents`).
 */
export const countsMending = (character: Pick<Character, 'talents' | 'healing'>, presetTalents?: string) => hasMendingTalent(character.talents || presetTalents) && character.healing?.mending !== false;

/** The part of the fight spent casting in the character's scenario, 0 to 1. */
export function castingShare(character: Pick<Character, 'healing'>): number {
	const pressure = HEALING_PRESSURES.find(p => p.id === healingChoice(character).pressure)!;
	return 1 - pressure.pause / 10;
}

/** The part of all other healing that gives way: one global cooldown in every cooldown of the spell. */
export const MENDING_DISPLACED = MENDING.globalCooldown / MENDING.cooldown;

export interface MendingEstimate {
	/** Healing per second gained over the simulator's number, the displaced casts already taken off. */
	hps: number;
	/** Healing of one cast with all its jumps. */
	perCast: number;
	healingPower: number;
	/** Chance to crit, 0 to 1. */
	crit: number;
	/** Healing per second of the spell itself. */
	gross: number;
	/** Healing per second of other spells that its casts take the place of. */
	displaced: number;
}

/**
 * The estimate: cast on cooldown while casting, every jump heals for its full amount, a crit
 * heals for half more. Each cast takes one global cooldown from the other spells, so that part of
 * the simulated healing is taken off. Not counted: talents that raise all healing, the mana it
 * costs (about what the displaced cast would have cost), and jumps that find nobody hurt.
 */
export function mendingEstimate(base: number, healingPower: number, crit: number, simulatedHps: number, casting: number): MendingEstimate {
	const perCast = MENDING.jumps * (base + MENDING.coefficient * healingPower) * (1 + crit / 2);
	const gross = (casting * perCast) / MENDING.cooldown;
	const displaced = MENDING_DISPLACED * simulatedHps;
	return { hps: Math.max(0, gross - displaced), perCast, healingPower, crit, gross, displaced };
}

const HEALING_POWER = 4;
const SPELL_CRIT_PERCENT = 15;

/** Reads the simulator's character stats (its computeStats answer) into an estimate; undefined when the character does not know the spell. */
export function readMending(statsJson: string | null | undefined, simulatedHps: number, casting: number): MendingEstimate | undefined {
	if (!statsJson) return undefined;
	const player = JSON.parse(statsJson).raidStats?.parties?.[0]?.players?.[0];
	const known: number[] = (player?.metadata?.spells ?? []).map((s: { id?: { spellId?: number } }) => s.id?.spellId);
	// The engine lists every rank the character knows; the highest one is cast.
	const ranks = known.filter(id => id !== undefined && id in MENDING.base);
	if (ranks.length === 0) return undefined;
	const rank = ranks.reduce((best, id) => (MENDING.base[id] > MENDING.base[best] ? id : best));
	const healingPower = Number(player.finalStats?.stats?.[HEALING_POWER] ?? 0);
	const crit = Number(player.finalStats?.pseudoStats?.[SPELL_CRIT_PERCENT] ?? 0) / 100;
	return mendingEstimate(MENDING.base[rank], healingPower, crit, simulatedHps, casting);
}

/**
 * Stat weights with the estimate in them: everything measured gives way by the displaced part,
 * and healing power gains what the spell's jumps make of a point.
 */
export function mendingWeights(weights: Record<string, number>, casting: number): Record<string, number> {
	const scaled = Object.fromEntries(Object.entries(weights).map(([stat, value]) => [stat, value * (1 - MENDING_DISPLACED)]));
	scaled.healingPower = (scaled.healingPower ?? 0) + (casting * MENDING.jumps * MENDING.coefficient) / MENDING.cooldown;
	return scaled;
}

/** The highest rank, for the name, icon and tooltip of the estimate's row. */
export const MENDING_SPELL = { spellId: 1240827, rank: 3 };

/**
 * The simulator's outcome with the estimate worked in everywhere: the total, the spread of
 * fights, and the table per spell, where the other spells give way by the displaced part and
 * Prayer of Mending gets a row of its own, marked as an estimate.
 */
export function withMending(outcome: SimOutcome, mending: MendingEstimate | undefined, casting: number): SimOutcome {
	if (!mending || mending.hps <= 0) return outcome;
	const result: SimOutcome = { ...outcome, dps: outcome.dps + mending.hps, mending };
	const breakdown = outcome.breakdown;
	if (!breakdown) return result;
	const keep = 1 - MENDING_DISPLACED;
	const casts = (casting * breakdown.seconds) / MENDING.cooldown;
	const rows = [
		...breakdown.actions.map(row => ({ ...row, casts: row.casts * keep, damage: row.damage * keep, hits: row.hits * keep, dps: row.dps * keep })),
		{ id: MENDING_SPELL, casts, damage: mending.gross * breakdown.seconds, hits: casts * MENDING.jumps, dpet: mending.perCast / MENDING.globalCooldown, dps: mending.gross, share: 0, crit: mending.crit, estimate: true },
	].sort((a, b) => b.damage - a.damage);
	const total = rows.reduce((sum, row) => sum + row.damage, 0) || 1;
	result.breakdown = {
		...breakdown,
		min: breakdown.min + mending.hps,
		max: breakdown.max + mending.hps,
		histogram: breakdown.histogram.map(([bucket, fights]): [number, number] => [bucket + mending.hps, fights]),
		actions: rows.map(row => ({ ...row, share: row.damage / total })),
	};
	return result;
}

/** The step the estimate stands for, for the rotation list: first in line, since it is cast whenever it is ready. */
export const MENDING_STEP: RotationLine = {
	text: `Heal a group member with \u27e6s:${MENDING_SPELL.spellId}|Prayer of Mending\u27e7`,
	when: `it is ready (every ${MENDING.cooldown} seconds)`,
	estimate: true,
};
