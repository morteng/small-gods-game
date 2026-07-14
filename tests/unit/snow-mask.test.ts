// @vitest-environment node
// The CPU snow mask must AGREE with the terrain shader's snow decision — entities
// whiten (and deciduous crowns go bare) exactly where the ground is painted white.
// The kernel is exercised on SYNTHETIC fields (the same quantities the shader is fed)
// so the three gates — cold, altitude, flat-ground — are each pinned independently.
import { describe, it, expect } from 'vitest';
import { computeSnow01, snowAmount01, type SnowFields } from '@/render/snow-mask';
import { ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import type { GameMap } from '@/core/types';

const W = 5, H = 5;

/** A 5×5 field: flat at `h`, uniform temperature `t`. Metres are honest (reliefM 300,
 *  1.5 screen-px per metre — a plausible world style), so the altitude gate is real. */
function fields(h: number, t: number, over: Partial<SnowFields> = {}): SnowFields {
  return {
    heights: new Float32Array(W * H).fill(h),
    temperature: new Float32Array(W * H).fill(t),
    width: W, height: H, reliefM: 300, zPxPerM: 1.5,
    ...over,
  };
}

/** Elevation for a given height ABOVE SEA LEVEL in metres (the altitude gate's input). */
const atMetres = (m: number, reliefM = 300): number => ELEVATION_SEA_LEVEL + m / reliefM;

describe('computeSnow01 — the terrain shader\'s snow decision, mirrored on the CPU', () => {
  it('lies snow on a COLD cell (the cold gate saturates below temp ~0.16)', () => {
    const snow = computeSnow01(fields(atMetres(3), 0.10), 2, 2);
    expect(snow).toBeGreaterThan(0.9);
  });

  it('lies snow on a HIGH-ALTITUDE cool cell (the altitude gate, above ~28 m)', () => {
    // temp 0.36 is past the cold gate (no lowland snow) but inside the altitude gate's
    // temperature window (0.45→0.33), and 75 m clears its 22.5→28 m ramp.
    const cell = fields(atMetres(75), 0.36);
    expect(computeSnow01(cell, 2, 2)).toBeGreaterThan(0.5);
    // …and the SAME temperature at sea level stays bare — altitude is what tipped it.
    expect(computeSnow01(fields(atMetres(0), 0.36), 2, 2)).toBe(0);
  });

  it('leaves a WARM LOWLAND cell bare (0, not merely small)', () => {
    expect(computeSnow01(fields(atMetres(3), 0.75), 2, 2)).toBe(0);
  });

  it('a warm cell stays bare even high up (the altitude gate needs cool air too)', () => {
    expect(computeSnow01(fields(atMetres(75), 0.75), 2, 2)).toBe(0);
  });

  it('SUPPRESSES snow on a steep face (the n.y flat-ground gate) though the cell is freezing', () => {
    const flat = fields(atMetres(3), 0.10);
    expect(computeSnow01(flat, 2, 2)).toBeGreaterThan(0.9);   // same temperature, flat → snow

    // Same freezing temperature, but the ground drops 0.5 of the elevation span across
    // the cell's ±1-tile neighbourhood: a cliff face sheds its snow.
    const heights = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) heights[y * W + x] = 0.6 - x * 0.25;
    const steep: SnowFields = { ...flat, heights };
    expect(computeSnow01(steep, 2, 2)).toBe(0);
  });

  it('is deterministic and clamped to [0,1]', () => {
    const f = fields(atMetres(40), 0.30);
    const a = computeSnow01(f, 3, 1);
    expect(computeSnow01(f, 3, 1)).toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(1);
  });

  it('border tiles take the shader\'s flat-normal fallback (no gradient → no false steepness)', () => {
    // A field sloped everywhere: the interior cell is gated off, the border cell — where
    // the vertex shader itself falls back to a flat normal — is not.
    const heights = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) heights[y * W + x] = 0.6 - x * 0.25;
    const f = fields(atMetres(3), 0.10, { heights });
    expect(computeSnow01(f, 2, 2)).toBe(0);            // interior, steep → suppressed
    expect(computeSnow01(f, 0, 2)).toBeGreaterThan(0.9); // border → flat-normal fallback
  });

  it('clamps out-of-range / fractional tile coords onto the grid', () => {
    const f = fields(atMetres(3), 0.10);
    expect(computeSnow01(f, 2.7, 2.2)).toBe(computeSnow01(f, 2, 2));
    expect(computeSnow01(f, -5, 99)).toBe(computeSnow01(f, 0, H - 1));
  });
});

describe('snowAmount01 — the per-map read the draw list makes', () => {
  it('the flat studio ground is snowless (short-circuit, never touches the field memos)', () => {
    const map = { width: 8, height: 8, flatHeight: true } as unknown as GameMap;
    expect(snowAmount01(map, 4, 4)).toBe(0);
  });

  it('a map with no field substrate (a test/studio stub) degrades to 0 rather than throwing', () => {
    const map = { width: 8, height: 8 } as unknown as GameMap;
    expect(snowAmount01(map, 4, 4)).toBe(0);
  });
});
