import { readFileSync, writeFileSync } from 'node:fs';
import { loadSim } from './sim.mjs';
const R = '/home/claude/ref/forever/ui/specs/';
const OUT = '/home/claude/forever-gear-planner/scripts/builds/';
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const builds = {};
const mage = (base, gear, talents, apl) => {
	const b = read(OUT + base + '.build.json');
	b.player.equipment = read(R + `mage/dps/gear_sets/${gear}.gear.json`);
	b.player.talentsString = talents;
	b.player.rotation = read(R + `mage/dps/apls/${apl}.apl.json`);
	return b;
};
builds['mage-arcane-fire'] = mage('mage-arcane', 'preraid', '050205203100311531-525000012001-003', 'arcaneFireFill');
builds['mage-ffb'] = mage('mage-arcane', 'preraid', '-5550000123011303-2035010311013002', 'ffb');
builds['mage-frost-incin'] = mage('mage-frost', 'preraidFrost', '203205-5-053500011121331251', 'frost');
{
	const b = read(R + 'priest/dps/builds/smite_testing.build.json');
	const encounter = read(OUT + 'priest-shadow.build.json').encounter;
	builds['priest-smite'] = { raidBuffs: b.raidBuffs ?? {}, partyBuffs: b.partyBuffs ?? {}, debuffs: b.debuffs ?? {}, player: b.player, encounter: b.encounter ?? encounter };
}
const log = console.log; console.log = () => {};
const sim = await loadSim('lib.wasm', '/home/claude/simbin/pages-deploy/forever/assets/database/db.json');
console.log = log;
for (const [id, b] of Object.entries(builds)) {
	const req = { raid: { parties: [{ players: [structuredClone(b.player)], buffs: b.partyBuffs }], numActiveParties: 1, buffs: b.raidBuffs, debuffs: b.debuffs }, encounter: b.encounter, type: 'SimTypeIndividual' };
	const t = Date.now(); const r = sim.run(req, 500);
	log(id, r.error ? 'ERROR ' + r.error.slice(0, 300) : r.dps.toFixed(1), 'missing', r.missing, Date.now() - t, 'ms');
	if (!r.error) writeFileSync(OUT + id + '.build.json', JSON.stringify(b));
}
process.exit(0);
