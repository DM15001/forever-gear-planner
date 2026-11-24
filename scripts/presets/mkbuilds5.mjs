import { readFileSync, writeFileSync } from 'node:fs';
import { loadSim } from './sim.mjs';
import { C } from './cons.mjs';
const R = '/home/claude/ref/forever/ui/specs/';
const OUT = '/home/claude/forever-gear-planner/scripts/builds/';
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const encounter = read(OUT + 'priest-shadow.build.json').encounter;
const builds = {};
builds['druid-balance'] = {
	raidBuffs: { arcaneIntellect: true, markOfTheWild: true, powerWordFortitude: true, prayerOfSpirit: true },
	partyBuffs: { manaSpringTotem: 1 },
	debuffs: { curseOfElements: true, judgementOfWisdom: true },
	player: {
		apiVersion: 2, name: 'Player', race: 'RaceNightElf', class: 'ClassDruid',
		equipment: read(R + 'druid/balance/gear_sets/prebis.gear.json'),
		consumables: { conjuredId: C.DemonicRune, elixirIds: [C.GreaterArcaneElixir, C.ElixirOfNaturePower, C.ElixirOfTheOwl, C.GreaterMagebloodElixir], explosiveId: C.SAFTCleverDynamite, flaskId: C.FlaskOfSupremePower, foodId: C.LobsterStew, mhImbueId: C.BrilliantWizardOil, offensivePotId: C.MajorSpellblastingPotion, resourcePotId: C.MajorManaPotion },
		buffs: { greaterBlessingOfKings: true, greaterBlessingOfWisdom: 1 },
		balanceDruid: { options: { classOptions: {} } },
		talentsString: '5232220115501351--5053', profession1: 'Enchanting', profession2: 'Tailoring',
		rotation: read(R + 'druid/balance/apls/default.apl.json'), distanceFromTarget: 20, reactionTimeMs: 100, channelClipDelayMs: 100,
	},
	encounter,
};
const cat = talents => ({
	raidBuffs: { arcaneIntellect: true, prayerOfSpirit: true, markOfTheWild: true, powerWordFortitude: true, strengthOfEarthTotem: 1, graceOfAirTotem: 1, windfuryTotem: true, battleShout: 1 },
	partyBuffs: { manaSpringTotem: 1 },
	debuffs: { judgementOfWisdom: true, sunderArmor: true, giftOfArthas: true, vindication: true },
	player: {
		apiVersion: 2, name: 'Player', race: 'RaceTauren', class: 'ClassDruid',
		equipment: read(R + 'druid/feralcat/gear_sets/pre_raid.gear.json'),
		itemSwap: { items: Array.from({ length: 17 }, (_, slot) => (slot === 14 ? { id: 9449, enchant: 1896 } : {})) },
		consumables: { flaskId: C.FlaskOfNaturalAggression, foodId: C.SwiftstrikeSteak, conjuredId: C.DemonicRune, explosiveId: C.EZThroDarkBomb, mhImbueId: C.DenseWeightstone, swapMhImbueId: C.DenseWeightstone, extraIds: [C.JujuMight, C.GroundScorpokAssay, C.GoblinSapperCharge], elixirIds: [C.ElixirOfCunning, C.ElixirOfSages, C.ElixirOfThePhalanx, C.GreaterMagebloodElixir, C.ElixirOfTheGrizzly], resourcePotId: C.MajorManaPotion, offensivePotId: C.MightyRagePotion },
		buffs: { greaterBlessingOfKings: true, greaterBlessingOfMight: 1 },
		feralCatDruid: { options: { assumeBleedActive: true } },
		talentsString: talents, profession1: 'Engineering', profession2: 'Enchanting',
		rotation: read(R + 'druid/feralcat/apls/adaptive.apl.json'), distanceFromTarget: 25, reactionTimeMs: 250,
	},
	encounter,
});
builds['druid-cat'] = cat('050021-53200032123012125001-055');
const log = console.log; console.log = () => {};
const sim = await loadSim('lib.wasm', '/home/claude/simbin/pages-deploy/forever/assets/database/db.json');
console.log = log;
for (const [id, b] of Object.entries(builds)) {
	const req = { raid: { parties: [{ players: [structuredClone(b.player)], buffs: b.partyBuffs }], numActiveParties: 1, buffs: b.raidBuffs, debuffs: b.debuffs }, encounter: b.encounter, type: 'SimTypeIndividual' };
	const r = sim.run(req, 1000); const st = sim.stats(req); const f = st?.raidStats?.parties?.[0]?.players?.[0]?.finalStats;
	log('RESULT', id, r.error ? 'ERROR ' + String(r.error).slice(0, 300) : r.dps.toFixed(1), 'missing', r.missing, 'hit', f?.stats?.[17], 'spellhit', f?.pseudoStats?.[13], f?.pseudoStats?.[6], f?.pseudoStats?.[10]);
	if (!r.error) writeFileSync(OUT + id + '.build.json', JSON.stringify(b));
}
process.exit(0);
