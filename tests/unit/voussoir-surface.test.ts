// tests/unit/voussoir-surface.test.ts — KV: the stone formations arches are built of.
// The arch ring's faces get a `polar` SurfaceFrame so the masonry engine lays RADIAL
// voussoir wedges (joints on constant-θ lines, courses concentric) rather than the
// horizontal coursing a planar frame gives. These pin the polar unwrap directly + the
// arch projector's face-vs-edge selection.
import { describe, it, expect } from 'vitest';
import { prepareSurface, type SurfaceSpec } from '@/assetgen/render/material-surface';
import { archVoussoirProjector } from '@/assetgen/geometry/arch';
import type { Vec3 } from '@/assetgen/types';

const ASHLAR: SurfaceSpec = { material: 'stone', work: 'ashlar' };

describe('polar surface frame (voussoir coursing)', () => {
  it('lays joints on constant-θ lines — the relief drops periodically as we sweep the arc', () => {
    // A ring centred at origin springing line z=0, span-plane x-z, mean radius 2 (cube-units).
    const frame = { kind: 'polar' as const, cx: 0, cy: 0, cz: 0, meanR: 2, spanAxis: 'x' as const };
    const s = prepareSurface(ASHLAR, [0, 1, 0], 0.5, frame);   // a face normal (+y)
    // Sweep the arc at a fixed radius; sample the AO (drops into a mortar joint). A planar
    // frame would give NO θ-periodicity; the polar frame must show several joint dips.
    const R = 2;
    let dips = 0, prev = 1;
    for (let i = 0; i <= 120; i++) {
      const ang = (i / 120) * Math.PI;                          // 0 … π across the arch
      const p: Vec3 = [R * Math.cos(ang), 1.0, R * Math.sin(ang)];
      const ao = s.at(p).ao;
      if (prev - ao > 0.02 && ao < prev) dips++;                // entering a joint
      prev = ao;
    }
    expect(dips).toBeGreaterThanOrEqual(4);                     // multiple voussoir joints around the ring
  });

  it('radius maps to v (concentric courses) — sweeping the radius crosses course joints', () => {
    const frame = { kind: 'polar' as const, cx: 0, cy: 0, cz: 0, meanR: 2, spanAxis: 'x' as const };
    const s = prepareSurface(ASHLAR, [0, 1, 0], 0.5, frame);
    // Sweep OUTWARD at a fixed angle (across the ring depth). The radial coordinate is the
    // course axis, so we must cross at least one concentric joint (an AO dip) over a span of
    // several course heights — proving radius drives v, not a constant.
    const ang = Math.PI / 2;                                    // crown
    let dips = 0, prev = 1;
    for (let i = 0; i <= 120; i++) {
      const r = 2 + (i / 120) * 2;                              // r: 2 → 4 cube-units
      const ao = s.at([r * Math.cos(ang), 1, r * Math.sin(ang)]).ao;
      if (prev - ao > 0.02 && ao < prev) dips++;
      prev = ao;
    }
    expect(dips).toBeGreaterThanOrEqual(1);
  });
});

describe('archVoussoirProjector', () => {
  const AT: Vec3 = [0, 0, 0];

  it('gives the polar frame to the ring FACES (±depth normal) and skips soffit/edges', () => {
    const proj = archVoussoirProjector(AT, 4, 2, 0.35, 0, 0)!;  // yaw 0 → spans x, depth along y
    expect(proj).toBeTypeOf('function');
    // a front face (normal +y = depth axis) → polar
    expect(proj([2, 0, 1], [0, 1, 0])?.kind).toBe('polar');
    // the soffit (normal points up/in, +z) → no frame (planar default)
    expect(proj([2, 0.5, 1.5], [0, 0, 1])).toBeUndefined();
    // a jamb side (normal +x) → no frame
    expect(proj([0, 0.5, 1], [1, 0, 0])).toBeUndefined();
  });

  it('centres on the springing mid-point, accounting for a 90° yaw', () => {
    const ew = archVoussoirProjector(AT, 4, 2, 0.35, 0, 0)!;
    const ns = archVoussoirProjector(AT, 4, 2, 0.35, 0, 90)!;
    const ewF = ew([2, 0, 1], [0, 1, 0]) as Extract<ReturnType<typeof ew>, { kind: 'polar' }>;
    // ns: faces now have normal ±x (depth along x); centre moves onto the y axis.
    const nsF = ns([0, 2, 1], [1, 0, 0]) as Extract<ReturnType<typeof ns>, { kind: 'polar' }>;
    expect(ewF.spanAxis).toBe('x');
    expect(ewF.cx).toBeCloseTo(2, 6);   // at.x + span/2
    expect(ewF.cy).toBeCloseTo(0, 6);
    expect(nsF.spanAxis).toBe('y');
    expect(nsF.cx).toBeCloseTo(0, 6);
    expect(nsF.cy).toBeCloseTo(2, 6);   // at.y + span/2
  });

  it('returns undefined for non-cardinal yaw (planar fallback, safe)', () => {
    expect(archVoussoirProjector(AT, 4, 2, 0.35, 0, 45)).toBeUndefined();
  });
});
