import { Game } from './game';
import { getBootProfile } from './dev/profile';

const container = document.getElementById('app');
if (container && new URLSearchParams(location.search).has('studio')) {
  // Render Studio: uncluttered single-object scene reusing the real render path
  // (terrain + lit entity layer + shadows) for debugging lighting/anchoring.
  import('./studio/studio').then(({ mountStudio }) => mountStudio(container));
} else if (container) {
  const game = new Game(container);
  game.generateWorld().then(() => {
    console.log('World generated');
  });

  // Expose for debugging: __game is the raw instance; __debug is the stable
  // console/Playwright/MCP surface (see src/dev/debug-api.ts).
  (window as any).__game = game;
  (window as any).__debug = game.debug();
  // __bus is the S0 command/query seam (emit/preview/capabilities/query/subscribe)
  // a WebGPU UI or MCP bridge consumes. See src/game/game-bus.ts.
  (window as any).__bus = game.bus;

  // __perf: boot-phase timings + live FPS, read in a REAL browser (Playwright/CDP
  // throttles the rAF loop, so its absolute numbers can't be trusted). See profile.ts.
  (window as any).__perf = {
    boot: () => getBootProfile(),
    fps: () => game.fpsStats(),
    showFps: (v = true) => game.setFpsHud(v),
  };

  // Bus bridge (dev only): with ?bridge / ?bridge=rw, carry the GameBus seam out
  // to the dev broker so a CLI / MCP server can drive & inspect this tab. Loaded
  // lazily so it's inert (and tree-shaken from the prod hot path) by default.
  import('./dev/bus-bridge-client').then(({ readBridgeFlag, startBridgeClient }) => {
    const flag = readBridgeFlag(location.search);
    if (flag) startBridgeClient({ bus: game.bus, allowWrite: flag.allowWrite });
  });
}
