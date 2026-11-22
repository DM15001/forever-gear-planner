import { readFileSync, writeFileSync } from 'node:fs';
import { loadSim } from './sim.mjs';
import { C } from './cons.mjs';
const R = '/home/claude/ref/forever/ui/specs/';
const OUT = '/home/claude/forever-gear-planner/scripts/builds/';
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const encounter = read(OUT + 'priest-shadow.build.json').encounter;
const builds = {};
const warrior = (gear, talents, apl, consumables) => ({
	raidBuffs: { powerWordFortitude: true, markOfTheWild: true, strengthOfEarthTotem: 1, windfuryTotem: true, graceOfAirTotem: 1, leaderOfThePack: true },
	partyBuffs: {},
	debuffs: { giftOfArthas: true, exposeArmor: true, faerieFire: true, sunderArmor: true, curseOfRecklessness: true },
	player: {
		apiVersion: 2, name: 'Player', race: 'RaceOrc', class: 'ClassWarrior',
		equipment: read(R + `warrior/dps/gear_sets/${gear}.gear.json`),
		consumables,
		buffs: { greaterBlessingOfKings: true, greaterBlessingOfMight: 1 },
		dpsWarrior: { options: { classOptions: { queueDelay: 250, startingRage: 50, useBattleShout: true, defaultStance: 'WarriorStanceBerserker', stanceSnapshot: true } } },
		talentsString: talents, profession1: 'Engineering', profession2: 'Blacksmithing',
		rotation: read(R + `warrior/dps/apls/${apl}.apl.json`), distanceFromTarget: 25, reactionTimeMs: 100,
	},
	encounter,
});
const base = { foodId: C.SmokedDesertDumplings, explosiveId: C.SAFTCleverDynamite, extraIds: [C.GoblinSapperCharge], resourcePotId: C.MightyRagePotion, elixirIds: [C.ElixirOfFerocity, C.ElixirOfTheMongoose, C.WinterfallFirewater] };
builds['warrior-fury'] = warrior('prebis_fury', '30303213002-050530045122100231', 'fury', { ...base, mhImbueId: C.DenseWeightstone, ohImbueId: C.DenseSharpeningStone });
builds['warrior-arms'] = warrior('prebis_arms', '30303213132215201-55050000002-2', 'arms', { ...base, mhImbueId: C.DenseSharpeningStone });
const log = console.log; console.log = () => {};
const sim = await loadSim('lib.wasm', '/home/claude/simbin/pages-deploy/forever/assets/database/db.json');
console.log = log;
for (const [id, b] of Object.entries(builds)) {
	const req = { raid: { parties: [{ players: [structuredClone(b.player)], buffs: b.partyBuffs }], numActiveParties: 1, buffs: b.raidBuffs, debuffs: b.debuffs }, encounter: b.encounter, type: 'SimTypeIndividual' };
	const r = sim.run(req, 1000); const st = sim.stats(req); const f = st?.raidStats?.parties?.[0]?.players?.[0]?.finalStats;
	log('RESULT', id, r.error ? 'ERROR ' + String(r.error).slice(0, 300) : r.dps.toFixed(1), 'missing', r.missing, 'hit', f?.stats?.[17], 'meleeHit%', f?.pseudoStats?.slice(0, 6));
	if (!r.error) writeFileSync(OUT + id + '.build.json', JSON.stringify(b));
}
process.exit(0);
