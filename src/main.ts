import { Game } from './game';

const container = document.getElementById('app');
if (container) {
  const game = new Game(container);
  game.generateWorld().then(() => {
    console.log('World generated');
  });

  // Expose for debugging: __game is the raw instance; __debug is the stable
  // console/Playwright/MCP surface (see src/dev/debug-api.ts).
  (window as any).__game = game;
  (window as any).__debug = game.debug();
}
