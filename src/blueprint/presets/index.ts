// src/blueprint/presets/index.ts
// The 11 building presets, re-expressed as Blueprints. Mechanical port of the
// old BUILDING_PRESETS descriptors (the retired flat descriptor model).
import { BLUEPRINT_VERSION, type Blueprint, type BlueprintPatch, type ResolvedBlueprint } from '../types';
import { resolveBlueprint } from '../resolve';
import { ensureBuildingTypesRegistered } from '../register-buildings';

const bp = (preset: string, b: Omit<Blueprint, 'version' | 'class' | 'preset'>): Blueprint =>
  ({ version: BLUEPRINT_VERSION, class: 'building', preset, ...b });

export const BUILDING_BLUEPRINTS: Record<string, Blueprint> = {
  cottage: bp('cottage', {
    category: 'residential', era: 'medieval', footprint: { w: 3, h: 3 },
    materials: { walls: 'wattle', roof: 'thatch', ground: 'packed_dirt' },
    parts: { body: {
      type: 'body', at: { x: 0, y: 0 }, size: { w: 2, h: 2 },
      params: { plan: 'rect', levels: 1, levelInset: 0, roof: 'gable' },
      features: { door: { type: 'door', face: 'south', params: { main: true } }, smoke: { type: 'vent', face: 'north', params: { kind: 'chimney' } } },
    } },
  }),
  tavern: bp('tavern', {
    category: 'commercial', era: 'medieval', footprint: { w: 3, h: 3 },
    materials: { walls: 'timber', roof: 'tile', ground: 'packed_dirt' },
    parts: { body: {
      type: 'body', size: { w: 3, h: 3 }, params: { plan: 'rect', levels: 2, roof: 'hip' },
      features: {
        door: { type: 'door', face: 'south', params: { main: true } },
        smoke: { type: 'vent', params: { kind: 'chimney' } },
        win_s: { type: 'window', face: 'south', params: { style: 'shuttered', t: 0.25 } },
        win_s2: { type: 'window', face: 'south', params: { style: 'shuttered', t: 0.75, sill: 2.2 } },
      },
    } },
  }),
  market_stall: bp('market_stall', {
    category: 'commercial', era: 'medieval', footprint: { w: 2, h: 2 },
    materials: { walls: 'timber', roof: 'thatch' },
    parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'lean_to' }, features: { door: { type: 'door', face: 'west' } } } },
  }),
  temple_small: bp('temple_small', {
    category: 'religious', era: 'classical', footprint: { w: 3, h: 3 },
    materials: { walls: 'stone', roof: 'tile', ground: 'flagstone' },
    parts: { body: { type: 'body', size: { w: 3, h: 3 }, params: { plan: 'cross', levels: 1, storeyM: 4, roof: 'hip' }, features: { door: { type: 'door', face: 'south', params: { main: true } }, smoke: { type: 'vent', params: { kind: 'smokehole' } } } } },
  }),
  farm_barn: bp('farm_barn', {
    category: 'farm', era: 'medieval', footprint: { w: 3, h: 2 },
    materials: { walls: 'timber', roof: 'wood', ground: 'dirt' },
    parts: { body: { type: 'body', size: { w: 3, h: 2 }, params: { plan: 'rect', levels: 1, storeyM: 3.2, roof: 'gable' }, features: { door: { type: 'door', face: 'south', params: { main: true } } } } },
  }),
  tower: bp('tower', {
    category: 'military', era: 'medieval', footprint: { w: 2, h: 3 },
    materials: { walls: 'stone', roof: 'slate', ground: 'flagstone' },
    parts: { body: { type: 'body', size: { w: 2, h: 3 }, params: { plan: 'rect', levels: 3, roof: 'flat' }, features: {
      door: { type: 'door', face: 'west' },
      win_s: { type: 'window', face: 'south', params: { style: 'arched', sill: 1.8 } },
      win_e: { type: 'window', face: 'east', params: { style: 'arched', sill: 2.8 } },
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
        features: { door: { type: 'door', face: 'south', params: { main: true } } },
      },
      tower: {
        type: 'body', at: { x: 0, y: 0 }, size: { w: 2, h: 2 },
        params: { plan: 'rect', levels: 3, roof: 'flat' },
        features: {
          win_s: { type: 'window', face: 'south', params: { style: 'arched', sill: 1.8 } },
          win_e: { type: 'window', face: 'east', params: { style: 'arched', sill: 1.8 } },
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
    parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'gable' }, features: { door: { type: 'door', face: 'west' } } } },
  }),
  guard_post: bp('guard_post', {
    category: 'military', era: 'medieval', footprint: { w: 2, h: 2 },
    materials: { walls: 'timber', roof: 'wood' },
    parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, storeyM: 3.2, roof: 'hip' }, features: { door: { type: 'door', face: 'west' } } } },
  }),
  yurt: bp('yurt', {
    category: 'residential', era: 'primordial', footprint: { w: 3, h: 3 },
    materials: { walls: 'hide', roof: 'hide', ground: 'dirt' },
    parts: { body: { type: 'body', size: { w: 3, h: 3 }, params: { plan: 'round', levels: 1, roof: 'domed' }, features: { door: { type: 'door', face: 'west' }, smoke: { type: 'vent', params: { kind: 'smokehole' } } } } },
  }),
  longhouse: bp('longhouse', {
    category: 'residential', era: 'medieval', footprint: { w: 4, h: 2 },
    materials: { walls: 'log', roof: 'thatch', ground: 'packed_dirt' },
    parts: { body: { type: 'body', size: { w: 4, h: 2 }, params: { plan: 'rect', levels: 1, storeyM: 3.2, roof: 'gable' }, features: { door: { type: 'door', face: 'south', params: { main: true } }, smoke: { type: 'vent', params: { kind: 'smokehole' } } } } },
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
