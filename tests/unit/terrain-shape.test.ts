import { describe, it, expect } from 'vitest';
import { applyTerrainShape, styledShapeSpec, shapeSignature, type TerrainShapeSpec } from '@/terrain/terrain-shape';

const W = 96, H = 96, SEED = 7;
const sample = (shape: TerrainShapeSpec, x: number, y: number, base = 0.5) =>
  applyTerrainShape(base, x, y, W, H, shape, SEED);

describe('applyTerrainShape', () => {
  it('vale: a low trough flanked by high dry ground, tilting downhill along the axis', () => {
    const vale: TerrainShapeSpec = { kind: 'vale', axis: 0, strength: 1 };
    // Mid-run cross-section (x at the centre): trough at the middle row, flanks at the edges.
    const trough = sample(vale, W / 2, H / 2);
    const flankN = sample(vale, W / 2, 6);
    const flankS = sample(vale, W / 2, H - 6);
    expect(trough).toBeLessThan(flankN - 0.1);
    expect(trough).toBeLessThan(flankS - 0.1);
    // Downhill tilt: the trough is lower at the downstream (+x) end than upstream.
    const up = sample(vale, 8, H / 2);
    const down = sample(vale, W - 8, H / 2);
    expect(down).toBeLessThan(up);
  });

  it('knoll: a single dominant rise over otherwise gentle ground', () => {
    const knoll: TerrainShapeSpec = { kind: 'knoll', strength: 1 };
    const summit = sample(knoll, Math.round(W * 0.40), Math.round(H * 0.46));
    const edge = sample(knoll, W - 4, H - 4);
    expect(summit).toBeGreaterThan(edge + 0.2);
    expect(summit).toBeGreaterThan(0.8); // a real hill
  });

  it('plain: near-flat buildable ground everywhere', () => {
    const plain: TerrainShapeSpec = { kind: 'plain', strength: 1 };
    let lo = Infinity, hi = -Infinity;
    for (let y = 4; y < H; y += 8) for (let x = 4; x < W; x += 8) {
      const v = sample(plain, x, y); if (v < lo) lo = v; if (v > hi) hi = v;
    }
    expect(hi - lo).toBeLessThan(0.12); // gentle undulation only
    expect(lo).toBeGreaterThan(0.4);    // dry, above sea level (0.35)
  });

  it('strength blends toward the unshaped base (0 = passthrough)', () => {
    const vale: TerrainShapeSpec = { kind: 'vale', strength: 0 };
    expect(sample(vale, W / 2, H / 2, 0.7)).toBeCloseTo(0.7, 6);
  });

  it('styledShapeSpec / shapeSignature read the seed field and stay stable', () => {
    expect(styledShapeSpec(null)).toBeUndefined();
    expect(styledShapeSpec({ terrainShape: { kind: 'vale' } })?.kind).toBe('vale');
    expect(shapeSignature(null)).toBe('-');
    expect(shapeSignature({ kind: 'vale', axis: 0, strength: 0.9 }))
      .toBe(shapeSignature({ kind: 'vale', axis: 0, strength: 0.9 }));
    expect(shapeSignature({ kind: 'vale' })).not.toBe(shapeSignature({ kind: 'knoll' }));
  });
});
