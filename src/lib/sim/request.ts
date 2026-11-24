import { applyHealingFight, healingChoice } from './healing';
import type { MendingEstimate } from './mending';
import type { Gear } from '../scoring';
import { specOf } from '../specs';
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

/** True for a request whose player is a healer spec of the simulator. */
export const isHealer = (request: SimTemplate): boolean => Object.keys(request.raid.parties[0].players[0]).some(key => /^(healer|holy|restoration)/i.test(key));

/**
 * The build's settings with those of the character's WoWSims import in their place, where it has one for this
 * build: what the import does not name is off, as on wowsims.com, not left at the build's own pick.
 */
export function withSimSettings<T extends SimTemplate>(template: T, character: Character): T {
	const own = character.simSettings;
	if (!own || own.specId !== specOf(character).id) return template;
	const request = structuredClone(template);
	const party = request.raid.parties[0];
	const player = party.players[0];
	party.players[0] = { ...player, ...structuredClone(own.player), equipment: player.equipment } as typeof player;
	if (own.raidBuffs) request.raid.buffs = structuredClone(own.raidBuffs);
	if (own.debuffs) request.raid.debuffs = structuredClone(own.debuffs);
	if (own.partyBuffs) party.buffs = structuredClone(own.partyBuffs);
	if (own.encounter) request.encounter = structuredClone(own.encounter);
	return request;
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
	// The enemy kind and terrain: the sim then counts the gear's bonuses against them.
	const encounter = request.encounter as { targets?: Record<string, unknown>[]; areaTypes?: string[] } | undefined;
	if (encounter && character.fight?.mobType) for (const target of encounter.targets ?? []) target.mobType = `MobType${character.fight.mobType}`;
	if (encounter && character.fight?.family) for (const target of encounter.targets ?? []) target.creatureFamily = `CreatureFamily${character.fight.family}`;
	if (encounter && character.fight?.area) encounter.areaTypes = [`AreaType${character.fight.area}`];
	// A healer's fight and rotation are the planner's own scenario; WoWSims ships none.
	if (isHealer(request)) applyHealingFight(request, healingChoice(character));
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
	const request = structuredClone(withSimSettings(template, character)) as SimTemplate & { simOptions?: unknown };
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
	/** Damage per fight, on average. */
	damage: number;
	/** Hits and ticks that landed per fight, on average. */
	hits: number;
	/** Damage per second of cast time; undefined for effects without one. */
	dpet?: number;
	/** The largest single hit or tick seen in any fight, crits included. */
	maxHit?: number;
	/** Worked out by hand, not played by the simulator (Prayer of Mending, mending.ts). */
	estimate?: boolean;
}

export interface SimAuraRow {
	id: SimActionId;
	/** Part of the fight the effect was up, 0 to 1. */
	uptime: number;
	/** How often it was gained per fight. */
	procs: number;
	/** Gains per minute. */
	ppm: number;
}

/** One line of the Casts table: how often something was cast or swung per fight. */
export interface SimCastRow {
	id: SimActionId;
	pet?: string;
	casts: number;
	/** Casts per minute. */
	cpm: number;
}

/** One source of a resource (mana, rage, energy, combo points, health): what it gave or cost per fight. */
export interface SimResourceRow {
	id: SimActionId;
	/** How often it gave or took the resource, per fight. */
	events: number;
	/** What it gave per fight; negative for a cost. */
	gain: number;
	perSecond: number;
	/** Per event. */
	average: number;
	/** The part that went over the cap. */
	wasted: number;
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
	/** Casts per minute, damaging or not. */
	apm: number;
	/** How many fights ended in each DPS bucket: [lower edge of the bucket, fights]. */
	histogram: [dps: number, fights: number][];
	actions: SimActionRow[];
	/** Buffs and procs on the character. */
	auras: SimAuraRow[];
	/** Debuffs on the target. */
	targetAuras: SimAuraRow[];
	/** Everything cast or swung, damaging or not, most often first. */
	casts: SimCastRow[];
	/** Per resource, where it came from and went. */
	resources: { type: string; rows: SimResourceRow[] }[];
}

