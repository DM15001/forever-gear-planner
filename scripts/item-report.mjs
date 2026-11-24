// What a data rebuild changed in the item list: new and removed items, changed stats, and items that
// gained or lost a source. Compares src/data/items.json with the last committed copy.
//
//   node scripts/item-report.mjs                 print the report
//   node scripts/item-report.mjs --log "title"   also put it on top of docs/item-changes.md
//
// Exit code 0 either way; prints nothing but "No item changes." when the two are the same.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const FILE = 'src/data/items.json';
const LOG = `${root}docs/item-changes.md`;
const KEEP = 40; // entries kept in the log
const LIST = 60; // lines per section before "and N more"

const now = JSON.parse(readFileSync(root + FILE, 'utf8'));
const before = JSON.parse(execFileSync('git', ['show', `HEAD:${FILE}`], { cwd: root, maxBuffer: 1 << 30 }).toString());
const byId = list => new Map(list.map(item => [item.id, item]));
const old = byId(before);
const fresh = byId(now);

const label = item => `${item.name} (${item.id}, ${item.quality ?? '?'} ${item.ilvl ?? '?'}, ${item.slot})`;
const sourceText = source => {
	if (source.kind === 'quest') return `quest "${source.name ?? source.questId}"`;
	if (source.kind === 'drop') return `drop${source.npcId ? ` npc ${source.npcId}` : source.otherName ? ` ${source.otherName.trim()}` : ''}${source.zoneId ? ` zone ${source.zoneId}` : ''}`;
	if (source.kind === 'crafted') return `crafted (${source.profession})`;
	if (source.kind === 'rep') return `reputation ${source.repFaction}`;
	if (source.kind === 'vendor') return `vendor ${source.npcName ?? ''}`.trim();
	return source.kind;
};
const sources = item => (item.sources ?? []).map(sourceText).sort();
const statDiff = (a = {}, b = {}) =>
	[...new Set([...Object.keys(a), ...Object.keys(b)])]
		.filter(key => a[key] !== b[key])
		.map(key => `${key} ${a[key] ?? 0} → ${b[key] ?? 0}`);

const sections = { 'New items': [], 'Removed items': [], 'Source gained': [], 'Source lost': [], 'Source changed': [], 'Stats changed': [], 'Other changes': [] };
for (const item of now) {
	const was = old.get(item.id);
	if (!was) {
		sections['New items'].push(`${label(item)}: ${sources(item).join('; ') || 'no source'}`);
		continue;
	}
	const [a, b] = [sources(was), sources(item)];
	if (a.join('|') !== b.join('|')) {
		if (!a.length) sections['Source gained'].push(`${label(item)}: ${b.join('; ')}`);
		else if (!b.length) sections['Source lost'].push(`${label(item)}: was ${a.join('; ')}`);
		else sections['Source changed'].push(`${label(item)}: ${a.join('; ')} → ${b.join('; ')}`);
	}
	const stats = [...statDiff(was.stats, item.stats), ...statDiff(was.weapon, item.weapon)];
	if (stats.length) sections['Stats changed'].push(`${label(item)}: ${stats.join(', ')}`);
	const other = ['name', 'slot', 'quality', 'ilvl', 'reqLvl', 'unreleased', 'setId'].filter(key => was[key] !== item[key]).map(key => `${key} ${was[key] ?? '-'} → ${item[key] ?? '-'}`);
	if (JSON.stringify(was.effects ?? []) !== JSON.stringify(item.effects ?? [])) other.push('effects');
	if (JSON.stringify(was.classes ?? []) !== JSON.stringify(item.classes ?? [])) other.push('classes');
	if (other.length) sections['Other changes'].push(`${label(item)}: ${other.join(', ')}`);
}
for (const item of before) if (!fresh.has(item.id)) sections['Removed items'].push(label(item));

const filled = Object.entries(sections).filter(([, lines]) => lines.length);
if (!filled.length) {
	console.log('No item changes.');
	process.exit(0);
}
const summary = filled.map(([title, lines]) => `${lines.length} ${title.toLowerCase()}`).join(', ');
const body = filled
	.map(([title, lines]) => `**${title} (${lines.length})**\n${lines.slice(0, LIST).map(line => `- ${line}`).join('\n')}${lines.length > LIST ? `\n- … and ${lines.length - LIST} more` : ''}`)
	.join('\n\n');
console.log(`${summary}\n\n${body}`);

const at = process.argv.indexOf('--log');
if (at > -1) {
	const title = process.argv[at + 1] ?? 'Data rebuild';
	const HEAD = '# Item changes\n\nWhat each data update from WoWSims changed in the item list, newest first. Written by `scripts/item-report.mjs` from `.github/workflows/engine.yml`.\n';
	const entries = existsSync(LOG) ? readFileSync(LOG, 'utf8').split(/\n(?=## )/).slice(1) : [];
	const entry = `## ${new Date().toISOString().slice(0, 10)}: ${title}\n\n${summary}\n\n${body}\n`;
	writeFileSync(LOG, [HEAD, entry, ...entries.slice(0, KEEP - 1)].join('\n'));
}
