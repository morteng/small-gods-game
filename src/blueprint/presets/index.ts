// src/blueprint/presets/index.ts
// The 11 building presets, re-expressed as Blueprints. Mechanical port of the
// old BUILDING_PRESETS descriptors (the retired flat descriptor model).
import { BLUEPRINT_VERSION, type Blueprint, type BlueprintPatch, type ResolvedBlueprint, type Descriptors, type Era, type Palette } from '../types';
import { resolveBlueprint } from '../resolve';
import { descriptorPatch } from '../descriptors';
import { eraPatch } from '../eras';
import { stagePatch, defaultStageFor } from '../lifecycle';
import { ensureBuildingTypesRegistered } from '../register-buildings';
import { catalogue } from '@/catalogue/pack';
import { loadDefaultPacks } from '@/catalogue/default-packs';
import { expand } from '../connectome/grammar';
import { deriveSmokeEgress } from '../connectome/smoke';
import { connectomeToBlueprint } from '../connectome/to-blueprint';
import { connectomeOpenings, GEN_OPENINGS_TAG } from '../connectome/openings';
import type { Connectome, ExpandCtx } from '../connectome/types';

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

/** Branching L-system plant (class:'plant') — real limbs/foliage vs the blob `tree`.
 *  `recipe` selects the L-system; the blueprint seed fixes the (stochastic) shape so
 *  every instance of a species shares one cached sprite. See flora-branch.ts. */
const branched = (preset: string, recipe: string, heightM: number, trunkR = 0.16): Blueprint => ({
  version: BLUEPRINT_VERSION, class: 'plant', preset,
  category: 'flora', footprint: { w: 1, h: 1 },
  materials: { walls: 'timber', roof: 'thatch', ground: 'grass' },
  parts: { trunk: { type: 'branch_plant', size: { w: 1, h: 1 }, params: { recipe, heightM, trunkR } } },
});