export interface SimOutcome {
	/** Damage per second; for a healer, healing per second (see `healing`). */
	dps: number;
	/** True when `dps` and the breakdown are healing. */
	healing?: boolean;
	/** Standard error of the average: about two thirds of runs land within this of the true value. */
	error: number;
	iterations: number;
	breakdown?: SimBreakdown;
	/** Prayer of Mending, added to `dps` by hand because the engine cannot cast it (mending.ts). */
	mending?: MendingEstimate;
}

type RawAction = { id: SimActionId; targets?: (Record<string, number> & { ranges?: Record<string, { max?: number }> })[] };
type RawAura = { id: SimActionId; uptimeSecondsAvg?: number; procsAvg?: number };
type RawResource = { id: SimActionId; type?: string; events?: number; gain?: number; actualGain?: number };
type RawUnit = { name?: string; actions?: RawAction[]; auras?: RawAura[]; resources?: RawResource[]; pets?: RawUnit[]; secondsOomAvg?: number };

function readBreakdown(result: any, iterations: number, healing = false): SimBreakdown | undefined {
	const dps = healing ? result.raidMetrics?.hps : result.raidMetrics?.dps;
	const player: RawUnit | undefined = result.raidMetrics?.parties?.[0]?.players?.[0];
	const seconds: number = result.avgIterationDuration;
	if (!player || !seconds) return undefined;
	const rows: SimActionRow[] = [];
	const castRows: SimCastRow[] = [];
	let allCasts = 0;
	const collect = (unit: RawUnit, pet?: string) => {
		for (const action of unit.actions ?? []) {
			const sum = (field: string) => (action.targets ?? []).reduce((total, target) => total + ((target[field] as number | undefined) ?? 0), 0);
			const maxHit = Math.max(0, ...(action.targets ?? []).flatMap(target => Object.values(target.ranges ?? {}).map(range => range.max ?? 0)));
			// For a healer the rows are healing done, shields included.
			const damage = healing ? sum('healing') + sum('shielding') : sum('damage');
			if (!pet) allCasts += sum('casts');
			if (sum('casts') > 0) castRows.push({ id: action.id, ...(pet ? { pet } : {}), casts: sum('casts') / iterations, cpm: sum('casts') / iterations / (seconds / 60) });
			if (damage <= 0) continue;
			const landed = sum('hits') + sum('crits') + sum('ticks') + sum('critTicks');
			const casts = sum('casts');
			rows.push({
				id: action.id,
				...(pet ? { pet } : {}),
				casts: casts / iterations,
				damage: damage / iterations,
				hits: landed / iterations,
				...(sum('castTimeMs') > 0 ? { dpet: damage / (sum('castTimeMs') / 1000) } : {}),
				...(maxHit > 0 && !healing ? { maxHit } : {}),
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
			.map(aura => ({ id: aura.id, uptime: Math.min(1, (aura.uptimeSecondsAvg ?? 0) / seconds), procs: aura.procsAvg ?? 0, ppm: (aura.procsAvg ?? 0) / (seconds / 60) }))
			.filter(aura => aura.uptime > 0.001)
			.sort((x, y) => y.uptime - x.uptime);
	// Resources come as totals over all fights: per type, gains first, then costs.
	const byType = new Map<string, SimResourceRow[]>();
	for (const raw of player.resources ?? []) {
		const type = String(raw.type ?? '').replace(/^ResourceType/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
		const events = (raw.events ?? 0) / iterations;
		const gain = (raw.gain ?? 0) / iterations;
		if (!type || (!events && !gain)) continue;
		const list = byType.get(type) ?? byType.set(type, []).get(type)!;
		list.push({ id: raw.id, events, gain, perSecond: gain / seconds, average: events ? gain / events : 0, wasted: gain > 0 ? Math.max(0, gain - (raw.actualGain ?? raw.gain ?? 0) / iterations) : 0 });
	}
	const resources = [...byType.entries()].map(([type, list]) => ({ type, rows: list.sort((x, y) => y.gain - x.gain) }));
	return {
		min: dps.min,
		max: dps.max,
		stdev: dps.stdev ?? 0,
		seconds,
		oomSeconds: player.secondsOomAvg ?? 0,
		apm: allCasts / iterations / (seconds / 60),
		histogram: Object.entries((dps.hist ?? {}) as Record<string, number>)
			.map(([bucket, fights]): [number, number] => [Number(bucket), fights])
			.sort((x, y) => x[0] - y[0]),
		actions: rows.sort((x, y) => y.damage - x.damage).map(row => ({ ...row, share: row.damage / total })),
		auras: auras(player.auras),
		targetAuras: auras(result.encounterMetrics?.targets?.[0]?.auras),
		casts: castRows.sort((x, y) => y.casts - x.casts),
		resources,
	};
}

/** One row's name in a timeline: the same for a result row and for a line of the fight log. */
export const actionKey = (id: SimActionId): string => (id.spellId ? `s${id.spellId}` : id.itemId ? `i${id.itemId}` : `o${id.otherId ?? ''}`) + `:${id.tag ?? 0}`;

/** The simulator's numbers for the actions that are neither spell nor item, as its fight log prints them. */
const OTHER_BY_NUMBER: Record<string, string> = { 3: 'OtherActionAttack', 4: 'OtherActionShoot', 7: 'OtherActionPet' };
/** The other numbered actions of the log, named for the reader only. */
const OTHER_NAMES: Record<string, string> = { 1: 'OtherActionWait', 2: 'OtherActionManaRegen', 5: 'OtherActionEnergyRegen', 6: 'OtherActionFocusRegen', 8: 'OtherActionRefund', 9: 'OtherActionDamageTaken', 10: 'OtherActionHealingModel', 11: 'OtherActionBloodRuneGain', 12: 'OtherActionFrostRuneGain', 13: 'OtherActionUnholyRuneGain', 14: 'OtherActionDeathRuneGain', 15: 'OtherActionPotion', 16: 'OtherActionExplosives', 17: 'OtherActionOffensiveEquip', 18: 'OtherActionDefensiveEquip' };

/** One fight, second by second: what each damage source did in each slice of time. */
export interface SimTimeline {
	/** Length of one slice in seconds. */
	slice: number;
	/** Length of the fight in seconds. */
	seconds: number;
	/** actionKey -> damage (or healing) per second in each slice. */
	series: Record<string, number[]>;
	/** Every cast of the fight, by what was cast: the moments it started, in seconds. */
	casts: { id: SimActionId; times: number[]; /** True for something the player presses: it costs a resource or the global cooldown, or it is used only a few times (a cooldown, a potion). */ pressed: boolean }[];
	/** Every line of the fight log, in order. `text` keeps the engine's {SpellID: 1} marks; LOG_TOKEN finds them. */
	log: { time: number; who: string; text: string }[];
	/** When each effect was up: on the player, or on the target. */
	auras: { id: SimActionId; target: boolean; spans: [start: number, end: number][] }[];
	/** How full each resource was over the fight: [time, value] at every change. */
	resources: { name: string; max: number; points: [time: number, value: number][] }[];
}

/** An action as the fight log prints it. */
export const LOG_TOKEN = /\{(SpellID|ItemID|OtherID): (\d+)(?:, Tag: (-?\d+))?[^}]*\}/g;
/** The action a mark of the fight log names. */
export const logAction = (kind: string, id: string, tag?: string): SimActionId => ({ ...(kind === 'SpellID' ? { spellId: Number(id) } : kind === 'ItemID' ? { itemId: Number(id) } : { otherId: OTHER_BY_NUMBER[id] ?? OTHER_NAMES[id] ?? id }), ...(tag && tag !== '0' ? { tag: Number(tag) } : {}) });
const SPLIT_LINE = /^\[(-?[\d.]+)\] \[([^\]]+)\] (.*)$/;
const AURA_LINE = /^Aura (gained|faded): \{(SpellID|ItemID|OtherID): (\d+)(?:, Tag: (-?\d+))?[^}]*\}/;
const RESOURCE_LINE = /^(?:Gained|Spent) [\d.]+ ([a-z ]+?) from .*\((-?[\d.]+) --> (-?[\d.]+)\)(?: of ([\d.]+) total)?/;

const CAST_LINE = /^\[(-?[\d.]+)\] \[([^\]]+)\] Casting \{(SpellID|ItemID|OtherID): (\d+)(?:, Tag: (-?\d+))?[^}]*\}(?: \(Cost = ([\d.]+), Cast Time = [^,]*, GCD = ([\d.]+))?/;
const LOG_LINE = /^\[(-?[\d.]+)\] \[([^\]]+)\] \[[^\]]+\] \{(SpellID|ItemID|OtherID): (\d+)(?:, Tag: (-?\d+))?[^}]*\} (?:tick )?\w+ for ([\d.]+) (damage|healing)/;

