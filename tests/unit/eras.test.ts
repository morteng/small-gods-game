// tests/unit/eras.test.ts
import { describe, it, expect } from 'vitest';
import { resolveAsset, synthesizeBlueprint, BUILDING_BLUEPRINTS } from '@/blueprint/presets';
import { eraPatch } from '@/blueprint/eras';
import { canonicalJson } from '@/render/generated-art-cache';

const body = (rb: NonNullable<ReturnType<typeof resolveAsset>>) => rb.parts.find(p => p.type === 'body')!;
const windowStyle = (rb: NonNullable<ReturnType<typeof resolveAsset>>) =>
  body(rb).features.find(f => f.type === 'window')?.params.style;
const ventKind = (rb: NonNullable<ReturnType<typeof resolveAsset>>) =>
  rb.parts.flatMap(p => p.features).find(f => f.type === 'vent')?.params.kind;

describe('eraPatch', () => {
  it('restyles materials + features for the period', () => {
    const cottage = BUILDING_BLUEPRINTS.cottage;
    const classical = eraPatch(cottage, 'classical');
    expect(classical.materials?.walls).toBe('stone');
    expect(classical.materials?.roof).toBe('tile');
    expect(classical.era).toBe('classical');
  });

  it('only overrides roles the base declares (a well gains no roof it lacks)', () => {
    const well = BUILDING_BLUEPRINTS.well;     // has walls+roof+ground
    const p = eraPatch(well, 'primordial');
    // well has a roof material, so it can be overridden; but nothing invented beyond roles present
    expect(Object.keys(p.materials ?? {}).every(k => k in (well.materials ?? {}))).toBe(true);
  });
});

describe('resolveAsset era variants', () => {
  it('a primordial cottage uses hide walls + a smokehole; current uses brick + chimney', () => {
    const prim = resolveAsset({ type: 'cottage', era: 'primordial' })!;
    const cur = resolveAsset({ type: 'cottage', era: 'current' })!;
    expect(prim.materials.walls).toBe('hide');
    expect(ventKind(prim)).toBe('smokehole');
    expect(cur.materials.walls).toBe('brick');
    expect(ventKind(cur)).toBe('chimney');
    expect(windowStyle(cur)).toBe('arched');
    expect(prim.era).toBe('primordial');
  });

  it('requesting the base era is a no-op (identical key to bare — library-safe)', () => {
    // cottage's base era is medieval
    const bare = canonicalJson(resolveAsset({ type: 'cottage' })!);
    const sameEra = canonicalJson(resolveAsset({ type: 'cottage', era: 'medieval' })!);
    expect(sameEra).toBe(bare);
    expect(sameEra).toBe(canonicalJson(synthesizeBlueprint('cottage')!));
  });

  it('different eras yield different canonical JSON (distinct sprites)', () => {
    const eras = ['primordial', 'ancient', 'classical', 'current'] as const;
    const keys = eras.map(era => canonicalJson(resolveAsset({ type: 'cottage', era })!));
    expect(new Set(keys).size).toBe(eras.length);
  });

  it('era + descriptors compose', () => {
    const rb = resolveAsset({ type: 'cottage', era: 'classical', descriptors: { wealth: 'opulent' } })!;
    expect(rb.era).toBe('classical');
    expect(rb.descriptors?.wealth).toBe('opulent');
    expect(body(rb).params.levels).toBe(2);   // opulent storey still applies
  });
});
