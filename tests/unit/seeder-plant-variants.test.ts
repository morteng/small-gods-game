// Guards the invariant the vendored-sprite seeder MUST hold: it enumerates EXACTLY
// the plant variant set the runtime ParametricPlantSource composes (v0..V-1 seeded
// silhouettes + a bare-crown slot on the variant-0 seed). This is the regression
// that shipped the ~189-pack plant miss set — the seeder baked only
// `synthesizeBlueprint(kind)` (seed = hashKind), matching NEITHER runtime variant-0
// (seed 0) for most species NOR any higher variant. Node-keyed here (plt keys
// diverge Node↔Chromium, but the ENUMERATION — which seeds/specs — is engine-
// independent, so this parity check is valid in Node/jsdom).
import { describe, it, expect } from 'vitest';
import { plantSlots, plantSpecForSlot } from '../../scripts/seed-parametric-sprites';
import { plantPresetNames, synthesizeBlueprint } from '@/blueprint/presets';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { canonicalJson } from '@/render/generated-art-cache';
import { parametricSpriteKey } from '@/render/parametric-sprite-cache';
import { FLORA_VARIANTS, floraVariantSeed } from '@/render/flora-variant';

/** The runtime's per-variant blueprint (mirror of ParametricPlantSource.warmVariant):
 *  seed = floraVariantSeed(kind, bare ? 0 : v); bare drops leaves on branch_plant parts. */
function runtimePlantKey(kind: string, v: number, bare: boolean): string | null {
  const rb = synthesizeBlueprint(kind, [], floraVariantSeed(kind, bare ? 0 : v));
  if (!rb) return null;
  if (bare) for (const p of rb.parts) if (p.type === 'branch_plant') p.params = { ...p.params, bare: 1 };
  const spec = toGeometry(rb);
  return spec ? parametricSpriteKey('plt', canonicalJson(spec)) : null;
}

describe('seeder plant enumeration matches the runtime plant source', () => {
  const presets = plantPresetNames();

  it('emits FLORA_VARIANTS seeded slots + a bare slot per preset, with the runtime seeds', () => {
    const slots = plantSlots();
    expect(slots.length).toBe(presets.length * (FLORA_VARIANTS + 1));
    for (const kind of presets) {
      const mine = slots.filter((s) => s.kind === kind).map((s) => `${s.seed}:${s.bare}`);
      const expected = [
        ...Array.from({ length: FLORA_VARIANTS }, (_, v) => `${floraVariantSeed(kind, v)}:false`),
        `${floraVariantSeed(kind, 0)}:true`,
      ];
      expect(mine).toEqual(expected);
    }
  });

  it('every seeder slot keys the SAME plt spec the runtime composes for that variant', () => {
    for (const slot of plantSlots()) {
      const spec = plantSpecForSlot(slot);
      if (!spec) continue; // rocks/landforms without a branch_plant skip identically both sides
      const seederKey = parametricSpriteKey('plt', canonicalJson(spec));
      // The label encodes the variant: `${kind}#v${v}` or `${kind}#bare`.
      const suffix = slot.label.slice(slot.kind.length + 1);
      const v = suffix === 'bare' ? 0 : Number(suffix.slice(1));
      const runtimeKey = runtimePlantKey(slot.kind, v, slot.bare);
      expect(seederKey, `mismatch for ${slot.label}`).toBe(runtimeKey);
    }
  });

  it('regression witness: variant-0 differs from the legacy synthesizeBlueprint(kind) default for many species', () => {
    // The OLD seeder used synthesizeBlueprint(kind) (seed = hashKind) for every plant;
    // for most species that is NOT the runtime variant-0 (seed 0), which is exactly why
    // ~189 plant packs missed. If this ever drops to 0, the enumeration bug could silently
    // return (variant-0 seed collapsing back to hashKind).
    let mismatch = 0;
    for (const kind of presets) {
      const legacy = toGeometry(synthesizeBlueprint(kind)!);
      const variant0 = plantSpecForSlot({ kind, seed: floraVariantSeed(kind, 0), bare: false, label: '' });
      if (!legacy || !variant0) continue;
      if (canonicalJson(legacy) !== canonicalJson(variant0)) mismatch++;
    }
    expect(mismatch).toBeGreaterThan(0);
  });
});
