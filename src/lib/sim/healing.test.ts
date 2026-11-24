import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { importCharacter } from '../importCharacter';
import { SPECS } from '../specs';
import type { Character } from '../types';
import { DEFAULT_HEALING, HEALING_PRESSURES, HEALING_STYLES, healingChoice, healingFight, scenarioKey } from './healing';
import { buildSimRequest, indexSimDb, isHealer, readSimResult, simKey } from './request';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../public/sim/${name}`, import.meta.url), 'utf8'));
const healers = SPECS.filter(spec => spec.role === 'healer');

describe('healing scenarios', () => {
	it('has measured weights for every scenario of every healer build', () => {
		expect(healers.map(spec => spec.id)).toEqual(['priest-holy', 'priest-disc']);
		for (const spec of healers) {
			for (const style of HEALING_STYLES) {
				for (const pressure of HEALING_PRESSURES) {
					const measured = spec.healing!.scenarios[scenarioKey({ style: style.id, pressure: pressure.id })];
					expect(measured, `${spec.id} ${style.id} ${pressure.id}`).toBeDefined();
					expect(measured.hps).toBeGreaterThan(100);
					expect(measured.weights.healingPower).toBeGreaterThan(0);
				}
			}
			// The file's plain weights are those of the default scenario.
			expect(spec.weights.stats).toEqual(spec.healing!.scenarios[scenarioKey(DEFAULT_HEALING)].weights);
		}
	});

	it('values mana more the longer the fight', () => {
		for (const spec of healers) {
			const share = (pressure: string) => {
				const weights = spec.healing!.scenarios[`tank.${pressure}`].weights;
				return weights.mp5 / weights.healingPower;
			};
			expect(share('burst'), spec.id).toBeLessThan(share('balanced'));
			expect(share('balanced'), spec.id).toBeLessThanOrEqual(share('endurance') * 1.1);
		}
	});

	it('falls back to the default for an unknown choice', () => {
		expect(healingChoice({ healing: { style: 'nope', pressure: 'burst' } })).toEqual({ style: 'tank', pressure: 'burst' });
		expect(healingChoice(null)).toEqual(DEFAULT_HEALING);
	});

	it('pauses only where the fight says so and never casts Prayer of Mending', () => {
		const burst = JSON.stringify(healingFight({ style: 'tank', pressure: 'burst' }).rotation);
		const long = JSON.stringify(healingFight({ style: 'group', pressure: 'endurance' }).rotation);
		expect(burst).not.toContain('schedule');
		expect(long).toContain('"wait"');
		expect(long).toContain('25316');
		// The engine stops with an error on Prayer of Mending as a heal (ranks 401859, 1240826, 1240827).
		for (const text of [burst, long]) expect(text).not.toMatch(/401859|1240826|1240827/);
	});
});

describe('a healer in the simulator request', () => {
	const spec = healers[0];
	const template = read(`template.${spec.id}.json`);
	const index = indexSimDb(read('db.json'), template);
	const character: Character = { specId: spec.id, race: 'RaceDwarf', level: 60, talents: '', professions: ['Tailoring', 'Enchanting'], gear: template.raid.parties[0].players[0].equipment.items };

	it('recognises the healer and plays the chosen scenario', () => {
		expect(isHealer(template)).toBe(true);
		expect(isHealer(read('template.priest-shadow.json'))).toBe(false);
		const chosen = { ...character, healing: { style: 'fast', pressure: 'endurance' } };
		const request = buildSimRequest(chosen, chosen.gear, index, 10).request as any;
		expect(request.encounter.duration).toBe(600);
		expect(request.raid.targetDummies).toBe(4);
		expect(JSON.stringify(request.raid.parties[0].players[0].rotation)).toContain('10917');
		// Another scenario is another run.
		expect(simKey(chosen, chosen.gear, 10)).not.toBe(simKey(character, character.gear, 10));
	});

	it('reads healing per second and healing rows from a result', () => {
		const result = {
			avgIterationDuration: 100,
			raidMetrics: {
				dps: { avg: 0 },
				hps: { avg: 500, stdev: 20, min: 450, max: 550, hist: { 450: 2, 500: 6, 550: 2 } },
				parties: [{ players: [{ secondsOomAvg: 12, actions: [{ id: { spellId: 25314, rank: 5 }, targets: [{ casts: 100, hits: 80, crits: 20, healing: 400000, castTimeMs: 250000 }, { healing: 100000 }] }] }] }],
			},
		};
		const outcome = readSimResult(JSON.stringify(result), 10, true);
		expect(outcome.dps).toBe(500);
		expect(outcome.healing).toBe(true);
		expect(outcome.breakdown!.oomSeconds).toBe(12);
		expect(outcome.breakdown!.actions[0].damage).toBe(50000);
		expect(outcome.breakdown!.actions[0].share).toBe(1);
	});
});

describe('importing a healing Priest', () => {
	const holyPint =
		'{"class":"priest","flavor":"forever","gear":{"items":[{"id":260212},{"id":10829},{"id":7473},{"id":274613},{"enchant":843,"id":9623},{"enchant":1884,"id":13958},{"id":16692},{"id":19047},{"id":11123},{"id":287007},{"id":12543},{"id":17768},{"id":270276},{"id":276744},{"id":17710},{"id":11262},{"id":15279}]},"level":60,"name":"Holy Pint","professions":[{"level":250,"name":"Tailoring"},{"level":300,"name":"Enchanting"}],"race":"Gnome","realm":"","spec":"holy_disc","talents":"025005001330011-0350510303002053","unit":"player","version":"v3.2.11"}';

	it('plans a holy_disc export as a healer, by its talents', () => {
		const { character } = importCharacter(holyPint);
		expect(character.specId).toBe('priest-holy');
		expect(character.race).toBe('RaceGnome');
		expect(character.gear.filter(Boolean)).toHaveLength(17);
	});

	it('still plans a shadow export as a damage build', () => {
		const shadow = holyPint.replace('"spec":"holy_disc"', '"spec":"shadow"').replace('025005001330011-0350510303002053', '00530300103-3-50042201251302051');
		expect(importCharacter(shadow).character.specId).toBe('priest-shadow');
	});
});
