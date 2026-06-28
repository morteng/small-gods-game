// tests/unit/terrain-affordance.test.ts
// The terrain affordance/tag layer (building-validity epic S4). `terrainAffordanceAt`
// reports defensive affordances (height/commanding/steepFlanks/water/approachControl) AND
// the intrinsic terrain tags (elevation/slope/flatness/aspect) that sun-orientation (S3)
// and view/prominence siting (S5) consume — all from a height sampler, so we can drive it
// with synthetic terrain (a plane, a ramp, a cone) and assert the math exactly.
import { describe, it, expect } from 'vitest';
import { terrainAffordanceAt, makeTerrainProbe, type HeightSampler } from '@/world/terrain-affordance';

const flat = (h: number): HeightSampler => () => h;
/** A ramp falling `dropPerTile` metres for every +1 in the given axis. */
const ramp = (axis: 'x' | 'y', dropPerTile: number, base = 0): HeightSampler =>
  (tx, ty) => base - dropPerTile * (axis === 'x' ? tx : ty);
/** A cone peaking at (cx,cy): height falls 1 m per tile of radius. */
const cone = (cx: number, cy: number, peak: number): HeightSampler =>
  (tx, ty) => peak - Math.hypot(tx - cx, ty - cy);

describe('terrainAffordanceAt — intrinsic terrain tags', () => {
  it('flat ground: slope 0, flatness 1, no aspect, elevation passes through', () => {
    const a = terrainAffordanceAt(flat(10), 50, 50);
    expect(a.elevation).toBe(10);
    expect(a.slope).toBe(0);
    expect(a.flatness).toBe(1);
    expect(a.aspectX).toBe(0);
    expect(a.aspectY).toBe(0);
    // Flat ground commands nothing and has no steep flanks.
    expect(a.commanding).toBe(0);
    expect(a.steepFlanks).toBe(0);
  });

  it('a gentle south-facing slope: aspect points downhill (+y), slope is partial', () => {
    // Falls 1 m per +y tile → gradient 1 m/tile → slope 1/2 (45° = 2 m/tile = slope 1).
    const a = terrainAffordanceAt(ramp('y', 1), 40, 40);
    expect(a.slope).toBeCloseTo(0.5, 6);
    expect(a.flatness).toBeCloseTo(0.5, 6);
    expect(a.aspectX).toBeCloseTo(0, 6);
    expect(a.aspectY).toBeCloseTo(1, 6); // downhill = +y (the descending direction)
  });

  it('aspect points downhill along x for an east-facing ramp', () => {
    // Height rises toward -x / falls toward +x → downhill is +x.
    const a = terrainAffordanceAt(ramp('x', 0.5), 30, 30);
    expect(a.aspectX).toBeCloseTo(1, 6);
    expect(a.aspectY).toBeCloseTo(0, 6);
    expect(a.slope).toBeCloseTo(0.25, 6); // 0.5 m/tile ÷ 2 m/tile reference
  });

  it('slope saturates to 1 (and flatness to 0) on a cliff steeper than ~45°', () => {
    const a = terrainAffordanceAt(ramp('y', 5), 20, 20); // 5 m/tile ≫ 2 m/tile reference
    expect(a.slope).toBe(1);
    expect(a.flatness).toBe(0);
  });

  it('aspect is a unit vector pointing radially OUT from a peak (downhill)', () => {
    const peakAt = cone(50, 50, 30);
    const east = terrainAffordanceAt(peakAt, 56, 50); // east of the apex
    expect(east.aspectX).toBeCloseTo(1, 4); // downhill = away from peak = +x
    expect(east.aspectY).toBeCloseTo(0, 4);
    const south = terrainAffordanceAt(peakAt, 50, 56);
    expect(south.aspectX).toBeCloseTo(0, 4);
    expect(south.aspectY).toBeCloseTo(1, 4);
    // The unit-vector invariant holds wherever there's a slope.
    const diag = terrainAffordanceAt(peakAt, 56, 56);
    expect(Math.hypot(diag.aspectX, diag.aspectY)).toBeCloseTo(1, 4);
  });

  it('a peak commands its surroundings (high commanding + local prominence)', () => {
    const a = terrainAffordanceAt(cone(50, 50, 30), 50, 50);
    expect(a.commanding).toBe(1); // looks down on every direction
    expect(a.height).toBeGreaterThan(0); // local prominence above neighbours
    expect(a.elevation).toBeCloseTo(30, 6); // absolute height at the apex
  });
});

