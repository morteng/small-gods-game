/**
 * P2 living-population — the building CAPACITY data layer (residents / workers /
 * visitorDraw), DERIVED from catalogue facts already present so there is ZERO
 * per-building authoring, no new persisted field, and no WCV/ART/SAVE bump.
 *
 * A settlement's placed buildings live in `map.buildings` as `BuildingInstance`s
 * whose `templateId` is the blueprint PRESET id (`cottage`, `townhouse`, …) —
 * the SAME seam `spawner.ts` uses for resident placement. Each preset id matches
 * a medieval-europe catalogue `buildingType`, so its `functions` + `roomProgram`
 * classify it into a `CapacityClass`; `sizeBays` scales the per-instance profile.
 * Door tiles come from the legacy `getBuildingTemplate` when one exists (the
 * proven spawner door), else a stable building-interior proxy.
 *
 * Pure + rng-free (guarded by tests/unit/no-random-in-sim.test.ts): every choice
 * is a table lookup over deterministic catalogue data.
 *
 * SLICE 1 consumes only `residents`; `workers`/`visitorDraw` are facts-only
 * seams for slices 2–3.
 */

import type { BuildingInstance } from '@/core/types';
import type { BuildingTypeFields } from '@/catalogue/types';
import { catalogue } from '@/catalogue/pack';
import { getBuildingTemplate } from '@/map/building-templates';

export type CapacityClass =
  | 'dwelling' | 'farmstead' | 'workshop' | 'market'
  | 'hospitality' | 'worship' | 'martial' | 'civic-well';

export interface CapacityProfile {
  residents: number;
  workers: number;
  visitorDraw: number;
}

export interface BuildingDraw extends CapacityProfile {
  buildingId: string;
  poiId: string;
  /** Blueprint preset / template id (BuildingInstance.templateId). */
  kind: string;
  klass: CapacityClass;
  /** Door tile (absolute) — the resident placement anchor. */
  doorX: number;
  doorY: number;
}

/** Base per-instance profile by class, before the `sizeBays` scale. */
export const CAPACITY_BY_CLASS: Record<CapacityClass, CapacityProfile> = {
  dwelling:      { residents: 4, workers: 0, visitorDraw: 0 },
  farmstead:     { residents: 3, workers: 2, visitorDraw: 0 },
  workshop:      { residents: 1, workers: 3, visitorDraw: 1 },
  market:        { residents: 0, workers: 2, visitorDraw: 3 },
  hospitality:   { residents: 2, workers: 2, visitorDraw: 4 },
  worship:       { residents: 1, workers: 1, visitorDraw: 3 },
  martial:       { residents: 2, workers: 3, visitorDraw: 0 },
  'civic-well':  { residents: 0, workers: 0, visitorDraw: 1 },
};

/**
 * Authoritative resident counts for the residential presets — MIRRORS
 * settlement-growth-system's `DWELLING_CAPACITY` for the shared presets so
 * materialized occupancy agrees with the housing model (kept local to keep this
 * a pure dependency leaf; the growth module is import-heavy). Presets absent
 * here fall back to the class base × size scale.
 */
export const DWELLING_RESIDENTS: Record<string, number> = {
  yurt: 4, cottage: 5, longhouse: 8, townhouse: 8, manor: 10, fisherman_hut: 3,
};

/** Presets whose class the catalogue can't cleanly signal from functions/rooms. */
const MARTIAL_KINDS = new Set(['castle_keep', 'tower', 'guard_post']);
const MARKET_KINDS = new Set(['market_stall', 'dock']);

/** roomProgram room-id → class (present on every catalogue building type). */
const ROOM_CLASS: Record<string, CapacityClass> = {
  hall: 'dwelling', chamber: 'dwelling', parlour: 'dwelling', solar: 'dwelling',
  byre: 'farmstead', stable: 'farmstead', aisle: 'farmstead',
  'granary-loft': 'farmstead', 'dovecote-loft': 'farmstead',
  'guest-chamber': 'hospitality', taproom: 'hospitality', kitchen: 'hospitality',
  nave: 'worship', chancel: 'worship',
  'shopfront-stall': 'market',
  'forge-room': 'workshop', 'mill-room': 'workshop', workshop: 'workshop',
  'bakehouse-room': 'workshop', 'brewhouse-room': 'workshop',
};

