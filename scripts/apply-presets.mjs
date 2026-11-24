// Brings the builds in line with what wowsims.com shows. Reads the exports that .github/workflows/presets.yml
// takes from WoWSims (the branch wowsims-presets: for every spec its defaults and each preset build, loaded the
// way the page loads them) and writes, for every build in src/specs that names one with `wowsims`:
//
//   scripts/builds/<id>.build.json   the build, in the form of a wowsims.com JSON export
//   public/sim/template.<id>.json    the request the site simulates, as scripts/build-data.mjs writes it
//
//   node scripts/apply-presets.mjs <folder with the exports>
//
// Prints one line per changed build with what changed. A build whose export is missing is an error: WoWSims
// renamed or dropped the preset, and `wowsims` in its src/specs file needs a new name.
// The two healing Priest builds name no export: their fight and rotation are the planner's own (scripts/presets).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const from = process.argv[2];
if (!from) {
	console.error('Usage: node scripts/apply-presets.mjs <folder with the exports>');
	process.exit(1);
}
const read = path => JSON.parse(readFileSync(path, 'utf8'));

/** JSON with the keys in order, so the same settings written in another order compare as equal. */
const canon = value => JSON.stringify(value, (_key, part) => (part && typeof part === 'object' && !Array.isArray(part) ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => (a < b ? -1 : 1))) : part));

/** Which top-level parts of two builds differ, for the log. */
function changes(before, after) {
	if (!before) return ['new'];
	const out = [];
	for (const key of ['raidBuffs', 'partyBuffs', 'debuffs', 'encounter']) if (canon(before[key] ?? {}) !== canon(after[key] ?? {})) out.push(key);
	const [a, b] = [before.player ?? {}, after.player ?? {}];
	for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
		if (canon(a[key] ?? null) === canon(b[key] ?? null)) continue;
		if (key === 'equipment') {
			const ids = list => (list?.items ?? []).map(piece => `${piece?.id ?? 0}:${piece?.enchant ?? 0}:${piece?.randomSuffix ?? 0}`);
			const [x, y] = [ids(a.equipment), ids(b.equipment)];
			out.push(`gear (${y.filter((piece, index) => piece !== x[index]).length} slots)`);
		} else if (key === 'consumables') {
			out.push(`consumables (${[...new Set([...Object.keys(a.consumables ?? {}), ...Object.keys(b.consumables ?? {})])].filter(field => canon(a.consumables?.[field]) !== canon(b.consumables?.[field])).join(', ')})`);
		} else if (['race', 'talentsString', 'profession1', 'profession2'].includes(key)) {
			out.push(`${key} ${a[key] ?? '-'} → ${b[key] ?? '-'}`);
		} else out.push(key);
	}
	return out;
}

let failed = false;
for (const file of readdirSync(join(root, 'src/specs')).filter(name => name.endsWith('.json')).sort()) {
	const spec = read(join(root, 'src/specs', file));
	if (!spec.wowsims) continue;
	const source = join(from, `${spec.wowsims}.request.json`);
	if (!existsSync(source)) {
		console.error(`${spec.id}: WoWSims has no preset "${spec.wowsims}" any more. Set "wowsims" in src/specs/${file} to one of the names in the exports.`);
		failed = true;
		continue;
	}
	const request = read(source);
	const party = request.raid.parties[0];
	const { database: _database, ...player } = party.players[0];
	const build = { raidBuffs: request.raid.buffs ?? {}, partyBuffs: party.buffs ?? {}, debuffs: request.raid.debuffs ?? {}, player: { name: 'Player', ...player }, encounter: request.encounter };
	const buildFile = join(root, 'scripts/builds', `${spec.id}.build.json`);
	const changed = changes(existsSync(buildFile) ? read(buildFile) : undefined, build);
	if (!changed.length) continue;
	writeFileSync(buildFile, JSON.stringify(build));
	writeFileSync(
		join(root, 'public/sim', `template.${spec.id}.json`),
		JSON.stringify({ raid: { parties: [{ players: [build.player], buffs: build.partyBuffs }], numActiveParties: 1, buffs: build.raidBuffs, debuffs: build.debuffs }, encounter: build.encounter, type: 'SimTypeIndividual' }),
	);
	// The build's talents are also the spec's default talents in the app.
	if (player.talentsString && spec.talents !== player.talentsString) {
		const specFile = join(root, 'src/specs', file);
		writeFileSync(specFile, readFileSync(specFile, 'utf8').replace(/("talents":\s*")[^"]*(")/, `$1${player.talentsString}$2`));
	}
	console.log(`${spec.id}: ${changed.join('; ')}`);
}
process.exit(failed ? 1 : 0);
