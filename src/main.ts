import { Game } from './game';

const container = document.getElementById('app');
if (container) {
  const game = new Game(container);
  game.generateWorld().then(() => {
    console.log('World generated');
  });

  // Expose for debugging
  (window as any).__game = game;
}
