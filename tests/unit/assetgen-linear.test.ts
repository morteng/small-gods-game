import { describe, it, expect } from 'vitest';
import { linearFacets } from '@/assetgen/geometry/linear';
import type { BarrierRun } from '@/world/barrier';

const base: BarrierRun = { kind: 'wall', path: [[0,0],[4,0]], height: 3, thickness: 1, material: 'stone', gates: [] };

describe('linearFacets', () => {
  it('emits facets + a wall_end anchor at each end', async () => {
    const { facets, anchors } = await linearFacets(base);
    expect(facets.length).toBeGreaterThan(0);
    expect(anchors.wallEnds).toHaveLength(2);
  });
  it('a gate adds a gate anchor and removes wall material there', async () => {
    const gated = await linearFacets({ ...base, gates: [{ t: 2, width: 1 }] });
    const plain = await linearFacets(base);
    expect(gated.anchors.gates).toHaveLength(1);
    expect(gated.volume).toBeLessThan(plain.volume);
  });
  it('a masonry gate is an ARCHED passage — masonry spans over it (not a full-height slot)', async () => {
    // The void is a passage capped by an arch whose crown is held below the wall-top, so the
    // curtain still reaches its full height OVER the gate. A regression to a full-height slot
    // would drop the wall-top to grade across the opening.
    const tall: BarrierRun = { ...base, height: 3, thickness: 1.5 };
    const gated = await linearFacets({ ...tall, gates: [{ t: 2, width: 2 }] });
    const plain = await linearFacets(tall);
    const maxZ = (r: { facets: { pts: number[][] }[] }) => Math.max(...r.facets.flatMap(f => f.pts.map(p => p[2])));
    // Masonry bridges the gate: the gated wall is just as TALL as the plain one.
    expect(maxZ(gated)).toBeGreaterThan(maxZ(plain) - 0.05);
    // …yet material WAS removed (the passage) — so it's an opening, not a no-op.
    expect(gated.volume).toBeLessThan(plain.volume);
  });
  it('crenellation gives a TOOTHED top (merlons + crenel gaps), not extra height', async () => {
    // run.height is the full height to the merlon crest (the parapet is PART of the wall, not
    // glued on top), so a crenellated wall is no TALLER than a plain one of the same height —
    // but its top is BROKEN by crenels: there are wall-top facets both at the crest and dropped
    // to the wall-walk between the teeth, and the battlements add geometry (more facets).
    const plain = await linearFacets(base);
    const cren = await linearFacets({ ...base, crenellated: true });
    const maxZ = (r: { facets: { pts: number[][] }[] }) => Math.max(...r.facets.flatMap(f => f.pts.map(p => p[2])));
    // No taller (within a small epsilon): the crest of both sits at ~run.height.
    expect(maxZ(cren)).toBeLessThanOrEqual(maxZ(plain) + 0.05);
    expect(maxZ(cren)).toBeGreaterThan(base.height * 0.7);
    // The merlon teeth are extra solids → strictly more facets than the plain curtain.
    expect(cren.facets.length).toBeGreaterThan(plain.facets.length);
    // The crenels expose the wall-walk: distinct top-Z bands appear (crest + walk), so the
    // set of facet-vertex heights is richer than the plain wall's.
    const tops = (r: { facets: { pts: number[][] }[] }) =>
      new Set(r.facets.flatMap(f => f.pts.map(p => Math.round(p[2] * 4) / 4)));
    expect(tops(cren).size).toBeGreaterThan(tops(plain).size);
  });

  // ── Cap coursing (ART v38) ──────────────────────────────────────────────────────────────
  // The horizontal surfaces of a wall — the walk, the coping, the merlon tops — used to take
  // `frameFor`'s world +y fallback, because world-up degenerates as the "v" reference on a
  // horizontal facet. Every cap in the world therefore got ONE grid (rows stacked in +y, courses
  // running along −x) whatever its wall's bearing, and an iso camera draws a world-axis grid as a
  // diamond lattice. These pin the contract that fixed it: a cap courses ALONG ITS OWN RUN.
  type Linear = Awaited<ReturnType<typeof linearFacets>>;
  type PlanarCap = { normal: number[]; uAxis: number[]; vAxis: number[] };
  /** The z-dominant (cap) facets, with their frame asserted planar and unwrapped. */
  const capsOf = (r: Linear): PlanarCap[] =>
    r.facets
      .filter((f) => Math.abs(f.normal[2]) >= Math.abs(f.normal[0])
                  && Math.abs(f.normal[2]) >= Math.abs(f.normal[1]))
      .map((f) => {
        expect(f.frame?.kind).toBe('planar');
        const fr = f.frame as { kind: 'planar'; uAxis: number[]; vAxis: number[] };
        return { normal: f.normal, uAxis: fr.uAxis, vAxis: fr.vAxis };
      });

  it('a cap courses ALONG the run — and follows the wall when the wall turns', async () => {
    // The same wall on two bearings. If the cap frame were world-derived these would agree;
    // the whole point is that they must NOT.
    const alongX = await linearFacets({ ...base, path: [[0, 0], [4, 0]], crenellated: true });
    const alongY = await linearFacets({ ...base, path: [[0, 0], [0, 4]], crenellated: true });
    const uOf = (r: Linear) => {
      const caps = capsOf(r);
      expect(caps.length).toBeGreaterThan(0);
      return caps[0].uAxis;
    };
    // u runs along the wall: |u·bearing| ≈ 1 for each, and the two bearings disagree.
    const ux = uOf(alongX), uy = uOf(alongY);
    expect(Math.abs(ux[0])).toBeCloseTo(1, 5);   // x-running wall → u along x
    expect(Math.abs(uy[1])).toBeCloseTo(1, 5);   // y-running wall → u along y
    expect(Math.abs(ux[0] * uy[0] + ux[1] * uy[1])).toBeLessThan(1e-6);   // perpendicular
  });

  it('leaves UPRIGHT faces on the normal-derived basis (they already course level)', async () => {
    const r = await linearFacets(base);
    const upright = r.facets.filter((f) => {
      const n = f.normal;
      return Math.abs(n[2]) < Math.abs(n[0]) || Math.abs(n[2]) < Math.abs(n[1]);
    });
    expect(upright.length).toBeGreaterThan(0);
    for (const f of upright) expect(f.frame).toBeUndefined();
  });

  it('an L-shaped run courses each LEG along its own bearing', async () => {
    // One wall, two legs. A single run-wide direction would give both legs the same coursing —
    // the nearest-segment rule is what makes the corner turn.
    const r = await linearFacets({ ...base, path: [[0, 0], [6, 0], [6, 6]] });
    const caps = capsOf(r);
    const xLeg = caps.filter((f) => Math.abs(f.uAxis[0]) > 0.9);
    const yLeg = caps.filter((f) => Math.abs(f.uAxis[1]) > 0.9);
    expect(xLeg.length).toBeGreaterThan(0);
    expect(yLeg.length).toBeGreaterThan(0);
  });

  it('the cap basis is ORTHONORMAL and lies in the facet plane (metric, not sheared)', async () => {
    const r = await linearFacets({ ...base, path: [[0, 0], [5, 3]], crenellated: true });
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const caps = capsOf(r);
    expect(caps.length).toBeGreaterThan(0);
    for (const f of caps) {
      const { uAxis: u, vAxis: v } = f;
      const nl = Math.hypot(...f.normal);
      const n = f.normal.map((c) => c / nl);
      expect(Math.hypot(...u)).toBeCloseTo(1, 6);
      expect(Math.hypot(...v)).toBeCloseTo(1, 6);
      expect(dot(u, v)).toBeCloseTo(0, 6);   // orthogonal to each other…
      expect(dot(u, n)).toBeCloseTo(0, 6);   // …and both IN the facet plane
      expect(dot(v, n)).toBeCloseTo(0, 6);
    }
  });
});
