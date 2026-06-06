import { defineConfig } from 'vite';
import { resolve } from 'path';
import { promoteAssetPlugin } from './vite-plugins/promote-asset';

export default defineConfig(({ command }) => ({
  root: '.',
  // GitHub Pages serves this project site from /small-gods-game/, but the dev
  // server and tests run at '/'. Only the production build gets the subpath.
  // Override with VITE_BASE (e.g. a custom domain or renamed repo).
  base: command === 'build' ? (process.env.VITE_BASE ?? '/small-gods-game/') : '/',
  plugins: [promoteAssetPlugin()],
  server: { port: 3000 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
}));
