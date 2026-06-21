// src/dev/expose.ts
//
// The dev/debug WINDOW surface (console / Playwright / MCP handles). DEV BUILDS
// ONLY — main.ts imports this dynamically behind `__DEV_TOOLS__`, so a distribution
// `vite build` tree-shakes the whole module (and its `./profile` dependency) out of
// the bundle. The shipping game uses `game.bus` IN-PROCESS (the WebGPU UI + Fate
// never round-trip through these globals), so hiding them costs it nothing.
import type { Game } from '@/game';
import { getBootProfile } from './profile';

export function exposeDevGlobals(game: Game): void {
  const w = window as unknown as Record<string, unknown>;
  // __game is the raw instance; __debug is the stable console/Playwright/MCP surface
  // (src/dev/debug-api.ts); __bus is the S0 command/query seam (src/game/game-bus.ts).
  w.__game = game;
  w.__debug = game.debug();
  w.__bus = game.bus;
  // __perf: boot-phase timings + live FPS, read in a REAL browser (Playwright/CDP
  // throttles rAF, so its absolute numbers can't be trusted). See profile.ts.
  w.__perf = {
    boot: () => getBootProfile(),
    fps: () => game.fpsStats(),
    showFps: (v = true) => game.setFpsHud(v),
  };
}
