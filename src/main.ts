import { Game } from './game';

// Dev features (the Studio + the __game/__debug/__bus/__perf window surface) are
// gated behind the build-time `__DEV_TOOLS__` flag and loaded by DYNAMIC import, so a
// distribution build (`npm run build`) tree-shakes them out entirely — only the dev
// server and `npm run build:dev` (`--mode devtools`) ship them. See vite.config.ts.
const container = document.getElementById('app');
if (container && __DEV_TOOLS__ && new URLSearchParams(location.search).has('studio')) {
  // Studio (?studio=…): the unified Object/Gallery/Zoo/World authoring shell, reusing
  // the real render path. Dev-only.
  void import('./studio/studio').then(({ mountStudio }) => mountStudio(container));
} else if (container) {
  const game = new Game(container);
  game.generateWorld().then(() => {
    console.log('World generated');
  });

  if (__DEV_TOOLS__) {
    // Attach the dev/debug window globals (excluded from distribution builds).
    void import('./dev/expose').then(({ exposeDevGlobals }) => exposeDevGlobals(game));
  }
}
