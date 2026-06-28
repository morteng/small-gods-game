/**
 * expressBuilding — the layered-connectome pipeline as one composable call. This locks
 * its contract: it runs PROGRAM → STRUCTURE → FABRIC and returns the connectome plus the
 * resolve-stack patches split into `pre` (the FORM massing DEFAULT, applied before a
 * caller's overrides) and `post` (OPENINGS/VENT projections + the frame CAP, applied
 * last). The two preset entry points (synthesizeBlueprint / resolveAsset) both fold
 * `[base, ...pre, ...overrides, ...post]`, so this is the single source of layer order.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadDefaultPacks } from '@/catalogue';
import { expressBuilding, hasAuthoredVent } from '@/blueprint/presets/express';
import { getBlueprintPreset } from '@/blueprint/presets';
import type { Blueprint } from '@/blueprint/types';

beforeAll(() => loadDefaultPacks());

const cottage = (): Blueprint => getBlueprintPreset('cottage')!;

describe('expressBuilding — the layered pipeline in one call', () => {
  it('annotates the construction (frame) onto the connectome', () => {
    const e = expressBuilding(cottage(), 'cottage', 'medieval', 'modest', 1);
    expect(e.connectome.structure?.frame).toBe('cruck'); // wattle/cob dwelling ⇒ cruck
  });

  it('returns FORM as a pre-default and the frame projections as post', () => {
    const e = expressBuilding(cottage(), 'cottage', 'medieval', 'modest', 1);
    // cottage opts into gen-form + gen-openings ⇒ a form default + opening/vent projections.
    expect(e.pre.length).toBeGreaterThanOrEqual(1);
    expect(e.post.length).toBeGreaterThanOrEqual(1);
    // The form default touches the body's massing params (levels/jetty/plan).
    const formParams = Object.values(e.pre[0].parts ?? {})[0]?.params ?? {};
    expect(formParams).toHaveProperty('levels');
  });

  it('omits the derived vent when the preset authors its own', () => {
    const base = cottage();
    // Inject a hand-authored vent: expressBuilding must then NOT add a derived one.
    const body = Object.values(base.parts)[0];
    body.features = { ...(body.features ?? {}), smoke: { type: 'vent', params: { kind: 'chimney', t: 0.5 } } };
    expect(hasAuthoredVent(base)).toBe(true);
    const e = expressBuilding(base, 'cottage', 'medieval', 'modest', 1);
    const ventInPost = e.post.some((p) =>
      Object.values(p.parts ?? {}).some((pt) =>
        Object.values((pt as { features?: Record<string, { type?: string }> })?.features ?? {}).some((f) => f.type === 'vent'),
      ),
    );
    expect(ventInPost).toBe(false);
  });

  it('is deterministic', () => {
    const a = JSON.stringify(expressBuilding(cottage(), 'cottage', 'medieval', 'modest', 7));
    const b = JSON.stringify(expressBuilding(cottage(), 'cottage', 'medieval', 'modest', 7));
    expect(a).toBe(b);
  });
});
