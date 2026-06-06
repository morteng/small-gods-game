import { describe, it, expect } from 'vitest';
import { buildingBrief, doorFace } from '@/assetgen/producers/building-producer';
import type { BuildingDescriptor } from '@/world/building-descriptor';

function cottage(door = { x: 1, y: 2 }): BuildingDescriptor {
  return {
    preset: 'cottage',
    category: 'residential',
    era: 'medieval',
    footprint: { w: 3, h: 3 },
    plan: 'rect',
    levels: 1,
    levelInset: 0,
    heightPerLevel: 1,
    roof: 'gable',
    walls: 'wattle',
    roofMat: 'thatch',
    groundMaterial: 'dirt',
    door,
  };
}

describe('doorFace', () => {
  it('maps a south door', () => {
    expect(doorFace({ w: 3, h: 3 }, { x: 1, y: 2 })).toBe('s');
  });
  it('maps an east door', () => {
    expect(doorFace({ w: 3, h: 3 }, { x: 2, y: 1 })).toBe('e');
  });
  it('maps a north door', () => {
    expect(doorFace({ w: 3, h: 3 }, { x: 1, y: 0 })).toBe('n');
  });
  it('maps a west door', () => {
    expect(doorFace({ w: 3, h: 3 }, { x: 0, y: 1 })).toBe('w');
  });
});

describe('buildingBrief', () => {
  it('derives wattle walls + thatch roof into materials and paletteAnchors', () => {
    const b = buildingBrief(cottage(), 1);
    expect(b.materials).toContainEqual({ part: 'walls', material: 'wattle', color: '#b29162' });
    expect(b.materials).toContainEqual({ part: 'roof', material: 'thatch', color: '#c9a227' });
    expect(b.paletteAnchors).toContain('#b29162');
    expect(b.paletteAnchors).toContain('#c9a227');
  });

  it('computes the door face and carries footprint + massing guidance', () => {
    const b = buildingBrief(cottage(), 1);
    expect(b.door).toEqual({ x: 1, y: 2, face: 's' });
    expect(b.footprint).toEqual({ w: 3, h: 3 });
    expect(b.guidance).toEqual({ source: 'massing', strength: 500 });
    expect(b.heightUnits).toBeGreaterThan(1); // 1 storey body + gable rise
  });

  it('is deterministic for a fixed seed', () => {
    expect(buildingBrief(cottage(), 7)).toEqual(buildingBrief(cottage(), 7));
  });

  it('differs across seeds only in the per-instance detail trait', () => {
    const a = buildingBrief(cottage(), 1);
    const c = buildingBrief(cottage(), 2);
    // Everything except the seed and seeded trait is identical.
    expect({ ...a, traits: null, seed: 0 }).toEqual({ ...c, traits: null, seed: 0 });
    // The seeded detail (last trait) differs; the structural traits match.
    expect(a.traits.slice(0, -1)).toEqual(c.traits.slice(0, -1));
    expect(a.traits.at(-1)).not.toBe(c.traits.at(-1));
  });

  it('omits a "none" roof from materials', () => {
    const d = cottage();
    d.roofMat = 'none';
    const b = buildingBrief(d, 1);
    expect(b.materials.find((m) => m.part === 'roof')).toBeUndefined();
  });
});
