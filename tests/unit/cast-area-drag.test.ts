/**
 * Abilities v1 — B4: the click+drag gesture for an 'area'-footprint cast
 * (`summon_storm`). `Game.onDragArea` is the callback `attachControls` routes
 * a captured drag through (see `src/ui/controls.ts`'s `onDragArea`/
 * `shouldCaptureDrag` doc); `Game.dragPreview` backs the hint bar's live
 * radius/cost readout, pinned against the registry's own `effectiveCost` so
 * the two can never drift apart (B3's whole point for `costFor`).
 *
 * Follows the `tests/unit/cast-targeting.test.ts` precedent: this state lives
 * on private `Game` fields/methods with no pure-function seam of their own
 * (live `interaction`/`state`, the `getUiRuntime()` singleton's private
 * hooks), so this instantiates a real `Game` under jsdom and drives it via
 * `(game as any)`.
 *
 * These tests assert at the EMIT seam (`bus.emit`), not by draining the
 * command queue: `summon_storm` is belief-content gated (a convinced flood
 * congregation) AND costs more than the player's default power stipend at
 * anything past the minimum radius, so asserting an actual `applied` result
 * would mean contorting the world fixture just to exercise a UI gesture that
 * doesn't care whether the eventual command succeeds — the drag's job is to
 * emit the RIGHT command, not to succeed at it (that's `summon-storm.test.ts`'s
 * job, already covered).
 */
/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Game } from '@/game';
import { World } from '@/world/world';
import { getUiRuntime } from '@/render/ui/ui-runtime';
import { getCapability, effectiveCost } from '@/sim/command/registry';
import type { Command } from '@/sim/command/types';
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
  for (let y = 0; y < 32; y++) {
    tiles[y] = [];
    for (let x = 0; x < 32; x++) tiles[y][x] = { type: 'grass', x, y, walkable: true, state: 'realized' };
  }
  return {
    tiles, width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
}