/** A boulder/rock (class:'terrain_feature'); `sizeM` = diameter in metres. */
const rock = (preset: string, sizeM: number): Blueprint => ({
  version: BLUEPRINT_VERSION, class: 'terrain_feature', preset,
  category: 'flora', footprint: { w: 1, h: 1 },
  materials: { walls: 'stone', roof: 'stone', ground: 'dirt' },
  parts: { mass: { type: 'rock', size: { w: 1, h: 1 }, params: { sizeM } } },
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
      // Openings + smoke vent are DERIVED from the room graph (gen-openings + the
      // hearth) — a south door and shuttered, unglazed windows for an early-medieval
      // commoner, smoke through a ridge louver. See connectome/openings.ts + smoke.ts.
      tags: [GEN_OPENINGS_TAG],
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
      type: 'body', size: { w: 3, h: 2 },
      params: { plan: 'rect', levels: 2, roof: 'gable', jetty: 0.12 },
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
  // Temple: a classical rectangular cella (naos) — axial and bilaterally symmetric, NOT
  // cruciform (cross/L plans are vernacular, not sacred; a small temple is a single tall
  // hall). Deeper than wide so the gable roof throws a PEDIMENT over the entrance front;
  // tall arched windows ranked symmetrically down the long flanks. NO smoke (no hearth).
  temple_small: bp('temple_small', {
    category: 'religious', era: 'classical', footprint: { w: 3, h: 4 },
    materials: { walls: 'stone', roof: 'tile', ground: 'flagstone' },
    parts: { body: {
      // A classical rectangular cella (naos): deep gable throws a pediment over the
      // entrance front, tall arched windows rank symmetrically down the long flanks —
      // all DERIVED from the church-axial room graph (worship zones ⇒ bilateral flank
      // glazing, the front kept clear for the pediment). See connectome/openings.ts.
      type: 'body', size: { w: 3, h: 4 }, params: { plan: 'rect', levels: 1, storeyM: 4.5, roof: 'gable' },
      tags: [GEN_OPENINGS_TAG],
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
  // A canvas bell tent (prop) — the seed of the tent family; pairs with market stalls
  // for fairs/encampments. Open-frame `tent` part, no catalogue buildingType needed.
  bell_tent: prop('bell_tent', {
    category: 'commercial', era: 'medieval', footprint: { w: 2, h: 2 },
    materials: { walls: 'hide', roof: 'hide', ground: 'dirt' },
    parts: { canvas: { type: 'tent', size: { w: 2, h: 2 }, params: { heightM: 2.8 } } },
  }),
  // Trees (class:'plant'). Heights match NATURE_HEIGHT_M; render keys one sprite/species.
  oak_tree: tree('oak_tree', 'broad', 15, 8, 0.20),
  pine_tree: tree('pine_tree', 'conifer', 18, 5, 0.16),
  birch_tree: tree('birch_tree', 'slender', 12, 3.5, 0.11),
  dead_tree: tree('dead_tree', 'bare', 8, 4, 0.13),
  orange_tree: tree('orange_tree', 'broad', 6, 4, 0.13),
  pale_tree: tree('pale_tree', 'broad', 10, 5.5, 0.15),
  brown_tree: tree('brown_tree', 'broad', 11, 6, 0.16),
  // Branching L-system flora (richer than the blob trees; opt-in presets for the
  // flora-generation epic — existing kinds above keep the blob `tree` for now).
  oak_branched: branched('oak_branched', 'oak', 15, 0.20),
  pine_branched: branched('pine_branched', 'pine', 18, 0.16),
  willow_tree: branched('willow_tree', 'willow', 13, 0.18),
  shrub_bush: branched('shrub_bush', 'shrub', 2.2, 0.06),
  bracken_fern: branched('bracken_fern', 'fern', 1.1, 0.03),
  wildflower: branched('wildflower', 'flower', 0.6, 0.02),
  boulder: rock('boulder', 2.5),
  rock_small: rock('rock_small', 1.0),
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
};

export function getBlueprintPreset(name: string): Blueprint | undefined { return BUILDING_BLUEPRINTS[name]; }

/** True if `name` is a tree/plant preset (class:'plant') — the render layer uses this
 *  to route a vegetation entity to the generative species-keyed sprite vs the billboard. */
export function isPlantPreset(name: string): boolean { return BUILDING_BLUEPRINTS[name]?.class === 'plant'; }

/** Resolve `name` (+ optional override patches) into a ResolvedBlueprint. Seed from name.
 *  Buildings derive their hearth→smoke vent from the latent connectome (so the runtime
 *  placement path — building-placer → synthesizeBlueprint — gets the same period-correct
 *  louver/chimney as resolveAsset; the derived vent patch is applied LAST). */
export function synthesizeBlueprint(name: string, patches: BlueprintPatch[] = [], seed?: number): ResolvedBlueprint | undefined {
  ensureBuildingTypesRegistered();
  const base = BUILDING_BLUEPRINTS[name];
  if (!base) return undefined;
  const s = seed ?? [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const all = [base, ...patches];
  let connectome: Connectome | undefined;
  if (base.class === 'building') {
    const d = deriveConnectome(base, name, base.era, undefined, s);
    connectome = d.connectome;
    if (d.openingsPatch) all.push(d.openingsPatch);
    if (d.ventPatch) all.push(d.ventPatch);
  }
  const rb = resolveBlueprint(all, s);
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

/** True if any part of `base` already declares a hand-authored vent feature. */
function hasAuthoredVent(base: Blueprint): boolean {
  return Object.values(base.parts).some((p) =>
    Object.values(p.features ?? {}).some((f) => f.type === 'vent'),
  );
}

/**
 * Expand the building's latent connectome and derive its smoke vent from the hearth.
 * Returns the graph plus the vent patch to fold into the resolve stack. The vent is
 * only emitted when the preset DOESN'T author its own vent — so the early-medieval
 * commoner dwellings (cottage/longhouse/yurt, vents stripped) derive a period-correct
 * louver/chimney, while tavern/keep/townhouse keep their artistic stacks untouched.
 */
function deriveConnectome(
  base: Blueprint,
  type: string,
  era: Era | undefined,
  wealth: string | undefined,
  seed: number,
): { connectome: Connectome; ventPatch: BlueprintPatch | null; openingsPatch: BlueprintPatch | null } {
  loadDefaultPacks();
  const ctx: ExpandCtx = { era: era ?? base.era ?? 'medieval', wealth, seed, registry: catalogue };
  const connectome = deriveSmokeEgress(expand(type, ctx), ctx);
  const ventPatch = hasAuthoredVent(base) ? null : (() => {
    const p = connectomeToBlueprint(connectome, base);
    return Object.keys(p).length ? p : null;
  })();
  // Doors + windows derived from the graph — only for a body that opted in (tag
  // 'gen-openings'); a hand-authored preset returns {} here and keeps its features.
  const openingsPatch = (() => {
    const p = connectomeOpenings(connectome, base, ctx.era);
    return Object.keys(p).length ? p : null;
  })();
  return { connectome, ventPatch, openingsPatch };
}

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
    const d = deriveConnectome(base, req.type, req.era, req.descriptors?.wealth, seed);
    connectome = d.connectome;
    if (d.openingsPatch) patches.push(d.openingsPatch);
    if (d.ventPatch) patches.push(d.ventPatch);
  }

  const rb = resolveBlueprint(patches, seed);
  if (connectome) attachConnectome(rb, connectome);
  return rb;
}
