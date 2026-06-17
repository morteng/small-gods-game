import { describe, it, expect } from 'vitest';
import { islandFalloff, applyIslandMask, DEFAULT_ISLAND } from '@/terrain/island-mask';
import { generateTerrainFields } from '@/terrain/terrain-generator';
import { classifyBiomes } from '@/terrain/terrain-generator';

describe('islandFalloff', () => {
  const W = 64, H = 64;

  it('is ~0 at the map centre (interior untouched)', () => {
    const cx = (W - 1) / 2, cy = (H - 1) / 2;
    expect(islandFalloff(cx, cy, W, H)).toBeCloseTo(0, 5);
  });

  it('is 1 (fully sunk) at the corners', () => {
    expect(islandFalloff(0, 0, W, H)).toBe(1);
    expect(islandFalloff(W - 1, H - 1, W, H)).toBe(1);
  });

  it('is 1 at edge midpoints with the default spec (end = 1.0)', () => {
    expect(islandFalloff((W - 1) / 2, 0, W, H)).toBe(1); // top edge midpoint, d = 1
    expect(islandFalloff(0, (H - 1) / 2, W, H)).toBe(1); // left edge midpoint
  });

  it('is monotonic from centre to edge along an axis', () => {
    let prev = -1;
    for (let x = Math.floor((W - 1) / 2); x < W; x++) {
      const f = islandFalloff(x, (H - 1) / 2, W, H);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it('is deterministic and symmetric', () => {
    expect(islandFalloff(10, 20, W, H)).toBe(islandFalloff(10, 20, W, H));
    expect(islandFalloff(10, 20, W, H)).toBeCloseTo(islandFalloff(W - 1 - 10, 20, W, H), 10);
    expect(islandFalloff(10, 20, W, H)).toBeCloseTo(islandFalloff(10, H - 1 - 20, W, H), 10);
  });

  it('square shape leaves a wider interior than euclidean (corners aside)', () => {
    // At an off-axis interior point, square (max-axis) distance < euclidean.
    const sq = islandFalloff(40, 40, W, H, { shape: 'square', start: 0.62, end: 1.0 });
    const eu = islandFalloff(40, 40, W, H, { shape: 'euclidean', start: 0.62, end: 1.0 });
    expect(sq).toBeLessThanOrEqual(eu);
  });

  it('handles 1-wide axes without NaN (centred, no divide-by-zero)', () => {
    expect(Number.isFinite(islandFalloff(0, 5, 1, 16))).toBe(true);
    expect(Number.isFinite(islandFalloff(5, 0, 16, 1))).toBe(true);
  });
});

describe('applyIslandMask', () => {
  it('sinks border cells toward 0 and swells the interior with the dome', () => {
    const W = 32, H = 32;
    const elev = new Float32Array(W * H).fill(0.6);
    applyIslandMask(elev, W, H);
    expect(elev[0]).toBeCloseTo(0, 5); // corner fully sunk
    // The dome RAISES the centre above the input (land rises coast→interior),
    // by ~the full dome height near the middle.
    const dome = DEFAULT_ISLAND.dome ?? 0;
    const centre = elev[Math.floor(H / 2) * W + Math.floor(W / 2)];
    expect(centre).toBeGreaterThan(0.6 + dome * 0.8);
    expect(centre).toBeLessThanOrEqual(0.6 + dome + 1e-6);
  });

  it('with no dome the interior is left intact', () => {
    const W = 32, H = 32;
    const elev = new Float32Array(W * H).fill(0.8);
    applyIslandMask(elev, W, H, { ...DEFAULT_ISLAND, dome: 0 });
    const centre = elev[Math.floor(H / 2) * W + Math.floor(W / 2)];
    expect(centre).toBeCloseTo(0.8, 5);
  });

  it('returns the same array instance (mutates in place)', () => {
    const elev = new Float32Array(16 * 16).fill(0.5);
    expect(applyIslandMask(elev, 16, 16)).toBe(elev);
  });
});

describe('island mask in generateTerrainFields → ocean frame', () => {
  const W = 64, H = 64, seed = 1234;

  it('off by default: terrain reaches the border (some non-ocean edge tiles)', () => {
    const fields = generateTerrainFields({ seed, width: W, height: H, elevationScale: 0.06 });
    let landEdge = 0;
    for (let x = 0; x < W; x++) if (fields.elevation[x] >= 0.35) landEdge++;
    // Without a mask the top row is just noise — at least some of it should be land.
    expect(landEdge).toBeGreaterThan(0);
  });

  it('on: every border tile is below sea level (a closed ocean frame)', () => {
    const fields = generateTerrainFields({
      seed, width: W, height: H, elevationScale: 0.06, seaLevel: 0.35, island: DEFAULT_ISLAND,
    });
    const below = (i: number) => fields.elevation[i] < 0.35;
    for (let x = 0; x < W; x++) {
      expect(below(x)).toBe(true);                 // top row
      expect(below((H - 1) * W + x)).toBe(true);   // bottom row
    }
    for (let y = 0; y < H; y++) {
      expect(below(y * W)).toBe(true);             // left col
      expect(below(y * W + (W - 1))).toBe(true);   // right col
    }
  });

  it('on: border biomes classify as ocean, interior keeps land', () => {
    const cfg = { seed, width: W, height: H, elevationScale: 0.06, seaLevel: 0.35, island: DEFAULT_ISLAND };
    const fields = generateTerrainFields(cfg);
    const bm = classifyBiomes(fields, cfg);
    const oceanish = new Set(['ocean', 'deep_ocean']);
    for (let x = 0; x < W; x++) expect(oceanish.has(bm.biomes[x])).toBe(true);
    // The interior should still contain non-ocean land somewhere.
    let land = 0;
    for (let i = 0; i < bm.biomes.length; i++) if (!oceanish.has(bm.biomes[i])) land++;
    expect(land).toBeGreaterThan(W * H * 0.1);
  });
});
