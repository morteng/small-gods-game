// src/blueprint/presets/index.ts
// The 11 building presets, re-expressed as Blueprints. Mechanical port of the
// old BUILDING_PRESETS descriptors (the retired flat descriptor model).
import { BLUEPRINT_VERSION, type Blueprint, type BlueprintPatch, type ResolvedBlueprint, type Descriptors, type Era, type Palette } from '../types';
import { resolveBlueprint } from '../resolve';
import { descriptorPatch } from '../descriptors';
import { eraPatch } from '../eras';
import { stagePatch, defaultStageFor } from '../lifecycle';
import { ensureBuildingTypesRegistered } from '../register-buildings';
import { GEN_OPENINGS_TAG } from '../connectome/openings';
import { GEN_FORM_TAG } from '../connectome/form';
import { expressBuilding } from './express';
import { blueprintFromBuildingType } from './from-building-type';
import type { Connectome } from '../connectome/types';
import { allFloraSpecies, getFloraSpecies } from '@/flora/flora-registry';
import { stairFootprint } from '../parts/stair';
import { deriveGenParams } from '@/flora/flora-species';
import { mToTiles } from '@/render/scale-contract';
import { BARRIER_DEFAULTS, type BarrierKind } from '@/world/barrier';

const bp = (preset: string, b: Omit<Blueprint, 'version' | 'class' | 'preset'>): Blueprint =>
  ({ version: BLUEPRINT_VERSION, class: 'building', preset, ...b });

/** Civic props — small free-standing structures that are NOT buildings (well/graveyard).
 *  Same generate→sprite pipeline; `class:'prop'` keeps them out of building counts and
 *  off the `canPlaceIgnoringNature` blocker (see entity.ts class→category mapping). */
const prop = (preset: string, b: Omit<Blueprint, 'version' | 'class' | 'preset'>): Blueprint =>
  ({ version: BLUEPRINT_VERSION, class: 'prop', preset, ...b });

/** Trees — class:'plant' so they map to category 'vegetation' (entity.ts) and render
 *  through the SAME generate→sprite pipeline as buildings (PBR-lit, cast shadows).
 *  Keyed by the existing entity kinds so `kind` is preserved; heights match
 *  NATURE_HEIGHT_M (scale-contract). Render keys ONE sprite per species (see
 *  ParametricPlantSource) — trees never carry a per-entity blueprint. */
/** Branching L-system plant (class:'plant') — real limbs/foliage.
 *  `recipe` selects the L-system; the blueprint seed fixes the (stochastic) shape so
 *  every instance of a species shares one cached sprite. See flora-branch.ts. */
/** Sensible (generator, crownShape) for a hand-authored preset that only names a
 *  recipe — mirrors the species-path derivation so legacy presets pick the right
 *  generator (conifer → spacecol cone, willow → proctree weeping, etc.). */
const recipeDefaults = (recipe: string): { generator: string; crownShape: string } => {
  switch (recipe) {
    case 'pine': return { generator: 'spacecol', crownShape: 'conical' };
    case 'willow': return { generator: 'proctree', crownShape: 'weeping' };
    case 'shrub': return { generator: 'proctree', crownShape: 'irregular' };
    case 'fern': case 'flower': return { generator: 'lsystem', crownShape: 'none' };
    default: return { generator: 'proctree', crownShape: 'rounded' };
  }
};

const branched = (
  preset: string, recipe: string, heightM: number, trunkR = 0.16,
  generator?: string, crownShape?: string,
): Blueprint => {
  const d = recipeDefaults(recipe);
  return {
    version: BLUEPRINT_VERSION, class: 'plant', preset,
    category: 'flora', footprint: { w: 1, h: 1 },
    materials: { walls: 'timber', roof: 'thatch', ground: 'grass' },
    parts: { trunk: { type: 'branch_plant', size: { w: 1, h: 1 }, params: {
      generator: generator ?? d.generator, recipe, crownShape: crownShape ?? d.crownShape, heightM, trunkR,
    } } },
  };
};

/** A flight of stairs (class:'prop') — renders through the same generate→sprite pipeline
 *  as buildings, sized to its own run. `construction` sweeps the spectrum (0 rough scramble
 *  → 1 dressed/accessible); `material` (walls) picks timber/stone/brick. */
const stair = (
  preset: string,
  opts: { material: string; riseM?: number; treads?: number; widthM?: number; construction?: number; railing?: 'none' | 'one' | 'both'; dir?: 'north' | 'south' | 'east' | 'west' },
): Blueprint => {
  const fp = stairFootprint({ riseM: opts.riseM, treads: opts.treads, widthM: opts.widthM, construction: opts.construction });
  return {
    version: BLUEPRINT_VERSION, class: 'prop', preset, category: 'infrastructure',
    footprint: fp,
    materials: { walls: opts.material, roof: opts.material, ground: 'dirt' },
    parts: { flight: { type: 'stair_flight', at: { x: 0, y: 0 }, size: fp, params: {
      riseM: opts.riseM ?? 1.8, ...(opts.treads ? { treads: opts.treads } : {}),
      widthM: opts.widthM ?? 2, construction: opts.construction ?? 0.5,
      railing: opts.railing ?? 'none', dir: opts.dir ?? 'south',
    } } },
  };
};

