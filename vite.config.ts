import { defineConfig } from 'vite';

export default defineConfig({
  // Capacitor loads the bundled page from a local scheme, so relative asset
  // paths keep the built dist/ portable.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  }
});
