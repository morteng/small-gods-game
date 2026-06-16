// tests/unit/building-image-prompt-truth.test.ts
// "Only and all" guard: across EVERY building/prop preset in the connectome, the
// img2img prompt must describe exactly what the compiled geometry actually contains
// — every material that is present, no material that is absent, and no door/window/
// chimney that the render doesn't show. This is what stops the prompt drifting back
// to generic boilerplate (the bug where an open market stall was told it had walls,
// a gable roof and a wooden door).
import { describe, it, expect, beforeAll } from 'vitest';
import { buildingImagePrompt, presentMaterials, MAT_DESC } from '@/assetgen/building-image-prompt';
import { BUILDING_BLUEPRINTS, synthesizeBlueprint, resolveAsset } from '@/blueprint/presets';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { MATERIAL_RGB, type Mat } from '@/assetgen/types';

const FLUX = 'black-forest-labs/flux.2-klein-4b';

beforeAll(() => ensureBuildingTypesRegistered());

// Every preset that renders as a structure (buildings + the open-frame/civic props).
const STRUCTURES = Object.entries(BUILDING_BLUEPRINTS)
  .filter(([, bp]) => bp.class === 'building' || bp.class === 'prop')
  .map(([id]) => id);

/** Extract the material-legend clause from a prompt. */
function legendOf(prompt: string): string {
  const m = prompt.match(/only these are present: (.*?)\. Use those regions/);
  return m ? m[1] : '';
}

/** Visible features of a type on the resolved blueprint (south/east walls + roof). */
function hasVisibleFeature(rb: ReturnType<typeof synthesizeBlueprint>, type: string): boolean {
  const VIS = new Set(['south', 'east', undefined]);
  return !!rb?.parts.some(p => p.features.some(f => f.type === type && VIS.has(f.face as never)));
}

describe('img2img prompt is geometry-true across the connectome', () => {
  it('lists ALL and ONLY the materials actually in each compiled sprite', () => {
    for (const id of STRUCTURES) {
      const rb = synthesizeBlueprint(id)!;
      const present = presentMaterials(toGeometry(rb));
      const legend = legendOf(buildingImagePrompt(rb, FLUX));
      expect(legend, `${id}: legend present`).not.toBe('');
      // ALL present materials are named…
      for (const m of present) {
        expect(legend, `${id}: legend must mention ${m}`).toContain(`= ${MAT_DESC[m].noun}`);
      }
      // …and NO absent material is named.
      for (const m of Object.keys(MATERIAL_RGB) as Mat[]) {
        if (present.includes(m)) continue;
        expect(legend, `${id}: legend must NOT mention absent ${m}`).not.toContain(`= ${MAT_DESC[m].noun}`);
      }
    }
  });

  it('never POSITIVELY describes a wooden door, chimney or window the geometry does not show', () => {
    // We check the positive description tokens, not the negative "add no …" guards
    // (which legitimately name the things the model must NOT paint).
    for (const id of STRUCTURES) {
      const rb = synthesizeBlueprint(id)!;
      const p = buildingImagePrompt(rb, FLUX).toLowerCase();
      if (!hasVisibleFeature(rb, 'door')) expect(p, `${id}: no wooden door`).not.toContain('wooden door');
      if (!hasVisibleFeature(rb, 'vent')) expect(p, `${id}: no chimney count`).not.toMatch(/exactly \d+ chimney/);
      if (!hasVisibleFeature(rb, 'window')) expect(p, `${id}: no visible window`).not.toContain('visible window');
    }
  });

  it('describes present doors/vents/windows when they ARE there', () => {
    const cottage = synthesizeBlueprint('cottage')!;          // door + windows, derived louver vent
    const cp = buildingImagePrompt(cottage, FLUX).toLowerCase();
    expect(cp).toContain('wooden door');
    expect(cp).toMatch(/visible window/);

    const tavern = synthesizeBlueprint('tavern')!;            // chimneys
    expect(buildingImagePrompt(tavern, FLUX).toLowerCase()).toContain('chimney');
  });

  it('open frames (stall/tent) are described as open, walled buildings as storeyed', () => {
    const stall = buildingImagePrompt(synthesizeBlueprint('market_stall')!, FLUX).toLowerCase();
    expect(stall).toContain('open structure');
    expect(stall).not.toContain('gable roof');
    expect(stall).not.toContain('storey');
    expect(stall).not.toContain('wooden door');

    const cottage = buildingImagePrompt(synthesizeBlueprint('cottage')!, FLUX).toLowerCase();
    expect(cottage).toContain('storey');
  });

  it('weaves agent customisation (notes + palette) into the prompt and the cache identity', () => {
    const custom = synthesizeBlueprint('cottage', [{
      notes: 'a fisherman’s cottage, salt-bleached blue door, nets drying on the wall',
      palette: { walls: '#d8e6ea', trim: '#2b5d77' },
    }])!;
    const p = buildingImagePrompt(custom, FLUX);
    expect(p).toContain('Art direction: a fisherman’s cottage');
    expect(p).toContain('#d8e6ea');
    // customisation rides on the resolved blueprint → distinct prompt from the plain preset.
    expect(p).not.toBe(buildingImagePrompt(synthesizeBlueprint('cottage')!, FLUX));
  });

  it('resolveAsset carries an agent variant (notes/palette/materials) into a distinct asset', () => {
    const plain = resolveAsset({ type: 'cottage' })!;
    const variant = resolveAsset({
      type: 'cottage',
      notes: 'a reeve’s cottage with a fresh limewash',
      palette: { walls: '#eef0ea' },
      materials: { roof: 'slate' },
    })!;
    const vp = buildingImagePrompt(variant, FLUX);
    expect(vp).toContain('Art direction: a reeve’s cottage');
    expect(vp).toContain('#eef0ea');
    // The roof override reached the geometry: slate renders as the stone Mat, so the
    // variant says "stone roof" where the plain cottage says "thatch roof".
    expect(vp.toLowerCase()).toContain('stone roof');
    expect(buildingImagePrompt(plain, FLUX).toLowerCase()).toContain('thatch roof');
    // distinct cache identity (the resolved blueprints differ) ⇒ its own library sprite.
    expect(JSON.stringify(variant)).not.toBe(JSON.stringify(plain));
  });
});
