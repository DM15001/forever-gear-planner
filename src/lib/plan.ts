import { applicableEnchants, bestEnchants } from './enchants';
import type { GameData } from './gameData';
import { type Candidate, type CandidateOptions, EVERYTHING, filterKey, plannedGear, reputationOf, scoreSet, slotCandidates, suggestPlan, usableSources } from './scoring';
import { effortLine } from './loot';
import { sourceLine, vendorCurrency } from './stats';
import type { Character, Enchant, Item, ItemSource } from './types';

/** A full plan: the items to get and the enchants to put on the finished set. */
export function buildPlan(options: CandidateOptions): Pick<Character, 'plan' | 'planEnchants'> {
	const { character, data, spec } = options;
	const blank: Character = { ...character, plan: {}, planEnchants: {} };
	const plan = suggestPlan({ ...options, character: blank });
	const planEnchants = bestEnchants(plannedGear({ ...blank, plan }, data), blank, data, spec);
	return { plan, planEnchants };
}

/** The best other items for a slot of the planned gear, for when the goal is out of reach. */
export function fallbacks(slotIndex: number, options: CandidateOptions, count = 2): Candidate[] {
	const equippedId = options.character.gear[slotIndex]?.id;
	const equippedScoreGain = (candidate: Candidate) => candidate.item.id !== equippedId;
	return slotCandidates(slotIndex, plannedGear(options.character, options.data), options).filter(equippedScoreGain).slice(0, count);
}

export type StepKind = 'dungeon' | 'craft' | 'reputation' | 'vendor' | 'quest' | 'world' | 'pvp' | 'unknown' | 'enchant';

export interface StepItem {
	slotIndex: number;
	item?: Item;
	enchant?: Enchant;
	/** Where exactly: boss, quest, vendor... */
	detail: string;
	/** For drops with known numbers: "20% drop, about 5 runs". */
	effort?: string;
	/** Score gained by this one change on top of the equipped gear. */
	gain: number;
	/** False when the step cannot be ticked off yet (an enchant for an item not equipped). */
	ready: boolean;
}

export interface PlanStep {
	key: string;
	kind: StepKind;
	/** "Blackrock Spire: Lower", "Craft with Leatherworking", "Reputation: Stormpike Guard" ... */
	title: string;
	items: StepItem[];
	gain: number;
}

function stepOf(source: ItemSource | undefined, character: Character, item?: Item, tier05SetId?: number): { kind: StepKind; title: string } {
	// The item data lists Tier 0.5 pieces under the vendor who hands them out; they come from the questline.
	if (item?.setId !== undefined && item.setId === tier05SetId) return { kind: 'quest', title: 'Tier 0.5 questline' };
	if (!source) return { kind: 'unknown', title: 'Source unknown' };
	if (source.dungeonName) return { kind: 'dungeon', title: source.dungeonName };
	const reputation = reputationOf(source);
	if (reputation) return { kind: 'reputation', title: `Reputation: ${reputation}` };
	switch (filterKey(source)) {
		case 'crafted':
			return character.professions.includes(source.profession ?? '')
				? { kind: 'craft', title: `Craft with ${source.profession}` }
				: { kind: 'craft', title: `Buy or commission: ${source.profession}` };
		case 'currency':
			return { kind: 'vendor', title: `${source.npcName}: ${vendorCurrency(source)}` };
		case 'vendor':
			return { kind: 'vendor', title: `Vendor: ${source.npcName ?? 'unknown'}` };
		case 'quest':
			return { kind: 'quest', title: 'Quests' };
		case 'pvp':
			return { kind: 'pvp', title: 'PvP rank rewards' };
		case 'drop':
			return { kind: 'world', title: 'World drops and auction house' };
		default:
			return { kind: 'unknown', title: 'Source unknown' };
	}
}

/**
 * The plan as a to-do list: one step per run, vendor, profession or reputation, biggest gain
 * first, with the enchants as a last step.
 */
