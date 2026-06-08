import { describe, it, expect } from 'vitest';
import { buildingBrief, doorFace } from '@/assetgen/producers/building-producer';
import type { BuildingDescriptor } from '@/world/building-descriptor';
import { synthesizeFromPreset } from '@/world/building-presets';
import { structureRect } from '@/world/building-descriptor';

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

  it('computes the door face and footprint; buildings generate text-only (no init)', () => {
    const b = buildingBrief(cottage(), 1);
    expect(b.door).toEqual({ x: 1, y: 2, face: 's' });
    expect(b.footprint).toEqual({ w: 3, h: 3 });
    expect(b.guidance).toEqual({ source: 'none', strength: 0 });
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
    expect(a.traits[a.traits.length - 1]).not.toBe(c.traits[c.traits.length - 1]);
  });

  it('omits a "none" roof from materials', () => {
    const d = cottage();
    d.roofMat = 'none';
    const b = buildingBrief(d, 1);
    expect(b.materials.find((m) => m.part === 'roof')).toBeUndefined();
  });
});

describe('buildingBrief — structure + human-scale door', () => {
  it('sizes the brief footprint to the structure rect', () => {
    const d = { ...synthesizeFromPreset('cottage')!, footprint: { w: 3, h: 3 },
                structure: { w: 2, h: 2, dx: 0, dy: 0 } };
    const brief = buildingBrief(d, 0);
    expect(brief.footprint).toEqual({ w: 2, h: 2 });
  });

  it('phrases a human-height door so the model draws it to scale', () => {
    const brief = buildingBrief(synthesizeFromPreset('cottage')!, 0);
    expect(brief.traits.some(t => /human-height door/i.test(t))).toBe(true);
  });
});