/**
 * Classify a building into a CapacityClass from its preset id + catalogue fields
 * + optional `civic` marker. Priority (spec order, adapted to the real 25 types):
 * civic → explicit martial/market presets → establishment `functions` → worship
 * (a chancel) → barn (a naveless-of-chancel church-axial) → first roomProgram
 * class → dwelling default. `null` = houses nobody (graveyard/green).
 */
export function resolveCapacityClass(
  kind: string, fields?: BuildingTypeFields, civic?: string,
): CapacityClass | null {
  if (civic === 'well') return 'civic-well';
  if (civic === 'graveyard' || civic === 'green') return null;
  if (MARTIAL_KINDS.has(kind)) return 'martial';
  if (MARKET_KINDS.has(kind)) return 'market';

  const fns = fields?.functions ?? [];
  if (fns.includes('worship')) return 'worship';
  if (fns.includes('craft')) return 'workshop';
  if (fns.includes('residential')) return 'dwelling';
  if (fns.includes('agrarian')) return 'farmstead';
  if (fns.includes('hospitality')) return 'hospitality';
  if (fns.includes('commercial')) return 'market';

  const rooms = (fields?.roomProgram ?? []).map(r => r.type);
  if (rooms.includes('chancel')) return 'worship';   // temple / shrine / parish-church
  if (rooms.includes('nave')) return 'farmstead';    // aisled barn (church-axial, no chancel)
  for (const rt of rooms) { const c = ROOM_CLASS[rt]; if (c) return c; }
  return 'dwelling';
}

function buildingFields(kind: string): BuildingTypeFields | undefined {
  return catalogue.get<BuildingTypeFields>('buildingType', kind)?.fields;
}

/** `sizeBays`-derived scale, clamped so a manor houses more than a cottage
 *  without a per-preset row and a single-bay stall never over-scales. */
function sizeScale(fields?: BuildingTypeFields): number {
  const maxBays = fields?.sizeBays?.[1] ?? 1;
  return Math.min(3, Math.max(0.5, maxBays / 2));
}

/** The capacity profile for one preset (class base × size, dwellings pinned to
 *  the authoritative resident table). Null when the class houses nobody. */
export function capacityProfileFor(
  kind: string, fields?: BuildingTypeFields, civic?: string,
): (CapacityProfile & { klass: CapacityClass }) | null {
  const klass = resolveCapacityClass(kind, fields, civic);
  if (klass === null) return null;
  const base = CAPACITY_BY_CLASS[klass];
  const s = sizeScale(fields);
  const residents = klass === 'dwelling'
    ? (DWELLING_RESIDENTS[kind] ?? Math.round(base.residents * s))
    : Math.round(base.residents * s);
  return {
    klass,
    residents,
    workers: Math.round(base.workers * s),
    visitorDraw: Math.round(base.visitorDraw * Math.sqrt(s)),
  };
}

/** Resolve a placed building instance to its capacity draw (profile + door),
 *  or null if it houses/draws nobody. Door matches the proven spawner: the
 *  legacy template's doorCell when known, else a stable interior proxy. */
export function resolveBuildingDraw(b: BuildingInstance): BuildingDraw | null {
  if (!b.poiId) return null;
  const fields = buildingFields(b.templateId);
  const prof = capacityProfileFor(b.templateId, fields);
  if (!prof) return null;
  const tmpl = getBuildingTemplate(b.templateId);
  const doorX = b.tileX + (tmpl ? tmpl.doorCell.x : 1);
  const doorY = b.tileY + (tmpl ? tmpl.doorCell.y : 1);
  return {
    buildingId: b.id, poiId: b.poiId, kind: b.templateId, klass: prof.klass,
    residents: prof.residents, workers: prof.workers, visitorDraw: prof.visitorDraw,
    doorX, doorY,
  };
}
