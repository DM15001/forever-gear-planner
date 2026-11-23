// Checks whether the WoWSims engine can cast Prayer of Mending yet. It could not on
// wowsims/forever 7322fc0 and c83d90c ("CritDamageMultiplier() called for {SpellID: 1240827}
// which has no DefenseType"), which is why src/lib/sim/mending.ts adds the spell as an estimate.
// Run with:
//   WASM=<lib.wasm, unzipped> DB=<forever/assets/database/db.json> WASM_EXEC=<Go's wasm_exec.js> \
//     npx vite-node scripts/presets/check-mending.ts
// Prints one line: "MENDING fixed: ..." or "MENDING still broken: ...".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { applyHealingFight, DEFAULT_HEALING } from '../../src/lib/sim/healing';
// @ts-expect-error plain JS helper without types
import { loadSim } from './sim.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const log = console.log;
console.log = () => {};
const sim = await loadSim(process.env.WASM, process.env.DB);

const request = JSON.parse(readFileSync(join(ROOT, 'public/sim/template.priest-holy.json'), 'utf8'));
applyHealingFight(request, DEFAULT_HEALING);
const player = request.raid.parties[0].players[0];
// The talent is the 17th of the Holy tree; one point less elsewhere keeps the total.
const [discipline, holy = ''] = String(player.talentsString).split('-');
player.talentsString = `${discipline}-${holy.padEnd(16, '0').slice(0, 16)}1`;
const mending = { action: { castFriendlySpell: { spellId: { spellId: 1240827, rank: 3 }, target: { type: 'Player', index: 1 } } } };
player.rotation.priorityList = [mending, ...player.rotation.priorityList];

let line: string;
try {
	const outcome = sim.run(request, 200);
	const text = JSON.stringify(outcome.result?.raidMetrics?.parties?.[0]?.players?.[0]?.actions ?? []);
	if (outcome.error) line = `MENDING still broken: ${outcome.error}`;
	else if (!text.includes('1240827')) line = 'MENDING still broken: the run finished but the spell was never cast';
	else line = `MENDING fixed: the engine casts it (${Math.round(outcome.result.raidMetrics.hps.avg)} HPS in the default scenario)`;
} catch (err) {
	line = `MENDING still broken: ${String((err as Error)?.message ?? err).slice(0, 300)}`;
}
console.log = log;
log(line);
process.exit(0);
