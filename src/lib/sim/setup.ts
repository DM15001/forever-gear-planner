/**
 * What the simulator is given besides gear, in a form a person can read and change: talents,
 * consumables, buffs and the rotation. The data comes from the WoWSims build of each spec
 * (public/sim/template.<spec>.json) and from public/sim/setup.json.
 */

export interface TalentTree {
	name: string;
	talents: { name: string; max: number; row: number; col: number }[];
}

export type ConsumableKind = 'flask' | 'food' | 'elixir' | 'imbue' | 'weaponImbue' | 'potion' | 'conjured' | 'scroll' | 'explosive' | 'other';

export interface ConsumableOption {
	id: number;
	name: string;
	kind: ConsumableKind;
	level?: number;
	/** A potion that restores mana, rage or energy: what the rotation's "resource potion" step drinks. */
	resource?: boolean;
	/** What it buffs, e.g. "Agility". Two consumables with the same `groupKey` do not stack. */
	group?: string;
	groupKey?: string;
}

/** One buff or debuff the sim can be told about. */
export interface BuffField {
	key: string;
	label: string;
	/** Named levels above "off": the stored value is the position in this list, counted from 1. */
	steps?: string[];
	/** A plain count, e.g. how many of something the raid brings. */
	count?: boolean;
}

export type BuffScope = 'raid' | 'party' | 'player' | 'debuffs';
export const BUFF_SCOPES: { scope: BuffScope; title: string }[] = [
	{ scope: 'raid', title: 'Raid buffs' },
	{ scope: 'party', title: 'Party buffs' },
	{ scope: 'player', title: 'Buffs on you' },
	{ scope: 'debuffs', title: 'Debuffs on the target' },
];

/** Buffs and debuffs a character changed against the build: scope -> field -> value (false or 0 = off). */
export type BuffPicks = Partial<Record<BuffScope, Record<string, boolean | number>>>;

export interface SimSetupData {
	/** Talent trees by class name in lower case. */
	trees: Record<string, TalentTree[]>;
	spells: Record<string, string>;
	items: Record<string, string>;
	consumables: ConsumableOption[];
	/** The wowsims/forever commit the simulator copy was built from, and the day it was fetched. */
	simVersion?: { commit?: string; fetched?: string };
	/** Every buff and debuff the sim knows. */
	buffs?: Record<BuffScope, BuffField[]>;
}

/** The consumables a character can change. A missing field keeps the build's own pick; 0 means none. */
export interface ConsumablePicks {
	flaskId?: number;
	foodId?: number;
	mhImbueId?: number;
	ohImbueId?: number;
	mhWeaponImbueId?: number;
	ohWeaponImbueId?: number;
	conjuredId?: number;
	resourcePotId?: number;
	explosiveId?: number;
	elixirIds?: number[];
	/** Scrolls and other one-off consumables. */
	extraIds?: number[];
}

/** One-per-kind consumable fields, with the kind of item each takes. */
export const CONSUMABLE_FIELDS: { field: Exclude<keyof ConsumablePicks, 'elixirIds' | 'extraIds'>; label: string; kind: ConsumableKind; resourceOnly?: boolean }[] = [
	{ field: 'flaskId', label: 'Flask', kind: 'flask' },
	{ field: 'foodId', label: 'Food', kind: 'food' },
	{ field: 'mhImbueId', label: 'Main hand stone or oil', kind: 'imbue' },
	{ field: 'ohImbueId', label: 'Off hand stone or oil', kind: 'imbue' },
	{ field: 'mhWeaponImbueId', label: 'Main hand poison, firestone or spellstone', kind: 'weaponImbue' },
	{ field: 'ohWeaponImbueId', label: 'Off hand poison, firestone or spellstone', kind: 'weaponImbue' },
	{ field: 'resourcePotId', label: 'Mana potion', kind: 'potion', resourceOnly: true },
	{ field: 'conjuredId', label: 'Rune, mana gem or healthstone', kind: 'conjured' },
	{ field: 'explosiveId', label: 'Explosive', kind: 'explosive' },
];

// ---- Talents ----

/** "053-21" -> points per talent, one list per tree, padded to the tree's size. */
export function parseTalents(talents: string, trees: TalentTree[]): number[][] {
	const parts = talents.split('-');
	return trees.map((tree, t) => tree.talents.map((talent, i) => Math.min(talent.max, Number(parts[t]?.[i] ?? 0) || 0)));
}

