/**
 * Abilities v1 — Phase A (A2): the cast reticle's validity read.
 *
 * The reticle tints gold vs dim ink off a LIVE "would this hovered tile
 * resolve?" read (`FrameRendererDeps.wouldResolveTarget`, wired in `game.ts` to
 * `this.resolveTargetAt(x, y, kinds) !== null` — the exact same authority
 * `resolveTargetedCast` consults on click, so the tint never promises a hit
 * the click itself would then miss). This drives that same resolution
 * directly, the way `frame-renderer.ts` does, rather than reaching into
 * `FrameRenderer`'s private deps.
 *
 * `dream`'s targetKind is `npc`-only (no tile/entity fallback, unlike smite's
 * `smiteLocation`) — the previous builder's note that "a smite reticle is
 * valid essentially everywhere" makes smite a poor witness for the invalid
 * tint, so this exercises `dream` instead: invalid over bare ground, valid
 * over an NPC's tile.
 *
 * Follows the `tests/unit/cast-targeting.test.ts` precedent: `Game`'s
 * resolution logic is a private method with no pure-function seam of its own
 * (it reads the live `World`), so this instantiates a real `Game` under
 * jsdom and drives it via `(game as any)`.
 */
/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Game } from '@/game';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { getCapability, acceptedTargetKinds } from '@/sim/command/registry';
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

describe('Game — cast reticle validity read (abilities-v1 A2)', () => {
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
    const props = initNpcProps('Ada', 'farmer', 1) as NpcProperties;
    state.world.addEntity({ id: 'n1', kind: 'npc', x: 3, y: 4, tags: [], properties: props });
  });

  afterEach(() => {
    game.destroy();
    container.remove();
  });

  it("dream (npc-only) reads invalid over bare ground and valid over the NPC's tile", () => {
    const kinds = acceptedTargetKinds(getCapability('dream')!);
    expect(kinds).toEqual(['npc']); // confirms this verb has no tile/entity fallback

    const bareGround = (game as any).resolveTargetAt(0, 0, kinds) !== null;
    expect(bareGround).toBe(false);

    const onNpc = (game as any).resolveTargetAt(3, 4, kinds) !== null;
    expect(onNpc).toBe(true);
  });

  it('smite (npc/entity/tile) reads valid everywhere on the map, including bare ground', () => {
    // The previous builder's note: smite's tile fallback means its reticle is
    // valid essentially anywhere — confirming that here so the invalid-tint
    // test above (on `dream`) is the one actually earning its keep, not smite.
    const kinds = acceptedTargetKinds(getCapability('smite')!);
    const bareGround = (game as any).resolveTargetAt(0, 0, kinds) !== null;
    expect(bareGround).toBe(true);
  });

  it("wiring: castPower('dream') arms targetKinds ['npc'], matching the registry read above", () => {
    (game as any).castPower('dream');
    const t = (game as any).interaction.targeting;
    expect(t.targetKinds).toEqual(['npc']);
  });
});