/** Reads the log of one simulated fight (simOptions.debug) into a timeline. */
export function readTimeline(json: string | null | undefined, healing = false, slice = 5): SimTimeline | undefined {
	if (!json) return undefined;
	const result = JSON.parse(json);
	const seconds: number = result.firstIterationDuration ?? result.avgIterationDuration;
	if (typeof result.logs !== 'string' || !seconds) return undefined;
	const slices = Math.max(1, Math.ceil(seconds / slice));
	const series: Record<string, number[]> = {};
	const casts = new Map<string, { id: SimActionId; times: number[]; free: boolean }>();
	const log: SimTimeline['log'] = [];
	const auraRows = new Map<string, { id: SimActionId; target: boolean; spans: [number, number][]; open?: number }>();
	const resourceRows = new Map<string, { name: string; max: number; points: [number, number][] }>();
	for (const line of result.logs.split('\n')) {
		const parts = SPLIT_LINE.exec(line);
		if (parts) {
			const at = Number(parts[1]);
			const who = parts[2];
			const text = parts[3];
			log.push({ time: at, who, text });
			const aura = AURA_LINE.exec(text);
			if (aura) {
				const id = logAction(aura[2], aura[3], aura[4]);
				const target = who.startsWith('Target');
				const key = `${target ? 't' : 'p'}${actionKey(id)}`;
				const row = auraRows.get(key) ?? auraRows.set(key, { id, target, spans: [] }).get(key)!;
				const now = Math.max(0, at);
				if (aura[1] === 'gained') row.open ??= now;
				else if (row.open !== undefined) {
					if (now > row.open) row.spans.push([row.open, now]);
					row.open = undefined;
				}
			} else if (!who.startsWith('Target')) {
				const change = RESOURCE_LINE.exec(text);
				if (change) {
					const name = change[1].trim();
					const row = resourceRows.get(name) ?? resourceRows.set(name, { name, max: 0, points: [] }).get(name)!;
					row.max = Math.max(row.max, Number(change[4] ?? 0), Number(change[2]), Number(change[3]));
					if (row.points.length === 0) row.points.push([Math.max(0, at), Number(change[2])]);
					row.points.push([Math.max(0, at), Number(change[3])]);
				}
			}
		}
		const cast = CAST_LINE.exec(line);
		if (cast) {
			const [, time, source, kind, id, tag, cost, gcd] = cast;
			if (source.startsWith('Target') || Number(time) < 0) continue;
			const action: SimActionId = { ...(kind === 'SpellID' ? { spellId: Number(id) } : kind === 'ItemID' ? { itemId: Number(id) } : { otherId: OTHER_BY_NUMBER[id] ?? id }), ...(tag ? { tag: Number(tag) } : {}) };
			const key = actionKey(action);
			if (!casts.has(key)) casts.set(key, { id: action, times: [], free: true });
			const row = casts.get(key)!;
			row.times.push(Number(time));
			if (Number(cost ?? 0) > 0 || Number(gcd ?? 0) > 0) row.free = false;
			continue;
		}
		const match = LOG_LINE.exec(line);
		if (!match) continue;
		const [, time, source, kind, id, tag, amount, what] = match;
		// What the enemy does to the player is not the player's damage.
		if (source.startsWith('Target') || (what === 'healing') !== healing) continue;
		const at = Number(time);
		if (at < 0 || at > seconds) continue;
		const key = (kind === 'SpellID' ? `s${id}` : kind === 'ItemID' ? `i${id}` : `o${OTHER_BY_NUMBER[id] ?? id}`) + `:${tag ?? 0}`;
		const row = (series[key] ??= new Array<number>(slices).fill(0));
		row[Math.min(slices - 1, Math.floor(at / slice))] += Number(amount) / slice;
	}
	// Attacks and procs are "cast" by the engine too. What costs nothing, skips the global cooldown and still happens all the time is a proc.
	const rows = [...casts.values()].map(({ id, times, free }) => ({ id, times, pressed: !id.otherId && (!free || times.length <= 8) }));
	// What is still up when the fight ends was up until the end.
	const auras = [...auraRows.values()].map(({ id, target, spans, open }) => ({ id, target, spans: open !== undefined && open < seconds ? [...spans, [open, seconds] as [number, number]] : spans })).filter(row => row.spans.length > 0);
	return { slice, seconds, series, casts: rows.sort((x, y) => Number(y.pressed) - Number(x.pressed) || y.times.length - x.times.length), log, auras, resources: [...resourceRows.values()].filter(row => row.points.length > 1) };
}