describe('terrainAffordanceAt — semantic tags (S5)', () => {
  it('a peak is prominent (dominant / far-seen) and unsheltered', () => {
    const a = terrainAffordanceAt(cone(50, 50, 30), 50, 50);
    expect(a.prominence).toBeGreaterThan(0.7); // commands every direction + local rise
    expect(a.shelter).toBeLessThan(0.1);       // exposed — the opposite of cosy
  });

  it('a flat valley floor is sheltered (cosy) but not prominent', () => {
    const a = terrainAffordanceAt(flat(2), 50, 50);
    expect(a.shelter).toBe(1);     // flat + un-exposed = maximally snug
    expect(a.prominence).toBe(0);  // sees/dominates nothing
  });

  it('a sun-facing slope is sunny; the shaded slope is not; flat is neutral', () => {
    // SUN_BEARING is +y (south); a slope whose downhill aspect is +y faces the sun.
    const southSlope = terrainAffordanceAt(ramp('y', 1), 40, 40); // aspect +y, slope 0.5
    const northSlope = terrainAffordanceAt(ramp('y', -1), 40, 40); // aspect -y
    expect(southSlope.sunny).toBeGreaterThan(0.7);
    expect(northSlope.sunny).toBeLessThan(0.3);
    expect(terrainAffordanceAt(flat(5), 10, 10).sunny).toBe(0.5); // no aspect → neutral
  });

  it('all three semantic tags are present and finite on the probe', () => {
    const probe = makeTerrainProbe({
      seed: 1, width: 8, height: 8, worldSeed: undefined,
    } as unknown as Parameters<typeof makeTerrainProbe>[0]);
    const a = probe.affordanceAt(4, 4);
    for (const k of ['prominence', 'shelter', 'sunny']) {
      expect(typeof a[k]).toBe('number');
      expect(Number.isFinite(a[k])).toBe(true);
    }
  });
});

describe('terrainAffordanceAt — defensive affordances are unchanged (additive tags)', () => {
  it('still reports the five earthworks protocol fields, all numeric', () => {
    const a = terrainAffordanceAt(cone(10, 10, 20), 12, 10);
    for (const k of ['height', 'commanding', 'steepFlanks', 'water', 'approachControl']) {
      expect(typeof a[k]).toBe('number');
      expect(Number.isFinite(a[k])).toBe(true);
    }
  });

  it('water proximity registers below-sea-level ground nearby', () => {
    // A coast: everything at x ≥ 55 is underwater.
    const coast: HeightSampler = (tx) => (tx >= 55 ? -3 : 5);
    const dry = terrainAffordanceAt(coast, 50, 30);
    expect(dry.water).toBeGreaterThan(0); // sea is within WATER_R to the east
    const inland = terrainAffordanceAt(coast, 20, 30);
    expect(inland.water).toBe(0);
  });
});

describe('makeTerrainProbe — exposes the tag layer over a map', () => {
  it('routes affordanceAt through terrainAffordanceAt (same keys present)', () => {
    // A minimal map stub: makeTerrainProbe only calls heightMetresAt, which needs the
    // seed/dims/worldSeed; we assert the wiring shape, not worldgen values.
    const probe = makeTerrainProbe({
      seed: 1, width: 8, height: 8, worldSeed: undefined,
    } as unknown as Parameters<typeof makeTerrainProbe>[0]);
    const a = probe.affordanceAt(4, 4);
    for (const k of ['elevation', 'slope', 'flatness', 'aspectX', 'aspectY', 'height', 'commanding']) {
      expect(k in a).toBe(true);
    }
  });
});