/** The sim's talent string: one digit per talent, trees joined by "-", trailing zeros dropped. */
export function serializeTalents(points: number[][]): string {
	const parts = points.map(tree => tree.join('').replace(/0+$/, ''));
	while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
	return parts.join('-');
}

export const talentPointsSpent = (points: number[][]) => points.flat().reduce((sum, n) => sum + n, 0);

/** Talent points a character of this level has: one per level from 10. */
export const talentPointsAt = (level: number) => Math.max(0, level - 9);

// ---- Rotation in words ----

type Json = Record<string, any>;

/** The file in the WoWSims project each build's rotation is taken from, unchanged. */
export const ROTATION_SOURCES: Record<string, string> = {
	'enhancement-shaman': 'ui/specs/shaman/enhancement/builds/default.build.json',
	'elemental-shaman': 'ui/specs/shaman/elemental/builds/default.build.json',
	'warlock-sm-ruin': 'ui/specs/warlock/dps/builds/sm_ruin.build.json',
	'warlock-destruction': 'ui/specs/warlock/dps/builds/destro.build.json',
	'warlock-affliction': 'ui/specs/warlock/dps/builds/aff_wrack.build.json',
	'warlock-demo-fire': 'ui/specs/warlock/dps/builds/demo_fire_brand.build.json',
	'warlock-demo-shadow': 'ui/specs/warlock/dps/builds/demo_shadow_brand.build.json',
	'priest-shadow': 'ui/specs/priest/dps/builds/testing.build.json',
	'mage-fire': 'ui/specs/mage/dps/apls/deepFire.apl.json',
	'rogue-combat-ss': 'ui/specs/rogue/dps/apls/default.apl.json',
	'rogue-combat-bs': 'ui/specs/rogue/dps/apls/default.apl.json',
	'rogue-combat-venom': 'ui/specs/rogue/dps/apls/default.apl.json',
	'rogue-asn-muti': 'ui/specs/rogue/dps/apls/default.apl.json',
	'rogue-sub-hemo': 'ui/specs/rogue/dps/apls/default.apl.json',
	'rogue-hemo-sf': 'ui/specs/rogue/dps/apls/default.apl.json',
	'druid-balance': 'ui/specs/druid/balance/apls/default.apl.json',
	'druid-cat': 'ui/specs/druid/feralcat/apls/adaptive.apl.json',
	'warrior-fury': 'ui/specs/warrior/dps/apls/fury.apl.json',
	'warrior-arms': 'ui/specs/warrior/dps/apls/arms.apl.json',
	'mage-frost': 'ui/specs/mage/dps/apls/frost.apl.json',
	'mage-arcane': 'ui/specs/mage/dps/apls/arcane.apl.json',
	'mage-arcane-fire': 'ui/specs/mage/dps/apls/arcaneFireFill.apl.json',
	'mage-ffb': 'ui/specs/mage/dps/apls/ffb.apl.json',
	'mage-frost-incin': 'ui/specs/mage/dps/apls/frost.apl.json',
	'priest-smite': 'ui/specs/priest/dps/builds/smite_testing.build.json',
};
export const rotationSourceUrl = (specId: string) => (ROTATION_SOURCES[specId] ? `https://github.com/wowsims/forever/blob/master/${ROTATION_SOURCES[specId]}` : undefined);

export interface RotationLine {
	text: string;
	/** Position of the step in its list in the rotation file, hidden steps counted. */
	index?: number;
	/** The step exactly as WoWSims wrote it, for checking the wording against the source. */
	raw?: string;
	/** The condition the step waits for, when it has one. */
	when?: string;
	/** Steps of a group or sequence, shown under the line. */
	children?: RotationLine[];
}

export interface RotationText {
	prepull: RotationLine[];
	priority: RotationLine[];
	groups: { name: string; lines: RotationLine[] }[];
	variables: { name: string; value: string }[];
}

const COMPARE: Record<string, string> = { OpEq: '=', OpNe: '≠', OpLt: '<', OpLe: '≤', OpGt: '>', OpGe: '≥' };
const MATH: Record<string, string> = { OpAdd: '+', OpSub: '−', OpMul: '×', OpDiv: '÷' };
const ID_FIELDS = new Set(['spellId', 'auraId', 'talentId']);
const UNIT_FIELDS = new Set(['targetUnit', 'sourceUnit', 'target']);
const DEFAULT_UNITS = new Set(['Target', 'CurrentTarget', 'Self', undefined]);

