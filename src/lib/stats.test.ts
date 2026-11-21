import { describe, expect, it } from 'vitest';

import specJson from '../specs/enhancement-shaman.json';
import simExport from './__fixtures__/sim-export.json';
import { loadGameData } from './gameData';
import { importCharacter } from './importCharacter';
import { gearStats, hitSummary, pieceStats, sourceLine, statLine } from './stats';
import type { SpecConfig } from './types';

const spec = specJson as unknown as SpecConfig;
const data = await loadGameData();
const imported = importCharacter(JSON.stringify(simExport), spec).character;
const noEnchants = { ...imported, gear: imported.gear.map(piece => (piece ? { id: piece.id } : null)) };

describe('gearStats', () => {
	it('sums item stats without enchants', () => {
		const stats = gearStats(noEnchants, data);
		expect(stats.hitRating).toBe(17);
		expect(stats.attackPower).toBe(126);
		expect(stats.intellect).toBe(88);
	});

	it('adds enchant stats for the slot they sit in', () => {
		const withCloak = { ...noEnchants, gear: noEnchants.gear.map((piece, i) => (i === 3 && piece ? { ...piece, enchant: 7667 } : piece)) };
		expect(gearStats(withCloak, data).agility).toBe((gearStats(noEnchants, data).agility ?? 0) + 5);
	});

	it('ignores items that are not in the data', () => {
		const stats = gearStats({ ...noEnchants, gear: noEnchants.gear.map((piece, i) => (i === 0 ? { id: 999999999 } : piece)) }, data);
		expect(stats.hitRating).toBe(17);
	});
});

describe('pieceStats', () => {
	it('adds the random suffix, scaled by the item', () => {
		const ring = data.itemById.get(11118)!; // Archaedic Stone, random suffix
		expect(ring.randomSuffixOptions?.length).toBeGreaterThan(0);
		const suffixId = ring.randomSuffixOptions![0];
		const suffix = data.suffixById.get(suffixId)!;
		const [stat, share] = Object.entries(suffix.stats)[0];
		const stats = pieceStats(ring, { id: ring.id, randomSuffix: suffixId }, data);
		expect(stats[stat]).toBe((ring.stats?.[stat] ?? 0) + Math.floor((ring.randPropPoints! * share) / 10000));
		expect(pieceStats(ring, { id: ring.id }, data)).toEqual(ring.stats ?? {});
	});
});

describe('hitSummary', () => {
	const stats = gearStats(noEnchants, data);

	it('counts the Dwarf racial toward the cap', () => {
		const hit = hitSummary(stats, { ...noEnchants, race: 'RaceDwarf' }, spec);
		expect(hit.fromGear).toBeCloseTo(1.7);
		expect(hit.fromRace).toBe(1);
		expect(hit.total).toBeCloseTo(2.7);
		expect(hit.ratingMissing).toBe(53);
		expect(hit.ratingOver).toBe(0);
	});

	it('has no racial for an Orc', () => {
		const hit = hitSummary(stats, { ...noEnchants, race: 'RaceOrc' }, spec);
		expect(hit.fromRace).toBe(0);
		expect(hit.ratingMissing).toBe(63);
	});

	it('reports rating over the cap', () => {
		const hit = hitSummary({ hitRating: 95 }, { ...noEnchants, race: 'RaceDwarf' }, spec);
		expect(hit.ratingMissing).toBe(0);
		expect(hit.ratingOver).toBe(25);
	});
});

describe('display lines', () => {
	it('formats stats and sources', () => {
		expect(statLine({ stamina: 20, attackPower: 32, hitRating: 10, armor: 300 })).toBe('+20 Sta, +32 AP, +10 Hit');
		const shaft = data.itemById.get(14531)!;
		expect(sourceLine(shaft.sources?.[0], data)).toBe('Scholomance: Rattlegore');
		expect(sourceLine(undefined, data)).toBe('Source unknown');
	});
});
