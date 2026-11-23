import { GEAR_SLOTS } from './constants';
import { allUpgrades, type FarmDrop } from './farm';
import type { GameData } from './gameData';
import { type CandidateOptions, type Gear, scoreSet, usableSources } from './scoring';
import { statLine } from './stats';
import type { Character, Enchant, Item, SpecConfig } from './types';

/** Enchants that can go on this item in this slot. */
export function applicableEnchants(slotIndex: number, item: Item | undefined, data: GameData): Enchant[] {
	if (!item || item.rangedType === 'totem' || item.rangedType === 'idol') return []; // relics cannot be enchanted
	const kind = GEAR_SLOTS[slotIndex].kind;
	// Scopes go on bows, guns and crossbows; wands and thrown weapons take nothing.
	if (kind === 'ranged' && !['bow', 'gun', 'crossbow'].includes(item.rangedType ?? '')) return [];
	return (data.enchantsBySlot.get(kind) ?? []).filter(enchant => {
		if (/fishing line/i.test(enchant.name)) return false; // fishing poles only
		// The data marks most two-hand enchants; the name catches the rest.
		const only = enchant.only ?? (/^Enchant 2H Weapon/.test(enchant.name) ? 'twoHand' : undefined);
		switch (only) {
			case undefined:
				// A plain weapon enchant needs a real weapon: not a shield, not an item held in the off hand.
				return kind !== 'weapon' || (!!item.weapon && item.weapon.type !== 'shield' && item.weapon.type !== 'offHand');
			case 'twoHand':
				return item.weapon?.hand === 'twoHand';
			case 'staff':
				return item.weapon?.type === 'staff';
			case 'shield':
				return item.weapon?.type === 'shield';
			case 'offHand':
				return item.weapon?.type === 'offHand';
			default:
				return false; // armor kits and anything new: not offered until checked
		}
	});
}

const ENCHANT_STAT_LABELS: Record<string, string> = {
	mana: 'Mana',
	health: 'Health',
	armorNoMods: 'Armor',
	bonusArmor: 'Armor',
	rangedAttackPower: 'Ranged AP',
	fireResistance: 'Fire resist',
	frostResistance: 'Frost resist',
	natureResistance: 'Nature resist',
	arcaneResistance: 'Arcane resist',
	shadowResistance: 'Shadow resist',
};

/** What an enchant gives, short: "+8 Int", "+150 Mana". An effect without stats is named by the enchant: "Crusader". */
export function enchantLine(enchant: Enchant): string {
	const stats = enchant.stats ?? {};
	const known = statLine(stats);
	const extra = Object.entries(ENCHANT_STAT_LABELS)
		.filter(([key]) => stats[key])
		.map(([key, label]) => `+${stats[key]} ${label}`);
	const line = [known, ...extra].filter(Boolean).join(', ');
	return line || enchant.name.replace(/^Enchant [^-]+ - /, '').replace(/^Enchant: /, '');
}

/** Which weapons a weapon enchant goes on, when it does not go on all: for the list of enchants. */
export function enchantLimit(enchant: Enchant): string | undefined {
	const only = enchant.only ?? (/^Enchant 2H Weapon/.test(enchant.name) ? 'twoHand' : undefined);
	return { twoHand: 'Two-handed weapons only', shield: 'Shields only', offHand: 'Held off-hand items only', staff: 'Staves only', kit: undefined }[only ?? 'kit'];
}

export interface EnchantOption {
	enchant: Enchant;
	/** Change in set score against the slot without an enchant. */
	delta: number;
}

export interface SlotEnchants {
	slotIndex: number;
	item: Item;
	current?: Enchant;
	/** Change in set score from the current enchant, against none. */
	currentDelta: number;
	/** Enchants with a known worth (stats, or an effect the simulator measured), best first. */
	options: EnchantOption[];
	/** Proc or effect enchants nobody measured; the score cannot rank them. */
	unscored: Enchant[];
}

export const withEnchant = (gear: Gear, slotIndex: number, effectId: number | undefined): Gear =>
	gear.map((piece, i) => {
		if (i !== slotIndex || !piece) return piece;
		const { enchant: _old, ...rest } = piece;
		return effectId ? { ...rest, enchant: effectId } : rest;
	});