/** "auraIsActive" -> "aura is active" */
const words = (key: string) =>
	key
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/\bGcd\b/g, 'GCD')
		.replace(/\bDpet\b/g, 'damage per cast time')
		.toLowerCase()
		.replace(/\bgcd\b/g, 'GCD');

export function describeRotation(rotation: Json | undefined, setup: Pick<SimSetupData, 'spells' | 'items'>): RotationText {
	const idName = (id: Json | undefined): string => {
		if (!id) return 'unknown';
		if (id.spellId) return `${setup.spells[id.spellId] ?? `Spell #${id.spellId}`}${id.rank ? ` (Rank ${id.rank})` : ''}`;
		if (id.itemId) return setup.items[id.itemId] ?? `Item #${id.itemId}`;
		if (id.otherId) return words(String(id.otherId).replace(/^OtherAction/, ''));
		return 'unknown';
	};

	const value = (v: Json | undefined, nested = false): string => {
		if (!v) return '';
		const entry = Object.entries(v)[0];
		if (!entry) return '';
		const [key, arg] = entry as [string, Json];
		const wrap = (text: string) => (nested ? `(${text})` : text);
		switch (key) {
			case 'const':
				return String(arg.val);
			case 'cmp':
				return `${value(arg.lhs, true)} ${COMPARE[arg.op] ?? arg.op} ${value(arg.rhs, true)}`;
			case 'math':
				return `(${value(arg.lhs, true)} ${MATH[arg.op] ?? arg.op} ${value(arg.rhs, true)})`;
			case 'and':
				return wrap((arg.vals ?? []).map((x: Json) => value(x, true)).join(' and '));
			case 'or':
				return wrap((arg.vals ?? []).map((x: Json) => value(x, true)).join(' or '));
			case 'not':
				return `not ${value(arg.val, true)}`;
			case 'max':
			case 'min':
				return `${key}(${(arg.vals ?? []).map((x: Json) => value(x)).join(', ')})`;
			case 'variableRef':
				return `"${arg.name}"`;
		}
		// Anything else reads as "what is asked: about which spell", e.g. "aura is active: Water Shield".
		const details: string[] = [];
		for (const [field, fieldValue] of Object.entries(arg ?? {})) {
			if (field === 'includeReactionTime') continue;
			if (ID_FIELDS.has(field)) details.push(idName(fieldValue as Json));
			else if (UNIT_FIELDS.has(field)) {
				const unit = fieldValue as Json;
				if (!DEFAULT_UNITS.has(unit?.type)) details.push(`on ${words(unit.type)}${unit.index ? ` ${unit.index}` : ''}`);
			} else if (fieldValue && typeof fieldValue === 'object') details.push(value(fieldValue as Json, true));
			else details.push(words(String(fieldValue)));
		}
		return details.length ? `${words(key)}: ${details.join(', ')}` : words(key);
	};

	const bare = (action: Json): RotationLine => {
		const entry = Object.entries(action).find(([key]) => key !== 'condition');
		if (!entry) return { text: 'Nothing' };
		const [key, arg] = entry as [string, Json];
		switch (key) {
			case 'castSpell':
				return { text: `Cast ${idName(arg.spellId)}` };
			case 'channelSpell':
				return { text: `Channel ${idName(arg.spellId)}${arg.interruptIf ? `, stop when ${value(arg.interruptIf)}` : ''}` };
			case 'multidot':
			case 'strictMultidot':
				return { text: `Keep ${idName(arg.spellId)} up on up to ${arg.maxDots ?? 1} target${arg.maxDots === 1 ? '' : 's'}${arg.maxOverlap ? `, refresh with at most ${value(arg.maxOverlap)} left` : ''}` };
			case 'sequence':
			case 'strictSequence':
				return { text: key === 'strictSequence' ? 'In one go, only when all are ready:' : 'One after another:', children: (arg.actions ?? []).map((a: Json) => line(a)) };
			case 'groupReference':
				return { text: `Run the group "${arg.groupName}"` };
			case 'autocastOtherCooldowns':
				return { text: 'Use every other cooldown when it is ready (trinkets, racials, class cooldowns)' };
			case 'changeTarget':
				return { text: `Switch to the ${words(arg.newTarget?.type ?? 'next target')}` };
			case 'petAttack':
				return { text: 'Send the pet to attack' };
			case 'castWarlockAssignedCurse':
				return { text: 'Cast the assigned curse' };
			case 'itemSwap':
				return { text: `Swap to the ${words(arg.swapSet ?? 'other')} weapon set` };
			case 'move':
				return { text: `Move to ${value(arg.rangeFromTarget)} yards from the target` };
		}
		const detail = value({ [key]: arg });
		return { text: detail.charAt(0).toUpperCase() + detail.slice(1) };
	};

	const line = (action: Json): RotationLine => {
		const result = bare(action);
		if (action.condition) result.when = value(action.condition);
		result.raw = JSON.stringify(action);
		return result;
	};

	const steps = (list: Json[] | undefined) => (list ?? []).map((step, index) => ({ step, index })).filter(({ step }) => !step.hide && step.action).map(({ step, index }) => ({ ...line(step.action), index }));
	return {
		prepull: (rotation?.prepullActions ?? [])
			.map((step: Json, index: number) => ({ step, index }))
			.filter(({ step }: { step: Json }) => !step.hide && step.action)
			.map(({ step, index }: { step: Json; index: number }) => ({ ...line(step.action), when: `the pull timer is at ${value(step.doAtValue)}`, raw: JSON.stringify(step), index })),
		priority: steps(rotation?.priorityList),
		groups: (rotation?.groups ?? []).map((group: Json) => ({ name: group.name, lines: steps(group.actions) })),
		variables: (rotation?.valueVariables ?? []).map((variable: Json) => ({ name: variable.name, value: value(variable.value) })),
	};
}

