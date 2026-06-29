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
});
