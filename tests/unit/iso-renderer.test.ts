import { describe, it, expect, vi } from 'vitest';
import { renderMap, createIsoRenderMap } from '@/render/iso/iso-renderer';
import type { RenderContext, GameMap, NpcInstance } from '@/core/types';
import { createIsoCamera } from '@/render/iso/iso-camera';

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

function makeMockCtx() {
  return {
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(),
    fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    closePath: vi.fn(), fill: vi.fn(), drawImage: vi.fn(),
    ellipse: vi.fn(), arc: vi.fn(),
    fillStyle: '', strokeStyle: '',
  } as unknown as CanvasRenderingContext2D;
}

function makeRc(w = 8, h = 6): RenderContext {
  return {
    map: makeMap(w, h),
    camera: createIsoCamera(),
    canvasWidth: 800,
    canvasHeight: 600,
    npcs: [
      { id: 'n1', name: 'Alice', role: 'farmer', seed: 1, tileX: 2, tileY: 2,
        direction: 'down', frame: 0, frameTimer: 0 } as NpcInstance,
    ],
    npcSheets: new Map(),
    visualMap: null,
    blobMap: null,
    tileAtlas: null,
    terrainSheets: new Map(),
    buildingSprites: new Map(),
    treeSheets: new Map(),
    world: { entities: new Map(), query: () => [] } as any,
  };
}

describe('iso-renderer: integration', () => {
  it('renders without throwing on a populated RenderContext', () => {
    const ctx = makeMockCtx();
    const rc = makeRc();
    expect(() => renderMap(ctx, rc)).not.toThrow();
    expect((ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });
});

describe('iso-renderer: factory', () => {
  it('back-compat renderMap export runs without throwing', () => {
    const ctx = makeMockCtx();
    expect(() => renderMap(ctx, makeRc())).not.toThrow();
  });

  it('createIsoRenderMap(null) returns a callable renderMap that does not throw', () => {
    const fn = createIsoRenderMap(null);
    const ctx = makeMockCtx();
    expect(() => fn(ctx, makeRc())).not.toThrow();
    expect((ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });
});
