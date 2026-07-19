import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { promoteAssetPlugin } from './vite-plugins/promote-asset';
import { llmProxyPlugin, replicateProxyPlugin } from './vite-plugins/llm-proxy';
import { busBridgePlugin } from './vite-plugins/bus-bridge';
import { grabSinkPlugin } from './vite-plugins/grab-sink';
import { reflibSinkPlugin } from './vite-plugins/reflib-sink';

const pkg = createRequire(import.meta.url)('./package.json') as { version: string };

// Short git SHA baked into the build for in-app display / bug reports. The Hetzner CI
// box builds from a `git archive` tar with NO .git, so `git rev-parse` fails there —
// VITE_GIT_SHA is the env override for that path. Guarded so a missing git never breaks
// the build (falls back to 'unknown').
function resolveGitSha(): string {
  if (process.env.VITE_GIT_SHA) return process.env.VITE_GIT_SHA;
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig(({ command, mode }) => {
  // Load the (non-VITE_-prefixed) OpenRouter key + Replicate token for the dev
  // proxies. Handed only to the dev-server middleware — never bundled into
  // client code.
  const env = loadEnv(mode, process.cwd(), '');
  // Dev-tools gate. The dev server always has them; a production build includes
  // them only under `--mode devtools` (npm run build:dev). A plain `vite build`
  // (npm run build → distribution) folds this to `false`, so Rollup tree-shakes
  // the studio chunk + the __game/__debug/__bus/__perf globals out of the bundle.
  const devTools = command === 'serve' || mode === 'devtools';
  return {
    root: '.',
    define: {
      __DEV_TOOLS__: JSON.stringify(devTools),
      __APP_VERSION__: JSON.stringify(pkg.version),
      __GIT_SHA__: JSON.stringify(resolveGitSha()),
    },
    // GitHub Pages serves this project site from /small-gods-game/, but the dev
    // server and tests run at '/'. Only the production build gets the subpath.
    // Override with VITE_BASE (e.g. a custom domain or renamed repo).
    base: command === 'build' ? (process.env.VITE_BASE ?? '/small-gods-game/') : '/',
    plugins: [promoteAssetPlugin(), llmProxyPlugin(env.OPENROUTER_API_KEY), replicateProxyPlugin(env.REPLICATE_API_TOKEN), busBridgePlugin(), grabSinkPlugin(), reflibSinkPlugin()],
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
