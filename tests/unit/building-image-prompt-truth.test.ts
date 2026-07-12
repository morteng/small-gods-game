// tests/unit/building-image-prompt-truth.test.ts
// "Only and all" guard: across EVERY building/prop preset in the connectome, the
// img2img prompt must describe exactly what the compiled geometry actually contains
// — every material that is present, no material that is absent, and no door/window/
// chimney that the render doesn't show. This is what stops the prompt drifting back
// to generic boilerplate (the bug where an open market stall was told it had walls,
// a gable roof and a wooden door).
import { describe, it, expect, beforeAll } from 'vitest';
import { buildingImagePrompt, imageModelFamily, presentMaterials, MAT_DESC } from '@/assetgen/building-image-prompt';
import { BUILDING_BLUEPRINTS, synthesizeBlueprint, resolveAsset } from '@/blueprint/presets';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { MATERIAL_RGB, type Mat } from '@/assetgen/types';

const FLUX = 'black-forest-labs/flux.2-klein-4b';
const QWEN = 'qwen/qwen-image-edit-2511';
const GEMINI = 'google/gemini-2.5-flash-image';

// The pilot-validated adherence clause (IoU 0.974–0.994) — must appear VERBATIM as the
// final clause of every qwen prompt, and nowhere else.
const QWEN_ADHERENCE =
  'Repaint surfaces only: keep the exact silhouette, roof pitch, eave lines and outline ' +
  'of the input image unchanged, and keep the background pure magenta.';

beforeAll(() => ensureBuildingTypesRegistered());

// Every preset that renders as a structure (buildings + the open-frame/civic props).
const STRUCTURES = Object.entries(BUILDING_BLUEPRINTS)
  .filter(([, bp]) => bp.class === 'building' || bp.class === 'prop')
  .map(([id]) => id);

/** Extract the material-legend clause from a prompt. */
function legendOf(prompt: string): string {
  const m = prompt.match(/only these are present: (.*?)\. /);
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
      // A building with no smoke vent must not mention a chimney OR a smoke-louver at all.
      if (!hasVisibleFeature(rb, 'vent')) {
        expect(p, `${id}: no chimney`).not.toContain('chimney');
        expect(p, `${id}: no smoke-louver`).not.toContain('smoke-louver');
      }
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

describe('qwen prompt family (Qwen-Image-Edit adoption)', () => {
  it('classifies qwen ids as their own family — checked before flux, after gemini', () => {
    expect(imageModelFamily(QWEN)).toBe('qwen');
    expect(imageModelFamily('Qwen/Qwen-Image-Edit')).toBe('qwen');
    expect(imageModelFamily('acme/qwen-flux-edit')).toBe('qwen');       // qwen beats flux
    expect(imageModelFamily('google/gemini-qwen-image')).toBe('gemini'); // gemini stays first
  });

  it('appends the pilot-validated adherence sentence as the FINAL clause — qwen only', () => {
    const rb = synthesizeBlueprint('cottage')!;
    const q = buildingImagePrompt(rb, QWEN);
    expect(q.endsWith(QWEN_ADHERENCE)).toBe(true);
    expect(buildingImagePrompt(rb, FLUX)).not.toContain(QWEN_ADHERENCE);
    expect(buildingImagePrompt(rb, GEMINI)).not.toContain(QWEN_ADHERENCE);
    // qwen shares the flux repaint edit verb (the pilot prompt WAS the flux prompt + adherence).
    expect(q).toContain('Repaint the attached colour-coded massing render as');
  });

  it('texture hints are EARNED by present materials, qwen-gated', () => {
    const THATCH_HINT = 'dense, tightly combed straw courses';
    const SCALE_HINT = 'true real-world scale for the stated footprint';

    const cottage = synthesizeBlueprint('cottage')!;      // thatch, no tile/brick
    const cottageMats = presentMaterials(toGeometry(cottage));
    expect(cottageMats).toContain('thatch');
    expect(cottageMats).not.toContain('tile');
    expect(cottageMats).not.toContain('brick');
    const cq = buildingImagePrompt(cottage, QWEN);
    expect(cq).toContain(THATCH_HINT);
    expect(cq).not.toContain(SCALE_HINT);
    expect(buildingImagePrompt(cottage, FLUX)).not.toContain(THATCH_HINT); // qwen-only

    const bakehouse = synthesizeBlueprint('bakehouse')!;  // tile, no thatch
    const bakehouseMats = presentMaterials(toGeometry(bakehouse));
    expect(bakehouseMats).toContain('tile');
    expect(bakehouseMats).not.toContain('thatch');
    const bq = buildingImagePrompt(bakehouse, QWEN);
    expect(bq).toContain(SCALE_HINT);
    expect(bq).not.toContain(THATCH_HINT);
    expect(buildingImagePrompt(bakehouse, FLUX)).not.toContain(SCALE_HINT); // qwen-only

    const keep = synthesizeBlueprint('castle_keep')!;     // neither material → no hints even at qwen
    const keepMats = presentMaterials(toGeometry(keep));
    expect(keepMats).not.toContain('thatch');
    expect(keepMats).not.toContain('tile');
    expect(keepMats).not.toContain('brick');
    const kq = buildingImagePrompt(keep, QWEN);
    expect(kq).not.toContain(THATCH_HINT);
    expect(kq).not.toContain(SCALE_HINT);
  });

  it('the bakehouse oven brief reads as bare clay/stone with a dark arched mouth (anti metal/glass)', () => {
    const rb = synthesizeBlueprint('bakehouse')!;
    const OVEN_BRIEF =
      'a domed bread oven of bare clay and stone with a dark arched mouth and a slim flue, bulging from one gable';
    for (const model of [FLUX, QWEN]) {
      expect(buildingImagePrompt(rb, model), `oven brief reaches the ${model} prompt`).toContain(OVEN_BRIEF);
    }
  });
});
