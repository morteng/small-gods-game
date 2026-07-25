/**
 * Abilities v1 — Phase A (A1/A3/A5): verb-first cast targeting.
 *
 * CAST always arms the reticle (no auto-pick fast path — an already-selected
 * compatible NPC must no longer fire instantly, product decision 1); an invalid
 * click stays armed and flashes an honest miss instead of silently exiting
 * (product decision 2); Esc cancels an in-progress cast BEFORE it reaches the
 * card-dismiss/menu-toggle chain (A3); the aim hint bar reports the full
 * targeting view, not just a label (A5).
 *
 * `castPower`/`resolveTargetedCast`/the `getTargeting`/`onCancelTargeting` hooks
 * are private `Game` methods and closures with no pure-function seam of their
 * own (they read/write live `state`/`interaction` and the singleton UI
 * runtime), so — following the `tests/dom/inspector-band-gating.test.ts`
 * precedent — this instantiates a real `Game` under jsdom and drives it via
 * `(game as any)` / the `getUiRuntime()` singleton's private `hooks`.
 */
/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Game } from '@/game';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { getUiRuntime } from '@/render/ui/ui-runtime';
import type { GameMap, NpcProperties, Tile } from '@/core/types';

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

describe('Game — verb-first cast targeting (abilities-v1 A1/A3/A5)', () => {
  let container: HTMLElement;
  let game: Game;
  let emit: ReturnType<typeof vi.spyOn>;

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
    const props = initNpcProps('Ada', 'farmer', 1) as NpcProperties;
    // `smite`'s congregation-belief precondition doesn't gate targeting/arming
    // (only the eventual command apply) — no belief setup needed for these tests.
    state.world.addEntity({ id: 'n1', kind: 'npc', x: 2, y: 2, tags: [], properties: props });
    state.selectedNpcId = 'n1'; // the old fast path's trigger condition

    emit = vi.spyOn((game as any).bus, 'emit');
  });

  afterEach(() => {
    game.destroy();
    container.remove();
    vi.restoreAllMocks();
  });

  it('CAST arms the reticle without firing, even with a compatible NPC already selected', () => {
    (game as any).castPower('smite');

    expect(emit).not.toHaveBeenCalled(); // the auto-pick fast path is gone (decision 1)
    const t = (game as any).interaction.targeting;
    expect(t).not.toBeNull();
    expect(t.verb).toBe('smite');
    expect(t.targetKinds).toEqual(['npc', 'entity', 'tile']); // registry-sourced, not beliefPowers
    expect(t.footprint).toBe('point');
  });

  it('an invalid click keeps aiming and reports a miss, instead of clearing targeting', () => {
    // `dream`'s targetKinds is npc-only (no tile fallback, unlike smite's
    // smiteLocation) — clicking bare ground with no NPC there is a genuine miss.
    (game as any).castPower('dream');
    (game as any).resolveTargetedCast(7, 7); // bare ground, no npc there

    expect(emit).not.toHaveBeenCalled();
    expect((game as any).interaction.targeting).not.toBeNull(); // still armed (decision 2)

    const view = (getUiRuntime() as any).hooks.getTargeting();
    expect(view.miss).toBe(true);
  });

  it('a valid click resolves, clears targeting, and emits exactly one command', () => {
    (game as any).castPower('smite');
    (game as any).resolveTargetedCast(2, 2); // n1's tile

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({ verb: 'smite', target: { kind: 'npc', npcId: 'n1' } });
    expect((game as any).interaction.targeting).toBeNull();

    const view = (getUiRuntime() as any).hooks.getTargeting();
    expect(view).toBeNull();
  });

  it('getTargeting reports the full view (label/targetKinds/footprint), not just a label', () => {
    (game as any).castPower('smite');
    const view = (getUiRuntime() as any).hooks.getTargeting();
    expect(view.targetKinds).toEqual(['npc', 'entity', 'tile']);
    expect(view.footprint).toBe('point');
    expect(view.miss).toBeFalsy();
  });

  it('Esc cancels an in-progress cast BEFORE it reaches the menu toggle (A3)', () => {
    (game as any).castPower('smite');
    const toggleMenu = vi.spyOn(getUiRuntime() as any, 'toggleMenu');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect((game as any).interaction.targeting).toBeNull(); // consumed + cleared
    expect(toggleMenu).not.toHaveBeenCalled(); // never reached the menu branch
  });

  it('with no cast in progress, Esc falls through to the menu toggle as before', () => {
    expect((game as any).interaction.targeting).toBeNull();
    const toggleMenu = vi.spyOn(getUiRuntime() as any, 'toggleMenu');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(toggleMenu).toHaveBeenCalledTimes(1);
  });
});
