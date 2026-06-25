import { describe, it, expect } from 'vitest';
import {
  halfWidthFromFlow, referenceFlow, reachHalfWidths,
  RIVER_HALF_AT_REF, RIVER_HALF_MIN, RIVER_HALF_MAX,
  type WaterNetwork, type WaterReach,
} from '@/terrain/river-network';
import { polylineDeformation } from '@/world/terrain-deformation';

/** A bare reach with a straight centreline of `n` evenly-spaced vertices. */
function reach(id: string, from: string, to: string, flowUp: number, flow: number, n = 9): WaterReach {
  const centerline = Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }));
  return { id, from, to, cells: [], order: 1, flow, flowUp, klass: 'stream', lakeFed: false, centerline };
}

function net(reaches: WaterReach[]): WaterNetwork {
  return { nodes: [], reaches, lakes: [], byId: new Map(), nodeAtCell: new Map(), width: 64, height: 64 };
}

describe('river width by flow (downstream hydraulic geometry)', () => {
  it('half-width scales with √(flow/ref) and pins the brook at the reference flow', () => {
    const ref = 500;
    expect(halfWidthFromFlow(ref, ref)).toBeCloseTo(RIVER_HALF_AT_REF, 6);
    // 4× the flow ⇒ √4 = 2× the half-width.
    expect(halfWidthFromFlow(4 * ref, ref)).toBeCloseTo(2 * RIVER_HALF_AT_REF, 6);
    // Monotonic increasing in flow.
    expect(halfWidthFromFlow(8 * ref, ref)).toBeGreaterThan(halfWidthFromFlow(2 * ref, ref));
  });

  it('clamps to the [MIN, MAX] half-width band', () => {
    const ref = 500;
    expect(halfWidthFromFlow(0, ref)).toBe(RIVER_HALF_MIN);
    expect(halfWidthFromFlow(1e9, ref)).toBe(RIVER_HALF_MAX);
  });

  it('reference flow is the smallest reach flow in the network', () => {
    const n = net([reach('a', 's1', 'c', 500, 900), reach('b', 's2', 'c', 500, 500), reach('t', 'c', 'm', 1400, 4000)]);
    expect(referenceFlow(n)).toBe(500);
  });

  it('a reach widens from its upstream end to its mouth (taper, not constant)', () => {
    const ref = 500;
    const r = reach('t', 'c', 'm', ref, 16 * ref); // flowUp ref → flow 16×ref
    const hw = reachHalfWidths(r, ref);
    expect(hw).toHaveLength(r.centerline.length);
    // Strictly increasing along the reach (upstream narrow → downstream wide).
    for (let i = 1; i < hw.length; i++) expect(hw[i]).toBeGreaterThan(hw[i - 1]);
    expect(hw[0]).toBeCloseTo(RIVER_HALF_AT_REF, 6);            // upstream = brook
    expect(hw[hw.length - 1]).toBeCloseTo(4 * RIVER_HALF_AT_REF, 6); // mouth = √16×
  });

  it('a constant-flow reach has a constant width (no spurious taper)', () => {
    const ref = 500;
    const hw = reachHalfWidths(reach('b', 's', 'm', ref, ref), ref);
    for (const w of hw) expect(w).toBeCloseTo(RIVER_HALF_AT_REF, 6);
  });

  it('polylineDeformation with per-vertex halfWidths carves a tapered footprint', () => {
    // A 2-vertex line narrow (0.4) at x=0, wide (1.6) at x=10. A probe 1.0 tile off the
    // line should be OUTSIDE near the narrow end and INSIDE near the wide end.
    const d = polylineDeformation({
      id: 'r', source: 'test', op: 'carve', amount: 1,
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], halfWidth: 1.6, halfWidths: [0.4, 1.6], feather: 0.01,
    });
    expect(d.mask!(1, 1.0)).toBe(0);      // near narrow end, 1 tile off ⇒ outside
    expect(d.mask!(9, 1.0)).toBe(1);      // near wide end, 1 tile off ⇒ inside the core
  });

  it('polylineDeformation without halfWidths is unchanged (constant width)', () => {
    const d = polylineDeformation({
      id: 'r', source: 'test', op: 'carve', amount: 1,
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], halfWidth: 1.0, feather: 0.01,
    });
    expect(d.mask!(5, 0.5)).toBe(1);      // within half-width ⇒ full
    expect(d.mask!(5, 2.0)).toBe(0);      // well beyond ⇒ zero
  });
});
