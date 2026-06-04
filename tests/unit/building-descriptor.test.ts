import { describe, it, expect } from 'vitest';
import {
  buildingPalette, buildingEntity, WALL_COLORS, ROOF_COLORS, GROUND_COLORS,
  type BuildingDescriptor,
} from '@/world/building-descriptor';

const cottage: BuildingDescriptor = {
  category: 'residential', era: 'medieval',
  footprint: { w: 3, h: 3 }, plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 1,
  roof: 'gable', walls: 'wattle', roofMat: 'thatch', door: { x: 1, y: 2 },
};

describe('building-descriptor', () => {
  it('derives a palette from materials', () => {
    const p = buildingPalette(cottage);
    expect(p.walls).toBe(WALL_COLORS.wattle);
    expect(p.roof).toBe(ROOF_COLORS.thatch);
    expect(typeof p.trim).toBe('string');
  });

  it('falls back to a neutral colour for an unknown material (extensible, no throw)', () => {
    const exotic = { ...cottage, walls: 'adamantium' as unknown as BuildingDescriptor['walls'] };
    expect(() => buildingPalette(exotic)).not.toThrow();
    expect(buildingPalette(exotic).walls).toBe('#8a8a8a');
  });

  it('lets palette overrides win', () => {
    const p = buildingPalette({ ...cottage, palette: { walls: '#123456' } });
    expect(p.walls).toBe('#123456');
  });

  it('builds an entity that mirrors footprint + descriptor into properties', () => {
    const e = buildingEntity('b1', cottage, 10, 20, { poiId: 'poi-x' });
    expect(e.kind).toBe('building');           // no preset → generic kind
    expect(e.x).toBe(10); expect(e.y).toBe(20);
    expect(e.tags).toEqual(['building', 'residential']);
    expect(e.properties?.category).toBe('building');
    expect(e.properties?.footprint).toEqual({ w: 3, h: 3 });
    expect(e.properties?.sortYOffset).toBe(3);   // = footprint.h
    expect(e.properties?.poiId).toBe('poi-x');
    expect((e.properties?.descriptor as BuildingDescriptor).plan).toBe('rect');
  });

  it('uses the preset name as kind when present', () => {
    const e = buildingEntity('b2', { ...cottage, preset: 'cottage' }, 0, 0);
    expect(e.kind).toBe('cottage');
  });

  it('has colour entries for every declared ground material', () => {
    for (const m of ['flagstone', 'dirt', 'packed_dirt', 'wood', 'tile', 'gravel'] as const) {
      expect(GROUND_COLORS[m]).toMatch(/^#/);
    }
  });
});
