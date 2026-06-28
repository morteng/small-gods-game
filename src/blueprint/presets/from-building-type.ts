// src/blueprint/presets/from-building-type.ts
//
// GENERATIVE catalogue → geometry bridge. The foundational vision is that a building
// is EXPRESSED from its programme (the catalogue buildingType: rooms, frame, entrance,
// size) by the layered fold — a hand-authored `BUILDING_BLUEPRINTS` preset is just a
// PINNED shortcut, not the only way to get geometry. This module is the unpinned path:
// given any catalogue `buildingType` id with NO hand preset, it synthesises a minimal
// generative `Blueprint` shell (footprint + materials + one gen-tagged body) so the
// existing `expressBuilding` fold can derive its form, openings and structure.
//
// Everything here is DERIVED from catalogue fields (sizeBays → footprint, topology →
// roof/plan, entrance.face → door facing, defaultMaterials → walls/roof/ground) — no
// per-type hand-tuning. The shell stays deliberately spare: the fold does the work.
import type { Blueprint, Era } from '../types';
import { BLUEPRINT_VERSION } from '../types';
import { GEN_OPENINGS_TAG } from '../connectome/openings';
import { GEN_FORM_TAG } from '../connectome/form';
import { catalogue } from '@/catalogue/pack';
import { loadDefaultPacks } from '@/catalogue/default-packs';
import type { BuildingTypeFields } from '@/catalogue/types';

/** 'n'|'e'|'s'|'w' (catalogue face id) → the body feature's face name. */
const FACE: Record<string, 'north' | 'east' | 'south' | 'west'> = {
  n: 'north', e: 'east', s: 'south', w: 'west',
};

/**
 * Footprint (in tiles) derived from the programme's bay count + topology. A bay is one
 * structural module; we pick a bay count within [min,max] from the seed for variety, then
 * map to a tile rectangle whose proportion follows the topology:
 *   - vertical-stack (towers/keeps/granaries) → compact square plan; the FORM layer stacks
 *     the storeys, so the footprint stays small;
 *   - everything else (linear ranges, axial halls) → a longer 3:2-ish range that grows with
 *     bays, clamped to sane settlement sizes.
 */
function deriveFootprint(bt: BuildingTypeFields, seed: number): { w: number; h: number } {
  const [lo, hi] = bt.sizeBays;
  const span = Math.max(1, hi - lo + 1);
  const bays = lo + (seed % span); // deterministic pick in [lo, hi]
  if (bt.topology === 'vertical-stack') {
    const s = Math.min(3, Math.max(2, bays + 1));
    return { w: s, h: s };
  }
  const long = Math.min(6, Math.max(2, bays + 1));
  const short = Math.min(4, Math.max(2, Math.ceil((long * 2) / 3)));
  return { w: long, h: short };
}

/**
 * Build a generative geometry `Blueprint` for a catalogue buildingType that has no pinned
 * preset. Returns undefined for an unknown id or a non-building programme. The body opts
 * into BOTH derivation layers (gen-form for massing, gen-openings for fenestration) and
 * carries only a main door on the programme's entrance face — the fold supplies the rest.
 */
export function blueprintFromBuildingType(id: string, seed: number): Blueprint | undefined {
  loadDefaultPacks();
  const entry = catalogue.get<BuildingTypeFields>('buildingType', id);
  if (!entry) return undefined;
  const bt = entry.fields;
  const era: Era = entry.applicability?.eras?.[0] ?? 'medieval';
  const footprint = deriveFootprint(bt, seed);
  // Towers/keeps read as a flat fighting top; every other range takes a pitched gable.
  const roof = bt.topology === 'vertical-stack' ? 'flat' : 'gable';
  const face = FACE[bt.entrance.face ?? 's'] ?? 'south';
  return {
    version: BLUEPRINT_VERSION,
    class: 'building',
    preset: id,
    era,
    materials: {
      walls: bt.defaultMaterials.walls ?? 'timber',
      roof: bt.defaultMaterials.roof ?? 'thatch',
      ground: bt.defaultMaterials.ground ?? 'packed_dirt',
    },
    footprint,
    parts: {
      body: {
        type: 'body',
        at: { x: 0, y: 0 },
        size: { w: footprint.w, h: footprint.h },
        // Massing + fenestration are DERIVED from the programme/structure (gen-form +
        // gen-openings); only the door is seeded, onto the entrance face.
        params: { plan: 'rect', levels: 1, roof },
        tags: [GEN_FORM_TAG, GEN_OPENINGS_TAG],
        features: {
          door: { type: 'door', face, params: { main: true, t: 0.5 } },
        },
      },
    },
  };
}
