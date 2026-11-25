// The list of builds whose measured numbers are behind the simulator: src/data/measureQueue.json.
//
// A simulator update does not change every build. WoWSims keeps each class in its own folder, so a commit that
// only touches the mage needs new numbers for the mage builds alone, and a commit that only touches the
// interface needs none. This script works out which builds an update touches, keeps them in a queue per kind of
// measurement, starts the measurements for what is queued, and takes builds off the queue when they are measured.
//
//   node scripts/measure-queue.mjs add --repo <wowsims checkout> --from <commit> --to <commit>
//   node scripts/measure-queue.mjs add --specs "mage-fire mage-frost"     builds changed by a preset update
//   node scripts/measure-queue.mjs add --all                              everything, when in doubt
//   node scripts/measure-queue.mjs seq                                    the number of the last update queued
//   node scripts/measure-queue.mjs pending <effects|weights|weapons>      the builds waiting, space separated
//   node scripts/measure-queue.mjs done <kind> --seq <n> [--specs "..."]  measured: off the queue (all of the kind without --specs)
//   node scripts/measure-queue.mjs start [--self <kind>]                  start a run for every kind with builds waiting
//
// Every "add" raises a counter and stamps the builds with it. A measurement notes the counter when it starts and,
// when it ends, only takes off the builds stamped up to that number: a build queued again while it ran stays queued.
// "start" needs the gh command and GH_TOKEN; it leaves a kind alone while a run of that kind is going, except the
// one given with --self (a run that starts its own successor as its last step).
//
// The nightly full run measures everything whatever this list says, so a wrong guess here costs a day at most.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const FILE = root + 'src/data/measureQueue.json';
const KINDS = { effects: 'measure.yml', weights: 'weights.yml', weapons: 'weapons.yml' };
const CLASSES = ['druid', 'hunter', 'mage', 'paladin', 'priest', 'rogue', 'shaman', 'warlock', 'warrior'];

const specs = readdirSync(root + 'src/specs')
	.filter(name => name.endsWith('.json'))
	.map(name => JSON.parse(readFileSync(root + 'src/specs/' + name, 'utf8')));
/** Which builds a kind of measurement covers: the same rule as the "list" job of its workflow. */
const covers = {
	effects: () => true,
	weights: spec => spec.role !== 'healer',
	weapons: spec => spec.role !== 'healer' && ((spec.weights?.mainHandDps ?? 0) > 0 || (spec.weights?.rangedDps ?? 0) > 0),
};
const idsOf = kind => specs.filter(covers[kind]).map(spec => spec.id);

const load = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { seq: 0, effects: {}, weights: {}, weapons: {} });
const save = queue => writeFileSync(FILE, JSON.stringify(queue, null, '\t') + '\n');

/**
 * What one changed file of WoWSims means for the measurements: 'none', 'all', or the name of a class.
 * Anything not known here counts as 'all': a wasted run is cheaper than a missed change.
 */
export function touches(path) {
	if (/(_test\.go|\.results|\.md|\.test\.tsx?)$/.test(path)) return 'none';
	const [top, second, third] = path.split('/');
	if (top === 'sim') {
		if (CLASSES.includes(second)) return second;
		return 'all'; // core, common, siml, encounters, lib, wasm, register_all.go: shared by every class
	}
	if (top === 'ui') return second === 'specs' && CLASSES.includes(third) ? third : 'none'; // a class's presets; the rest is interface
	if (top === 'assets') return second === 'database' || second === 'db_inputs' ? 'all' : 'none'; // the item and spell data
	if (top === 'proto' || path === 'go.mod' || path === 'go.sum') return 'all';
	const harmless = ['docs', '.github', 'cmd', 'tools', 'schemas', '.vscode', '.devcontainer'];
	const harmlessFiles = /^(skills-lock\.json|package(-lock)?\.json|makefile|Dockerfile|docker-compose\.yml|tsconfig\.json|buf\.yaml|LICENSE|gitconfig|pre-commit|upgrade\.sh|\.gitignore|\.gitattributes|\.editorconfig|\.prettierrc.*|[\w.-]+\.config\.m?[jt]s|vitest\.[\w.]+|test-locales\.mjs)$/;
	if (harmless.includes(top) || (second === undefined && harmlessFiles.test(top))) return 'none';
	return 'all';
}

/** The builds an update touches, from the list of changed files. */
export function affected(paths) {
	const hit = new Set(paths.map(touches));
	if (hit.has('all')) return specs.map(spec => spec.id);
	return specs.filter(spec => hit.has(String(spec.className).toLowerCase())).map(spec => spec.id);
}

