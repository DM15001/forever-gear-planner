import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';

import { beforeAll, describe, expect, it } from 'vitest';

import specJson from '../../specs/enhancement-shaman.json';
import simExport from '../__fixtures__/sim-export.json';
import { loadGameData } from '../gameData';
import { guidePlan } from '../guides';
import { importCharacter } from '../importCharacter';
import { plannedGear } from '../scoring';
import type { Character, SpecConfig } from '../types';
import { buildSimRequest, indexSimDb, readSimResult, simKey } from './request';

const spec = specJson as unknown as SpecConfig;
const data = await loadGameData();
const imported = importCharacter(JSON.stringify(simExport), spec).character;
const dwarf: Character = { ...imported, race: 'RaceDwarf', professions: ['Skinning', 'Leatherworking'], gear: imported.gear.map(p => (p ? { id: p.id } : null)) };
const read = (name: string) => JSON.parse(readFileSync(`public/sim/${name}`, 'utf8'));
const index = indexSimDb(read('db.json'), read('template.enhancement-shaman.json'));

describe('buildSimRequest', () => {
	const { request, missingItems } = buildSimRequest(dwarf, dwarf.gear, index, 500) as any;
	const player = request.raid.parties[0].players[0];

	it('puts the character into the sim defaults', () => {
		expect(player.race).toBe('RaceDwarf');
		expect(player.profession1).toBe('Skinning');
		expect(player.profession2).toBe('Leatherworking');
		expect(player.talentsString).toBe(dwarf.talents);
		expect(player.equipment.items).toHaveLength(17);
		expect(player.equipment.items[0]).toEqual({ id: 17740 });
		expect(player.equipment.items[15]).toEqual({});
		expect(player.rotation).toBeDefined();
		expect(request.simOptions).toEqual({ iterations: 500, randomSeed: '1' });
		expect(missingItems).toEqual([]);
	});

	it('attaches the item records the request refers to, and no others', () => {
		const ids = player.database.items.map((i: { id: number }) => i.id).sort();
		const wanted = [...dwarf.gear, ...player.itemSwap.items].filter(p => p?.id).map(p => p.id);
		expect(ids).toEqual([...new Set(wanted)].sort());
	});

	it('leaves the template untouched and reports unknown items', () => {
		expect(index.template.raid.parties[0].players[0].database).toBeUndefined();
		const odd = dwarf.gear.map((p, i) => (i === 1 ? { id: 999999999 } : p));
		const built = buildSimRequest(dwarf, odd, index, 100) as any;
		expect(built.missingItems).toEqual([999999999]);
		expect(built.request.raid.parties[0].players[0].equipment.items[1]).toEqual({});
	});

	it('includes enchants and keys runs by gear', () => {
		const enchanted = dwarf.gear.map((p, i) => (i === 14 && p ? { ...p, enchant: 1900 } : p));
		const built = buildSimRequest(dwarf, enchanted, index, 100) as any;
		expect(built.request.raid.parties[0].players[0].database.enchants.map((e: { effectId: number }) => e.effectId)).toContain(1900);
		expect(simKey(dwarf, enchanted, 100)).not.toBe(simKey(dwarf, dwarf.gear, 100));
		expect(simKey(dwarf, dwarf.gear, 100)).toBe(simKey({ ...dwarf }, [...dwarf.gear], 100));
	});
});

describe('readSimResult', () => {
	it('reads DPS and its standard error', () => {
		const outcome = readSimResult(JSON.stringify({ raidMetrics: { dps: { avg: 700, stdev: 70 } }, error: null }), 4900);
		expect(outcome).toEqual({ dps: 700, error: 1, iterations: 4900 });
	});

	it('throws on a rejected request or a sim error', () => {
		expect(() => readSimResult(null, 100)).toThrow(/rejected/);
		expect(() => readSimResult(JSON.stringify({ error: { message: 'bad talents' } }), 100)).toThrow(/bad talents/);
	});
});

// The real simulator, run in Node the same way the browser worker runs it.
describe('the WebAssembly sim', () => {
	let raidSimJson: (request: string) => string;

	beforeAll(async () => {
		const require = createRequire(import.meta.url);
		require('../../../public/sim/wasm_exec.js');
		const g = globalThis as any;
		const ready = new Promise<void>(resolve => (g.wasmready = resolve));
		const log = console.log;
		console.log = () => {}; // the sim logs every request
		const go = new g.Go();
		const { instance } = await WebAssembly.instantiate(gunzipSync(readFileSync('public/sim/lib.wasm.gz')), go.importObject);
		go.run(instance);
		await ready;
		raidSimJson = g.raidSimJson;
		return () => (console.log = log);
	}, 60_000);

	const dpsOf = (character: Character, gear: Character['gear']) => readSimResult(raidSimJson(JSON.stringify(buildSimRequest(character, gear, index, 400).request)), 400).dps;

	it('simulates the equipped gear and ranks a guide set above it', () => {
		const equipped = dpsOf(dwarf, dwarf.gear);
		expect(equipped).toBeGreaterThan(500);
		expect(equipped).toBeLessThan(900);
		const plan = guidePlan(data.guides.find(g => g.id === 'wowhead')!, dwarf, data, spec).plan;
		expect(dpsOf(dwarf, plannedGear({ ...dwarf, plan }))).toBeGreaterThan(equipped + 100);
	}, 60_000);
});
