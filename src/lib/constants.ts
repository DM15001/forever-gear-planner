import type { SlotKind } from './types';

/** Gear slots in the order both export formats use. */
export const GEAR_SLOTS: { key: string; label: string; kind: SlotKind }[] = [
	{ key: 'head', label: 'Head', kind: 'head' },
	{ key: 'neck', label: 'Neck', kind: 'neck' },
	{ key: 'shoulder', label: 'Shoulders', kind: 'shoulder' },
	{ key: 'back', label: 'Back', kind: 'back' },
	{ key: 'chest', label: 'Chest', kind: 'chest' },
	{ key: 'wrist', label: 'Wrists', kind: 'wrist' },
	{ key: 'hands', label: 'Hands', kind: 'hands' },
	{ key: 'waist', label: 'Waist', kind: 'waist' },
	{ key: 'legs', label: 'Legs', kind: 'legs' },
	{ key: 'feet', label: 'Feet', kind: 'feet' },
	{ key: 'finger1', label: 'Ring 1', kind: 'finger' },
	{ key: 'finger2', label: 'Ring 2', kind: 'finger' },
	{ key: 'trinket1', label: 'Trinket 1', kind: 'trinket' },
	{ key: 'trinket2', label: 'Trinket 2', kind: 'trinket' },
	{ key: 'mainHand', label: 'Main hand', kind: 'weapon' },
	{ key: 'offHand', label: 'Off hand', kind: 'weapon' },
	{ key: 'ranged', label: 'Ranged or relic', kind: 'ranged' },
];

/** Like the in-game character pane, with seven slots a side so the columns end level: armor left, the rest right, weapons along the bottom. */
export const SHEET_LAYOUT = {
	left: [0, 1, 2, 3, 4, 5, 6],
	right: [7, 8, 9, 10, 11, 12, 13],
	bottom: [14, 15, 16],
};

export const PROFESSIONS = ['Alchemy', 'Blacksmithing', 'Enchanting', 'Engineering', 'Herbalism', 'Leatherworking', 'Mining', 'Skinning', 'Tailoring'];
