import { describe, it, expect, vi } from 'vitest';
import { drawIsoTerrain, tileHash01, ISO_SKIRT_H } from '@/render/iso/iso-terrain';
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

/** Fake ctx recording each fill's style + the path coords moved/lined to. */
function recordingCtx() {
  const fills: string[] = [];
  const coords: Array<[number, number]> = [];
  let pending = '';
  const ctx = {
    beginPath: vi.fn(),
    moveTo: vi.fn((x: number, y: number) => coords.push([x, y])),
    lineTo: vi.fn((x: number, y: number) => coords.push([x, y])),
    closePath: vi.fn(),
    fill: vi.fn(() => fills.push(pending)),
    imageSmoothingEnabled: true,
    set fillStyle(v: string) { pending = v; },
    get fillStyle() { return pending; },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, fills, coords };
}

describe('iso-terrain: tile slabs (top diamond + front skirts + noise)', () => {
  it('an isolated tile draws both front skirts + the top diamond (3 fills)', () => {
    const { ctx, fills } = recordingCtx();
    drawIsoTerrain(ctx, {
      map: makeMap(1, 1),
      bounds: { minTx: 0, maxTx: 0, minTy: 0, maxTy: 0 },
      originX: 0, originY: 0,
    });
    expect(fills).toHaveLength(3); // left skirt, right skirt, top
  });

  it('culls skirts where a front neighbour occludes them — interior tile is top-only', () => {
    const { ctx, fills } = recordingCtx();
    // Draw ONLY the back-corner tile (0,0) of a 3x3: both its front neighbours
    // (1,0) and (0,1) exist, so neither skirt is drawn → 1 fill.
    drawIsoTerrain(ctx, {
      map: makeMap(3, 3),
      bounds: { minTx: 0, maxTx: 0, minTy: 0, maxTy: 0 },
      originX: 0, originY: 0,
    });
    expect(fills).toHaveLength(1);
  });

  it('a full 3x3 draws 9 tops + 3 left + 3 right skirts (front silhouette only)', () => {
    const { ctx, fills } = recordingCtx();
    drawIsoTerrain(ctx, {
      map: makeMap(3, 3),
      bounds: { minTx: 0, maxTx: 2, minTy: 0, maxTy: 2 },
      originX: 0, originY: 0,
    });
    expect(fills).toHaveLength(9 + 3 + 3);
  });

  it('snaps every vertex to a whole pixel (no sub-pixel seams)', () => {
    const { ctx, coords } = recordingCtx();
    drawIsoTerrain(ctx, {
      map: makeMap(2, 2),
      // half-integer origin would push raw coords off-grid; output must still snap.
      bounds: { minTx: 0, maxTx: 1, minTy: 0, maxTy: 1 },
      originX: 0.5, originY: 0.5,
    });
    for (const [x, y] of coords) {
      expect(Number.isInteger(x)).toBe(true);
      expect(Number.isInteger(y)).toBe(true);
    }
  });

  it('disables image smoothing for crisp pixel edges', () => {
    const { ctx } = recordingCtx();
    drawIsoTerrain(ctx, {
      map: makeMap(1, 1),
      bounds: { minTx: 0, maxTx: 0, minTy: 0, maxTy: 0 },
      originX: 0, originY: 0,
    });
    expect(ctx.imageSmoothingEnabled).toBe(false);
  });

  it('skirts hang exactly ISO_SKIRT_H below the front edge', () => {
    const { ctx, coords } = recordingCtx();
    drawIsoTerrain(ctx, {
      map: makeMap(1, 1),
      bounds: { minTx: 0, maxTx: 0, minTy: 0, maxTy: 0 },
      originX: 0, originY: 0,
    });
    // bottom vertex y = cy + halfH + 1 = 0 + 32 + 1 = 33; skirt drops to 33 + SKIRT_H.
    const ys = coords.map(([, y]) => y);
    expect(ys).toContain(33 + ISO_SKIRT_H);
  });
});

describe('tileHash01', () => {
  it('is deterministic and in [0,1)', () => {
    for (const [x, y] of [[0, 0], [3, 7], [-2, 5], [120, 88]] as const) {
      const a = tileHash01(x, y);
      expect(a).toBe(tileHash01(x, y));
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it('decorrelates neighbouring tiles (no smooth gradient)', () => {
    // Adjacent tiles should differ substantially, not crawl by a tiny LCG step.
    const diffs: number[] = [];
    for (let x = 0; x < 16; x++) diffs.push(Math.abs(tileHash01(x, 0) - tileHash01(x + 1, 0)));
    const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
    expect(mean).toBeGreaterThan(0.2); // far from a near-zero correlated step
  });
});
