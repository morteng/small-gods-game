import { describe, it, expect } from 'vitest';
import { buildingMassing } from '@/render/building-massing-model';
import { synthesizeFromPreset } from '@/world/building-presets';
import type { BuildingDescriptor } from '@/world/building-descriptor';

const d = (over: Partial<BuildingDescriptor> = {}): BuildingDescriptor => ({
  category: 'residential', era: 'medieval', footprint: { w: 3, h: 3 },
  plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 1,
  roof: 'gable', walls: 'timber', roofMat: 'thatch', door: { x: 1, y: 2 },
  ...over,
});

describe('buildingMassing', () => {
  it('derives body height from levels × heightPerLevel', () => {
    expect(buildingMassing(d({ levels: 3, heightPerLevel: 1.5 })).bodyHeight).toBeCloseTo(4.5);
  });

  it('clamps levels to at least 1 and heightPerLevel to a floor', () => {
    const m = buildingMassing(d({ levels: 0, heightPerLevel: 0 }));
    expect(m.levels).toBe(1);
    expect(m.bodyHeight).toBeGreaterThan(0);
  });

  it('pitched roofs rise, flat roofs barely rise', () => {
    expect(buildingMassing(d({ roof: 'gable' })).roofHeight).toBeGreaterThan(
      buildingMassing(d({ roof: 'flat' })).roofHeight,
    );
    expect(buildingMassing(d({ roof: 'conical' })).roofHeight).toBeGreaterThan(0.9);
  });

  it('carries plan, footprint, door, and stepped inset through unchanged', () => {
    const m = buildingMassing(d({ plan: 'stepped', levelInset: 1, footprint: { w: 4, h: 4 }, door: { x: 1, y: 3 } }));
    expect(m.plan).toBe('stepped');
    expect(m.footprint).toEqual({ w: 4, h: 4 });
    expect(m.levelInset).toBe(1);
    expect(m.door).toEqual({ x: 1, y: 3 });
  });

  it('resolves wall and roof colours from materials', () => {
    const m = buildingMassing(d({ walls: 'stone', roofMat: 'slate' }));
    expect(m.walls).toMatch(/^#/);
    expect(m.roofColor).toMatch(/^#/);
    expect(m.walls).not.toBe(m.roofColor);
  });

  it('produces a distinct massing per archetype (yurt ≠ keep)', () => {
    const yurt = buildingMassing(synthesizeFromPreset('yurt')!);
    const keep = buildingMassing(synthesizeFromPreset('castle_keep')!);
    expect(yurt.plan).toBe('round');
    expect(keep.plan).toBe('stepped');
    expect(keep.bodyHeight).toBeGreaterThan(yurt.bodyHeight);
  });
});
