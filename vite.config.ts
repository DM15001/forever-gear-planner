import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// base './' keeps asset paths relative, so the build works under any GitHub Pages path.
export default defineConfig({
	base: './',
	plugins: [react()],
	// The item list is one large chunk on purpose; it loads after the page shell.
	build: { chunkSizeWarningLimit: 2000 },
});
