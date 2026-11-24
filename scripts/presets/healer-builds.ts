// Writes the healing Priest's build files (scripts/builds/priest-holy.build.json and
// priest-disc.build.json) from the WoWSims healer defaults and this planner's default healing
// scenario. Run with:  npx vite-node scripts/presets/healer-builds.ts -- <path to a wowsims/forever clone>
//
// WoWSims' healer Priest is a gear planner without a healing rotation (ui/specs/priest/healer);
// gear, consumables, buffs and talents come from there, the rotation from src/lib/sim/healing.ts.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_HEALING, healingFight } from '../../src/lib/sim/healing';

const repo = process.argv.at(-1)!;
const ROOT = new URL('../..', import.meta.url).pathname;
const gear = JSON.parse(readFileSync(join(repo, 'ui/specs/priest/healer/gear_sets/preraid.gear.json'), 'utf8')).items;
const presets = readFileSync(join(repo, 'ui/specs/priest/healer/presets.ts'), 'utf8');
const consumableIds = readFileSync(join(repo, 'ui/features/settings/model/consumables_auto_gen.ts'), 'utf8');
const idOf = (name: string) => Number(consumableIds.match(new RegExp(`export const ${name} = \\{ id: (\\d+)`))![1]);
const one = (field: string) => idOf(presets.match(new RegExp(`${field}: Consumables\\.(\\w+)\\.id`))![1]);
const elixirs = [...presets.match(/elixirIds: \[([\s\S]*?)\]/)![1].matchAll(/Consumables\.(\w+)\.id/g)].map(match => idOf(match[1]));
const talents = (name: string) => presets.match(new RegExp(`makePresetTalents\\('${name}', SavedTalents\\.create\\(\\{ talentsString: '([^']+)'`))![1];

const fight = healingFight(DEFAULT_HEALING);
const build = (talentsString: string) => ({
	// ui/sim/proto/utils.ts: defaultHealerRaidBuffs, defaultHealerPartyBuffs, defaultHealerIndividualBuffs.
	raidBuffs: { arcaneIntellect: true, markOfTheWild: true, powerWordFortitude: true, prayerOfSpirit: true },
	partyBuffs: { manaSpringTotem: 'TristateEffectRegular' },
	debuffs: {},
	player: {
		apiVersion: 2,
		name: 'Player',
		race: 'RaceDwarf',
		class: 'ClassPriest',
		equipment: { items: gear },
		consumables: { foodId: one('foodId'), mhImbueId: one('mhImbueId'), resourcePotId: one('resourcePotId'), conjuredId: one('conjuredId'), elixirIds: elixirs },
		buffs: { greaterBlessingOfKings: true, greaterBlessingOfWisdom: 1 },
		healerPriest: { options: { classOptions: { armor: 'InnerFire' }, prayerOfMendingJumps: 5, prayerOfMendingDelay: 2.5, holyNovaHealTargets: 5 } },
		talentsString,
		profession1: 'Tailoring',
		profession2: 'Enchanting',
		rotation: fight.rotation,
		distanceFromTarget: 20,
	},
	encounter: {
		apiVersion: 2,
		duration: fight.duration,
		durationVariation: 5,
		targets: [{ id: 31146, name: 'Raid Target', level: 63, stats: Array(39).fill(0), minBaseDamage: 0, swingSpeed: 2 }],
	},
});
writeFileSync(join(ROOT, 'scripts/builds/priest-holy.build.json'), JSON.stringify(build(talents('Holy'))));
writeFileSync(join(ROOT, 'scripts/builds/priest-disc.build.json'), JSON.stringify(build(talents('Disc'))));
console.log('Wrote the Holy and Discipline healer builds.');
