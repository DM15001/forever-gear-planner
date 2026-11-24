// Not a test of this project. .github/workflows/presets.yml copies this file into a wowsims/forever checkout
// (ui/_dump/dump.test.ts) and runs it there with WoWSims' own test setup. For each spec it writes what
// wowsims.com shows: the page's defaults, and each preset build loaded over them, as the site's own JSON export.
//   DUMP_SPECS="rogue/dps mage/dps" DUMP_OUT=/tmp/out npx vitest run ui/_dump
import { mkdirSync, writeFileSync } from 'node:fs';

import { applyBuild } from '@features/settings/model/apply_build';
import { applyIndividualDefaults } from '@features/settings/model/apply_defaults';
import { createSettingsJson } from '@features/import-export/exporters/json';
import { RaidSimRequest } from '@generated/proto/api';
import { makeIndividualSim, serveRealDatabase } from '@testing/sim/individual_sim';
import { beforeAll, expect, it, vi } from 'vitest';

vi.mock('@sim/workers/worker_pool', async () => (await import('@testing/sim/worker_pool')).idleWorkerPool());
beforeAll(() => serveRealDatabase());

const OUT = process.env.DUMP_OUT ?? '/tmp/wowsims-presets';
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

it.each((process.env.DUMP_SPECS ?? '').split(/\s+/).filter(Boolean))('%s', async dir => {
	const config = (await import(/* @vite-ignore */ `../specs/${dir}/spec.ts`)).default;
	const fresh = async () => {
		const made = await makeIndividualSim({ spec: config.spec ?? config.playerSpec?.specID ?? undefined, config });
		const host = Object.assign(made.host, { statWeightActionSettings: { applyDefaults: () => {} }, statSweepSettings: { applyDefaults: () => {} } });
		applyIndividualDefaults(host as any);
		return host;
	};
	mkdirSync(OUT, { recursive: true });
	const base = dir.replace('/', '.');
	// `x.json` is the page's JSON export; `x.request.json` is the request the page sends to the simulator for it,
	// with a Simple or Auto rotation already turned into its priority list.
	const write = (name: string, host: Awaited<ReturnType<typeof fresh>>) => {
		writeFileSync(`${OUT}/${base}.${name}.json`, createSettingsJson(host));
		const request = RaidSimRequest.toJson(host.sim.makeRaidSimRequest()) as Record<string, any>;
		delete request.requestId;
		delete request.simOptions;
		writeFileSync(`${OUT}/${base}.${name}.request.json`, JSON.stringify(request));
	};
	write('defaults', await fresh());
	const builds = config.presets?.builds ?? [];
	const index: Record<string, { name: string; group?: string }> = {};
	for (const build of builds) {
		const host = await fresh();
		applyBuild(build, host);
		const group = (build as { group?: string }).group ?? build.gear?.group;
		let name = slug(`${group ?? ''} ${build.name}`);
		while (index[name]) name += '-2';
		index[name] = { name: build.name, group };
		write(name, host);
	}
	writeFileSync(`${OUT}/${base}.index.json`, JSON.stringify(index, null, '\t'));
	expect(builds.length).toBeGreaterThanOrEqual(0);
});