// ---- Buffs ----

/** Buff flags of the request as words: `{ battleShout: 2 }` -> "Battle shout (improved)". */
export function describeFlags(flags: Json | undefined): string[] {
	return Object.entries(flags ?? {})
		.filter(([, on]) => on && on !== 'TristateEffectMissing')
		.map(([key, on]) => {
			const name = words(key);
			const label = name.charAt(0).toUpperCase() + name.slice(1);
			if (on === 2 || on === 'TristateEffectImproved') return `${label} (improved)`;
			return typeof on === 'number' && on > 2 ? `${label} (${on})` : label;
		});
}

/** The value a buff has in a set of flags, as a number: 0 off, 1 on, 2+ a higher step. */
export function buffValue(flags: Json | undefined, key: string): number {
	const value = flags?.[key];
	if (value === true) return 1;
	if (value === 'TristateEffectRegular') return 1;
	if (value === 'TristateEffectImproved') return 2;
	return typeof value === 'number' ? value : 0;
}

/** Consumables that share a group with another picked one: only one of each group counts. */
export function clashingGroups(ids: number[], options: ConsumableOption[]): { group: string; names: string[] }[] {
	const byGroup = new Map<string, { group: string; names: string[] }>();
	for (const id of ids) {
		const option = options.find(o => o.id === id);
		if (!option?.groupKey) continue;
		if (!byGroup.has(option.groupKey)) byGroup.set(option.groupKey, { group: option.group ?? option.groupKey, names: [] });
		byGroup.get(option.groupKey)!.names.push(option.name);
	}
	return [...byGroup.values()].filter(entry => entry.names.length > 1);
}

/** Class and spec options of a build as words: `{ classOptions: { defaultMageArmor: 'MageArmorMageArmor' } }` -> "Default mage armor: mage armor mage armor". */
export function describeOptions(options: unknown, prefix = ''): string[] {
	if (!options || typeof options !== 'object') return [];
	return Object.entries(options as Json).flatMap(([key, value]) => {
		if (value && typeof value === 'object' && !Array.isArray(value)) return describeOptions(value, prefix);
		const name = words(key);
		const label = name.charAt(0).toUpperCase() + name.slice(1);
		if (value === true) return [label];
		if (value === false || value === 0 || value === '' || value == null) return [];
		return [`${label}: ${typeof value === 'string' ? words(value) : Array.isArray(value) ? value.join(', ') : value}`];
	});
}

/** A simulator remark with its ids turned into names: "does not know spell {SpellID: 408510}" -> "does not know Water Shield". */
export function describeCheck(remark: string, setup: Pick<SimSetupData, 'spells' | 'items'>): string {
	return remark
		.replace(/^Player \(#\d+\) /, 'Your character ')
		.replace(/(spell |talent )?\{SpellID: (\d+)\}/g, (_, _kind, id) => setup.spells[id] ?? `spell ${id}`)
		.replace(/\{ItemID: (\d+)\}/g, (_, id) => setup.items[id] ?? `item ${id}`);
}
