import enhancementShaman from '../specs/enhancement-shaman.json';
import mageArcane from '../specs/mage-arcane.json';
import mageFire from '../specs/mage-fire.json';
import mageFrost from '../specs/mage-frost.json';
import priestShadow from '../specs/priest-shadow.json';
import warlockAffliction from '../specs/warlock-affliction.json';
import warlockDemoFire from '../specs/warlock-demo-fire.json';
import warlockDemoShadow from '../specs/warlock-demo-shadow.json';
import warlockDestruction from '../specs/warlock-destruction.json';
import warlockSmRuin from '../specs/warlock-sm-ruin.json';
import type { Character, Enchant, Item, SpecConfig } from './types';

/** Every spec the planner knows, in the order they are offered. */
export const SPECS = [enhancementShaman, warlockSmRuin, warlockDestruction, warlockAffliction, warlockDemoFire, warlockDemoShadow, priestShadow, mageFire, mageFrost, mageArcane] as unknown as SpecConfig[];

export const DEFAULT_SPEC = SPECS[0];

export const specById = (id: string | undefined): SpecConfig => SPECS.find(spec => spec.id === id) ?? DEFAULT_SPEC;

/** The spec a character is planned as. Characters saved before specs existed are Enhancement Shamans. */
export const specOf = (character: Character | null): SpecConfig => specById(character?.specId);

/** The builds of one class, e.g. the five Warlock builds. */
export const specsOfClass = (className: string): SpecConfig[] => SPECS.filter(spec => spec.className === className);

const ARMOR_SLOTS = new Set(['head', 'shoulder', 'chest', 'wrist', 'hands', 'waist', 'legs', 'feet']);

/** Can this spec equip the item at all? Mirrors the rule in scripts/build-data.mjs. */
export function usableBy(item: Item, spec: SpecConfig): boolean {
	if (item.classes && !item.classes.includes(spec.classId)) return false;
	if (ARMOR_SLOTS.has(item.slot)) return !item.armorType || spec.armorTypes.includes(item.armorType);
	if (item.slot === 'weapon') {
		const type = item.weapon?.type ?? '';
		const hand = item.weapon?.hand;
		if (hand === 'twoHand') return spec.weaponTypes.twoHand.includes(type);
		if (hand === 'offHand') return spec.weaponTypes.offHand.includes(type) || (spec.canDualWield && spec.weaponTypes.oneHand.includes(type));
		return spec.weaponTypes.oneHand.includes(type);
	}
	if (item.slot === 'ranged') return spec.rangedTypes.includes(item.rangedType ?? '');
	return true;
}

export const enchantUsableBy = (enchant: Enchant, spec: SpecConfig): boolean => !enchant.classes || enchant.classes.includes(spec.classId);
