import { Game } from './game';

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
}
