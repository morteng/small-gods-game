// tests/unit/blueprint-presets.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { synthesizeBlueprint, getBlueprintPreset } from '@/blueprint/presets';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { toGeometry } from '@/blueprint/compile/to-geometry';

beforeAll(() => ensureBuildingTypesRegistered());

const NAMES = ['cottage','tavern','market_stall','temple_small','farm_barn','tower','castle_keep','dock','shrine','guard_post','yurt','longhouse','manor','parish-church'];

describe('blueprint presets', () => {
  it('defines all 11+ named presets', () => {
    for (const n of NAMES) expect(getBlueprintPreset(n)).toBeDefined();
  });
  it('every preset resolves + compiles to a non-empty StructureSpec', () => {
    for (const n of NAMES) {
      const rb = synthesizeBlueprint(n)!;
      const spec = toGeometry(rb);
      expect(spec.parts.length, n).toBeGreaterThan(0);
    }
  });
  it('cottage body length varies with the seed (sizeBays [1,2]) within a fixed 3x3 plot, south door', () => {
    // L2b: the gen-form body's plan length is derived from the cottage's bay range by the
    // seed, CLAMPED to the authored 3x3 lot — so the lot (placement) is fixed but the house
    // reads as a short 1-bay cot or a longer 2-bay range. The authored 3x2 is now a fallback.
    const bodyOf = (seed: number) =>
      synthesizeBlueprint('cottage', [], seed)!.parts.find(p => p.type === 'body')!;
    expect(bodyOf(0).size).toEqual({ w: 2, h: 2 }); // 1 bay → short cot
    expect(bodyOf(1).size).toEqual({ w: 3, h: 2 }); // 2 bays → longer range
    const rb = synthesizeBlueprint('cottage', [], 1)!;
    const body = rb.parts.find(p => p.type === 'body')!;
    expect(rb.footprint).toEqual({ w: 3, h: 3 });   // lot fixed regardless of seed
    expect(body.features.find(f => f.type === 'door')?.face).toBe('south');
  });
  it('castle_keep is a bailey + tall tower, not a pancaked stepped slab', () => {
    const rb = synthesizeBlueprint('castle_keep')!;
    const bodies = rb.parts.filter(p => p.type === 'body');
    expect(bodies.length).toBe(2);
    const spec = toGeometry(rb);
    const building = spec.parts.find(p => p.prim === 'building');
    expect(building).toBeDefined();
    if (building?.prim !== 'building') throw new Error('unreachable');
    expect(building.wings.length).toBe(2);
    expect(Math.max(...building.wings.map(w => w.storeys ?? 1))).toBeGreaterThanOrEqual(3);
    // the tower carries windows (also seeds Slice-5 emissive panes)
    expect(bodies.some(p => p.features.some(f => f.type === 'window'))).toBe(true);
  });
  it('tall presets carry window features (tower, tavern)', () => {
    for (const n of ['tower', 'tavern']) {
      const rb = synthesizeBlueprint(n)!;
      expect(rb.parts.some(p => p.features.some(f => f.type === 'window')), n).toBe(true);
    }
  });
  it('synthesizeBlueprint applies an override patch (levels bump)', () => {
    const rb = synthesizeBlueprint('cottage', [{ parts: { body: { type: 'body', params: { levels: 2 } } } }])!;
    expect(rb.parts.find(p => p.type === 'body')!.params.levels).toBe(2);
  });
});
