/**
 * UI v2 W2 — D1 tail (band-keyed target resolution) + D5 (settlement inspector
 * building-row threading). `hoverAffordances`/`inspectorView` are private `Game`
 * methods with no pure-function seam of their own (the decision reads live
 * `state`/`interaction`), so — following the `tests/dom/pause-banner.test.ts`
 * precedent — this instantiates a real `Game` under jsdom (no WebGPU needed;
 * these methods never touch the canvas) and reaches into the private surface via
 * `(game as any)`.
 */
/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Game } from '@/game';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
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

describe('Game — UI v2 W2/D1: band-keyed hover/inspector resolution', () => {
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
    state.worldSeed = {
      name: 'Testland', era: 'medieval',
      pois: [{ id: 'poi1', type: 'village', name: 'Hollow', position: { x: 2, y: 2 } }],
    };
    const props = initNpcProps('Ada', 'farmer', 1) as NpcProperties;
    props.homePoiId = 'poi1';
    state.world.addEntity({ id: 'n1', kind: 'npc', x: 2, y: 2, tags: [], properties: props });
    // A minimal fake building — enough for `blueprintOf` + `nearestPoiId`, no full
    // manifold pipeline needed for this seam.
    state.world.addEntity({
      id: 'b1', kind: 'cottage', x: 3, y: 2, tags: ['building'],
      properties: {
        blueprint: {
          rb: { preset: 'cottage', category: 'residential' },
          collision: { footprint: { w: 1, h: 1 }, blocked: [], doorCells: [] },
          anchors: [],
        },
      },
    });
  });

  afterEach(() => {
    game.destroy();
    container.remove();
  });

  /** Drives `currentBand()` to a stable value — each probe zoom sits well inside
   *  its band's dead-zone-free region (see `zoom-band.test.ts`), so one call settles
   *  it regardless of the private `zoomBandState`'s prior value. */
  function setZoom(zoom: number): void {
    (game as any).state.camera.zoom = zoom;
  }

  describe('hoverAffordances (D1 tail)', () => {
    it('is null ONLY in the world band — settlement and soul both resolve the hovered npc', () => {
      (game as any).interaction.hoverTile = { x: 2, y: 2 };

      setZoom(0.02); // world
      expect((game as any).hoverAffordances()).toBeNull();

      setZoom(0.2); // settlement
      expect((game as any).hoverAffordances()).not.toBeNull();

      setZoom(1); // soul
      expect((game as any).hoverAffordances()).not.toBeNull();
    });

    it('a hovered building resolves to its settlement in both settlement and soul bands', () => {
      (game as any).interaction.hoverTile = { x: 3, y: 2 }; // b1's tile, no npc there

      setZoom(0.2);
      (game as any).hoverAffordances();
      expect((game as any).hoverFrozen).toEqual({ kind: 'settlement', poiId: 'poi1' });

      setZoom(1);
      (game as any).hoverAffordances();
      expect((game as any).hoverFrozen).toEqual({ kind: 'settlement', poiId: 'poi1' });
    });
  });

  describe('inspectorView (D1 tail + D5 buildingRow)', () => {
    it('is null ONLY in the world band; the selection survives the band change', () => {
      (game as any).state.selectedNpcId = 'n1';

      setZoom(0.02); // world
      expect((game as any).inspectorView()).toBeNull();
      expect((game as any).state.selectedNpcId).toBe('n1'); // selection preserved, not cleared

      setZoom(0.2); // settlement
      const settlementView = (game as any).inspectorView();
      expect(settlementView).not.toBeNull();
      expect(settlementView.kind).toBe('npc');
      expect(settlementView.title).toBe('Ada');

      setZoom(1); // soul
      expect((game as any).inspectorView()?.kind).toBe('npc');
    });

    it('a settlement selection resolved from a building click carries a buildingRow', () => {
      (game as any).state.selectedBuildingId = 'b1';
      setZoom(0.2); // settlement band — the inspector now lives here too (W2)

      const view = (game as any).inspectorView();
      expect(view.kind).toBe('settlement');
      expect(view.buildingRow).toEqual({ name: 'a one-room peasant cottage', type: 'residential' });
    });

    it('an npc selection never carries a buildingRow, even with a building also selected', () => {
      (game as any).state.selectedNpcId = 'n1';
      (game as any).state.selectedBuildingId = 'b1';
      setZoom(0.2);
      const view = (game as any).inspectorView();
      expect(view.kind).toBe('npc');
      expect(view.buildingRow).toBeUndefined();
    });
  });
});