/** Reads the sim's JSON answer. Throws with the sim's message when it reports an error. */
export function readSimResult(json: string | null | undefined, iterations: number, healing = false): SimOutcome {
	if (!json) throw new Error('The simulator rejected the request.');
	const result = JSON.parse(json);
	const failure = result.error ?? result.errorResult;
	if (failure && (typeof failure !== 'object' || Object.keys(failure).length > 0)) {
		throw new Error(typeof failure === 'string' ? failure : (failure.message ?? JSON.stringify(failure)));
	}
	const dps = healing ? result.raidMetrics?.hps : result.raidMetrics?.dps;
	if (typeof dps?.avg !== 'number') throw new Error(healing ? 'The simulator returned no healing.' : 'The simulator returned no DPS.');
	return { dps: dps.avg, error: (dps.stdev ?? 0) / Math.sqrt(iterations), iterations, ...(healing ? { healing: true } : {}), breakdown: readBreakdown(result, iterations, healing) };
}

/** The simulator's remarks per rotation step, in the order of the rotation file (hidden steps included). */
export interface RotationChecks {
	prepull: string[][];
	priority: string[][];
	groups: string[][][];
}

/** Reads the rotation checks out of the simulator's character report. Informational lines are left out. */
export function readRotationChecks(json: string | null | undefined): RotationChecks {
	if (!json) throw new Error('The simulator rejected the request.');
	const stats = JSON.parse(json)?.raidStats?.parties?.[0]?.players?.[0]?.rotationStats ?? {};
	type Step = { validations?: { logLevel?: string; validation?: string }[] };
	const warnings = (step: Step) => [...new Set((step.validations ?? []).filter(v => v.logLevel !== 'Information' && v.validation).map(v => v.validation!))];
	const list = (steps: Step[] | undefined) => (steps ?? []).map(warnings);
	return { prepull: list(stats.prepullActions), priority: list(stats.priorityList), groups: (stats.groups ?? []).map((group: { actions?: Step[] }) => list(group.actions)) };
}

/** Identifies a run, so the same gear is never simulated twice. */
export const simKey = (character: Character, gear: Gear, iterations: number, bonus?: BonusStats) =>
	JSON.stringify([bonus ?? 0, character.specId ?? '', character.simSettings?.id ?? 0, character.race, character.talents, character.consumables ?? 0, character.buffs ?? 0, character.fight ?? 0, character.healing ?? 0, character.professions, gear.map(p => (p ? [p.id, p.enchant ?? 0, p.randomSuffix ?? 0] : 0)), iterations]);