// Only when run as a script: the rules above are also imported by the tests.
const isMain = Boolean(process.argv[1]?.endsWith('measure-queue.mjs'));
const [command, ...args] = isMain ? process.argv.slice(2) : [];
const flag = name => {
	const at = args.indexOf(name);
	return at >= 0 ? (args[at + 1] ?? '') : undefined;
};
const kindArg = () => {
	const kind = args[0];
	if (!KINDS[kind]) throw new Error(`Unknown kind "${kind}": effects, weights or weapons.`);
	return kind;
};

if (command === 'add') {
	let ids;
	let why;
	if (args.includes('--all')) {
		ids = specs.map(spec => spec.id);
		why = 'asked for all';
	} else if (flag('--specs') !== undefined) {
		const known = new Set(specs.map(spec => spec.id));
		ids = flag('--specs').split(/\s+/).filter(id => known.has(id));
		why = 'named';
	} else {
		const [repo, from, to] = [flag('--repo'), flag('--from'), flag('--to')];
		try {
			if (!repo || !from || !to) throw new Error('--repo, --from and --to are needed');
			const paths = execFileSync('git', ['-C', repo, 'diff', '--name-only', from, to], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
			ids = affected(paths);
			const kinds = [...new Set(paths.map(touches))].filter(kind => kind !== 'none');
			why = `${paths.length} files changed; touching: ${kinds.length ? kinds.join(', ') : 'nothing that is measured'}`;
		} catch (error) {
			// No history to compare (a shallow checkout, an unknown commit): measure everything.
			ids = specs.map(spec => spec.id);
			why = `could not compare (${String(error.message).split('\n')[0]}), so everything`;
		}
	}
	const queue = load();
	if (ids.length) {
		queue.seq += 1;
		for (const kind of Object.keys(KINDS)) for (const id of idsOf(kind)) if (ids.includes(id)) queue[kind][id] = queue.seq;
	}
	save(queue);
	console.log(`${why}. Queued: ${ids.length === specs.length ? 'every build' : ids.length ? ids.join(' ') : 'nothing'}.`);
} else if (command === 'seq') {
	console.log(load().seq);
} else if (command === 'pending') {
	console.log(Object.keys(load()[kindArg()]).sort().join(' '));
} else if (command === 'done') {
	const kind = kindArg();
	const seq = Number(flag('--seq'));
	if (!Number.isFinite(seq)) throw new Error('--seq <number> is needed: the counter from when the measurement started.');
	const named = flag('--specs')?.split(/\s+/).filter(Boolean);
	const ids = named?.length ? named : idsOf(kind);
	const queue = load();
	const cleared = ids.filter(id => queue[kind][id] !== undefined && queue[kind][id] <= seq);
	for (const id of cleared) delete queue[kind][id];
	save(queue);
	console.log(`${kind}: ${cleared.length} off the queue, ${Object.keys(queue[kind]).length} still waiting.`);
} else if (command === 'start') {
	const self = flag('--self');
	const queue = load();
	const repo = process.env.GITHUB_REPOSITORY;
	for (const [kind, workflow] of Object.entries(KINDS)) {
		const waiting = Object.keys(queue[kind]).sort();
		if (!waiting.length) {
			console.log(`${kind}: nothing waiting.`);
			continue;
		}
		if (kind !== self) {
			const busy = ['in_progress', 'queued', 'pending', 'requested', 'waiting']
				.map(status => Number(execFileSync('gh', ['api', `repos/${repo}/actions/workflows/${workflow}/runs?status=${status}&per_page=1`, '--jq', '.total_count'], { encoding: 'utf8' }).trim()))
				.reduce((sum, count) => sum + count, 0);
			if (busy) {
				console.log(`${kind}: a run is going; it starts the next one itself when it ends.`);
				continue;
			}
		}
		// Everything of the kind waiting: a plain full run, which also covers builds added since.
		const everything = waiting.length === idsOf(kind).length;
		execFileSync('gh', ['workflow', 'run', workflow, '--ref', 'main', ...(everything ? [] : ['-f', `specs=${waiting.join(' ')}`])], { stdio: 'inherit' });
		console.log(`${kind}: started for ${everything ? 'every build' : waiting.join(' ')}.`);
	}
} else if (isMain) {
	console.error('Usage: measure-queue.mjs add|seq|pending|done|start (see the top of the file).');
	process.exit(1);
}
