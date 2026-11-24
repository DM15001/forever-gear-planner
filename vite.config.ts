import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// base './' keeps asset paths relative, so the build works under any GitHub Pages path.
// The WoWSims build this copy of the site was made with: the page compares it with what is published, and the
// simulator files carry it in their address so a browser never mixes an old engine with new data.
const simCommit: string = JSON.parse(readFileSync(new URL('./public/sim/setup.json', import.meta.url), 'utf8')).simVersion?.commit ?? '';

export default defineConfig({
	base: './',
	define: { __SIM_COMMIT__: JSON.stringify(simCommit) },
	plugins: [react()],
	// The item list is one large chunk on purpose; it loads after the page shell.
	build: { chunkSizeWarningLimit: 2000 },
	// The planner and simulator tests do real work; a slow build machine needs more than the default 5 s.
	test: { testTimeout: 120_000, hookTimeout: 120_000 },
});
