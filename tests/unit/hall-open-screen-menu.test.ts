/**
 * Hall of the Gods (Phase C) — `open_screen` must not leave the legacy Esc menu
 * overlapping the shell, whoever asked.
 *
 * The plan's §1.4 claim is that a player's nav-row click and a connected agent's
 * `emit_command` reach the hall through ONE path. The nav row closes the menu
 * itself before emitting, so the claim held only for the click: an agent
 * emitting `open_screen` over the bus never touched a nav row, and the overlap
 * it left is not cosmetic — the menu stashes the sim rate at 0, so the screen
 * would sit in front of a world that had silently stopped.
 *
 * `handleMetaCommand` is a private `Game` method with no pure seam of its own
 * (it drives the live shell + UI singleton), so — following
 * `tests/unit/cast-targeting.test.ts`'s precedent — this instantiates a real
 * `Game` under jsdom and drives it through the bus the way an agent would.
 */
/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Game } from '@/game';
import { World } from '@/world/world';
import { getUiRuntime } from '@/render/ui/ui-runtime';
import { PLAYER_SPIRIT_ID } from '@/sim/believers';
import type { GameMap, Tile } from '@/core/types';

if (typeof (globalThis as any).ResizeObserver === 'undefined') {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

function miniMap(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 8; y++) {
    tiles[y] = [];
    for (let x = 0; x < 8; x++) tiles[y][x] = { type: 'grass', x, y, walkable: true, state: 'realized' };
  }
  return {
    tiles, width: 8, height: 8, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
}

/** Emit a meta verb exactly as an agent over the bus would. */
function openScreen(game: Game, screen: string): void {
  (game as any).bus.emit({
    verb: 'open_screen', source: PLAYER_SPIRIT_ID, target: { kind: 'none' }, params: { screen },
  });
}

describe('open_screen closes the legacy Esc menu (agent path parity)', () => {
  let container: HTMLElement;
  let game: Game;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);
    game = new Game(container);
    const map = miniMap();
    const state = (game as any).state;
    state.map = map;
    state.world = new World(map);
  });

  afterEach(() => {
    game.destroy();
    container.remove();
    vi.restoreAllMocks();
  });

  it('an agent opening the hall while the menu is up does not leave them overlapping', () => {
    const ui = getUiRuntime();
    ui.toggleMenu();
    expect(ui.isMenuOpen()).toBe(true);

    openScreen(game, 'hall');

    expect((game as any).shell.top()).toBe('hall');
    // The overlap is what stashes the sim rate at 0 behind a screen.
    expect(ui.isMenuOpen()).toBe(false);
  });

  it('holds for every screen an agent may open, not just the hall', () => {
    const ui = getUiRuntime();
    for (const screen of ['settings', 'save', 'load', 'newgame'] as const) {
      ui.toggleMenu();
      expect(ui.isMenuOpen(), `menu did not open before ${screen}`).toBe(true);

      openScreen(game, screen);

      expect((game as any).shell.top(), `${screen} not pushed`).toBe(screen);
      expect(ui.isMenuOpen(), `menu still open behind ${screen}`).toBe(false);
      (game as any).shell.pop();
    }
  });

  it('leaves a closed menu closed (no gratuitous toggle)', () => {
    const ui = getUiRuntime();
    expect(ui.isMenuOpen()).toBe(false);

    openScreen(game, 'hall');

    expect((game as any).shell.top()).toBe('hall');
    expect(ui.isMenuOpen()).toBe(false);
  });

  it('refuses an unknown screen and leaves the menu alone', () => {
    const ui = getUiRuntime();
    ui.toggleMenu();

    openScreen(game, 'not-a-screen');

    // Refused, not cast and pushed — and the refusal path touches nothing else.
    expect((game as any).shell.top()).toBeNull();
    expect(ui.isMenuOpen()).toBe(true);
  });
});
