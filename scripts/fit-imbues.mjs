// The measurements' copy of src/lib/sim/imbue.ts: a sharpening stone or weightstone that does not go on the
// weapon in its hand is swapped for the one of the same rank that does. Keep the two in step.
const SUBCLASS = { 1: [0, 1], 2: [15, 15], 3: [13, 13], 4: [4, 5], 6: [6, 6], 8: [10, 10], 9: [7, 8] };
const subclassOf = weapon => SUBCLASS[weapon.weaponType ?? 0]?.[weapon.handType === 4 ? 1 : 0];
const takes = (imbue, weapon) => !imbue.weaponSubclassMask || (subclassOf(weapon) !== undefined && (imbue.weaponSubclassMask & (1 << subclassOf(weapon))) !== 0);

function fitting(id, weapon, all) {
	const imbue = all.find(c => c.id === id);
	if (!imbue || !weapon || takes(imbue, weapon)) return id;
	const rank = imbue.name.split(' ')[0];
	return all.find(c => c.type === imbue.type && c.id !== imbue.id && c.weaponSubclassMask && c.name.split(' ')[0] === rank && takes(c, weapon))?.id ?? id;
}

/** `consumables` with the main-hand and off-hand stone fitted to the two weapon records. */
export function fitImbues(consumables, mainHand, offHand, all) {
	if (!consumables) return consumables;
	const out = { ...consumables };
	if (out.mhImbueId) out.mhImbueId = fitting(out.mhImbueId, mainHand, all);
	if (out.ohImbueId) out.ohImbueId = fitting(out.ohImbueId, offHand, all);
	return out;
}
