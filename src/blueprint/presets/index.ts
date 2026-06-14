// src/blueprint/presets/index.ts
// The 11 building presets, re-expressed as Blueprints. Mechanical port of the
// old BUILDING_PRESETS descriptors (the retired flat descriptor model).
import { BLUEPRINT_VERSION, type Blueprint, type BlueprintPatch, type ResolvedBlueprint, type Descriptors, type Era } from '../types';
import { resolveBlueprint } from '../resolve';
import { descriptorPatch } from '../descriptors';
import { eraPatch } from '../eras';
import { stagePatch, defaultStageFor } from '../lifecycle';
import { ensureBuildingTypesRegistered } from '../register-buildings';

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
const tree = (preset: string, form: string, heightM: number, crownM: number, trunkR = 0.16): Blueprint => ({
  version: BLUEPRINT_VERSION, class: 'plant', preset,
  category: 'flora', footprint: { w: 1, h: 1 },
  materials: { walls: 'timber', roof: 'thatch', ground: 'grass' },
  parts: { trunk: { type: 'tree', size: { w: 1, h: 1 }, params: { form, heightM, crownM, trunkR } } },
});

export const BUILDING_BLUEPRINTS: Record<string, Blueprint> = {
  // Peasant cottage: rectangular plan (1:1.5), door + one shuttered window on the
  // entry face, one on the gable, ridge smoke LOUVRE (no chimney — period default
  // for commoners; see docs/reference/medieval-building-reference.md).
  cottage: bp('cottage', {
    category: 'residential', era: 'medieval', footprint: { w: 3, h: 3 },
    materials: { walls: 'wattle', roof: 'thatch', ground: 'packed_dirt' },
    parts: { body: {
      type: 'body', at: { x: 0, y: 0 }, size: { w: 3, h: 2 },
      params: { plan: 'rect', levels: 1, levelInset: 0, roof: 'gable' },
      features: {
        door: { type: 'door', face: 'south', params: { main: true, t: 0.35 } },
        win_s: { type: 'window', face: 'south', params: { style: 'shuttered', t: 0.72, glazed: false } },
        win_e: { type: 'window', face: 'east', params: { style: 'shuttered', t: 0.5, glazed: false } },
        smoke: { type: 'vent', params: { kind: 'smokehole', t: 0.4 } },
      },
    } },
  }),
  // Inn: a cooking building — TWO ridge stacks, jettied upper storey, two dormers,
  // windows denser upstairs than down (tavern read: more glass than a house).
  tavern: bp('tavern', {
    category: 'commercial', era: 'medieval', footprint: { w: 3, h: 3 },
    materials: { walls: 'timber', roof: 'tile', ground: 'packed_dirt' },
    parts: { body: {
      type: 'body', size: { w: 3, h: 2 }, params: { plan: 'rect', levels: 2, roof: 'gable', jetty: 0.12 },
      features: {
        door: { type: 'door', face: 'south', params: { main: true, t: 0.5 } },
        smoke: { type: 'vent', params: { kind: 'chimney', t: 0.12 } },
        smoke2: { type: 'vent', params: { kind: 'chimney', t: 0.88 } },
        win_s: { type: 'window', face: 'south', params: { style: 'shuttered', t: 0.16 } },
        win_s2: { type: 'window', face: 'south', params: { style: 'shuttered', t: 0.84 } },
        win_u1: { type: 'window', face: 'south', params: { style: 'shuttered', t: 0.25, sill: 1.8 } },
        win_u2: { type: 'window', face: 'south', params: { style: 'shuttered', t: 0.5, sill: 1.8 } },
        win_u3: { type: 'window', face: 'south', params: { style: 'shuttered', t: 0.75, sill: 1.8 } },
        win_e: { type: 'window', face: 'east', params: { style: 'shuttered', t: 0.4 } },
        win_e2: { type: 'window', face: 'east', params: { style: 'shuttered', t: 0.6, sill: 1.8 } },
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
      type: 'body', size: { w: 3, h: 2 },
      params: { plan: 'rect', levels: 2, roof: 'gable', jetty: 0.12 },
      features: {
        door: { type: 'door', face: 'south', params: { main: true, t: 0.3 } },
        win_s: { type: 'window', face: 'south', params: { style: 'shuttered', t: 0.7 } },
        win_u1: { type: 'window', face: 'south', params: { style: 'shuttered', t: 0.3, sill: 1.8 } },
        win_u2: { type: 'window', face: 'south', params: { style: 'shuttered', t: 0.7, sill: 1.8 } },
        win_e: { type: 'window', face: 'east', params: { style: 'shuttered', t: 0.5, sill: 1.8 } },
        smoke: { type: 'vent', params: { kind: 'chimney', t: 0.85 } },
      },
    } },
  }),
  market_stall: bp('market_stall', {
    category: 'commercial', era: 'medieval', footprint: { w: 2, h: 2 },
    materials: { walls: 'timber', roof: 'thatch' },
    parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'lean_to' }, features: { door: { type: 'door', face: 'south' } } } },
  }),
  // Temple: tall arched windows along the nave, NO smoke (churches have none).
  temple_small: bp('temple_small', {
    category: 'religious', era: 'classical', footprint: { w: 3, h: 3 },
    materials: { walls: 'stone', roof: 'tile', ground: 'flagstone' },
    parts: { body: {
      type: 'body', size: { w: 3, h: 3 }, params: { plan: 'cross', levels: 1, storeyM: 4, roof: 'hip' },
      features: {
        door: { type: 'door', face: 'south', params: { main: true } },
        win_s: { type: 'window', face: 'south', params: { style: 'arched', t: 0.25, sill: 0.6, height: 0.9 } },
        win_s2: { type: 'window', face: 'south', params: { style: 'arched', t: 0.75, sill: 0.6, height: 0.9 } },
        win_e: { type: 'window', face: 'east', params: { style: 'arched', t: 0.5, sill: 0.6, height: 0.9 } },
      },
    } },
  }),
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
  shrine: bp('shrine', {
    category: 'religious', era: 'classical', footprint: { w: 2, h: 2 },
    materials: { walls: 'stone', roof: 'tile', ground: 'flagstone' },
    parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'gable' }, features: {
      door: { type: 'door', face: 'south' },
      win_e: { type: 'window', face: 'east', params: { style: 'arched', t: 0.5, sill: 0.6 } },
    } } },
  }),
  guard_post: bp('guard_post', {
    category: 'military', era: 'medieval', footprint: { w: 2, h: 2 },
    materials: { walls: 'timber', roof: 'wood' },
    parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, storeyM: 3.2, roof: 'hip' }, features: {
      door: { type: 'door', face: 'south', params: { t: 0.65 } },
      win_s: { type: 'window', face: 'south', params: { style: 'shuttered', t: 0.4, glazed: false } },
    } } },
  }),
  // Watermill: a working civic building beside the stream (S6). 2×2 to match the
  // CIVIC_RULES.mill reservation; timber over a stone base, a tall cart door, a
  // wall vent reading as the wheel-housing gap. No upper storey — the wheel, not
  // height, is the silhouette (the wheel itself awaits the separable-parts slice).
  watermill: bp('watermill', {
    category: 'craft', era: 'medieval', footprint: { w: 2, h: 2 },
    materials: { walls: 'timber', roof: 'wood', ground: 'flagstone' },
    parts: { body: {
      type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, storeyM: 3.2, roof: 'gable' },
      features: {
        door: { type: 'door', face: 'south', params: { main: true, t: 0.5, height: 1.3 } },
        win_e: { type: 'window', face: 'east', params: { style: 'shuttered', t: 0.5, glazed: false } },
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
  // Trees (class:'plant'). Heights match NATURE_HEIGHT_M; render keys one sprite/species.
  oak_tree: tree('oak_tree', 'broad', 15, 8, 0.20),
  pine_tree: tree('pine_tree', 'conifer', 18, 5, 0.16),
  birch_tree: tree('birch_tree', 'slender', 12, 3.5, 0.11),
  dead_tree: tree('dead_tree', 'bare', 8, 4, 0.13),
  orange_tree: tree('orange_tree', 'broad', 6, 4, 0.13),
  pale_tree: tree('pale_tree', 'broad', 10, 5.5, 0.15),
  brown_tree: tree('brown_tree', 'broad', 11, 6, 0.16),
  yurt: bp('yurt', {
    category: 'residential', era: 'primordial', footprint: { w: 3, h: 3 },
    materials: { walls: 'hide', roof: 'hide', ground: 'dirt' },
    parts: { body: { type: 'body', size: { w: 3, h: 3 }, params: { plan: 'round', levels: 1, roof: 'domed' }, features: { door: { type: 'door', face: 'south' }, smoke: { type: 'vent', params: { kind: 'smokehole' } } } } },
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
};

export function getBlueprintPreset(name: string): Blueprint | undefined { return BUILDING_BLUEPRINTS[name]; }

/** True if `name` is a tree/plant preset (class:'plant') — the render layer uses this
 *  to route a vegetation entity to the generative species-keyed sprite vs the billboard. */
export function isPlantPreset(name: string): boolean { return BUILDING_BLUEPRINTS[name]?.class === 'plant'; }

/** Resolve `name` (+ optional override patches) into a ResolvedBlueprint. Seed from name. */
export function synthesizeBlueprint(name: string, patches: BlueprintPatch[] = [], seed?: number): ResolvedBlueprint | undefined {
  ensureBuildingTypesRegistered();
  const base = BUILDING_BLUEPRINTS[name];
  if (!base) return undefined;
  const s = seed ?? [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return resolveBlueprint([base, ...patches], s);
}

/** A typed request for a concrete asset variant — the agent/worldgen-facing entry.
 *  Layers base preset → era → descriptors → lifecycle stage (era/stage land in
 *  later slices) → seeded resolve. See the asset-catalogue design doc. */
export interface AssetRequest {
  type: string;
  era?: Era;
  descriptors?: Descriptors;
  stage?: string;            // lifecycle stage (Slice D/E); ignored for now
  seed?: number;
}

const strHash = (s: string): number => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Resolve an AssetRequest into a concrete ResolvedBlueprint. The descriptor layer
 *  biases materials/glazing/storeys; the resolved blueprint records the descriptors
 *  so its art-cache key distinguishes this variant. */
export function resolveAsset(req: AssetRequest): ResolvedBlueprint | undefined {
  ensureBuildingTypesRegistered();
  const base = BUILDING_BLUEPRINTS[req.type];
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
  // A bare request (no variant axes) MUST seed identically to synthesizeBlueprint(type)
  // so its art-cache key matches the seeded library; only a real variant re-seeds.
  const seed = req.seed ?? ((eraVariant || descVariant || stageVariant)
    ? strHash(`${req.type}|${req.era ?? ''}|${JSON.stringify(req.descriptors ?? {})}|${req.stage ?? ''}`)
    : strHash(req.type));
  return resolveBlueprint(patches, seed);
}
