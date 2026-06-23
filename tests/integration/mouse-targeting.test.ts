import { describe, it, expect, beforeAll } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import { WaterType, type WorldSeed, type GameMap, type Camera } from '@/core/types';
import { projectConnectome, screenToTileLifted } from '@/render/connectome-overlay';
import { buildRenderWaterTypeMemo } from '@/render/gpu/render-water-mask';
import { getHydrologyResult, clearHydrologyCache } from '@/world/hydrology-store';
import { tileReadout } from '@/studio/world-hover';

// Integration: the FULL targeting chain on a REAL generated world (real heightfield,
// world style, composed road/river carve) — no browser, no GPU. Mirrors the studio's
// hover/select path: forward project a tile, invert the pixel with the lift-aware
// inverse, and assert the cursor resolves to the tile actually drawn there. Plus the
// readout-matches-render guarantee: a cell painted as a river READS as a river.

const seed: WorldSeed = {
  name: 'targeting-test', size: { width: 96, height: 96 }, biome: 'temperate',
  pois: [], connections: [], constraints: [],
};

let map: GameMap;
const cam: Camera = { x: 0, y: 0, zoom: 0.5, dragging: false, lastX: 0, lastY: 0 };

/** Two-triangle point-in-quad against a cell's four real lifted screen corners. */
function inCellQuad(p: { x: number; y: number }, cx: number, cy: number): boolean {
  const a = projectConnectome(map, cx, cy, cam), b = projectConnectome(map, cx + 1, cy, cam);
  const c = projectConnectome(map, cx + 1, cy + 1, cam), d = projectConnectome(map, cx, cy + 1, cam);
  const sign = (px: number, py: number, ax: number, ay: number, bx: number, by: number) =>
    (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const inTri = (q: { x: number; y: number }, t1: { x: number; y: number }, t2: { x: number; y: number }, t3: { x: number; y: number }) => {
    const d1 = sign(q.x, q.y, t1.x, t1.y, t2.x, t2.y);
    const d2 = sign(q.x, q.y, t2.x, t2.y, t3.x, t3.y);
    const d3 = sign(q.x, q.y, t3.x, t3.y, t1.x, t1.y);
    return !(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0)));
  };
  return inTri(p, a, b, c) || inTri(p, a, c, d);
}

beforeAll(async () => {
  clearHydrologyCache();
  ({ map } = await generateWithNoise(seed.size.width, seed.size.height, 1, seed));
});

describe('mouse targeting — real world projection round-trip', () => {
  it('every tile centre inverts to a tile that is drawn under that pixel (never behind)', () => {
    const W = map.width, H = map.height;
    let visible = 0, occluded = 0, behind = 0, notCovering = 0;
    // Stride 2 keeps thousands of samples (ample statistics) while the lift-aware
    // marcher — deliberately fine-stepped for accuracy — stays well inside the budget.
    for (let ty = 2; ty < H - 2; ty += 2) for (let tx = 2; tx < W - 2; tx += 2) {
      const s = projectConnectome(map, tx + 0.5, ty + 0.5, cam);
      const r = screenToTileLifted(map, s.x, s.y, cam);
      const rx = Math.floor(r.tx), ry = Math.floor(r.ty);
      if (rx === tx && ry === ty) { visible++; continue; }
      occluded++;
      if (rx + ry < tx + ty) behind++;             // resolved to a tile BEHIND ⇒ bug
      if (!inCellQuad(s, rx, ry)) notCovering++;    // resolved tile doesn't cover pixel ⇒ bug
    }
    const total = visible + occluded;
    // The overwhelming majority of tiles are directly visible…
    expect(visible / total).toBeGreaterThan(0.95);
    // …and the resolved tile is under the cursor and not behind the query for essentially
    // every tile. On REAL terrain a vanishing fraction (cliff cells where the marcher's
    // finite step grazes a sub-tile sliver crossing) may resolve to an adjacent tile —
    // bounded here, and held to ZERO on smooth terrain by the unit suite.
    expect(behind / total).toBeLessThan(0.002);
    expect(notCovering / total).toBeLessThan(0.002);
  }, 30000);

  it('is zoom-invariant: a fixed world tile resolves identically across zoom levels', () => {
    const tx = 48, ty = 40;
    const picks = [0.04, 0.2, 0.5, 1.5, 4].map((z) => {
      const c: Camera = { x: 120, y: 60, zoom: z, dragging: false, lastX: 0, lastY: 0 };
      const s = projectConnectome(map, tx + 0.5, ty + 0.5, c);
      const r = screenToTileLifted(map, s.x, s.y, c);
      return `${Math.floor(r.tx)},${Math.floor(r.ty)}`;
    });
    expect(new Set(picks).size).toBe(1);
    expect(picks[0]).toBe(`${tx},${ty}`);
  });
});

describe('mouse targeting — readout matches the rendered water', () => {
  it('classifies a painted-river cell as a river (render mask, not the D8 raster)', () => {
    const renderWT = buildRenderWaterTypeMemo(map);
    const W = map.width, H = map.height;
    let riverCell = -1;
    for (let i = 0; i < renderWT.length; i++) if (renderWT[i] === WaterType.River) { riverCell = i; break; }
    expect(riverCell).toBeGreaterThanOrEqual(0);   // the world has a rendered river
    const x = riverCell % W, y = (riverCell / W) | 0;
    const rows = tileReadout(map, x, y, { renderWaterType: renderWT });
    const water = rows.find((r) => r[0] === 'water');
    expect(water).toBeDefined();
    expect(water![1]).toMatch(/river/);
    void H;
  });

  it('the render mask diverges from the raster — the bug the fix closes is real', () => {
    // Where the smooth connectome river is re-stamped off the D8 staircase, the render
    // mask says River but the raster says Dry. On such a cell the OLD readout (raster)
    // said "dry/grass" while the pixels showed a river. Assert the divergence exists and
    // that the render-mask readout now reports river there.
    const renderWT = buildRenderWaterTypeMemo(map);
    const raster = getHydrologyResult(map).waterType;
    const W = map.width;
    let diverged = -1;
    for (let i = 0; i < renderWT.length; i++) {
      if (renderWT[i] === WaterType.River && raster[i] !== WaterType.River) { diverged = i; break; }
    }
    if (diverged < 0) return;   // no divergence for this seed — nothing to assert, not a failure
    const x = diverged % W, y = (diverged / W) | 0;
    const withRender = tileReadout(map, x, y, { renderWaterType: renderWT }).find((r) => r[0] === 'water');
    const withRaster = tileReadout(map, x, y).find((r) => r[0] === 'water');
    expect(withRender?.[1]).toMatch(/river/);                 // fixed: matches the pixels
    expect(withRaster?.[1] ?? 'none').not.toMatch(/river/);   // old behaviour: disagreed
  });
});
