import { describe, it, expect } from 'vitest';
import { descriptorToSpec } from '@/render/iso/building-spec';
import type { BuildingDescriptor } from '@/world/building-descriptor';
import { synthesizeFromPreset } from '@/world/building-presets';

const base: BuildingDescriptor = {
  category: 'residential', era: 'medieval',
  footprint: { w: 3, h: 3 }, plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 2,
  roof: 'gable', walls: 'timber', roofMat: 'thatch',
  door: { x: 1, y: 2 },
};

function buildingPart(d: BuildingDescriptor) {
  const spec = descriptorToSpec(d)!;
  const p = spec.parts[0];
  if (p.prim !== 'building') throw new Error('expected building part');
  return p;
}

describe('descriptorToSpec', () => {
  it('maps a rect plan to one wing covering the footprint', () => {
    const p = buildingPart(base);
    expect(p.wings).toEqual([{ x: 0, y: 0, w: 3, h: 3, storeys: 1, roof: 'gable' }]);
  });

  it('maps materials (timber walls, thatch roof) to assetgen Mats', () => {
    const p = buildingPart(base);
    expect(p.wallMat).toBe('timber');
    expect(p.roofMat).toBe('thatch');
  });

  it('carries storeys from levels', () => {
    const p = buildingPart({ ...base, levels: 3 });
    expect(p.wings[0].storeys).toBe(3);
  });

  it('maps a pyramidal-family roof to the pyramidal RoofKind per wing', () => {
    const p = buildingPart({ ...base, roof: 'conical' });
    expect(p.wings.every(w => w.roof === 'pyramidal')).toBe(true);
  });

  it('maps a flat/stepped roof to the flat RoofKind', () => {
    const p = buildingPart({ ...base, roof: 'flat' });
    expect(p.wings[0].roof).toBe('flat');
  });

  it('decomposes a cross plan into two wings', () => {
    const p = buildingPart({ ...base, plan: 'cross', footprint: { w: 4, h: 4 } });
    expect(p.wings.length).toBe(2);
  });

  it('decomposes an L plan into two wings', () => {
    const p = buildingPart({ ...base, plan: 'L', footprint: { w: 4, h: 4 } });
    expect(p.wings.length).toBe(2);
  });

  it('no longer returns null for round and stepped plans (solid builders)', () => {
    expect(descriptorToSpec({ ...base, plan: 'round' })).not.toBeNull();
    expect(descriptorToSpec({ ...base, plan: 'stepped' })).not.toBeNull();
  });

  it('derives a main door whose face matches the door cell edge', () => {
    const south = buildingPart({ ...base, door: { x: 1, y: 2 } }); // y == h-1 → south
    expect(south.features?.doors?.[0]).toMatchObject({ face: 'south', main: true });
    const east = buildingPart({ ...base, door: { x: 2, y: 1 } });  // x == w-1 → east
    expect(east.features?.doors?.[0]).toMatchObject({ face: 'east', main: true });
  });

  it('maps vents to ridge vents on wing 0', () => {
    const p = buildingPart({ ...base, vents: [{ x: 1, y: 1, height: 1, kind: 'chimney' }] });
    expect(p.features?.vents?.[0]).toMatchObject({ wing: 0, kind: 'chimney', placement: 'ridge' });
  });

  it('sets a footprint-scaled positive size', () => {
    const spec = descriptorToSpec(base)!;
    expect(spec.size).toBeGreaterThan(127);
    expect(spec.size).toBeLessThanOrEqual(640);
  });
});

describe('descriptorToSpec — structure + round/stepped', () => {
  it('sizes rect wings to the structure rect, not the plot', () => {
    const d = { ...synthesizeFromPreset('cottage')!, footprint: { w: 3, h: 3 },
                structure: { w: 2, h: 2, dx: 0, dy: 0 } };
    const spec = descriptorToSpec(d)!;
    const part = spec.parts[0] as Extract<typeof spec.parts[number], { prim: 'building' }>;
    expect(part.prim).toBe('building');
    expect(part.wings[0]).toMatchObject({ x: 0, y: 0, w: 2, h: 2 });
  });

  it('emits a cylinder wall + a roof cap for a round plan (no longer null)', () => {
    const d = synthesizeFromPreset('yurt')!;            // plan: 'round'
    const spec = descriptorToSpec(d)!;
    expect(spec).not.toBeNull();
    expect(spec.parts.some(p => p.prim === 'cylinder')).toBe(true);
    expect(spec.parts.some(p => p.prim === 'cone' || p.prim === 'ellipsoid')).toBe(true);
  });

  it('emits inset stacked boxes for a stepped plan (no longer null)', () => {
    const d = synthesizeFromPreset('castle_keep')!;     // plan: 'stepped', levels 4, levelInset 1
    const spec = descriptorToSpec(d)!;
    expect(spec).not.toBeNull();
    const boxes = spec.parts.filter(p => p.prim === 'box');
    // castle_keep: 3×3 footprint with inset=1 → only 2 levels fit (3×3 then 1×1; -1×-1 breaks)
    expect(boxes.length).toBeGreaterThanOrEqual(1);
    expect(boxes.length).toBeLessThanOrEqual(d.levels);
  });

  it('still maps rect/L/cross', () => {
    for (const preset of ['cottage', 'tavern']) {
      expect(descriptorToSpec(synthesizeFromPreset(preset)!)).not.toBeNull();
    }
  });
});
