import { describe, it, expect, beforeEach } from 'vitest';
import { hitTest } from '@/dev/hit-tester';
import { createCamera } from '@/render/camera';
import type { RenderContext, GameMap } from '@/core/types';

function makeMap(n = 8): GameMap {
  const tiles = [];
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { width: n, height: n, tiles, pois: [], buildings: [] } as unknown as GameMap;
}

function makeRc(): RenderContext {
  const cam = createCamera();
  cam.zoom = 1;
  return {
    map: makeMap(),
    camera: cam,
    canvasWidth: 800,
    canvasHeight: 600,
    npcs: [],
    world: { query: () => [] },
    generatedDecorations: [],
  } as unknown as RenderContext;
}

describe('hitTest: iso tile resolution', () => {
  beforeEach(() => localStorage.clear());

  // The renderer is WebGPU-only and iso-projected, so hit-testing resolves the
  // screen point through the iso inverse (via pickTile).
  it('resolves the screen point via the iso inverse', () => {
    // Same screen point pickTile maps to iso tile (2, 1).
    const hit = hitTest(makeRc(), 64, 96);
    expect(hit.type).toBe('tile');
    expect(hit.tileX).toBe(2);
    expect(hit.tileY).toBe(1);
  });

  it('ignores any stale render-mode flag and still resolves via iso', () => {
    localStorage.setItem('smallgods.render.mode', 'topdown');
    const hit = hitTest(makeRc(), 64, 96);
    expect(hit.tileX).toBe(2);
    expect(hit.tileY).toBe(1);
    localStorage.removeItem('smallgods.render.mode');
  });
});
