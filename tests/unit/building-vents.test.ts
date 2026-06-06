import { describe, it, expect } from 'vitest';
import { synthesizeFromPreset } from '@/world/building-presets';
import { buildingEntity } from '@/world/building-descriptor';
import { buildingMassing } from '@/render/building-massing-model';

describe('building vents', () => {
  it('cottage seeds a chimney', () => {
    const d = synthesizeFromPreset('cottage')!;
    expect(d.vents?.length).toBeGreaterThan(0);
    expect(d.vents![0].kind).toBe('chimney');
    expect(d.vents![0].height).toBeGreaterThan(0);
  });

  it('yurt seeds a smokehole at its apex', () => {
    const d = synthesizeFromPreset('yurt')!;
    expect(d.vents?.some(v => v.kind === 'smokehole')).toBe(true);
  });

  it('mirrors vents onto the entity properties', () => {
    const d = synthesizeFromPreset('tavern')!;
    const e = buildingEntity('b1', d, 0, 0);
    expect((e.properties as any).vents).toEqual(d.vents);
  });

  it('carries vents onto the Massing model', () => {
    const d = synthesizeFromPreset('cottage')!;
    const m = buildingMassing(d);
    expect(m.vents.length).toBe(d.vents!.length);
    expect(m.vents[0]).toMatchObject({ kind: 'chimney' });
  });

  it('a preset without vents yields an empty Massing.vents array (never undefined)', () => {
    const d = synthesizeFromPreset('dock')!;
    expect(buildingMassing(d).vents).toEqual([]);
  });
});
