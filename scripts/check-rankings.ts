// A sanity check on the measured numbers: an item far below the level of a level 60 plan should not be among a
// slot's three best. When one is, either its effect is truly special or WoWSims values it wrongly (Lord
// Sakrasis' Scepter was the best caster off hand while its proc had a placeholder rate). Writes
// docs/ranking-flags.md and prints one line per flagged item; prints nothing when there are none.
//
//   npx vite-node scripts/check-rankings.ts
//
// Run by the measurement workflows after new numbers are saved; they open an issue with the lines.
// An item that was looked at and is fine goes into src/config/sim-issues.json under "fine".
import { writeFileSync } from 'node:fs';

import simIssues from '../src/config/sim-issues.json';
import { GEAR_SLOTS } from '../src/lib/constants';
import { loadGameData } from '../src/lib/gameData';
import { DEFAULT_FILTER, slotCandidates, type Gear } from '../src/lib/scoring';
import { SPECS } from '../src/lib/specs';
import type { Character, Item } from '../src/lib/types';

const TOP = 3;
const LOW_ITEM_LEVEL = 50;
const fine = new Set(Object.keys((simIssues as { fine?: Record<string, string> }).fine ?? {}).map(Number));

const flagged = new Map<number, { item: Item; builds: Map<string, { rank: number; effect: number }> }>();
for (const spec of SPECS) {
	const data = await loadGameData(spec);
	const gear: Gear = GEAR_SLOTS.map(() => null);
	const character = { race: spec.races[0]?.id ?? null, level: 60, talents: '', gear, specId: spec.id, professions: [] } as unknown as Character;
	for (let slot = 0; slot < GEAR_SLOTS.length; slot++) {
		const list = slotCandidates(slot, gear, { character, data, spec, filter: { ...DEFAULT_FILTER, unknown: true, randomSuffix: true } });
		list.slice(0, TOP).forEach((candidate, index) => {
			const { item } = candidate;
			if ((item.ilvl ?? 99) >= LOW_ITEM_LEVEL || fine.has(item.id)) return;
			const row = flagged.get(item.id) ?? { item, builds: new Map() };
			if (!row.builds.has(spec.name)) row.builds.set(spec.name, { rank: index + 1, effect: data.simValues.items.get(item.id) ?? 0 });
			flagged.set(item.id, row);
		});
	}
}

const rows = [...flagged.values()].sort((a, b) => b.builds.size - a.builds.size || a.item.name.localeCompare(b.item.name));
const line = (row: (typeof rows)[number]) => {
	const builds = [...row.builds];
	const effect = Math.max(...builds.map(([, entry]) => entry.effect));
	return `${row.item.name} (${row.item.id}, ${row.item.quality} ${row.item.ilvl}, ${row.item.slot}): top ${TOP} for ${builds.length} build${builds.length === 1 ? '' : 's'} (${builds.slice(0, 3).map(([name, entry]) => `${name} #${entry.rank}`).join(', ')}${builds.length > 3 ? ', …' : ''})${effect ? `; its effect is measured at up to ${effect.toFixed(1)}` : ''}`;
};
writeFileSync(
	new URL('../docs/ranking-flags.md', import.meta.url),
	`# Ranking flags

Items below item level ${LOW_ITEM_LEVEL} that are among a slot's ${TOP} best for a build, starting from empty gear. Each is either
truly special or valued wrongly by the simulator: look at how its effect works before trusting it. Written by
\`scripts/check-rankings.ts\` after every measurement; do not edit by hand. An item that is fine goes into
\`src/config/sim-issues.json\` under "fine" and leaves this list; one that is wrong goes under "wrong" and is kept out of the lists.

${rows.length ? rows.map(row => `- ${line(row)}`).join('\n') : 'None.'}
`,
);
for (const row of rows) console.log(line(row));
process.exit(0);
