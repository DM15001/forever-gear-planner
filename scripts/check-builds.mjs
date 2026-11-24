// Looks for settings in the builds (scripts/builds, public/sim/template.*.json) that the current WoWSims data
// no longer allows: two elixirs of one group (they do not stack, and wowsims.com drops one on import) and
// consumables the data no longer has. Prints one line per finding; prints nothing when all is well.
//
// The builds are copies of the WoWSims presets taken by hand, so they fall behind when WoWSims regroups its
// consumables. .github/workflows/engine.yml runs this after every simulator update and opens an issue.
import { readdirSync, readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const read = path => JSON.parse(readFileSync(root + path, 'utf8'));
const byId = new Map(read('public/sim/db.json').consumables.map(c => [c.id, c]));

for (const file of readdirSync(root + 'public/sim').filter(name => /^template\..+\.json$/.test(name)).sort()) {
	const build = file.slice('template.'.length, -'.json'.length);
	const consumables = read(`public/sim/${file}`).raid.parties[0].players[0].consumables ?? {};
	const ids = Object.values(consumables).flat().filter(value => typeof value === 'number');
	for (const id of ids) if (!byId.has(id)) console.log(`${build}: consumable ${id} is not in the WoWSims data any more`);
	const groups = new Map();
	for (const id of consumables.elixirIds ?? []) {
		const elixir = byId.get(id);
		if (elixir?.groupKey) groups.set(elixir.groupKey, [...(groups.get(elixir.groupKey) ?? []), elixir.name]);
	}
	for (const names of groups.values()) if (names.length > 1) console.log(`${build}: ${names.join(' and ')} are one group and do not stack`);
}
