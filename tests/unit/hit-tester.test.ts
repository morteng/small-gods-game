import { describe, it, expect, beforeEach } from 'vitest';
import { hitTest } from '@/dev/hit-tester';
import { createCamera } from '@/render/camera';
import { pickTile } from '@/ui/pick-tile';
import { isoEnvForMap } from '@/render/iso/iso-env';
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

  // The renderer is WebGPU-only and iso-projected, so hit-testing resolves the screen
  // point through the LIFT-AWARE iso inverse (`pickTile` with the map's IsoEnv) — it must
  // return the exact integer tile `pickTile` resolves, accounting for terrain lift. We
  // assert that delegation rather than a hard-coded tile, so the test stays valid as the
  // height/lift model is tuned (a flat-inverse expectation would be wrong on lifted ground).
  it('resolves the screen point via the lift-aware iso inverse (delegates to pickTile)', () => {
    const rc = makeRc();
    const want = pickTile(rc.camera, 64, 96, isoEnvForMap(rc.map));
    const hit = hitTest(rc, 64, 96);
    expect(hit.type).toBe('tile');
    expect(hit.tileX).toBe(want.tx);
    expect(hit.tileY).toBe(want.ty);
    // …and the resolved indices are integers (consumers use them as tile indices).
    expect(Number.isInteger(hit.tileX)).toBe(true);
    expect(Number.isInteger(hit.tileY)).toBe(true);
  });

  it('ignores any stale render-mode flag and still resolves via iso', () => {
    const rc = makeRc();
    const want = pickTile(rc.camera, 64, 96, isoEnvForMap(rc.map));
    localStorage.setItem('smallgods.render.mode', 'topdown');
    const hit = hitTest(rc, 64, 96);
    expect(hit.tileX).toBe(want.tx);
    expect(hit.tileY).toBe(want.ty);
    localStorage.removeItem('smallgods.render.mode');
  });
});
