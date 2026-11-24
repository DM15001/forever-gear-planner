import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { fittingImbue, type ImbueRecord, takesImbue, type WeaponRecord } from './imbue';

const db = JSON.parse(readFileSync(new URL('../../../public/sim/db.json', import.meta.url), 'utf8')) as { consumables: ImbueRecord[]; items: ({ id: number } & WeaponRecord)[] };
const item = (id: number) => db.items.find(i => i.id === id)!;
const WEIGHTSTONE = 12643; // Dense Weightstone
const SHARPENING = 12404; // Dense Sharpening Stone
const FELSTRIKER = 12590; // dagger
const TEEBUS = 1728; // sword

describe('fittingImbue', () => {
	it('swaps a weightstone on an edged weapon for the sharpening stone of the same rank', () => {
		expect(takesImbue(db.consumables.find(c => c.id === WEIGHTSTONE)!, item(FELSTRIKER))).toBe(false);
		expect(fittingImbue(WEIGHTSTONE, item(FELSTRIKER), db.consumables)).toBe(SHARPENING);
		expect(fittingImbue(WEIGHTSTONE, item(TEEBUS), db.consumables)).toBe(SHARPENING);
	});

	it('leaves a stone that fits, an empty hand and an unknown id alone', () => {
		expect(fittingImbue(SHARPENING, item(FELSTRIKER), db.consumables)).toBe(SHARPENING);
		expect(fittingImbue(WEIGHTSTONE, undefined, db.consumables)).toBe(WEIGHTSTONE);
		expect(fittingImbue(1, item(FELSTRIKER), db.consumables)).toBe(1);
	});
});