describe('Game — the area-drag gesture (abilities-v1 B4)', () => {
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

    emit = vi.spyOn((game as any).bus, 'emit');
  });

  afterEach(() => {
    game.destroy();
    container.remove();
    vi.restoreAllMocks();
  });

  it("castPower('summon_storm') arms an 'area' footprint with no anchor yet", () => {
    (game as any).castPower('summon_storm');
    const t = (game as any).interaction.targeting;
    expect(t.footprint).toBe('area');
    expect(t.anchor).toBeUndefined();
  });

  it('onDragArea("start") stamps the anchor without emitting', () => {
    (game as any).castPower('summon_storm');
    (game as any).onDragArea('start', 5, 5);
    expect((game as any).interaction.targeting.anchor).toEqual({ x: 5, y: 5 });
    expect(emit).not.toHaveBeenCalled();
  });

  it('a drag that grows the radius, then releases, emits ONE area command with the expected centre + clamped radius', () => {
    (game as any).castPower('summon_storm');
    (game as any).onDragArea('start', 5, 5);
    (game as any).onDragArea('update', 8, 9); // distance 5 from anchor — mid-drag, no emit yet
    expect(emit).not.toHaveBeenCalled();
    (game as any).onDragArea('end', 11, 5);   // distance 6 from anchor (5,5)

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({
      verb: 'summon_storm',
      target: { kind: 'area', x: 5, y: 5, radius: 6 },
    });
    expect((game as any).interaction.targeting).toBeNull(); // aim clears on release
  });

  it('a plain click (start+end on the SAME tile) emits the MINIMUM radius (clampAreaRadius floors at 2)', () => {
    (game as any).castPower('summon_storm');
    (game as any).onDragArea('start', 7, 7);
    (game as any).onDragArea('end', 7, 7); // zero travel

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({
      verb: 'summon_storm',
      target: { kind: 'area', x: 7, y: 7, radius: 2 },
    });
  });

  it('a release BEYOND the 12-tile band still emits, clamped to the ceiling', () => {
    (game as any).castPower('summon_storm');
    (game as any).onDragArea('start', 10, 10);
    (game as any).onDragArea('end', 40, 10); // distance 30 — way past the band

    expect(emit.mock.calls[0][0]).toMatchObject({ target: { kind: 'area', x: 10, y: 10, radius: 12 } });
  });

  it('a cursor that leaves the canvas mid-drag drops the anchor but STAYS armed, so no phantom disc follows it back', () => {
    (game as any).castPower('summon_storm');
    (game as any).onDragArea('start', 5, 5);
    expect((game as any).interaction.targeting.anchor).toEqual({ x: 5, y: 5 });

    // `attachControls`' mouseleave abandons the gesture: 'cancel', never 'end'.
    (game as any).onDragArea('cancel', 0, 0);

    // Anchor gone ⇒ the frame renderer + hint bar both fall back to the point
    // reticle (anchor presence is what they branch on), so nothing keeps
    // painting a disc anchored to a drag that died off-canvas.
    expect((game as any).interaction.targeting.anchor).toBeUndefined();
    // Still armed: an accidental cursor exit is not a decision to stop casting.
    expect((game as any).interaction.targeting.verb).toBe('summon_storm');
    expect((game as any).dragPreview((game as any).interaction.targeting)).toBeUndefined();
    expect(emit).not.toHaveBeenCalled();

    // And a fresh drag still works afterwards, anchored where the NEW one starts.
    (game as any).onDragArea('start', 9, 9);
    (game as any).onDragArea('end', 15, 9);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({ target: { kind: 'area', x: 9, y: 9, radius: 6 } });
  });

  it('cancelling aim (Esc) mid-drag makes a subsequent onDragArea a no-op', () => {
    (game as any).castPower('summon_storm');
    (game as any).onDragArea('start', 5, 5);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect((game as any).interaction.targeting).toBeNull();

    (game as any).onDragArea('end', 11, 5); // a stray 'end' after cancel — must not emit
    expect(emit).not.toHaveBeenCalled();
  });

  it("getTargeting()'s drag readout (radius + cost) is PINNED against the registry's own effectiveCost — never a re-implemented formula", () => {
    (game as any).castPower('summon_storm');
    (game as any).onDragArea('start', 5, 5);
    (game as any).interaction.hoverTile = { x: 5, y: 15 }; // distance 10 from the anchor

    const view = (getUiRuntime() as any).hooks.getTargeting();
    expect(view.drag.radius).toBe(10);

    const cap = getCapability('summon_storm')!;
    const cmd: Command = {
      verb: 'summon_storm', source: 'player',
      target: { kind: 'area', x: 5, y: 5, radius: 10 }, seq: 0,
    };
    expect(view.drag.cost).toBe(effectiveCost(cap, cmd));
    // Sanity: this is a genuinely radius-scaled figure, not the flat base cost.
    expect(view.drag.cost).not.toBe(cap.cost);
  });

  it('getTargeting() carries no `drag` view before the anchor is set (not yet dragging)', () => {
    (game as any).castPower('summon_storm');
    const view = (getUiRuntime() as any).hooks.getTargeting();
    expect(view.drag).toBeUndefined();
  });

  it("a POINT-footprint cast (e.g. smite) never gets a drag view, even with a hover tile set", () => {
    (game as any).castPower('smite');
    (game as any).interaction.hoverTile = { x: 5, y: 5 };
    const view = (getUiRuntime() as any).hooks.getTargeting();
    expect(view.footprint).toBe('point');
    expect(view.drag).toBeUndefined();
  });

  it('END-TO-END through the real canvas: a captured drag pans NOTHING and the camera position is unchanged', () => {
    (game as any).castPower('summon_storm');
    const canvas: HTMLCanvasElement = (game as any).canvas;
    const camera = (game as any).state.camera;
    const beforeX = camera.x, beforeY = camera.y;

    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 250, clientY: 180, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: 250, clientY: 180, bubbles: true }));

    expect(camera.x).toBe(beforeX);
    expect(camera.y).toBe(beforeY);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({ verb: 'summon_storm', target: { kind: 'area' } });
  });
});
