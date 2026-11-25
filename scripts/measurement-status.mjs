// Writes src/data/measurementStatus.json: for every build, when its item effects, weapons and stat weights were
// last measured, and whether that measurement is the one for today's simulator, item data and preset. The app
// shows it next to the list numbers, which come from these measurements and can be a day behind "Simulate".
//
//   node scripts/measurement-status.mjs
//
// Each measuring script answers for itself (--status), so the rule for "still current" lives in one place.
// Run by the workflows after anything that can change the answer: a simulator update, new presets, new numbers.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const read = path => JSON.parse(readFileSync(root + path, 'utf8'));
const ask = (script, id) => {
	try {
		const out = execFileSync('node', [`${root}scripts/${script}`, '--spec', id, '--status'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
		return JSON.parse(out.trim().split('\n').pop());
	} catch {
		return null; // a healing build has no stat-weight run of this kind
	}
};

const builds = {};
for (const file of readdirSync(root + 'src/specs').filter(name => name.endsWith('.json')).sort()) {
	const id = file.slice(0, -5);
	builds[id] = { effects: ask('build-sim-values.mjs', id), weapons: ask('build-weapon-values.mjs', id), weights: ask('build-weights.mjs', id) };
}
// A build whose inputs changed only in name (a new simulator file that does not touch its class) is still current:
// the queue knows which builds an update really touched. Without a queue file, each script's own answer stands.
const queue = existsSync(root + 'src/data/measureQueue.json') ? read('src/data/measureQueue.json') : null;
if (queue) for (const [id, parts] of Object.entries(builds)) for (const kind of ['effects', 'weapons', 'weights']) if (parts[kind]) parts[kind].current = parts[kind].current || !(id in queue[kind]);
const setup = read('public/sim/setup.json');
const status = { simVersion: setup.simVersion?.commit?.slice(0, 10) ?? null, simDate: setup.simVersion?.fetched ?? null, builds };
writeFileSync(root + 'src/data/measurementStatus.json', JSON.stringify(status, null, '\t') + '\n');
const stale = Object.entries(builds).filter(([, parts]) => Object.values(parts).some(part => part && !part.current)).map(([id]) => id);
console.log(`${Object.keys(builds).length} builds; measured on an older simulator, item data or preset: ${stale.length ? stale.join(', ') : 'none'}.`);
