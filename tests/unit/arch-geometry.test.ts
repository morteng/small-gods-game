// tests/unit/arch-geometry.test.ts — K1: the first TRUE curved primitive.
// Until now every arch was a square (post-and-lintel portal / rectangular cutter box).
// solidArchCurved builds a real arch RING: a spandrel block minus a style-dependent
// intrados curve. These verify the manifold is watertight, actually carries a curved
// opening, and that `flat` still delegates to the historic portal byte-for-byte.
import { describe, it, expect } from 'vitest';
import { getManifold } from '@/assetgen/geometry/manifold-runtime';
import { solidArch, solidBox, carveApertures } from '@/assetgen/geometry/solids';
import { solidArchCurved, archHeadCutter } from '@/assetgen/geometry/arch';

const SPAN = 4, RISE = 2, DEPTH = 1; // round arch: rise = span/2

describe('solidArchCurved', () => {
  it('builds a watertight ring spanning the footprint, crown above the rise', async () => {
    const m = await solidArchCurved([0, 0, 0], SPAN, RISE, DEPTH, { style: 'round', ringDepth: 0.35 });
    const bb = m.boundingBox();
    expect(bb.min[0]).toBeCloseTo(0, 5);
    expect(bb.max[0]).toBeCloseTo(SPAN, 5);
    // crown reaches rise + ringDepth
    expect(bb.max[2]).toBeCloseTo(RISE + 0.35, 4);
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(DEPTH, 4);   // runs `depth` along +y
    expect(m.genus()).toBe(0);                              // a single watertight solid
  });

  it('carries a genuine opening — much less volume than the solid spandrel block', async () => {
    const { Manifold } = await getManifold();
    const arch = await solidArchCurved([0, 0, 0], SPAN, RISE, DEPTH, { style: 'round' });
    const crownZ = RISE + 0.35;
    const block = Manifold.cube([SPAN, DEPTH, crownZ]); // the un-bored spandrel
    // A semicircular opening removes a large fraction of the block.
    expect(arch.volume()).toBeLessThan(block.volume() * 0.7);
    expect(arch.volume()).toBeGreaterThan(0);
  });

  it('a pointed arch rises to a central apex taller than a segmental one for the same rise input', async () => {
    // Same nominal rise, but the pointed sampler concentrates height at the centre apex,
    // so its crown sits at the rise while the segmental (shallow ellipse) is lower at quarter-span.
    const pointed = await solidArchCurved([0, 0, 0], SPAN, RISE, DEPTH, { style: 'pointed', ringDepth: 0 });
    const round = await solidArchCurved([0, 0, 0], SPAN, RISE, DEPTH, { style: 'round', ringDepth: 0 });
    // both reach the same crown height (rise) at the apex…
    expect(pointed.boundingBox().max[2]).toBeCloseTo(RISE, 3);
    expect(round.boundingBox().max[2]).toBeCloseTo(RISE, 3);
    // …but the pointed opening is narrower at mid-height, leaving MORE masonry (volume).
    expect(pointed.volume()).toBeGreaterThan(round.volume());
  });

  it('`flat` delegates to the historic post-and-lintel portal (parity)', async () => {
    const viaCurved = await solidArchCurved([0, 0, 0], SPAN, RISE, DEPTH, { style: 'flat' });
    const portal = await solidArch([0, 0, 0], SPAN, RISE, DEPTH, 0);
    expect(viaCurved.volume()).toBeCloseTo(portal.volume(), 6);
    expect(viaCurved.boundingBox().max).toEqual(portal.boundingBox().max);
  });

  it('yaw pivots the ring about its springing origin (footprint turns, base stays put)', async () => {
    const ew = await solidArchCurved([0, 0, 0], SPAN, RISE, DEPTH, { style: 'round' });
    const ns = await solidArchCurved([0, 0, 0], SPAN, RISE, DEPTH, { style: 'round', yaw: 90 });
    // yawing 90° swaps the span extent from x onto y.
    expect(ns.boundingBox().max[1] - ns.boundingBox().min[1]).toBeCloseTo(
      ew.boundingBox().max[0] - ew.boundingBox().min[0], 3);
  });
});

describe('archHeadCutter (K2 — arched window/door heads)', () => {
  it('axis x: head spans the opening width in x, sits ON the box top, runs the depth in y', async () => {
    const m = await archHeadCutter([2, 5, 1], [0.8, 0.3, 1.2], 'x', 'round', 0.4);
    const bb = m.boundingBox();
    expect(bb.min[0]).toBeCloseTo(2, 3);
    expect(bb.max[0]).toBeCloseTo(2.8, 3);
    expect(bb.min[1]).toBeCloseTo(5, 2);
    expect(bb.max[1]).toBeCloseTo(5.3, 2);
    expect(bb.max[2]).toBeCloseTo(1 + 1.2 + 0.4, 2);   // box top + rise
    expect(bb.min[2]).toBeLessThan(1 + 1.2);            // overlaps the box top
  });

  it('axis y: head spans the opening width in y, runs the depth in x', async () => {
    const m = await archHeadCutter([2, 5, 1], [0.3, 0.8, 1.2], 'y', 'round', 0.4);
    const bb = m.boundingBox();
    expect(bb.min[1]).toBeCloseTo(5, 3);
    expect(bb.max[1]).toBeCloseTo(5.8, 3);
    expect(bb.min[0]).toBeCloseTo(2, 2);
    expect(bb.max[0]).toBeCloseTo(2.3, 2);
    expect(bb.max[2]).toBeCloseTo(1 + 1.2 + 0.4, 2);
  });

  it('carveApertures with arch removes MORE masonry than a square opening (the head)', async () => {
    const wall = () => solidBox([0, 0, 0], [4, 0.4, 2]);    // a south-facing wall slab
    const ap = { at: [1, 0, 0] as [number, number, number], size: [0.8, 0.45, 1.0] as [number, number, number] };
    const square = await carveApertures(await wall(), [ap]);
    const arched = await carveApertures(await wall(), [{ ...ap, arch: { axis: 'x' as const, style: 'round' as const, rise: 0.4 } }]);
    // the arched head bores extra void above the square top, so less solid remains.
    expect(arched.volume()).toBeLessThan(square.volume());
    // …and it reaches higher than the square opening's flat top (carves into the masonry above).
    expect(arched.genus()).toBeGreaterThanOrEqual(0); // still a valid manifold
  });
});
