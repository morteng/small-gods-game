import { describe, it, expect, vi } from 'vitest';
import { drawIsoTerrain } from '@/render/iso/iso-terrain';
import type { GameMap } from '@/core/types';

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

describe('iso-terrain: plain colored diamonds', () => {
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
      bounds: { minTx: 0, maxTx: 2, minTy: 0, maxTy: 2 },
      originX: 0, originY: 0,
    });
    expect((ctx.fill as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(9);
    expect((ctx.beginPath as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(9);
  });

  it('draws four diamond edges per tile', () => {
    const ctx = {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D;
    drawIsoTerrain(ctx, {
      map: makeMap(1, 1),
      bounds: { minTx: 0, maxTx: 0, minTy: 0, maxTy: 0 },
      originX: 0, originY: 0,
    });
    expect((ctx.moveTo as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((ctx.lineTo as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3);
  });
});
