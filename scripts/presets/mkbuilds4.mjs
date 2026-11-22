import { readFileSync, writeFileSync } from 'node:fs';
import { loadSim } from './sim.mjs';
import { C } from './cons.mjs';
const R = '/home/claude/ref/forever/ui/specs/';
const OUT = '/home/claude/forever-gear-planner/scripts/builds/';
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const encounter = read(OUT + 'priest-shadow.build.json').encounter;
const builds = {};
const rogue = (gear, talents) => ({
	raidBuffs: { markOfTheWild: true, strengthOfEarthTotem: 1, windfuryTotem: true, battleShout: 1, leaderOfThePack: true, graceOfAirTotem: 1, powerWordFortitude: true },
	partyBuffs: {},
	debuffs: { curseOfRecklessness: true, giftOfArthas: true, sunderArmor: true, curseOfElements: true },
	player: {
		apiVersion: 2, name: 'Player', race: 'RaceHuman', class: 'ClassRogue',
		equipment: read(R + `rogue/dps/gear_sets/${gear}.gear.json`),
		consumables: { elixirIds: [C.ElixirOfTheMongoose, C.ElixirOfGreaterFortitude, C.ElixirOfFerocity, C.JujuMight], foodId: C.SwiftstrikeSteak, offensivePotId: C.MajorFrenzyPotion, conjuredId: C.ThistleTea, mhImbueId: C.DenseWeightstone, ohImbueId: C.DenseSharpeningStone, mhWeaponImbueId: C.InstantPoisonVI, ohWeaponImbueId: C.DeadlyPoisonIV },
		buffs: { greaterBlessingOfKings: true, greaterBlessingOfMight: 1 },
		rogue: { options: { classOptions: {} } },
		talentsString: talents,
		rotation: read(R + 'rogue/dps/apls/default.apl.json'), distanceFromTarget: 5, reactionTimeMs: 100,
	},
	encounter,
});
builds['rogue-asn-muti'] = rogue('muti', '00530311231251031-32030302020103-001');
builds['rogue-combat-ss'] = rogue('sinister', '00530320201-3200132202012321551');
builds['rogue-combat-bs'] = rogue('backstab', '005303002-3203030202012321351-005');
builds['rogue-sub-hemo'] = rogue('hemo', '00530301-320003-005233031321001151');
builds['rogue-combat-venom'] = rogue('sinister', '00530320241001-320013220201232115');
builds['rogue-hemo-sf'] = rogue('hemo', '0053031121135102-02-0052030313210001');
const log = console.log; console.log = () => {};
const sim = await loadSim('lib.wasm', '/home/claude/simbin/pages-deploy/forever/assets/database/db.json');
console.log = log;
for (const [id, b] of Object.entries(builds)) {
	const req = { raid: { parties: [{ players: [structuredClone(b.player)], buffs: b.partyBuffs }], numActiveParties: 1, buffs: b.raidBuffs, debuffs: b.debuffs }, encounter: b.encounter, type: 'SimTypeIndividual' };
	const r = sim.run(req, 1000);
	log('RESULT', id, r.error ? 'ERROR ' + String(r.error).slice(0, 300) : r.dps.toFixed(1), 'missing', r.missing);
	if (!r.error) writeFileSync(OUT + id + '.build.json', JSON.stringify(b));
}
process.exit(0);
