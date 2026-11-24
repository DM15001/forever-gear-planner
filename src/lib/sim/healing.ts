import type { Character } from '../types';

/**
 * The healing scenarios. WoWSims has the Priest's heals in its engine but ships no healing
 * rotation, so the rotations here are this planner's own: a spell mix (style) and a fight that
 * sets how much mana matters (pressure). The simulator then plays them out with the engine's own
 * spell data, talents, mana regeneration and consumables.
 */

export interface HealingChoice {
	style: string;
	pressure: string;
}

export const HEALING_STYLES: { id: string; label: string; hint: string }[] = [
	{ id: 'tank', label: 'Tank healing (Greater Heal)', hint: 'One target: Penance when ready, Renew kept up, Greater Heal in between.' },
	{ id: 'fast', label: 'Fast heals (Flash Heal)', hint: 'One target: Penance when ready, Renew kept up, Flash Heal in between. Quicker, but it costs more mana for the healing it does.' },
	{ id: 'group', label: 'Group healing (Prayer of Healing)', hint: 'A full group of five: Penance and Renew on one of them, Prayer of Healing in between. Its numbers count all five targets.' },
];

export const HEALING_PRESSURES: { id: string; label: string; hint: string; duration: number; pause: number }[] = [
	{ id: 'burst', label: 'Burst: 45 seconds, casting nonstop', hint: 'A heavy damage phase. With single-target heals the mana lasts, so raw output counts most: healing power, crit and haste. Prayer of Healing costs so much that mana matters even here.', duration: 45, pause: 0 },
	{ id: 'balanced', label: 'Normal fight: 5 minutes, casting half the time', hint: 'Mana gets tight towards the end, so output and mana both count.', duration: 300, pause: 5 },
	{ id: 'endurance', label: 'Long fight: 10 minutes, casting 70% of the time', hint: 'You are out of mana for part of the fight, so regeneration and mana pool decide.', duration: 600, pause: 3 },
];

export const DEFAULT_HEALING: HealingChoice = { style: 'tank', pressure: 'balanced' };

export function healingChoice(character: Pick<Character, 'healing'> | null | undefined): HealingChoice {
	const style = HEALING_STYLES.some(s => s.id === character?.healing?.style) ? character!.healing!.style! : DEFAULT_HEALING.style;
	const pressure = HEALING_PRESSURES.some(p => p.id === character?.healing?.pressure) ? character!.healing!.pressure! : DEFAULT_HEALING.pressure;
	return { style, pressure };
}

/** "tank.balanced": the key of a scenario's measured stat weights in a spec file. */
export const scenarioKey = (choice: HealingChoice) => `${choice.style}.${choice.pressure}`;

type Json = Record<string, unknown>;

/** The party member the single-target heals go to: the first player after the Priest. */
const ALLY = { type: 'Player', index: 1 };
const SELF = { type: 'Self' };
const spell = (spellId: number, rank: number, tag?: number) => ({ spellId, rank, ...(tag ? { tag } : {}) });
// Highest ranks at level 60. Penance's heal is the cast the engine files under its heal bolt, tag 1.
const RENEW = spell(25315, 10);
const GREATER_HEAL = spell(25314, 5);
const FLASH_HEAL = spell(10917, 7);
const PRAYER_OF_HEALING = spell(25316, 5);
const PENANCE = spell(1316991, 4, 1);

const cast = (spellId: Json, target: Json = ALLY, condition?: Json) => ({ action: { ...(condition ? { condition } : {}), castFriendlySpell: { spellId, target } } });
const renewIsDown = { not: { val: { dotIsActive: { targetUnit: ALLY, spellId: RENEW } } } };

const FILLERS: Record<string, Json> = {
	tank: cast(GREATER_HEAL),
	fast: cast(FLASH_HEAL),
	group: cast(PRAYER_OF_HEALING, SELF),
};

/** A pause of `pause` seconds in every ten, for the whole fight: how "casting 50% of the time" is played. */
function pauses(duration: number, pause: number): Json {
	const times = Array.from({ length: Math.floor((duration + 10) / 10) }, (_, i) => `${(i + 1) * 10}s`).join(', ');
	return { action: { schedule: { schedule: times, innerAction: { wait: { duration: { const: { val: `${pause}s` } } } } } } };
}

export interface HealingFight {
	/** Seconds. */
	duration: number;
	/** How many more players stand in the Priest's group, as targets. */
	partyMembers: number;
	rotation: Json;
}

/**
 * The fight and rotation of a scenario. Prayer of Mending is left out on purpose: the engine
 * (wowsims/forever 7322fc0 and c83d90c) stops with an error when it is cast as a heal. Until that
 * is fixed, mending.ts adds its healing as an estimate.
 */
export function healingFight(choice: HealingChoice): HealingFight {
	const pressure = HEALING_PRESSURES.find(p => p.id === choice.pressure) ?? HEALING_PRESSURES[1];
	const filler = FILLERS[choice.style] ?? FILLERS.tank;
	return {
		duration: pressure.duration,
		partyMembers: 4,
		rotation: {
			type: 'TypeAPL',
			prepullActions: [],
			priorityList: [...(pressure.pause ? [pauses(pressure.duration, pressure.pause)] : []), { action: { autocastOtherCooldowns: {} } }, cast(PENANCE), cast(RENEW, ALLY, renewIsDown), filler],
		},
	};
}

/** Puts a scenario's fight and rotation into a sim request whose first player is the healer. */
export function applyHealingFight(request: { raid: Record<string, any>; encounter: unknown }, choice: HealingChoice): void {
	const fight = healingFight(choice);
	request.raid.parties[0].players[0].rotation = fight.rotation;
	request.raid.targetDummies = fight.partyMembers;
	request.encounter = { ...(request.encounter as object), duration: fight.duration, durationVariation: 5 };
}
