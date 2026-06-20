import { describe, it, expect } from 'vitest';
import { buildRoadMaterialAtlas, roadMaterialAtlas, ROAD_MAT, ROAD_MAT_LAYERS } from '@/render/gpu/road-material-atlas';

describe('buildRoadMaterialAtlas', () => {
  it('produces 3 seamless RGBA layers of the requested size', () => {
    const a = buildRoadMaterialAtlas(32);
    expect(a.size).toBe(32);
    expect(a.layers).toBe(ROAD_MAT_LAYERS);
    expect(a.albedo.length).toBe(32 * 32 * 4 * 3);
    expect(a.normal.length).toBe(32 * 32 * 4 * 3);
  });

  it('albedo alpha is fully opaque everywhere (roads are solid, no silhouette)', () => {
    const a = buildRoadMaterialAtlas(16);
    for (let i = 3; i < a.albedo.length; i += 4) expect(a.albedo[i]).toBe(255);
  });

  it('normals point mostly up (B channel dominant) — a near-flat surface with bumps', () => {
    const a = buildRoadMaterialAtlas(32);
    // Average the cobble layer normal: B (up) should dominate R/G (in-plane bump).
    const per = 32 * 32 * 4;
    const base = ROAD_MAT.cobble * per;
    let sumR = 0, sumG = 0, sumB = 0, n = 0;
    for (let p = 0; p < 32 * 32; p++) {
      sumR += a.normal[base + p * 4]; sumG += a.normal[base + p * 4 + 1]; sumB += a.normal[base + p * 4 + 2]; n++;
    }
    // Encoded up (z=+1) is 255; in-plane bumps average near 128 (zero-mean). B clearly highest.
    expect(sumB / n).toBeGreaterThan(sumR / n);
    expect(sumB / n).toBeGreaterThan(sumG / n);
    expect(sumB / n).toBeGreaterThan(200); // mostly up
  });

  it('the cobble layer actually has in-plane bump variation (not a flat normal)', () => {
    const a = buildRoadMaterialAtlas(32);
    const per = 32 * 32 * 4;
    const base = ROAD_MAT.cobble * per;
    let minR = 255, maxR = 0;
    for (let p = 0; p < 32 * 32; p++) {
      const r = a.normal[base + p * 4];
      if (r < minR) minR = r; if (r > maxR) maxR = r;
    }
    expect(maxR - minR).toBeGreaterThan(20); // domes tilt the normal both ways
  });

  it('is deterministic and memoised', () => {
    const a = buildRoadMaterialAtlas(16);
    const b = buildRoadMaterialAtlas(16);
    expect(Array.from(a.albedo)).toEqual(Array.from(b.albedo));
    expect(roadMaterialAtlas()).toBe(roadMaterialAtlas());
  });
});
