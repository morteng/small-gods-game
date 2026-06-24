// tests/unit/descriptors.test.ts
import { describe, it, expect } from 'vitest';
import { synthesizeBlueprint, resolveAsset } from '@/blueprint/presets';
import { descriptorPatch, descriptorPhrase } from '@/blueprint/descriptors';
import { BUILDING_BLUEPRINTS } from '@/blueprint/presets';
import { canonicalJson } from '@/render/generated-art-cache';
import { assetCatalogue, queryCatalogue } from '@/blueprint/catalogue';

const bodyParams = (rb: NonNullable<ReturnType<typeof resolveAsset>>) =>
  rb.parts.find(p => p.type === 'body')?.params ?? {};

describe('descriptorPatch', () => {
  it('shifts materials DOWN the ladder for a poor dwelling and UP for opulent', () => {
    const cottage = BUILDING_BLUEPRINTS.cottage;       // walls:wattle, roof:thatch
    const poor = descriptorPatch(cottage, { wealth: 'poor' });
    const rich = descriptorPatch(cottage, { wealth: 'opulent' });
    // wattle → (poor) mud ; thatch → (poor) below floor stays thatch
    expect(poor.materials?.walls).toBe('mud');
    // opulent (+3): wattle(idx1)→stone(idx4 clamp), thatch(0)→tile(3)
    expect(rich.materials?.walls).toBe('stone');
    expect(rich.materials?.roof).toBe('tile');
  });

  it('opulent adds a storey to the body', () => {
    const rich = resolveAsset({ type: 'cottage', descriptors: { wealth: 'opulent' } })!;
    expect(bodyParams(rich).levels).toBe(2);
  });

  it('records the descriptors on the resolved blueprint', () => {
    const rb = resolveAsset({ type: 'cottage', descriptors: { wealth: 'rich', quality: 'ornate' } })!;
    expect(rb.descriptors).toEqual({ wealth: 'rich', quality: 'ornate' });
  });
});

describe('resolveAsset cache-key stability', () => {
  it('a descriptor-less asset resolves byte-identically to synthesizeBlueprint (same art key)', () => {
    for (const type of ['cottage', 'tavern', 'temple_small']) {
      const viaSynth = synthesizeBlueprint(type)!;
      const viaAsset = resolveAsset({ type })!;
      expect(canonicalJson(viaAsset)).toBe(canonicalJson(viaSynth));
      // and it carries NO descriptors key (so the field's addition didn't change the key)
      expect('descriptors' in viaAsset).toBe(false);
    }
  });

  it('different descriptors yield different canonical JSON (distinct sprites)', () => {
    const a = canonicalJson(resolveAsset({ type: 'cottage', descriptors: { wealth: 'poor' } })!);
    const b = canonicalJson(resolveAsset({ type: 'cottage', descriptors: { wealth: 'opulent' } })!);
    const bare = canonicalJson(resolveAsset({ type: 'cottage' })!);
    expect(a).not.toBe(b);
    expect(a).not.toBe(bare);
  });
});

describe('descriptorPhrase', () => {
  it('builds a prompt phrase, empty when no descriptors', () => {
    expect(descriptorPhrase(undefined)).toBe('');
    expect(descriptorPhrase({ wealth: 'rich', quality: 'ornate' })).toBe('rich, ornately-decorated');
    expect(descriptorPhrase({ condition: 'dilapidated' })).toBe('run-down');
  });
});

describe('catalogue descriptor axes', () => {
  it('buildings expose wealth/quality/condition axes; trees do not', () => {
    const cat = assetCatalogue();
    const cottage = cat.find(e => e.type === 'cottage')!;
    const oak = cat.find(e => e.type === 'english-oak')!;
    expect(cottage.descriptorAxes.wealth).toContain('opulent');
    expect(oak.descriptorAxes.wealth).toBeUndefined();
  });

  it('queryCatalogue filters by facets and free text', () => {
    const cat = assetCatalogue();
    expect(queryCatalogue(cat, { class: 'plant' }).every(e => e.class === 'plant')).toBe(true);
    expect(queryCatalogue(cat, { text: 'tav' }).map(e => e.type)).toContain('tavern');
  });
});
