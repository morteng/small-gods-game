import { describe, it, expect } from 'vitest';
import {
  packInstances, packGlobals, packTerrainGlobals, QUAD_STRIP, QUAD_VERTEX_COUNT,
  INSTANCE_FLOATS, INSTANCE_STRIDE, GLOBALS_FLOATS, TERRAIN_GLOBALS_FLOATS,
} from '@/render/gpu/instance-buffer';
import type { InstanceAttrs } from '@/render/gpu/instance-batch';

const inst = (over: Partial<InstanceAttrs> = {}): InstanceAttrs => ({
  dx: 1, dy: 2, dw: 3, dh: 4, u0: 0, v0: 0, u1: 1, v1: 1, depth: 0.5, ...over,
});

describe('R2c — instance/globals buffer packing', () => {
  it('unit quad is a 4-vertex triangle strip', () => {
    expect(QUAD_VERTEX_COUNT).toBe(4);
    expect(Array.from(QUAD_STRIP)).toEqual([0, 0, 1, 0, 0, 1, 1, 1]);
  });

  it('stride is 9 floats / 36 bytes', () => {
    expect(INSTANCE_FLOATS).toBe(9);
    expect(INSTANCE_STRIDE).toBe(36);
  });

  it('packs instances interleaved in the documented field order', () => {
    const buf = packInstances([inst({ dx: 10, dy: 20, dw: 30, dh: 40, u0: 0.125, v0: 0.25, u1: 0.75, v1: 0.5, depth: 0.25 })]);
    expect(buf).toHaveLength(9);
    expect(Array.from(buf)).toEqual([10, 20, 30, 40, 0.125, 0.25, 0.75, 0.5, 0.25]);
  });

  it('packs N instances contiguously', () => {
    const buf = packInstances([inst({ dx: 1 }), inst({ dx: 2 }), inst({ dx: 3 })]);
    expect(buf).toHaveLength(27);
    expect(buf[0]).toBe(1);
    expect(buf[9]).toBe(2);
    expect(buf[18]).toBe(3);
  });

  it('Globals is 16 floats with vec3 padding and clamped bands', () => {
    // float32-exact fractions (powers of two) so the typed-array round-trips cleanly
    const g = packGlobals({
      viewport: [800, 600], bands: 0, // clamps to 1
      ambient: [0.5, 0.5, 0.75], sunDir: [-0.5, 0.5, 0.25], sunColor: [0.25, 0.5, 0.75],
    });
    expect(g).toHaveLength(GLOBALS_FLOATS);
    expect(g[0]).toBe(800);
    expect(g[1]).toBe(600);
    expect(g[2]).toBe(1); // bands clamped ≥1
    expect(g[3]).toBe(0); // pad
    expect([g[4], g[5], g[6]]).toEqual([0.5, 0.5, 0.75]);
    expect(g[7]).toBe(0); // pad
    expect([g[8], g[9], g[10]]).toEqual([-0.5, 0.5, 0.25]);
    expect([g[12], g[13], g[14]]).toEqual([0.25, 0.5, 0.75]);
  });

  it('packTerrainGlobals lays out viewport/xform/grid/half/z/sun/ambient (T1)', () => {
    const t = packTerrainGlobals({
      viewport: [800, 600],
      xform: { sx: 2, sy: 2, ox: 5, oy: 7 },
      grid: [64, 48], half: [64, 32],
      zPxPerM: 1.5, seaLevel: 0.35, reliefM: 48, subsample: 0, // subsample clamped ≥1
      sunDir: [-1, 1.6, -1], bands: 0,                         // bands clamped ≥1
      ambient: [0.7, 0.7, 0.74], sunStrength: 0.5,
    });
    expect(t).toHaveLength(TERRAIN_GLOBALS_FLOATS);
    expect(TERRAIN_GLOBALS_FLOATS).toBe(24);
    // Float32 storage, so fractional values are compared with tolerance.
    const near = (i: number, v: number) => expect(t[i]).toBeCloseTo(v, 5);
    expect([t[0], t[1], t[2], t[3]]).toEqual([800, 600, 0, 0]);   // viewport, pad
    expect([t[4], t[5], t[6], t[7]]).toEqual([2, 2, 5, 7]);       // xform
    expect([t[8], t[9], t[10], t[11]]).toEqual([64, 48, 64, 32]); // grid, half
    near(12, 1.5); near(13, 0.35); near(14, 48); near(15, 1);     // zParams (subsample ≥1)
    near(16, -1); near(17, 1.6); near(18, -1); near(19, 1);       // sun dir, bands ≥1
    near(20, 0.7); near(21, 0.7); near(22, 0.74); near(23, 0.5);  // ambient, strength
  });
});