export function planSteps(options: CandidateOptions): PlanStep[] {
	const { character, data, spec, filter } = options;
	const faction = spec.races.find(r => r.id === character.race)?.faction;
	const equipped = scoreSet(character.gear, character, data, spec).score;
	const steps = new Map<string, PlanStep>();
	const add = (kind: StepKind, title: string, entry: StepItem) => {
		const key = `${kind}:${title}`;
		const step = steps.get(key) ?? steps.set(key, { key, kind, title, items: [], gain: 0 }).get(key)!;
		step.items.push(entry);
		step.gain += Math.max(0, entry.gain);
	};

	for (const [slotKey, itemId] of Object.entries(character.plan ?? {})) {
		const slotIndex = Number(slotKey);
		const item = data.itemById.get(itemId);
		if (!item || itemId === character.gear[slotIndex]?.id) continue;
		// Prefer a source from the content the user picked; fall back to any source at all.
		const source = usableSources(item, faction, filter, character.professions)[0] ?? usableSources(item, faction, EVERYTHING)[0];
		const current = character.gear[slotIndex];
		const swapped = character.gear.map((piece, i) => (i === slotIndex ? (current?.enchant ? { id: itemId, enchant: current.enchant } : { id: itemId }) : piece));
		const { kind, title } = stepOf(source, character, item, spec.tier05Set?.setId);
		const isTier05 = title === 'Tier 0.5 questline';
		add(kind, title, { slotIndex, item, detail: isTier05 ? (spec.tier05Set?.name ?? '') : sourceLine(source, data), effort: isTier05 ? undefined : effortLine(source), gain: scoreSet(swapped, character, data, spec).score - equipped, ready: true });
	}

	const planned = plannedGear(character, data);
	for (const [slotKey, effectId] of Object.entries(character.planEnchants ?? {})) {
		const slotIndex = Number(slotKey);
		const piece = planned[slotIndex];
		const item = piece ? data.itemById.get(piece.id) : undefined;
		if (!piece || !item || character.gear[slotIndex]?.enchant === effectId) continue;
		const enchant = applicableEnchants(slotIndex, item, data).find(e => e.effectId === effectId);
		if (!enchant) continue;
		const without = planned.map((p, i) => (i === slotIndex && p ? { id: p.id } : p));
		add('enchant', 'Enchants', {
			slotIndex,
			item,
			enchant,
			detail: enchant.sources?.length ? sourceLine(enchant.sources[0], data) : 'Source unknown',
			gain: scoreSet(planned, character, data, spec).score - scoreSet(without, character, data, spec).score,
			ready: character.gear[slotIndex]?.id === piece.id,
		});
	}

	const list = [...steps.values()];
	for (const step of list) step.items.sort((a, b) => b.gain - a.gain);
	// Enchants come last: they go on the finished pieces.
	return list.sort((a, b) => Number(a.kind === 'enchant') - Number(b.kind === 'enchant') || b.gain - a.gain);
}

/** The character after getting the planned item of a slot: it is equipped and leaves the plan. */
export function gotItem(character: Character, slotIndex: number): Character {
	const itemId = character.plan?.[slotIndex];
	if (!itemId) return character;
	const old = character.gear[slotIndex];
	const { [slotIndex]: _done, ...plan } = character.plan ?? {};
	// The new piece comes without the old piece's enchant; keep it in the plan so it is not forgotten.
	const planEnchants = { ...character.planEnchants };
	if (old?.enchant && planEnchants[slotIndex] === undefined) planEnchants[slotIndex] = old.enchant;
	return { ...character, gear: character.gear.map((piece, i) => (i === slotIndex ? { id: itemId } : piece)), plan, planEnchants };
}

/** The character after applying the planned enchant of a slot. */
export function gotEnchant(character: Character, slotIndex: number): Character {
	const effectId = character.planEnchants?.[slotIndex];
	const piece = character.gear[slotIndex];
	if (!effectId || !piece) return character;
	const { [slotIndex]: _done, ...planEnchants } = character.planEnchants ?? {};
	return { ...character, gear: character.gear.map((p, i) => (i === slotIndex ? { ...piece, enchant: effectId } : p)), planEnchants };
}

/** How many steps of the plan are still open. */
export const openSteps = (character: Character, data: GameData): number =>
	Object.entries(character.plan ?? {}).filter(([slot, id]) => character.gear[Number(slot)]?.id !== id && data.itemById.has(id)).length +
	Object.entries(character.planEnchants ?? {}).filter(([slot, id]) => character.gear[Number(slot)]?.enchant !== id).length;
