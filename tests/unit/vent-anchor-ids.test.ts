// @vitest-environment node
// PER-VENT HEARTH CONTROL (studio Object studio): a click on a chimney/vent should light or
// snuff THAT hearth specifically, so the studio needs to know WHICH vent anchor corresponds to
// WHICH pick key. This threads the vent's existing pick-provenance id (`VentFeature.id`, already
// stamped by the blueprint compiler under `toGeometry(rb, { pickIds: true })` for the click-to-
// select channel — see compose-pick-buffer.test.ts) through the anchor pipeline too:
//   VentFeature.id → BuildingAnchors.vents[].id (assetgen/geometry/solids.ts) →
//   StructureAnchors.vents[].id (assetgen/compose.ts `norm()` loop)
// NOT a new gate: this reuses the SAME `pickIds` flag toGeometry already gates VentFeature.id
// behind, so there is nothing new to keep in sync with the cache-key contract — a runtime
// compile (no pickIds) still produces a plain `{x,y}` vent anchor with no `id` key at all.
import { describe, it, expect } from 'vitest';
import { composeStructure } from '@/assetgen/compose';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { synthesizeBlueprint } from '@/blueprint/presets';
import type { ResolvedBlueprint } from '@/blueprint/types';

describe('vent anchor ids (per-vent hearth control)', () => {
  // The tavern has ≥2 vents on its body part (smoke + smoke2 — the richest fixture already used
  // by compose-pick-buffer.test.ts), so it's the natural subject for "distinct ids per vent".
  const rb: ResolvedBlueprint = synthesizeBlueprint('tavern')!;
  it('fixture premise: the tavern compiles with at least two vent features', () => {
    expect(rb).toBeTruthy();
    const body = rb.parts.find((p) => p.features.some((f) => f.type === 'vent'))!;
    expect(body).toBeTruthy();
    expect(body.features.filter((f) => f.type === 'vent').length).toBeGreaterThanOrEqual(2);
  });

  it('with pickIds: StructureAnchors.vents entries carry distinct <partId>/<featureId> ids', async () => {
    const body = rb.parts.find((p) => p.features.some((f) => f.type === 'vent'))!;
    const ventFeatureIds = body.features.filter((f) => f.type === 'vent').map((f) => f.id);
    const r = await composeStructure(toGeometry(rb, { pickIds: true }), undefined, { pickIds: true });
    expect(r.anchors.vents.length).toBeGreaterThanOrEqual(2);
    // Every anchor carries an id, every id has the exact `<partId>/<featureId>` shape, and it
    // names one of the body's actual vent features (not e.g. a door/window key from elsewhere).
    for (const v of r.anchors.vents) {
      expect(v.id).toBeTruthy();
      expect(v.id).toMatch(/^[^/]+\/[^/]+$/);
      const [partId, featureId] = v.id!.split('/');
      expect(partId).toBe(body.id);
      expect(ventFeatureIds).toContain(featureId);
    }
    // Distinct: two vents on the same building must not collapse onto one key (that would light
    // BOTH hearths from a click meant for one).
    const ids = r.anchors.vents.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The SAME ids the click-to-select pick buffer resolves for those vents' own facets — the
    // anchor id and the pick key are literally the same string, not two independently-derived
    // formats that could drift (compose-pick-buffer.test.ts covers the pick-buffer side).
    for (const id of ids) expect(r.pick!.table).toContain(id);
  });

  it('without pickIds (the runtime/game path): vent anchors carry NO id key at all', async () => {
    // toGeometry's own pickIds gate gets checked elsewhere (compose-pick-buffer.test.ts); here
    // we confirm the ANCHOR side of the plumbing added in this change doesn't leak an id when
    // the upstream VentFeature.id was never set.
    const r = await composeStructure(toGeometry(rb));
    expect(r.anchors.vents.length).toBeGreaterThanOrEqual(2);
    for (const v of r.anchors.vents) expect(v.id).toBeUndefined();
    // JSON-level check: an `undefined` id is dropped by JSON.stringify, so the default-path
    // anchor payload is byte-identical in SHAPE to before this change (no `"id"` key at all) —
    // this is what keeps a persisted (e.g. sprite-cache) round-trip and any deep-equality golden
    // check indifferent to this feature existing.
    expect(JSON.stringify(r.anchors.vents)).not.toContain('"id"');
  });
});
