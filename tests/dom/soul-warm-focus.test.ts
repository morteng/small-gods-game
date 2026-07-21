/**
 * UI v2 W3 — D6: "focus warms the soul". `noteSoulFocus` is a private `Game`
 * method with no pure-function seam of its own (it reaches live `state.world` +
 * the live `llmBackfill` service), so — following the `tests/dom/
 * inspector-band-gating.test.ts` precedent — this instantiates a real `Game`
 * under jsdom (no WebGPU needed; this seam never touches the canvas) and drives
 * the method directly via `(game as any)`. The pure cooldown decision itself
 * (`soulWarmFocusDue`) has its own focused unit tests in
 * `tests/unit/soul-warm-focus.test.ts`.
 */
/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Game } from '@/game';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { SOUL_WARM_FOCUS_COOLDOWN_MS } from '@/game/soul-warm-focus';
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

describe('Game — UI v2 W3/D6: noteSoulFocus (warm-focus backfill, cooldown-gated)', () => {
  let container: HTMLElement;
  let game: Game;
  let trigger: ReturnType<typeof vi.spyOn>;

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
    state.world.addEntity({ id: 'n1', kind: 'npc', x: 2, y: 2, tags: [], properties: props });

    trigger = vi.spyOn((game as any).llmBackfill, 'trigger').mockResolvedValue(undefined);
  });

  afterEach(() => {
    game.destroy();
    container.remove();
    vi.restoreAllMocks();
  });

  it('no LLM configured (default boot: mock provider) ⇒ silently skips, never calls trigger', () => {
    expect((game as any).llmProviderType).toBe('mock'); // boots mock absent a stored/env config
    (game as any).noteSoulFocus('n1');
    expect(trigger).not.toHaveBeenCalled();
  });

  it('a missing npc id never throws, even with a real provider configured', () => {
    (game as any).llmProviderType = 'openrouter';
    expect(() => (game as any).noteSoulFocus('nope')).not.toThrow();
    expect(trigger).not.toHaveBeenCalled();
  });

  it('a missing world never throws', () => {
    (game as any).llmProviderType = 'openrouter';
    (game as any).state.world = null;
    expect(() => (game as any).noteSoulFocus('n1')).not.toThrow();
    expect(trigger).not.toHaveBeenCalled();
  });

  it('the first focus fires; an immediate re-focus on the SAME npc does not', () => {
    (game as any).llmProviderType = 'openrouter';
    (game as any).noteSoulFocus('n1');
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger.mock.calls[0][0].id).toBe('n1');

    (game as any).noteSoulFocus('n1'); // same tick, well inside the 10-minute cooldown
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('firing again after the cooldown elapses fires once more', () => {
    (game as any).llmProviderType = 'openrouter';
    (game as any).noteSoulFocus('n1');
    expect(trigger).toHaveBeenCalledTimes(1);

    // Fast-forward the recorded fire time past the cooldown window (the map is
    // real-clock-keyed, never sim-tick-keyed — CLAUDE.md's tick-window rule).
    const fired: Map<string, number> = (game as any).soulFocusFiredAt;
    fired.set('n1', fired.get('n1')! - SOUL_WARM_FOCUS_COOLDOWN_MS - 1);

    (game as any).noteSoulFocus('n1');
    expect(trigger).toHaveBeenCalledTimes(2);
  });

  it('cooldown is per-npc — a second npc fires independently of the first', () => {
    const state = (game as any).state;
    const props2 = initNpcProps('Bo', 'farmer', 2) as NpcProperties;
    state.world.addEntity({ id: 'n2', kind: 'npc', x: 3, y: 3, tags: [], properties: props2 });
    (game as any).llmProviderType = 'openrouter';

    (game as any).noteSoulFocus('n1');
    (game as any).noteSoulFocus('n2');
    expect(trigger).toHaveBeenCalledTimes(2);
  });
});
