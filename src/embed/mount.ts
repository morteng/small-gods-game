import { Game, type GameOptions } from '@/game';

/**
 * Mount the game into any DOM element.
 * Returns a handle for controlling the game.
 */
export function mount(container: HTMLElement | string, options?: GameOptions): Game {
  const el = typeof container === 'string' ? document.getElementById(container) : container;
  if (!el) throw new Error(`Container not found: ${container}`);
  return new Game(el, options);
}