/** For every enchantable slot of `gear`: the current enchant and the alternatives. */
export function enchantOverview(gear: Gear, character: Character, data: GameData, spec: SpecConfig): SlotEnchants[] {
	const result: SlotEnchants[] = [];
	gear.forEach((piece, slotIndex) => {
		const item = piece ? data.itemById.get(piece.id) : undefined;
		const enchants = applicableEnchants(slotIndex, item, data);
		if (!piece || !item || enchants.length === 0) return;
		const bare = scoreSet(withEnchant(gear, slotIndex, undefined), character, data, spec).score;
		const deltaOf = (effectId: number) => scoreSet(withEnchant(gear, slotIndex, effectId), character, data, spec).score - bare;
		const { simValues } = data;
		const hasStats = (e: Enchant) => Object.keys(e.stats ?? {}).length > 0;
		const options = enchants
			.filter(e => hasStats(e) || simValues.enchants.has(e.effectId))
			.map(enchant => ({ enchant, delta: deltaOf(enchant.effectId) }))
			.filter(o => o.delta > 0)
			.sort((a, b) => b.delta - a.delta || a.enchant.name.localeCompare(b.enchant.name));
		const current = piece.enchant ? enchants.find(e => e.effectId === piece.enchant) : undefined;
		result.push({
			slotIndex,
			item,
			current,
			currentDelta: current ? deltaOf(current.effectId) : 0,
			options,
			unscored: enchants.filter(e => e.hasEffect && !hasStats(e) && !simValues.measuredEnchants.has(e.effectId)),
		});
	});
	return result;
}

/**
 * The best stat enchant for every slot. Slots are filled one after another and re-checked,
 * so hit rating enchants are not stacked past the cap.
 */
export function bestEnchants(gear: Gear, character: Character, data: GameData, spec: SpecConfig): Record<number, number> {
	let current = gear;
	const chosen: Record<number, number> = {};
	for (let pass = 0; pass < 3; pass++) {
		let changed = false;
		for (const slot of enchantOverview(current, character, data, spec)) {
			const best = slot.options[0];
			if (!best || best.delta <= slot.currentDelta + 0.01) continue;
			current = withEnchant(current, slot.slotIndex, best.enchant.effectId);
			chosen[slot.slotIndex] = best.enchant.effectId;
			changed = true;
		}
		if (!changed) break;
	}
	return chosen;
}

export interface ProfessionValue {
	profession: string;
	mine: boolean;
	/** Craftable upgrades over the equipped gear, best first. */
	items: FarmDrop[];
	/** Sum of the best craftable upgrade per slot. An upper bound, like the dungeon ranking. */
	value: number;
}

/** What each crafting profession could add to the equipped gear. */
export function professionValues(options: CandidateOptions): ProfessionValue[] {
	const { character, spec } = options;
	const faction = spec.races.find(r => r.id === character.race)?.faction;
	// Every profession is shown here, whatever the "own crafts only" switch says.
	const filter = { ...options.filter, crafted: true, ownCraftsOnly: false };
	const byProfession = new Map<string, FarmDrop[]>();
	for (const drop of allUpgrades({ ...options, filter })) {
		for (const source of usableSources(drop.item, faction, { ...filter, ownCraftsOnly: false })) {
			if (source.kind !== 'crafted' || !source.profession) continue;
			if (!byProfession.has(source.profession)) byProfession.set(source.profession, []);
			if (!byProfession.get(source.profession)!.includes(drop)) byProfession.get(source.profession)!.push(drop);
		}
	}
	return [...byProfession.entries()]
		.map(([profession, items]) => {
			const bestPerSlot = new Map<number, number>();
			for (const drop of items) bestPerSlot.set(drop.slotIndex, Math.max(bestPerSlot.get(drop.slotIndex) ?? 0, drop.delta));
			return {
				profession,
				mine: character.professions.includes(profession),
				items: items.sort((a, b) => b.delta - a.delta),
				value: [...bestPerSlot.values()].reduce((sum, v) => sum + v, 0),
			};
		})
		.sort((a, b) => Number(b.mine) - Number(a.mine) || b.value - a.value);
}
