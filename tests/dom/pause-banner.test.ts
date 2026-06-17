/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Game } from '@/game';

// jsdom doesn't implement ResizeObserver — stub it
if (typeof (globalThis as any).ResizeObserver === 'undefined') {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

describe('pause banner', () => {
  let container: HTMLElement;
  let game: Game;

  beforeEach(() => {
    // The DOM pause banner is legacy chrome — the barebones default replaces it
    // with the WebGPU pause menu. Opt into legacy UI so the banner exists to test.
    window.history.replaceState(null, '', '?legacyui');
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);
    game = new Game(container);
  });

  afterEach(() => {
    game.destroy();
    container.remove();
    window.history.replaceState(null, '', '/');
  });

  function findBanner(): HTMLElement | undefined {
    return Array.from(container.querySelectorAll('div')).find(d => d.textContent === 'PAUSED');
  }

  it('is hidden by default (rate=1)', () => {
    expect(findBanner()?.style.display).not.toBe('block');
  });

  it('shows when scheduler.setRate(0) is called', () => {
    (game as any).scheduler.setRate(0);
    (game as any).refreshPauseBanner();
    expect(findBanner()?.style.display).toBe('block');
  });

  it('hides when scheduler.setRate(1) is called', () => {
    (game as any).scheduler.setRate(0);
    (game as any).refreshPauseBanner();
    (game as any).scheduler.setRate(1);
    (game as any).refreshPauseBanner();
    expect(findBanner()?.style.display).not.toBe('block');
  });
});
