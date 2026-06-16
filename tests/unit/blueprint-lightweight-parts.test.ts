// tests/unit/blueprint-lightweight-parts.test.ts
// Open-frame parts (stall/tent) — wall-less structures that fold to standalone prims
// (no prim:'building', no carved openings), like the civic props.
import { describe, it, expect, beforeAll } from 'vitest';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';

beforeAll(() => ensureBuildingTypesRegistered());

describe('open-frame parts', () => {
  it('market_stall is an open frame: timber posts + a peaked cone canopy, no building/walls', () => {
    const spec = toGeometry(synthesizeBlueprint('market_stall')!);
    const kinds = spec.parts.map(p => p.prim);
    expect(kinds).not.toContain('building');               // no walls
    expect(kinds.filter(k => k === 'box').length).toBeGreaterThanOrEqual(4); // ≥4 corner posts
    expect(kinds).toContain('cone');                        // the canopy
    expect(spec.parts.some(p => p.prim === 'box' && p.material === 'door')).toBe(false); // no door leaf
    const cone = spec.parts.find(p => p.prim === 'cone');
    expect(cone && cone.prim === 'cone' ? cone.height : 0).toBeGreaterThan(0.8); // clearly peaked, not a flat disc
  });

  it('bell_tent is a canvas cone + centre pole + an entrance flap', () => {
    const rb = synthesizeBlueprint('bell_tent')!;
    expect(rb.class).toBe('prop');                          // a prop, not a counted building
    const spec = toGeometry(rb);
    expect(spec.parts.some(p => p.prim === 'cone')).toBe(true);
    expect(spec.parts.some(p => p.prim === 'box' && p.material === 'door')).toBe(true); // the flap
  });
});
