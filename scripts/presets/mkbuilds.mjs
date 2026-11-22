import { readFileSync, writeFileSync } from 'node:fs';
import { loadSim } from './sim.mjs';
const R = '/home/claude/ref/forever/ui/specs/';
const OUT = '/home/claude/forever-gear-planner/scripts/builds/';
const read = p => JSON.parse(readFileSync(R + p, 'utf8'));
const encounter = JSON.parse(readFileSync('/home/claude/forever-gear-planner/public/sim/template.json', 'utf8')).encounter;
const builds = {};
for (const [id, f] of Object.entries({ 'warlock-sm-ruin': 'sm_ruin', 'warlock-destruction': 'destro', 'warlock-affliction': 'aff_wrack', 'warlock-demo-fire': 'demo_fire_brand', 'warlock-demo-shadow': 'demo_shadow_brand' })) {
	const b = read(`warlock/dps/builds/${f}.build.json`);
	builds[id] = { raidBuffs: b.raidBuffs ?? {}, partyBuffs: b.partyBuffs ?? {}, debuffs: b.debuffs ?? {}, player: b.player, encounter };
}
{
	const b = read('priest/dps/builds/testing.build.json');
	builds['priest-shadow'] = { raidBuffs: b.raidBuffs ?? {}, partyBuffs: b.partyBuffs ?? {}, debuffs: b.debuffs ?? {}, player: b.player, encounter: b.encounter ?? encounter };
}
const mage = (gear, talents, apl, distance) => ({
	raidBuffs: { prayerOfSpirit: true, arcaneIntellect: true, markOfTheWild: true, powerWordFortitude: true, moonkinAura: true },
	partyBuffs: { manaSpringTotem: 2, manaTideTotems: 1, darkInspiration: 5 },
	debuffs: { curseOfElements: true, judgementOfWisdom: true },
	player: {
		apiVersion: 2, name: 'Player', race: 'RaceGnome', class: 'ClassMage',
		equipment: read(`mage/dps/gear_sets/${gear}.gear.json`),
		consumables: { flaskId: 13512, elixirIds: [13454, 13447, 250348, 20007], foodId: 13931, mhImbueId: 20749, mhWeaponImbueId: 277502, resourcePotId: 13444 },
		buffs: { greaterBlessingOfKings: true, greaterBlessingOfWisdom: 1, innervates: 1 },
		mage: { options: { classOptions: { defaultMageArmor: 'MageArmorMageArmor' } } },
		talentsString: talents, profession1: 'Engineering', profession2: 'Tailoring',
		rotation: read(`mage/dps/apls/${apl}.apl.json`), distanceFromTarget: distance, reactionTimeMs: 100, channelClipDelayMs: 100,
	},
	encounter,
});
builds['mage-arcane'] = mage('preraid', '050205223101311531-5500003-003', 'arcane', 20);
builds['mage-fire'] = mage('preraidFire', '0502052001001-55500001230133031-003', 'deepFire', 20);
builds['mage-frost'] = mage('preraidFrost', '2032250100003--053500001121331251', 'frost', 28);
const log = console.log; console.log = () => {};
const sim = await loadSim('lib.wasm', '/home/claude/simbin/pages-deploy/forever/assets/database/db.json');
console.log = log;
for (const [id, b] of Object.entries(builds)) {
	const req = { raid: { parties: [{ players: [structuredClone(b.player)], buffs: b.partyBuffs }], numActiveParties: 1, buffs: b.raidBuffs, debuffs: b.debuffs }, encounter: b.encounter, type: 'SimTypeIndividual' };
	const t = Date.now(); const r = sim.run(req, 500);
	console.log(id, r.error ? 'ERROR ' + r.error.slice(0, 300) : r.dps.toFixed(1), 'missing', r.missing, Date.now() - t, 'ms');
	if (!r.error) writeFileSync(OUT + id + '.build.json', JSON.stringify(b));
}
process.exit(0);
