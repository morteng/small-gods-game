// src/blueprint/presets/index.ts
// The 11 building presets, re-expressed as Blueprints. Mechanical port of the
// old BUILDING_PRESETS descriptors (the retired flat descriptor model).
import { BLUEPRINT_VERSION, type Blueprint, type BlueprintPatch, type ResolvedBlueprint } from '../types';
import { resolveBlueprint } from '../resolve';
import { ensureBuildingTypesRegistered } from '../register-buildings';

const bp = (preset: string, b: Omit<Blueprint, 'version' | 'class' | 'preset'>): Blueprint =>
  ({ version: BLUEPRINT_VERSION, class: 'building', preset, ...b });

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
    parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'lean_to' }, features: { door: { type: 'door', face: 'west' } } } },
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
      door: { type: 'door', face: 'west' },
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
      door: { type: 'door', face: 'west' },
      win_e: { type: 'window', face: 'east', params: { style: 'arched', t: 0.5, sill: 0.6 } },
    } } },
  }),
  guard_post: bp('guard_post', {
    category: 'military', era: 'medieval', footprint: { w: 2, h: 2 },
    materials: { walls: 'timber', roof: 'wood' },
    parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, storeyM: 3.2, roof: 'hip' }, features: {
      door: { type: 'door', face: 'west' },
      win_s: { type: 'window', face: 'south', params: { style: 'shuttered', t: 0.4, glazed: false } },
    } } },
  }),
  yurt: bp('yurt', {
    category: 'residential', era: 'primordial', footprint: { w: 3, h: 3 },
    materials: { walls: 'hide', roof: 'hide', ground: 'dirt' },
    parts: { body: { type: 'body', size: { w: 3, h: 3 }, params: { plan: 'round', levels: 1, roof: 'domed' }, features: { door: { type: 'door', face: 'west' }, smoke: { type: 'vent', params: { kind: 'smokehole' } } } } },
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

/** Resolve `name` (+ optional override patches) into a ResolvedBlueprint. Seed from name. */
export function synthesizeBlueprint(name: string, patches: BlueprintPatch[] = [], seed?: number): ResolvedBlueprint | undefined {
  ensureBuildingTypesRegistered();
  const base = BUILDING_BLUEPRINTS[name];
  if (!base) return undefined;
  const s = seed ?? [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return resolveBlueprint([base, ...patches], s);
}
