import { defineConfig } from 'vite';
export default defineConfig({
  root: 'ios-pwa',
  base: '/',
  publicDir: 'public',
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', sourcemap: false },
  server: { host: '127.0.0.1', port: 5177, strictPort: true }
});