/** A defensive line (class:'barrier') — wall / rampart / palisade / fence / hedge — rendered
 *  through the SAME generate→sprite pipeline as buildings (PBR-lit, cast shadows). A straight
 *  REPRESENTATIVE run (the studio/preview subject + the unit the world tiles real rings from);
 *  its believable cross-section lives in assetgen/geometry/linear.ts. `gateWidthM`>0 cuts a
 *  central gate so the opening reads. */
const barrier = (
  preset: string,
  opts: {
    kind: BarrierKind; lengthM?: number; heightM?: number; thicknessTiles?: number;
    crenellated?: boolean; posts?: boolean; gateWidthM?: number; material?: string; wallMat?: string;
  },
): Blueprint => {
  const lengthM = opts.lengthM ?? 24;
  const thicknessTiles = opts.thicknessTiles ?? BARRIER_DEFAULTS[opts.kind].thickness;
  return {
    version: BLUEPRINT_VERSION, class: 'barrier', preset, category: 'fortification',
    footprint: { w: Math.max(1, Math.round(mToTiles(lengthM))), h: Math.max(1, thicknessTiles) },
    materials: { walls: opts.wallMat ?? opts.material ?? 'stone', roof: 'stone', ground: 'dirt' },
    parts: {
      line: {
        type: 'barrier', at: { x: 0, y: 0 }, params: {
          kind: opts.kind, lengthM, thicknessTiles,
          ...(opts.heightM ? { heightM: opts.heightM } : {}),
          ...(opts.crenellated != null ? { crenellated: opts.crenellated } : {}),
          ...(opts.posts != null ? { posts: opts.posts } : {}),
          ...(opts.gateWidthM ? { gateWidthM: opts.gateWidthM } : {}),
          ...(opts.material ? { material: opts.material } : {}),
        },
      },
    },
  };
};

/** A boulder/rock (class:'terrain_feature'); `sizeM` = diameter in metres. */
const rock = (preset: string, sizeM: number): Blueprint => ({
  version: BLUEPRINT_VERSION, class: 'terrain_feature', preset,
  category: 'flora', footprint: { w: 1, h: 1 },
  materials: { walls: 'stone', roof: 'stone', ground: 'dirt' },
  parts: { mass: { type: 'rock', size: { w: 1, h: 1 }, params: { sizeM } } },
});

/** A natural LANDFORM mesh prop (a sea arch) — class `plant` so the render seam
 *  routes it to the per-kind generative mesh source (and the loader pre-warms it),
 *  exactly like a tree species. It's a parametric prop, not vegetation; the class
 *  is purely the "warm one self-lit mesh per kind" routing tag. */
const landform = (preset: string, type: string, footprint: { w: number; h: number }): Blueprint => ({
  version: BLUEPRINT_VERSION, class: 'plant', preset,
  category: 'flora', footprint,
  materials: { walls: 'stone', roof: 'stone', ground: 'dirt' },
  parts: { mass: { type, size: footprint, params: {} } },
});

