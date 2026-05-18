import { describe, it, expect, vi } from 'vitest';
import { drawIsoTerrain } from '@/render/iso/iso-terrain';
import { createNullAtlas } from '@/render/iso/iso-atlas';
import type { GameMap, Tile } from '@/core/types';
import type { BlobTile } from '@/map/blob-autotiler';
import type { IsoAtlas } from '@/render/iso/iso-atlas';

// jsdom doesn't implement OffscreenCanvas — stub it using a regular canvas
if (typeof (globalThis as any).OffscreenCanvas === 'undefined') {
  (globalThis as any).OffscreenCanvas = class {
    width: number;
    height: number;
    private _canvas: HTMLCanvasElement;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      this._canvas = document.createElement('canvas');
      this._canvas.width = width;
      this._canvas.height = height;
    }
    getContext(type: string) {
      return this._canvas.getContext(type as '2d');
    }
  };
}

function makeMap(w: number, h: number, fill = 'grass'): GameMap {
  const tiles = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      row.push({ type: fill, x, y, walkable: true, state: 'realized' });
    }
    tiles.push(row);
  }
  return { width: w, height: h, tiles, pois: [], buildings: [] } as unknown as GameMap;
}

describe('drawIsoTerrain — blob variant integration', () => {
  function makeMap(): GameMap {
    const tiles: Tile[][] = [];
    for (let y = 0; y < 3; y++) {
      const row: Tile[] = [];
      for (let x = 0; x < 3; x++) {
        row.push({ type: 'grass', state: 'realized' } as Tile);
      }
      tiles.push(row);
    }
    return {
      width: 3, height: 3,
      tiles,
      buildings: [],
    } as unknown as GameMap;
  }

  function makeBlobMap(grid: number[][]): BlobTile[][] {
    return grid.map((row) => row.map((blobIndex) => ({ terrainGroup: 'grass', blobIndex })));
  }

  it('passes blob.blobIndex from blobMap to atlas.getTerrain', () => {
    const blobMap = makeBlobMap([
      [ 0,  1,  2],
      [ 7, 46,  9],
      [12, 13, 14],
    ]);
    const calls: Array<[string, number]> = [];
    const fakeAtlas: IsoAtlas = {
      getTerrain: (type, variant) => {
        calls.push([type, variant]);
        return null;
      },
      getBuilding: () => null,
      getCharacter: () => null,
      getTree: () => null,
    };
    const ctx = new OffscreenCanvas(2000, 2000).getContext('2d')!;
    drawIsoTerrain(ctx as unknown as CanvasRenderingContext2D, {
      map: makeMap(),
      atlas: fakeAtlas,
      blobMap,
      bounds: { minTx: 0, maxTx: 2, minTy: 0, maxTy: 2 },
      originX: 1000, originY: 1000,
    });
    expect(calls).toHaveLength(9);
    const indices = calls.map(([, i]) => i).sort((a, b) => a - b);
    expect(indices).toEqual([0, 1, 2, 7, 9, 12, 13, 14, 46]);
  });

  it('null blobMap → all tiles request variant 0 (back-compat)', () => {
    const calls: number[] = [];
    const fakeAtlas: IsoAtlas = {
      getTerrain: (_t, v) => { calls.push(v); return null; },
      getBuilding: () => null,
      getCharacter: () => null,
      getTree: () => null,
    };
    const ctx = new OffscreenCanvas(2000, 2000).getContext('2d')!;
    drawIsoTerrain(ctx as unknown as CanvasRenderingContext2D, {
      map: makeMap(),
      atlas: fakeAtlas,
      blobMap: null,
      bounds: { minTx: 0, maxTx: 2, minTy: 0, maxTy: 2 },
      originX: 1000, originY: 1000,
    });
    expect(calls.every((v) => v === 0)).toBe(true);
  });
});

describe('iso-terrain: fallback path', () => {
  it('fills one diamond per visible tile using path+fill', () => {
    const ctx = {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D;
    const map = makeMap(3, 3);
    drawIsoTerrain(ctx, {
      map,
      atlas: createNullAtlas(),
      blobMap: null,
      bounds: { minTx: 0, maxTx: 2, minTy: 0, maxTy: 2 },
      originX: 0, originY: 0,
    });
    expect((ctx.fill as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(9);
    expect((ctx.beginPath as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(9);
  });
});
