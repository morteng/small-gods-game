// @vitest-environment node
// Interior I-3: interiorPlan() projects a building's connectome rooms into the cutaway's
// partition + funnel plan. Driven off REAL synthesized connectomes (the same path the placer
// uses) so the room programmes stay honest.
import { describe, it, expect } from 'vitest';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { interiorPlan } from '@/blueprint/interior';

describe('interiorPlan (interior I-3)', () => {
  it('a single-room building (cottage) yields no plan — cutaway stays an open shell', () => {
    expect(interiorPlan(synthesizeBlueprint('cottage', [], 1)!)).toBeUndefined();
  });

  it('a worship procession (parish-church) partitions the spine AND sinks toward the sanctum', () => {
    const plan = interiorPlan(synthesizeBlueprint('parish-church', [], 1)!);
    expect(plan).toBeDefined();
    // nave|chancel spine (aisles/porch are off-spine) ⇒ ≥1 partition, all fractions in (0,1) + sorted.
    expect(plan!.partitions.length).toBeGreaterThanOrEqual(1);
    expect(plan!.partitions.every((f) => f > 0 && f < 1)).toBe(true);
    expect([...plan!.partitions].sort((a, b) => a - b)).toEqual(plan!.partitions);
    // Funnel: floor descends monotonically and the deepest segment is below the entrance.
    expect(plan!.floorDrop.length).toBe(plan!.partitions.length + 1);
    expect(plan!.floorDrop[0]).toBe(0);
    expect(plan!.floorDrop[plan!.floorDrop.length - 1]).toBeGreaterThan(0);
    for (let i = 1; i < plan!.floorDrop.length; i++) {
      expect(plan!.floorDrop[i]).toBeGreaterThanOrEqual(plan!.floorDrop[i - 1]);
    }
  });

  it('a multi-room dwelling (manor) partitions its rooms but keeps a LEVEL floor (no funnel)', () => {
    const plan = interiorPlan(synthesizeBlueprint('manor', [], 1)!);
    expect(plan).toBeDefined();
    expect(plan!.partitions.length).toBeGreaterThanOrEqual(2);
    expect(plan!.floorDrop.every((d) => d === 0)).toBe(true);
  });

  it('is undefined when the blueprint carries no connectome (e.g. save-rehydrated)', () => {
    const rb = synthesizeBlueprint('manor', [], 1)!;
    const stripped = JSON.parse(JSON.stringify(rb)); // serialization drops the non-enumerable graph
    expect(interiorPlan(stripped)).toBeUndefined();
  });
});
