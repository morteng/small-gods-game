// tests/unit/blueprint-describe-registry.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { describeRegistry, formatCatalogue } from '@/blueprint/describe-registry';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { getPartType } from '@/blueprint/registry';

beforeAll(() => ensureBuildingTypesRegistered());

describe('describeRegistry', () => {
  it('emits every registered part with its param domains + defaults', () => {
    const cat = describeRegistry();
    const body = cat.parts.find(p => p.type === 'body');
    expect(body).toBeDefined();
    const roof = body!.params.find(p => p.name === 'roof')!;
    expect(roof.kind).toBe('enum');
    expect(roof.values).toContain('gable');
    expect(roof.doc).toMatch(/pitched/);
    const levels = body!.params.find(p => p.name === 'levels')!;
    expect(levels.range).toEqual([1, 8]);
    expect(levels.default).toBe(1);
  });

  it('marks opening features (door/window) distinctly from non-openings (vent)', () => {
    const cat = describeRegistry();
    expect(cat.features.find(f => f.type === 'door')?.opening).toBe(true);
    expect(cat.features.find(f => f.type === 'window')?.opening).toBe(true);
    expect(cat.features.find(f => f.type === 'vent')?.opening).toBe(false);
  });

  it('the catalogue covers exactly the registered params (contract stays in sync)', () => {
    const cat = describeRegistry();
    const body = cat.parts.find(p => p.type === 'body')!;
    expect(body.params.map(p => p.name).sort())
      .toEqual(Object.keys(getPartType('body').paramSchema).sort());
  });

  it('formatCatalogue renders a readable text dump', () => {
    const txt = formatCatalogue();
    expect(txt).toContain('PART TYPES');
    expect(txt).toContain('FEATURE TYPES');
    expect(txt).toContain('body');
  });
});
