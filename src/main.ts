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

  // Studio bus bridge (dev only): with ?studio…&bridge / &bridge=rw, carry the active
  // Object-studio control surface out to the dev broker so a CLI / MCP server can pick
  // objects, render, and screenshot it (studio_select / studio_render / screenshot).
  void Promise.all([
    import('./dev/bus-bridge-client'),
    import('./studio/studio-bridge'),
  ]).then(([{ readBridgeFlag, startBridgeClient }, { makeStudioBus }]) => {
    const flag = readBridgeFlag(location.search);
    if (flag) startBridgeClient({ bus: makeStudioBus(flag.allowWrite), allowWrite: flag.allowWrite });
  });
} else if (container) {
  const game = new Game(container);
  game.generateWorld().then(() => {
    console.log('World generated');
  });

  if (__DEV_TOOLS__) {
    // Attach the dev/debug window globals (excluded from distribution builds).
    void import('./dev/expose').then(({ exposeDevGlobals }) => exposeDevGlobals(game));

    // Bus bridge (dev only): with ?bridge / ?bridge=rw, carry the GameBus seam out
    // to the dev broker so a CLI / MCP server can drive & inspect this tab. Loaded
    // lazily so it's inert (and tree-shaken from the prod hot path) by default.
    void import('./dev/bus-bridge-client').then(({ readBridgeFlag, startBridgeClient }) => {
      const flag = readBridgeFlag(location.search);
      if (flag) startBridgeClient({ bus: game.bus, allowWrite: flag.allowWrite });
    });
  }
}