export const BUILDING_BLUEPRINTS: Record<string, Blueprint> = {
  // Natural landform mesh props — a rock arch (a real hole through rock) and an
  // overhanging cliff face (rock leaning out over the water). Both are landforms the
  // heightfield can't represent; generated self-lit, no art.
  sea_arch: landform('sea_arch', 'sea_arch', { w: 4, h: 3 }),
  cliff_face: landform('cliff_face', 'cliff_face', { w: 4, h: 3 }),
  cave_mouth: landform('cave_mouth', 'cave_mouth', { w: 4, h: 3 }),
  // Peasant cottage: rectangular plan (1:1.5), door + one shuttered window on the
  // entry face, one on the gable, ridge smoke LOUVRE (no chimney — period default
  // for commoners; see docs/reference/medieval-building-reference.md).
  cottage: bp('cottage', {
    category: 'residential', era: 'medieval', footprint: { w: 3, h: 3 },
    materials: { walls: 'wattle', roof: 'thatch', ground: 'packed_dirt' },
    parts: { body: {
      type: 'body', at: { x: 0, y: 0 }, size: { w: 3, h: 2 },
      params: { plan: 'rect', levels: 1, levelInset: 0, roof: 'gable' },
      // Openings + smoke vent are DERIVED from the room graph (gen-openings + the
      // hearth) — a south door and shuttered, unglazed windows for an early-medieval
      // commoner, smoke through a ridge louver. See connectome/openings.ts + smoke.ts.
      // Massing (single low cruck range) is DERIVED too (gen-form): the cruck frame bears
      // one storey and never jetties, so the derived form matches this authored cottage.
      tags: [GEN_OPENINGS_TAG, GEN_FORM_TAG],
    } },
  }),
  // Inn: a cooking building — TWO ridge stacks, jettied upper storey, two dormers,
  // windows denser upstairs than down (tavern read: more glass than a house).
  tavern: bp('tavern', {
    category: 'commercial', era: 'medieval', footprint: { w: 3, h: 3 },
    materials: { walls: 'timber', roof: 'tile', ground: 'packed_dirt' },
    parts: { body: {
      // Massing (a jettied two-storey range) is DERIVED from the box frame (gen-form): the
      // box frame stacks a storey and oversails it. The authored levels/jetty here are the
      // fallback if gen-form is ever removed; the derived values take over at resolve.
      type: 'body', size: { w: 3, h: 2 }, params: { plan: 'rect', levels: 2, roof: 'gable', jetty: 0.12 },
      tags: [GEN_FORM_TAG],
      features: {
        door: { type: 'door', face: 'south', params: { main: true, t: 0.5 } },
        smoke: { type: 'vent', params: { kind: 'chimney', t: 0.12 } },
        smoke2: { type: 'vent', params: { kind: 'chimney', t: 0.88 } },
        // Ground-floor fenestration RANKED up the storeys (perStorey) — the upper floor is
        // generated from these, not hand-listed. Add a storey ⇒ another row of windows.
        win_s: { type: 'window', face: 'south', params: { style: 'shuttered', t: 0.16, perStorey: true } },
        win_s2: { type: 'window', face: 'south', params: { style: 'shuttered', t: 0.84, perStorey: true } },
        win_e: { type: 'window', face: 'east', params: { style: 'shuttered', t: 0.4, perStorey: true } },
        dormer1: { type: 'dormer', params: { t: 0.3 } },
        dormer2: { type: 'dormer', params: { t: 0.7 } },
      },
    } },
  }),
  // Townhouse: the cottage's urban upgrade (S4 upgrade-in-place). Same 3×3
  // burgage footprint, but TWO jettied storeys — densification without sprawl.
  // Timber over a stone ground floor, a proper chimney, glazed upper windows.
  townhouse: bp('townhouse', {
    category: 'residential', era: 'medieval', footprint: { w: 3, h: 3 },
    materials: { walls: 'timber', roof: 'tile', ground: 'flagstone' },
    parts: { body: {
      // Massing DERIVED from the box frame (gen-form) — a jettied two-storey burgage range.
      type: 'body', size: { w: 3, h: 2 },
      params: { plan: 'rect', levels: 2, roof: 'gable', jetty: 0.12 },
      tags: [GEN_FORM_TAG],
      features: {
        door: { type: 'door', face: 'south', params: { main: true, t: 0.3 } },
        // Ranked ground-floor windows: the upper storey is generated, not hand-listed.
        win_s1: { type: 'window', face: 'south', params: { style: 'shuttered', t: 0.3, perStorey: true } },
        win_s2: { type: 'window', face: 'south', params: { style: 'shuttered', t: 0.7, perStorey: true } },
        win_e: { type: 'window', face: 'east', params: { style: 'shuttered', t: 0.5, perStorey: true } },
        smoke: { type: 'vent', params: { kind: 'chimney', t: 0.85 } },
      },
    } },
  }),
  // Open market stall: timber posts + a front counter under a peaked canopy — NOT a
  // walled shack. Uses the open-frame `stall` part (no body/walls). See parts/lightweight.ts.
  market_stall: bp('market_stall', {
    category: 'commercial', era: 'medieval', footprint: { w: 2, h: 2 },
    materials: { walls: 'timber', roof: 'thatch', ground: 'packed_dirt' },
    parts: { frame: { type: 'stall', size: { w: 2, h: 2 }, params: { counter: true } } },
  }),
  // temple_small RETIRED (E3 slice 1): the hand preset is gone — a temple now EXPRESSES from
  // its church-axial programme through the layered fold, like any building. The generative
  // bridge (`from-building-type.ts`) gives it a DEEP stone cella (the axial nave fronts the
  // door with a pediment, `deriveFootprint` church-axial case), the FORM layer the lofty
  // sacred storey (storeyM 4.5), and the FABRIC layer the bilateral arched flank windows with
  // the entrance front kept clear (connectome/openings sacred path). So temples now vary their
  // footprint per instance instead of being one frozen 3×4 box — the procession's exterior is
  // generative; the threshold/funnel/axis-mundi interior primitives are Slices 2–3.
  // Barn: one huge roof (1:2 plan), full-height cart door, NO windows — just thin
  // slit vents high on the wall, no smoke at all.
  farm_barn: bp('farm_barn', {
    category: 'farm', era: 'medieval', footprint: { w: 4, h: 2 },
    materials: { walls: 'timber', roof: 'wood', ground: 'dirt' },
    parts: { body: {
      type: 'body', size: { w: 4, h: 2 }, params: { plan: 'rect', levels: 1, storeyM: 3.2, roof: 'gable' },
      features: {
        door: { type: 'door', face: 'south', params: { main: true, t: 0.5, width: 0.4, height: 1.3 } },
        slit1: { type: 'window', face: 'south', params: { t: 0.15, width: 0.05, height: 0.3, sill: 1.1, glazed: false } },
        slit2: { type: 'window', face: 'south', params: { t: 0.85, width: 0.05, height: 0.3, sill: 1.1, glazed: false } },
        slit3: { type: 'window', face: 'east', params: { t: 0.5, width: 0.05, height: 0.3, sill: 1.1, glazed: false } },
      },
    } },
  }),
  // Watchtower: openings grow with height — slit low, arched mid, window pair top.
  tower: bp('tower', {
    category: 'military', era: 'medieval', footprint: { w: 2, h: 3 },
    materials: { walls: 'stone', roof: 'slate', ground: 'flagstone' },
    parts: { body: { type: 'body', size: { w: 2, h: 3 }, params: { plan: 'rect', levels: 3, roof: 'flat' }, features: {
      door: { type: 'door', face: 'south', params: { t: 0.5 } },
      slit_s: { type: 'window', face: 'south', params: { t: 0.5, width: 0.05, height: 0.3, sill: 0.8, glazed: false } },
      win_s: { type: 'window', face: 'south', params: { style: 'arched', sill: 1.8 } },
      win_e: { type: 'window', face: 'east', params: { style: 'arched', sill: 2.8 } },
      win_s2: { type: 'window', face: 'south', params: { style: 'arched', t: 0.35, sill: 3.2 } },
      win_s3: { type: 'window', face: 'south', params: { style: 'arched', t: 0.65, sill: 3.2 } },
    } } },
  }),
  castle_keep: bp('castle_keep', {
    // Bailey + tower, two rect bodies. The old single `stepped` body (levels 4 × inset 1
    // on 3×3) degenerated to a pancake slab + cube — too featureless for the img2img
    // model to read as a keep. The tower sits NW so it rises behind the bailey in iso.
    category: 'military', era: 'medieval', footprint: { w: 3, h: 3 },
    materials: { walls: 'stone', roof: 'slate', ground: 'gravel' },
    parts: {
      bailey: {
        type: 'body', at: { x: 0, y: 0 }, size: { w: 3, h: 3 },
        params: { plan: 'rect', levels: 1, storeyM: 3.0, roof: 'flat' },
        features: {
          door: { type: 'door', face: 'south', params: { main: true } },
          slit1: { type: 'window', face: 'south', params: { t: 0.25, width: 0.05, height: 0.3, sill: 0.8, glazed: false } },
          slit2: { type: 'window', face: 'south', params: { t: 0.75, width: 0.05, height: 0.3, sill: 0.8, glazed: false } },
        },
      },
      tower: {
        type: 'body', at: { x: 0, y: 0 }, size: { w: 2, h: 2 },
        params: { plan: 'rect', levels: 3, roof: 'flat' },
        features: {
          // windows grow with height: slits low, arched pairs high (the "safe" faces)
          slit_s: { type: 'window', face: 'south', params: { t: 0.5, width: 0.05, height: 0.3, sill: 0.9, glazed: false } },
          win_s: { type: 'window', face: 'south', params: { style: 'arched', sill: 1.8 } },
          win_e: { type: 'window', face: 'east', params: { style: 'arched', sill: 1.8 } },
          win_s2: { type: 'window', face: 'south', params: { style: 'arched', t: 0.35, sill: 3.2 } },
          win_e2: { type: 'window', face: 'east', params: { style: 'arched', t: 0.65, sill: 3.2 } },
          smoke: { type: 'vent', params: { kind: 'chimney', t: 0.3, width: 0.24, height: 0.3 } },
        },
      },
    },
  }),
  dock: bp('dock', {
    category: 'special', era: 'medieval', footprint: { w: 2, h: 3 },
    materials: { walls: 'timber', roof: 'wood', ground: 'wood' },
    parts: { body: { type: 'body', size: { w: 2, h: 3 }, params: { plan: 'rect', levels: 1, storeyM: 0.5, roof: 'flat' }, features: { door: { type: 'door', face: 'north' } } } },
  }),
  // Wayside shrine: a gabled stone cell with a derived arched window on each flank.
  shrine: bp('shrine', {
    category: 'religious', era: 'classical', footprint: { w: 2, h: 2 },
    materials: { walls: 'stone', roof: 'tile', ground: 'flagstone' },
    parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'gable' }, tags: [GEN_OPENINGS_TAG] } },
  }),
  // Guard post: a small hip-roofed timber cell; door + shuttered window derived.
  guard_post: bp('guard_post', {
    category: 'military', era: 'medieval', footprint: { w: 2, h: 2 },
    materials: { walls: 'timber', roof: 'wood' },
    parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, storeyM: 3.2, roof: 'hip' }, tags: [GEN_OPENINGS_TAG] } },
  }),
  // Watermill: a working civic building beside the stream (S6). 2×2 to match the
  // CIVIC_RULES.mill reservation; timber over a stone base, a tall cart door, a
  // wall vent reading as the wheel-housing gap. No upper storey — the wheel, not
  // height, is the silhouette (the wheel itself awaits the separable-parts slice).
  watermill: bp('watermill', {
    category: 'craft', era: 'medieval', footprint: { w: 2, h: 2 },
    materials: { walls: 'timber', roof: 'wood', ground: 'flagstone' },
    parts: { body: {
      // Door + windows DERIVED (gen-openings); the wheel-housing gap on the stream side
      // stays a hand-authored override — the hybrid: generative base + a custom detail.
      type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, storeyM: 3.2, roof: 'gable' },
      tags: [GEN_OPENINGS_TAG],
      features: {
        vent_w: { type: 'window', face: 'west', params: { t: 0.5, width: 0.1, height: 0.5, sill: 0.4, glazed: false } },
      },
    } },
  }),
  // Civic props (NOT buildings — class:'prop'). The same generate→sprite pipeline:
  // a stone well on the green, a graveyard on the settlement rim (sacred).
  well: prop('well', {
    category: 'civic', era: 'medieval', footprint: { w: 1, h: 1 },
    materials: { walls: 'stone', roof: 'tile', ground: 'flagstone' },
    parts: { well: { type: 'well', size: { w: 1, h: 1 }, params: {} } },
  }),
  graveyard: prop('graveyard', {
    category: 'religious', era: 'medieval', footprint: { w: 2, h: 2 },
    materials: { walls: 'stone', roof: 'tile', ground: 'dirt' },
    parts: { yard: { type: 'graveyard', size: { w: 2, h: 2 }, params: { stones: 5 } } },
  }),
  // E3 Threshold (Law 1): a stone holy-water STOUP — the cleansing fixture at a sacred
  // precinct's border, co-placed at temples/shrines via the site `cleansing` token. Composed
  // from raw prims (a stone pedestal + a shallow bored basin) — no new part renderer.
  stoup: prop('stoup', {
    category: 'religious', era: 'medieval', footprint: { w: 1, h: 1 },
    materials: { walls: 'stone', roof: 'tile', ground: 'flagstone' },
    parts: {
      pedestal: { type: 'prim', size: { w: 1, h: 1 }, params: {
        prim: { prim: 'cylinder', center: [0.5, 0.5], baseZ: 0, radius: 0.16, height: 0.52, material: 'stone' } } },
      basin: { type: 'prim', size: { w: 1, h: 1 }, params: {
        prim: { prim: 'ellipsoid', center: [0.5, 0.5], baseZ: 0.52, radii: [0.3, 0.3, 0.16], material: 'stone',
          bore: { radius: 0.2, depth: 0.13 } } } },
    },
  }),
  // A canvas bell tent (prop) — the seed of the tent family; pairs with market stalls
  // for fairs/encampments. Open-frame `tent` part, no catalogue buildingType needed.
  bell_tent: prop('bell_tent', {
    category: 'commercial', era: 'medieval', footprint: { w: 2, h: 2 },
    materials: { walls: 'hide', roof: 'hide', ground: 'dirt' },
    parts: { canvas: { type: 'tent', size: { w: 2, h: 2 }, params: { heightM: 2.8 } } },
  }),
  // Branching L-system flora (class:'plant'). Hand-authored presets; worldgen prefers
  // the botanically-derived flora-DB species (english-oak, scots-pine, …).
  oak_branched: branched('oak_branched', 'oak', 15, 0.20),
  pine_branched: branched('pine_branched', 'pine', 18, 0.16),
  willow_tree: branched('willow_tree', 'willow', 13, 0.18),
  shrub_bush: branched('shrub_bush', 'shrub', 2.2, 0.06),
  bracken_fern: branched('bracken_fern', 'fern', 1.1, 0.03),
  wildflower: branched('wildflower', 'flower', 0.6, 0.02),
  boulder: rock('boulder', 2.5),
  rock_small: rock('rock_small', 1.0),
  // Stairs — "all kinds, the same way we support all kinds of buildings." One part type,
  // swept by construction (rough scramble → cut stone → dressed) and material. Switchbacks
  // compose extra flights + a `landing` part in the same blueprint (see crossing/path siting).
  stair_scramble: stair('stair_scramble', { material: 'stone', riseM: 1.6, widthM: 1.2, construction: 0.0 }),
  stair_wood:     stair('stair_wood',     { material: 'timber', riseM: 2.0, widthM: 1.6, construction: 0.5, railing: 'both' }),
  stair_stone:    stair('stair_stone',    { material: 'stone', riseM: 2.4, widthM: 2.0, construction: 0.6, railing: 'one' }),
  stair_grand:    stair('stair_grand',    { material: 'stone', riseM: 3.2, widthM: 5.0, construction: 1.0, railing: 'both' }),
  // Defensive lines — "all kinds, the same way we support all kinds of buildings." ONE part
  // type swept across the medieval enclosure spectrum (Wikipedia-grounded, see
  // catalogue/packs/medieval-europe/barrier-types.ts): a crenellated town wall + a tall
  // curtain (battered plinth, wall-walk, merlons + crenel gate), a timber palisade on its
  // earthen bank, a drystone field wall, a paling fence, a living hedgerow, an earth rampart.
  town_wall:     barrier('town_wall',     { kind: 'wall', material: 'stone', crenellated: true, thicknessTiles: 2, heightM: 6, lengthM: 26, gateWidthM: 3.5 }),
  curtain_wall:  barrier('curtain_wall',  { kind: 'wall', material: 'stone', crenellated: true, thicknessTiles: 2, heightM: 8, lengthM: 24, gateWidthM: 3.5 }),
  palisade:      barrier('palisade',      { kind: 'palisade', material: 'timber', posts: true, heightM: 3, lengthM: 22, gateWidthM: 3 }),
  drystone_wall: barrier('drystone_wall', { kind: 'wall', material: 'stone', crenellated: false, thicknessTiles: 1, heightM: 1.3, lengthM: 20 }),
  paling_fence:  barrier('paling_fence',  { kind: 'fence', material: 'timber', posts: true, heightM: 1.1, lengthM: 18 }),
  hedgerow:      barrier('hedgerow',      { kind: 'hedge', material: 'hedge', heightM: 1.6, lengthM: 20 }),
  earth_rampart: barrier('earth_rampart', { kind: 'rampart', material: 'earth', thicknessTiles: 2, heightM: 2.6, lengthM: 22 }),
  yurt: bp('yurt', {
    category: 'residential', era: 'primordial', footprint: { w: 3, h: 3 },
    materials: { walls: 'hide', roof: 'hide', ground: 'dirt' },
    parts: { body: { type: 'body', size: { w: 3, h: 3 }, params: { plan: 'round', levels: 1, roof: 'domed' }, features: { door: { type: 'door', face: 'south' } /* smoke vent DERIVED from hearth (resolveAsset connectome) */ } } },
  }),
  // Manor hall house (S2): the lord's seat and the village's secular focus — a long,
  // tall stone GREAT HALL range (open to the roof) with a two-storey jettied CROSS-WING
  // at the upper end (the solar/private chambers). The hall's openings are DERIVED
  // (gen-openings: a door + ranked hall windows down the flanks); the wing carries its
  // own chamber windows. A rich stone hall takes a real wall-fireplace CHIMNEY (authored,
  // not the commoner ridge-louvre the connectome would derive for an un-waged build).
  // The grander cousin of cottage/longhouse; matches the primed `manor` buildingType.
  manor: bp('manor', {
    category: 'residential', era: 'medieval', footprint: { w: 5, h: 3 },
    materials: { walls: 'stone', roof: 'tile', ground: 'flagstone' },
    parts: {
      hall: {
        type: 'body', at: { x: 0, y: 0 }, size: { w: 5, h: 3 },
        params: { plan: 'rect', levels: 1, storeyM: 5.5, roof: 'gable' },
        tags: [GEN_OPENINGS_TAG],
        features: { smoke: { type: 'vent', params: { kind: 'chimney', t: 0.45 } } },
      },
      // Two-storey jettied cross-wing at the upper (east) end — overlaps the hall's end
      // bays and rises above its ridge (the castle_keep bailey+tower trick).
      crosswing: {
        type: 'body', at: { x: 3, y: 0 }, size: { w: 2, h: 3 },
        params: { plan: 'rect', levels: 2, roof: 'gable', jetty: 0.12 },
        features: {
          win_s: { type: 'window', face: 'south', params: { style: 'shuttered', t: 0.5, perStorey: true } },
          win_e: { type: 'window', face: 'east', params: { style: 'shuttered', t: 0.5, perStorey: true } },
        },
      },
    },
  }),
  // Parish church (S2): the village's SACRED focus. A tall gabled stone NAVE lit by
  // arched windows ranked down its flanks (church-axial gen-openings keeps the entrance
  // front clear), with a square WEST TOWER carrying a broach spire that rises clear above
  // the ridge. No hearth, no smoke. Distinct from temple_small (a single classical cella)
  // and shrine (a single cell); matches the primed `parish-church` buildingType.
  'parish-church': bp('parish-church', {
    category: 'religious', era: 'medieval', footprint: { w: 3, h: 6 },
    materials: { walls: 'stone', roof: 'slate', ground: 'flagstone' },
    parts: {
      nave: {
        type: 'body', at: { x: 0, y: 2 }, size: { w: 3, h: 4 },
        params: { plan: 'rect', levels: 1, storeyM: 6.0, roof: 'gable' },
        tags: [GEN_OPENINGS_TAG],
      },
      // West tower + tall broach spire (the `tower` structural part's first real consumer).
      tower: {
        type: 'tower', at: { x: 0, y: 0 }, size: { w: 2, h: 2 },
        params: { levels: 5, shape: 'square', roof: 'pyramidal', spire: 4 },
      },
    },
  }),
  // Longhouse: half-hip (gablet) thatch — THE longhouse roof; opposed cross-passage
  // doors at ⅓ length; windows only on the humans' end, byre end blind; louvre over
  // the hearth bay.
  longhouse: bp('longhouse', {
    category: 'residential', era: 'medieval', footprint: { w: 4, h: 2 },
    materials: { walls: 'log', roof: 'thatch', ground: 'packed_dirt' },
    parts: { body: {
      type: 'body', size: { w: 4, h: 2 }, params: { plan: 'rect', levels: 1, storeyM: 3.2, roof: 'half_hip' },
      features: {
        door: { type: 'door', face: 'south', params: { main: true, t: 0.33 } },
        door_n: { type: 'door', face: 'north', params: { t: 0.33 } },
        win_s: { type: 'window', face: 'south', params: { style: 'shuttered', t: 0.62, glazed: false } },
        win_s2: { type: 'window', face: 'south', params: { style: 'shuttered', t: 0.85, glazed: false } },
        smoke: { type: 'vent', params: { kind: 'smokehole', t: 0.33 } },
      },
    } },
  }),
  // Stable: a low timber byre range — the auxiliary an establishment's site graph
  // (connectome/site.ts) derives for a 'stabling' requirement (a tavern's yard).
  // A single open range: wide stall door, no glazing, no hearth/smoke (animals,
  // not people). Openings DERIVED from the agrarian room graph (gen-openings).
  stable: bp('stable', {
    category: 'farm', era: 'medieval', footprint: { w: 3, h: 2 },
    materials: { walls: 'timber', roof: 'thatch', ground: 'dirt' },
    parts: { body: {
      type: 'body', size: { w: 3, h: 2 }, params: { plan: 'rect', levels: 1, storeyM: 2.8, roof: 'gable' },
      features: {
        door: { type: 'door', face: 'south', params: { main: true, t: 0.5, width: 0.45, height: 1.4 } },
        slit_e: { type: 'window', face: 'east', params: { t: 0.5, width: 0.05, height: 0.3, sill: 1.1, glazed: false } },
      },
    } },
  }),
};

