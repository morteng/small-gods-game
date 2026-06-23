import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';
import { promoteAssetPlugin } from './vite-plugins/promote-asset';
import { llmProxyPlugin } from './vite-plugins/llm-proxy';

export default defineConfig(({ command, mode }) => {
  // Load the (non-VITE_-prefixed) OpenRouter key for the dev LLM proxy. Handed
  // only to the dev-server middleware — never bundled into client code.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    root: '.',
    // GitHub Pages serves this project site from /small-gods-game/, but the dev
    // server and tests run at '/'. Only the production build gets the subpath.
    // Override with VITE_BASE (e.g. a custom domain or renamed repo).
    base: command === 'build' ? (process.env.VITE_BASE ?? '/small-gods-game/') : '/',
    plugins: [promoteAssetPlugin(), llmProxyPlugin(env.OPENROUTER_API_KEY)],
    server: { port: 3000 },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      // Production builds ship NO source maps so the public bundle (Pages /
      // desktop) doesn't hand out readable TS. Opt back in with VITE_SOURCEMAP=1
      // for a debuggable build. (Has no effect on the dev server.)
      sourcemap: process.env.VITE_SOURCEMAP === '1',
    },
    resolve: {
      alias: { '@': resolve(__dirname, 'src') },
    },
  };
});
