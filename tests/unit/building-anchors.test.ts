import { describe, it, expect } from 'vitest';
import { buildingEntity, type BuildingDescriptor } from '@/world/building-descriptor';
import { synthesizeFromPreset } from '@/world/building-presets';
import type { Anchor } from '@/world/anchors';

describe('buildingEntity anchors', () => {
  it('stores world-space door anchors on the entity', () => {
    const d = synthesizeFromPreset('cottage')!;          // has footprint + door
    const e = buildingEntity('t1', d, 10, 20);
    const anchors = e.properties!.anchors as Anchor[];
    expect(Array.isArray(anchors)).toBe(true);
    const door = anchors.find(a => a.kind === 'door')!;
    expect(door).toBeDefined();
    // door world position lies within the footprint's world extent (+1 tile margin on the outward edge)
    expect(door.x).toBeGreaterThanOrEqual(10);
    expect(door.x).toBeLessThanOrEqual(10 + d.footprint.w + 1);
    expect(door.y).toBeGreaterThanOrEqual(20);
    expect(door.y).toBeLessThanOrEqual(20 + d.footprint.h + 1);
  });
});
