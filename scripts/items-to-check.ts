// Writes docs/items-to-check.md: every item whose source is a guess ("World drop (assumed)") or missing,
// most important first. An item matters when the planner would offer it: it counts for each build that has
// it among a slot's ten best items, starting from empty gear.
//
//   npx vite-node scripts/items-to-check.ts
//
// Fix an item by adding its source to src/config/sources.manual.json, or to src/config/not-available.json
// when it cannot be had; it then drops off this list.
import { writeFileSync } from 'node:fs';

import { GEAR_SLOTS } from '../src/lib/constants';
import { loadGameData } from '../src/lib/gameData';
import { DEFAULT_FILTER, notYetAvailable, slotCandidates, type Gear } from '../src/lib/scoring';
import { SPECS } from '../src/lib/specs';
import type { Character, Item } from '../src/lib/types';

const TOP = 10;
const ROWS = 300;
// Green items with a random suffix ("of the Eagle") and no listed source are random drops for certain: not worth checking.
const guessed = (item: Item) => !item.sources?.length || item.sources.some(source => (source.assumed && !item.randomSuffixOptions?.length) || source.kind === 'unknown');

interface Row {
	item: Item;
	builds: Set<string>;
	best: number;
}
const rows = new Map<number, Row>();
let open = 0;
const all = new Map<number, Item>();
for (const spec of SPECS) {
	const data = await loadGameData(spec);
	for (const item of data.itemById.values()) all.set(item.id, item);
	const gear: Gear = GEAR_SLOTS.map(() => null);
	const character = { race: spec.races[0]?.id ?? null, level: 60, talents: '', gear, specId: spec.id, professions: [] } as unknown as Character;
	const seen = new Set<number>();
	for (let slot = 0; slot < GEAR_SLOTS.length; slot++) {
		const list = slotCandidates(slot, gear, { character, data, spec, filter: { ...DEFAULT_FILTER, randomSuffix: true } });
		list.slice(0, TOP).forEach((candidate, rank) => {
			if (!guessed(candidate.item) || seen.has(candidate.item.id)) return;
			seen.add(candidate.item.id);
			const row = rows.get(candidate.item.id) ?? { item: candidate.item, builds: new Set<string>(), best: TOP };
			row.builds.add(spec.name);
			row.best = Math.min(row.best, rank + 1);
			rows.set(candidate.item.id, row);
		});
	}
}
for (const item of all.values()) if (guessed(item) && !notYetAvailable(item)) open++;

const why = (item: Item) => (!item.sources?.length ? 'no source' : 'guessed world drop');
const ranked = [...rows.values()].sort((a, b) => b.builds.size - a.builds.size || a.best - b.best || (b.item.ilvl ?? 0) - (a.item.ilvl ?? 0));
const rest = [...all.values()]
	.filter(item => guessed(item) && !notYetAvailable(item) && !rows.has(item.id) && ['rare', 'epic'].includes(item.quality ?? ''))
	.sort((a, b) => (b.ilvl ?? 0) - (a.ilvl ?? 0) || a.name.localeCompare(b.name));
const line = (item: Item, extra: string) => `- [${item.name}](https://www.wowhead.com/forever/item=${item.id}) (${item.id}, ${item.quality} ${item.ilvl ?? '?'}, ${item.slot}): ${why(item)}${extra}`;

const text = `# Items to check

Items whose source the planner does not know: it either guesses "World drop (assumed)" or shows "Source unknown".
${open} such items are in the data; this page lists the ones worth checking first. Written by
\`scripts/items-to-check.ts\`; do not edit by hand. To fix one, add its source to \`src/config/sources.manual.json\`
(or to \`src/config/not-available.json\` when it cannot be had), or open an issue saying where it comes from.

## In a build's top ${TOP} for a slot (${ranked.length})

Most builds first. "best #2" = second-best item of its slot for at least one build, starting from empty gear.

${ranked.slice(0, ROWS).map(row => line(row.item, `; ${row.builds.size} build${row.builds.size === 1 ? '' : 's'}, best #${row.best} (${[...row.builds].slice(0, 4).join(', ')}${row.builds.size > 4 ? ', …' : ''})`)).join('\n')}

## Other rare and epic items (${rest.length})

${rest.slice(0, ROWS).map(item => line(item, '')).join('\n')}
`;
writeFileSync(new URL('../docs/items-to-check.md', import.meta.url), text);
console.log(`${open} items with a guessed or missing source; ${ranked.length} in a top ${TOP}, ${rest.length} other rare or epic.`);
process.exit(0);