export function getBlueprintPreset(name: string): Blueprint | undefined { return BUILDING_BLUEPRINTS[name]; }

/** True if `name` is a tree/plant preset (class:'plant') — the render layer uses this
 *  to route a vegetation entity to the generative species-keyed sprite vs the billboard. */
export function isPlantPreset(name: string): boolean {
  return BUILDING_BLUEPRINTS[name]?.class === 'plant' || floraPlantIds().has(name);
}

/** Every plant/species preset name. The renderer pre-warms all of these at load so
 *  trees never flash a placeholder mid-game. Includes both the hand-authored plant
 *  presets and the flora-DB species (the canonical, generative set). */
export function plantPresetNames(): string[] {
  const hand = Object.keys(BUILDING_BLUEPRINTS).filter((n) => BUILDING_BLUEPRINTS[n].class === 'plant');
  return [...hand, ...floraPlantIds()];
}

/** Lazily-built set of flora-DB species ids whose growth form is a plant (not rock) —
 *  these resolve to a branched Blueprint via {@link floraSpeciesBlueprint}. Memoised:
 *  the species DB is static, and the render seam queries this per vegetation entity. */
let _floraPlantIds: Set<string> | null = null;
function floraPlantIds(): Set<string> {
  if (!_floraPlantIds) {
    _floraPlantIds = new Set(
      allFloraSpecies().filter((s) => deriveGenParams(s).kind === 'plant').map((s) => s.id),
    );
  }
  return _floraPlantIds;
}

