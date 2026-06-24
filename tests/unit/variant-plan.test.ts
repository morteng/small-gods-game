// tests/unit/variant-plan.test.ts
import { describe, it, expect } from 'vitest';
import { planVariants, defaultVariantMatrix, variantKey, queryVariants } from '@/blueprint/variant-plan';
import { resolveAsset } from '@/blueprint/presets';
import { canonicalJson, generatedArtKey } from '@/render/generated-art-cache';

const MODEL = 'test-model/x';

describe('variantKey', () => {
  it('matches generatedArtKey(canonicalJson(resolveAsset(req)))', () => {
    const req = { type: 'tavern', stage: 'ruin' } as const;
    const rb = resolveAsset(req)!;
    expect(variantKey(req, MODEL)).toBe(generatedArtKey(canonicalJson(rb), MODEL, rb.footprint));
  });
  it('a base request keys identically to the bare preset', () => {
    expect(variantKey({ type: 'cottage' }, MODEL)).toBe(variantKey({ type: 'cottage', stage: 'complete', era: 'medieval' }, MODEL));
  });
  it('returns null for an unknown type', () => {
    expect(variantKey({ type: 'no_such_thing' }, MODEL)).toBeNull();
  });
});

describe('planVariants', () => {
  it('takes the cartesian product of the axes', () => {
    const v = planVariants([{ type: 'cottage', descriptors: [{ wealth: 'poor' }, { wealth: 'rich' }], stages: ['complete', 'ruin'] }], MODEL);
    expect(v.length).toBe(4);                       // 2 wealth × 2 stage
    expect(v.every(x => x.key.startsWith('v'))).toBe(true);   // recipe-versioned keys
  });
  it('dedups rows that collapse onto the same key (base era/default stage)', () => {
    const v = planVariants([{ type: 'cottage', eras: ['medieval'], stages: ['complete'] }], MODEL);
    expect(v.length).toBe(1);                       // both axes are no-ops → 1 row
    expect(v[0].stage).toBeUndefined();
  });
  it('labels carry the distinguishing axes', () => {
    const v = planVariants([{ type: 'tavern', descriptors: [{ wealth: 'rich' }], stages: ['ruin'] }], MODEL);
    expect(v[0].label).toContain('tavern');
    expect(v[0].label).toContain('rich');
    expect(v[0].label).toContain('ruin');
    expect(v[0].tags).toContain('ruined');
  });
});

describe('defaultVariantMatrix', () => {
  it('gives plants their whole stage timeline and buildings poor/rich/ruined cuts', () => {
    const specs = defaultVariantMatrix();
    const oak = specs.find(s => s.type === 'english-oak')!;
    const cottage = specs.find(s => s.type === 'cottage')!;
    expect(oak.stages).toContain('sapling');
    expect(oak.stages).toContain('stub');
    expect(cottage.descriptors).toEqual([{}, { wealth: 'poor' }, { wealth: 'rich' }]);
    expect(cottage.stages).toEqual(['complete', 'ruin']);
  });
  it('the planned matrix is non-trivial and every row has a distinct key', () => {
    const v = planVariants(defaultVariantMatrix(), MODEL);
    expect(v.length).toBeGreaterThan(20);
    expect(new Set(v.map(x => x.key)).size).toBe(v.length);
  });
});

describe('queryVariants', () => {
  const v = planVariants(defaultVariantMatrix(), MODEL);
  it('filters by stage', () => {
    expect(queryVariants(v, { stage: 'ruin' }).every(x => x.stage === 'ruin')).toBe(true);
    expect(queryVariants(v, { stage: 'ruin' }).length).toBeGreaterThan(0);
  });
  it('filters by wealth + tag + text', () => {
    expect(queryVariants(v, { wealth: 'rich' }).every(x => x.descriptors?.wealth === 'rich')).toBe(true);
    expect(queryVariants(v, { tag: 'ruined' }).every(x => x.tags.includes('ruined'))).toBe(true);
    expect(queryVariants(v, { text: 'tavern' }).every(x => x.type === 'tavern')).toBe(true);
  });
});
