import druidBalance from '../specs/druid-balance.json';
import druidCat from '../specs/druid-cat.json';
import elementalShaman from '../specs/elemental-shaman.json';
import enhancementShaman from '../specs/enhancement-shaman.json';
import mageArcane from '../specs/mage-arcane.json';
import mageArcaneFire from '../specs/mage-arcane-fire.json';
import mageFfb from '../specs/mage-ffb.json';
import mageFire from '../specs/mage-fire.json';
import mageFrost from '../specs/mage-frost.json';
import mageFrostIncin from '../specs/mage-frost-incin.json';
import priestDisc from '../specs/priest-disc.json';
import priestHoly from '../specs/priest-holy.json';
import priestShadow from '../specs/priest-shadow.json';
import priestSmite from '../specs/priest-smite.json';
import warriorArms from '../specs/warrior-arms.json';
import warriorFury from '../specs/warrior-fury.json';
import rogueAsnMuti from '../specs/rogue-asn-muti.json';
import rogueCombatBs from '../specs/rogue-combat-bs.json';
import rogueCombatSs from '../specs/rogue-combat-ss.json';
import rogueCombatVenom from '../specs/rogue-combat-venom.json';
import rogueHemoSf from '../specs/rogue-hemo-sf.json';
import rogueSubHemo from '../specs/rogue-sub-hemo.json';
import warlockAffliction from '../specs/warlock-affliction.json';
import warlockDemoFire from '../specs/warlock-demo-fire.json';
import warlockDemoShadow from '../specs/warlock-demo-shadow.json';
import warlockDestruction from '../specs/warlock-destruction.json';
import warlockSmRuin from '../specs/warlock-sm-ruin.json';
import type { Character, Enchant, Item, SpecConfig } from './types';

/** Every spec the planner knows, in the order they are offered. */
/**
 * The spec files count in "points", where one point is one attack power or one spell damage.
 * The planner counts in estimated DPS instead: every weight is multiplied by what one point is
 * worth in DPS for the build (`dpsPerPoint`, measured with the simulator on the preset gear).
 */
function inDps(spec: SpecConfig): SpecConfig {
	const factor = spec.weights.dpsPerPoint ?? 1;
	const scale = (value: number) => Math.round(value * factor * 1000) / 1000;
	return {
		...spec,
		weights: {
			...spec.weights,
			mainHandDps: scale(spec.weights.mainHandDps),
			...(spec.weights.offHandDps !== undefined ? { offHandDps: scale(spec.weights.offHandDps) } : {}),
			hitRatingOverCap: scale(spec.weights.hitRatingOverCap),
			stats: Object.fromEntries(Object.entries(spec.weights.stats).map(([key, value]) => [key, scale(value)])),
		},
	};
}

export const SPECS = ([enhancementShaman, elementalShaman, warlockSmRuin, warlockDestruction, warlockAffliction, warlockDemoFire, warlockDemoShadow, priestShadow, priestSmite, priestHoly, priestDisc, mageFire, mageFrost, mageFrostIncin, mageArcane, mageArcaneFire, mageFfb, warriorFury, warriorArms, rogueCombatSs, rogueCombatBs, rogueCombatVenom, rogueAsnMuti, rogueSubHemo, rogueHemoSf, druidBalance, druidCat] as unknown as SpecConfig[]).map(inDps);

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
