// Lists the open reports of where an item comes from, each with what the data already says, so they can be checked.
//
//   node scripts/source-reports.mjs            the open reports on GitHub (label "source-report", or a title "Source of … (id)")
//   node scripts/source-reports.mjs file.txt   reports pasted from a chat ("Gear Planner source report" blocks)
//   add --json for the list as JSON
//
// It decides nothing and changes nothing. docs/source-reports.md says how a report is checked and where it goes.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const read = path => JSON.parse(readFileSync(root + path, 'utf8'));
const items = new Map(read('src/data/items.json').map(item => [item.id, item]));
const npcs = read('src/data/npcs.json');
const zones = read('src/data/zones.json');
const manual = read('src/config/sources.manual.json');
const atlas = read('src/config/atlasloot/sources.json');
const zoneName = id => zones.find(z => z.id === id)?.name ?? atlas.zones.find(z => z.id === id)?.name ?? `zone ${id}`;

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const file = args.find(arg => !arg.startsWith('--'));

/** One report: where it came from, the item id it names, and its text. */
function reports() {
	if (file) {
		return readFileSync(file, 'utf8')
			.split(/(?=Gear Planner source report)/)
			.filter(block => /Item:/.test(block))
			.map((text, index) => ({ from: `${file} #${index + 1}`, title: '', text }));
	}
	const list = JSON.parse(execFileSync('gh', ['api', 'repos/DM15001/forever-gear-planner/issues?state=open&per_page=100'], { encoding: 'utf8' }));
	return list
		.filter(issue => !issue.pull_request && (issue.labels.some(label => label.name === 'source-report') || /^Source of .*\(\d+\)/.test(issue.title)))
		.map(issue => ({ from: `#${issue.number} by ${issue.user.login}`, number: issue.number, title: issue.title, text: issue.body ?? '' }));
}

const lower = text => text.toLowerCase();
const out = reports().map(report => {
	const id = Number((report.title.match(/\((\d+)\)\s*$/) ?? report.text.match(/Item:.*\((\d+)\)/) ?? report.text.match(/item=(\d+)/) ?? [])[1]);
	const item = items.get(id);
	const text = lower(report.text);
	const where = (report.text.match(/Where it comes from[^:]*:\s*([\s\S]*?)(?:\n\s*\n|How (?:I|you) know|$)/i) ?? [])[1]?.trim() ?? '';
	const proof = (report.text.match(/How (?:I|you) know[^:]*:\s*([\s\S]*)$/i) ?? [])[1]?.trim() ?? '';
	return {
		from: report.from,
		number: report.number,
		itemId: id || null,
		item: item?.name ?? null,
		says: where,
		proof,
		links: [...report.text.matchAll(/https?:\/\/[^\s)>\]]+/g)].map(match => match[0]).filter(link => !link.includes(`item=${id}`)),
		// What the planner has today.
		sourcesNow: (item?.sources ?? []).map(source => ({ ...source, zone: source.zoneId ? zoneName(source.zoneId) : undefined })),
		manualNow: manual.items[id] ?? null,
		atlasNow: atlas.sources[id] ?? null,
		// Names from the data that the report mentions: a first test of whether it can be true.
		creaturesNamed: npcs.filter(npc => npc.name.length > 4 && text.includes(lower(npc.name))).map(npc => ({ ...npc, zone: npc.zoneId ? zoneName(npc.zoneId) : undefined })),
		zonesNamed: zones.filter(zone => zone.name.length > 4 && text.includes(lower(zone.name.replace(/^The /, '')))),
	};
});

if (asJson) console.log(JSON.stringify(out, null, '\t'));
else if (out.length === 0) console.log('No open source reports.');
else {
	for (const report of out) {
		console.log(`\n${report.from}: ${report.item ?? 'UNKNOWN ITEM'} (${report.itemId ?? '?'})`);
		console.log(`  says: ${report.says || '(nothing)'}`);
		if (report.proof) console.log(`  how they know: ${report.proof}`);
		if (report.links.length) console.log(`  links: ${report.links.join(' ')}`);
		console.log(`  planner today: ${report.sourcesNow.length ? JSON.stringify(report.sourcesNow) : 'no source'}${report.manualNow ? ' (hand-kept entry exists)' : ''}${report.atlasNow ? ' (AtlasLoot entry exists)' : ''}`);
		console.log(`  creatures named that the data knows: ${report.creaturesNamed.map(npc => `${npc.name} [${npc.id}${npc.zone ? `, ${npc.zone}` : ''}]`).join('; ') || 'none'}`);
		console.log(`  zones named that the data knows: ${report.zonesNamed.map(zone => `${zone.name} [${zone.id}]`).join('; ') || 'none'}`);
	}
}
