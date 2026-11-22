import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// base './' keeps asset paths relative, so the build works under any GitHub Pages path.
export default defineConfig({
	base: './',
	plugins: [react()],
	// The item list is one large chunk on purpose; it loads after the page shell.
	build: { chunkSizeWarningLimit: 2000 },
	// The planner and simulator tests do real work; a slow build machine needs more than the default 5 s.
	test: { testTimeout: 120_000, hookTimeout: 120_000 },
});
