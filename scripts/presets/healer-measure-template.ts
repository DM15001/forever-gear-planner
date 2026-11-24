// Writes scripts/builds/<id>.healing.json for every healing build: its preset with the default
// healing fight (src/lib/sim/healing.ts) already set up. scripts/build-sim-values.mjs is plain
// JavaScript and cannot run that TypeScript itself, so it measures item effects and set bonuses
// for healers on this file, in healing per second.
// Run after a change to healing.ts or to a healer's preset:
//   npx vite-node scripts/presets/healer-measure-template.ts
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { applyHealingFight, DEFAULT_HEALING } from '../../src/lib/sim/healing';

const ROOT = new URL('../..', import.meta.url).pathname;
for (const file of readdirSync(join(ROOT, 'src/specs'))) {
	const spec = JSON.parse(readFileSync(join(ROOT, 'src/specs', file), 'utf8'));
	if (spec.role !== 'healer') continue;
	const request = JSON.parse(readFileSync(join(ROOT, 'public/sim', `template.${spec.id}.json`), 'utf8'));
	applyHealingFight(request, DEFAULT_HEALING);
	writeFileSync(join(ROOT, 'scripts/builds', `${spec.id}.healing.json`), JSON.stringify(request));
	console.log(`wrote scripts/builds/${spec.id}.healing.json`);
}
