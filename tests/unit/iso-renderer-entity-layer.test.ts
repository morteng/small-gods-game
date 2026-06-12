import { describe, it, expect, vi } from 'vitest';
import { createIsoRenderMap } from '@/render/iso/iso-renderer';
import type { RenderContext, GameMap, NpcInstance } from '@/core/types';
import { createIsoCamera } from '@/render/iso/iso-camera';

function makeMap(w: number, h: number): GameMap {
  const tiles = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { width: w, height: h, tiles, pois: [], buildings: [] } as unknown as GameMap;
}

function makeMockCtx() {
  return {
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(),
    setTransform: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
    lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), drawImage: vi.fn(),
    ellipse: vi.fn(), arc: vi.fn(),
    fillStyle: '', strokeStyle: '',
  } as unknown as CanvasRenderingContext2D;
}

function makeRc(): RenderContext {
  return {
    map: makeMap(8, 6),
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
    world: { entities: new Map(), query: () => [] } as never,
  };
}

describe('iso-renderer: WebGL entity layer composite', () => {
  it('composites the layer canvas under the identity transform and skips the Canvas2D entity pass', () => {
    const layerCanvas = { layer: true } as unknown as HTMLCanvasElement;
    const layer = { render: vi.fn(() => layerCanvas) };
    const rc = makeRc();
    rc.entityLayer = layer;
    const ctx = makeMockCtx();
    createIsoRenderMap()(ctx, rc);

    // The layer received the draw list (one NPC fallback circle) + viewport.
    expect(layer.render).toHaveBeenCalledTimes(1);
    const [items, view] = layer.render.mock.calls[0] as unknown as [unknown[], { cssWidth: number; camera: unknown }];
    expect(items).toHaveLength(1);
    expect(view.cssWidth).toBe(800);
    expect(view.camera).toBe(rc.camera);

    // Composite: identity transform, then drawImage of the layer's canvas at 0,0.
    expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
    expect(ctx.drawImage).toHaveBeenCalledWith(layerCanvas, 0, 0);
    // Canvas2D entity pass skipped — the NPC fallback circle never drew.
    expect(ctx.arc).not.toHaveBeenCalled();
  });

  it('falls back to the Canvas2D executor while the layer returns null', () => {
    const layer = { render: vi.fn(() => null) };
    const rc = makeRc();
    rc.entityLayer = layer;
    const ctx = makeMockCtx();
    createIsoRenderMap()(ctx, rc);
    expect(layer.render).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalled(); // NPC fallback circle drawn by Canvas2D
  });

  it("devMode.entityRenderBackend='canvas' bypasses the layer entirely", () => {
    const layer = { render: vi.fn(() => ({ layer: true } as unknown as HTMLCanvasElement)) };
    const rc = makeRc();
    rc.entityLayer = layer;
    rc.devMode = { entityRenderBackend: 'canvas' } as never;
    const ctx = makeMockCtx();
    createIsoRenderMap()(ctx, rc);
    expect(layer.render).not.toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalled();
  });
});
