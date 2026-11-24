/**
 * Sharpening stones only go on edged weapons and weightstones on blunt ones; the simulator ignores a stone on
 * the wrong kind. A build's own stone is picked for its own weapon, so a planned dagger under a weightstone
 * would be simulated with no stone at all. This swaps such a stone for the one of the same rank that fits,
 * as a player would. scripts/fit-imbues.mjs is the same rule for the measurements; keep the two in step.
 */
export interface ImbueRecord {
	id: number;
	name: string;
	type?: number;
	weaponSubclassMask?: number;
}
export interface WeaponRecord {
	weaponType?: number;
	handType?: number;
}

/** The game's weapon subclass per WoWSims weapon type: [one-handed, two-handed]. */
const SUBCLASS: Record<number, [number, number]> = { 1: [0, 1], 2: [15, 15], 3: [13, 13], 4: [4, 5], 6: [6, 6], 8: [10, 10], 9: [7, 8] };
const TWO_HAND = 4;
const subclassOf = (weapon: WeaponRecord): number | undefined => SUBCLASS[weapon.weaponType ?? 0]?.[weapon.handType === TWO_HAND ? 1 : 0];

export function takesImbue(imbue: ImbueRecord, weapon: WeaponRecord): boolean {
	if (!imbue.weaponSubclassMask) return true;
	const subclass = subclassOf(weapon);
	return subclass !== undefined && (imbue.weaponSubclassMask & (1 << subclass)) !== 0;
}

/** The imbue to use on `weapon` in place of `id`: `id` itself when it fits or nothing of its rank does. */
export function fittingImbue(id: number | undefined, weapon: WeaponRecord | undefined, all: ImbueRecord[]): number | undefined {
	const imbue = all.find(c => c.id === id);
	if (!imbue || !weapon || takesImbue(imbue, weapon)) return id;
	const rank = imbue.name.split(' ')[0];
	return all.find(c => c.type === imbue.type && c.id !== imbue.id && Boolean(c.weaponSubclassMask) && c.name.split(' ')[0] === rank && takesImbue(c, weapon))?.id ?? id;
}
