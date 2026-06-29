// E3 axis-mundi: a worship building (temple/church/shrine) crowns its ridge with a stone
// steeple — a `spire` ridge feature derived in connectomeToBlueprint. A barn shares the
// church-axial nave but is excluded by its opposed cart doors (≥2 exterior portals).
import { describe, it, expect } from 'vitest';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { composeStructure } from '@/assetgen/compose';

const spireCount = (rb: ReturnType<typeof synthesizeBlueprint>): number =>
  (rb!.parts.find((p) => p.type === 'body')?.features ?? [])
    .filter((f) => f.type === 'vent' && f.params.kind === 'spire').length;

describe('sacred spire (E3 axis mundi)', () => {
  it('worship buildings get exactly one spire; dwellings and barns get none', () => {
    expect(spireCount(synthesizeBlueprint('temple_small', [], 1))).toBe(1);
    expect(spireCount(synthesizeBlueprint('shrine', [], 1))).toBe(1);
    expect(spireCount(synthesizeBlueprint('parish-church', [], 1))).toBe(1);
    expect(spireCount(synthesizeBlueprint('cottage', [], 1))).toBe(0);   // no worship zone
    expect(spireCount(synthesizeBlueprint('farm_barn', [], 1))).toBe(0); // worship nave but cart-door through-passage
  });

  it('the spire is a tall ridge feature that compiles + renders', async () => {
    const rb = synthesizeBlueprint('temple_small', [], 1)!;
    const g = toGeometry(rb);
    expect(g.parts.length).toBeGreaterThan(0);
    const r = await composeStructure(g); // must not throw; the steeple adds opaque pixels up high
    expect(r.size).toBeGreaterThan(0);
  });
});