/** Bridge a flora-DB species id (e.g. 'english-oak') to a plant/rock Blueprint via its
 *  derived generation params, so the species DB feeds the SAME parametric pipeline as the
 *  hand-authored `*_branched` presets. Returns undefined for non-species names. */
function floraSpeciesBlueprint(name: string): Blueprint | undefined {
  const sp = getFloraSpecies(name);
  if (!sp) return undefined;
  const g = deriveGenParams(sp);
  return g.kind === 'rock'
    ? rock(name, g.sizeM ?? g.heightM)
    : branched(name, g.recipe ?? 'shrub', g.heightM, g.trunkR, g.generator, g.crownShape);
}

/** Resolve `name` (+ optional override patches) into a ResolvedBlueprint. Seed from name.
 *  Buildings derive their hearth→smoke vent from the latent connectome (so the runtime
 *  placement path — building-placer → synthesizeBlueprint — gets the same period-correct
 *  louver/chimney as resolveAsset; the derived vent patch is applied LAST). */
export function synthesizeBlueprint(name: string, patches: BlueprintPatch[] = [], seed?: number): ResolvedBlueprint | undefined {
  ensureBuildingTypesRegistered();
  const s = seed ?? [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  // Resolution order: a PINNED hand preset → a flora species → the GENERATIVE catalogue
  // bridge (a buildingType programme with no preset, expressed via the layered fold).
  const base = BUILDING_BLUEPRINTS[name] ?? floraSpeciesBlueprint(name) ?? blueprintFromBuildingType(name, s);
  if (!base) return undefined;
  let connectome: Connectome | undefined;
  let pre: BlueprintPatch[] = [];  // derived DEFAULTS, before the caller's override patches
  let post: BlueprintPatch[] = []; // derived projections + frame cap, after the overrides
  if (base.class === 'building') {
    const e = expressBuilding(base, name, base.era, undefined, s);
    connectome = e.connectome;
    pre = e.pre;
    post = e.post;
  }
  const rb = resolveBlueprint([base, ...pre, ...patches, ...post], s);
  if (connectome) attachConnectome(rb, connectome);
  return rb;
}

/** A typed request for a concrete asset variant — the agent/worldgen-facing entry.
 *  Layers base preset → era → descriptors → lifecycle stage → AGENT customisation
 *  (notes/palette/material overrides) → seeded resolve. Any customisation rides on the
 *  resolved blueprint (its cache identity), so a custom variant gets its own cached/
 *  seeded sprite and becomes part of the default library. See the asset-catalogue doc. */
export interface AssetRequest {
  type: string;
  era?: Era;
  descriptors?: Descriptors;
  stage?: string;            // lifecycle stage (Slice D/E); ignored for now
  /** Free-text art direction folded into the image prompt (e.g. "a fisherman's cottage,
   *  salt-bleached blue door"). Persists on the blueprint → part of the asset identity. */
  notes?: string;
  /** Preferred final colours (walls/roof/trim hex) the painter should aim for. */
  palette?: Palette;
  /** Per-role material overrides (e.g. { roof: 'slate' }) — restyle without a new preset. */
  materials?: Record<string, string>;
  seed?: number;
}

const strHash = (s: string): number => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Attach the latent room-graph WITHOUT entering the art-cache key. canonicalJson(rb)
 *  walks enumerable keys only, so a non-enumerable field is invisible to it (the vent's
 *  exterior effect already rides in rb.parts). */
function attachConnectome(rb: ResolvedBlueprint, connectome: Connectome): void {
  Object.defineProperty(rb, 'connectome', { value: connectome, enumerable: false, writable: true, configurable: true });
}

/** Resolve an AssetRequest into a concrete ResolvedBlueprint. The descriptor layer
 *  biases materials/glazing/storeys; the resolved blueprint records the descriptors
 *  so its art-cache key distinguishes this variant. The building's latent connectome
 *  is expanded and its smoke vent derived from the hearth (attached non-enumerably). */
export function resolveAsset(req: AssetRequest): ResolvedBlueprint | undefined {
  ensureBuildingTypesRegistered();
  // Mirror synthesizeBlueprint's resolution: a PINNED hand preset → flora species → the
  // GENERATIVE catalogue bridge (a buildingType with no preset, e.g. the retired temple_small,
  // expressed via the fold). The generative shell is seeded with the SAME name-derived seed
  // synthesizeBlueprint uses (strHash === its reduce), so a bare request stays byte-identical
  // to synthesizeBlueprint(type) and keeps the same art-cache key.
  const base = BUILDING_BLUEPRINTS[req.type]
    ?? floraSpeciesBlueprint(req.type)
    ?? blueprintFromBuildingType(req.type, strHash(req.type));
  if (!base) return undefined;
  const patches: BlueprintPatch[] = [base];
  // Era restyles the type for the period (materials + window/vent palette).
  const eraVariant = !!(req.era && req.era !== base.era);
  if (eraVariant) patches.push(eraPatch(base, req.era!));
  const descVariant = !!(req.descriptors && Object.keys(req.descriptors).length);
  if (descVariant) patches.push(descriptorPatch(base, req.descriptors!));
  // Lifecycle stage restyles the asset for its point on its own timeline (a sapling,
  // a ruin). The canonical stage (mature/complete) is a no-op — same key as stageless.
  const stageVariant = !!(req.stage && req.stage !== defaultStageFor(base.class));
  if (stageVariant) patches.push(stagePatch(base, req.stage!));
  // Agent customisation: free-text art direction, preferred colours, material overrides.
  // Folded as a patch so it lands on the resolved blueprint (→ the image prompt + the
  // art-cache identity); a customised variant is therefore a distinct library asset.
  const customVariant = !!(req.notes || (req.palette && Object.keys(req.palette).length) ||
    (req.materials && Object.keys(req.materials).length));
  if (customVariant) {
    patches.push({
      ...(req.notes ? { notes: req.notes } : {}),
      ...(req.palette ? { palette: req.palette } : {}),
      ...(req.materials ? { materials: req.materials } : {}),
    });
  }
  // A bare request (no variant axes) MUST seed identically to synthesizeBlueprint(type)
  // so its art-cache key matches the seeded library; only a real variant re-seeds.
  const seed = req.seed ?? ((eraVariant || descVariant || stageVariant || customVariant)
    ? strHash(`${req.type}|${req.era ?? ''}|${JSON.stringify(req.descriptors ?? {})}|${req.stage ?? ''}` +
      `|${req.notes ?? ''}|${JSON.stringify(req.palette ?? {})}|${JSON.stringify(req.materials ?? {})}`)
    : strHash(req.type));

  // Connectome (Slice 1): derive the hearth→smoke vent, applied LAST so the derived
  // egress is authoritative (it already accounts for era + wealth). Buildings only.
  let connectome: Connectome | undefined;
  if (base.class === 'building') {
    const e = expressBuilding(base, req.type, req.era, req.descriptors?.wealth, seed);
    connectome = e.connectome;
    // Form (pre) is the derived massing DEFAULT — it must sit BEFORE the era/descriptor/
    // custom overrides (an opulent +storey wins), so splice it right after the base; the
    // projections + frame cap (post) go LAST (the hard limit nothing may exceed).
    if (e.pre.length) patches.splice(1, 0, ...e.pre);
    patches.push(...e.post);
  }

  const rb = resolveBlueprint(patches, seed);
  if (connectome) attachConnectome(rb, connectome);
  return rb;
}
