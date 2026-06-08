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
  it('crenellation raises the roofline above plain wall height', async () => {
    const plain = await linearFacets(base);
    const cren = await linearFacets({ ...base, crenellated: true });
    const maxZ = (r: { facets: { pts: number[][] }[] }) => Math.max(...r.facets.flatMap(f => f.pts.map(p => p[2])));
    expect(maxZ(cren)).toBeGreaterThan(maxZ(plain));
  });
});
