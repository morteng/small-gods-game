import type { WorldSeed, POI } from '@/core/types';
import { ERAS, isEra } from '@/core/era';
import { CLIMATE_NAMES, isClimateName } from '@/terrain/climate';
import { REGION_FILL_POI_TYPES } from '@/terrain/poi-influence';

export const CONNECTION_TYPES = ['road', 'river', 'wall'] as const;
export const CONNECTION_STYLES = ['dirt', 'stone', 'bridge'] as const;

export const POI_TYPES = [
  'village',
  'city',
  'castle',
  'forest',
  'lake',
  'mountain',
  'farm',
  'port',
  'ruins',
  'temple',
  'mine',
  'tavern',
  'tower',
  'bridge',
  'crossroads',
  'swamp',
  'desert',
  'volcano',
  'glacier',
  'oasis',
  'plains',
  'cliffs',
  'sea_stacks',
  'cove',
  'headland',
] as const;

export const BIOMES = [
  'temperate',
  'desert',
  'arctic',
  'tropical',
  'volcanic',
  'swamp',
  'highland',
] as const;

export const CONSTRAINTS = [
  'no_water_in_region',
  'force_water_in_region',
  'roads_connect_all_settlements',
  'castle_on_high_ground',
  'ports_require_coast',
  'forests_cluster',
  'rivers_flow_to_water',
  'villages_near_water',
  'mountains_border_map',
] as const;

/** Default visual themes for biomes */
export const BIOME_VISUAL_THEMES: Record<string, string> = {
  temperate: 'lush green meadows, gentle rolling hills, oak forests, clear blue skies, wildflowers',
  desert: 'golden sand dunes, rocky outcrops, palm oases, intense sun, mirages',
  arctic: 'snow-covered tundra, ice formations, aurora borealis, evergreen forests, frozen lakes',
  tropical: 'dense jungle, exotic flowers, waterfalls, humid mist, colorful birds',
  volcanic: 'dark basalt rocks, lava flows, ash clouds, sulfur vents, charred trees',
  swamp: 'murky waters, moss-draped trees, fog, lily pads, fireflies',
  highland: 'dramatic cliffs, mountain peaks, heather moors, rushing streams, ancient stones',
};

/** Default visual styles for POI types */
export const POI_VISUAL_STYLES: Record<string, string> = {
  village: 'cozy thatched cottages, smoke from chimneys, vegetable gardens, dirt paths',
  city: 'stone buildings, cobblestone streets, market squares, church spire, busy crowds',
  castle: 'imposing stone walls, tall towers, flags and banners, drawbridge, guards',
  forest: 'tall ancient trees, dappled sunlight, mushrooms, wildlife, mysterious paths',
  lake: 'crystal clear water, gentle ripples, reeds at edges, reflections, fish jumping',
  mountain: 'snow-capped peaks, rocky crags, eagles soaring, alpine meadows',
  farm: 'golden wheat fields, red barn, grazing animals, scarecrow, wooden fences',
  port: 'wooden docks, fishing boats, seagulls, crates and barrels, lighthouse',
  ruins: 'crumbling stone walls, overgrown with vines, mysterious symbols, treasure hints',
  temple: 'ornate architecture, stained glass, sacred symbols, candles, peaceful atmosphere',
  mine: 'dark entrance, rail tracks, ore carts, pickaxes, lanterns',
  tavern: 'warm lights, wooden sign, outdoor tables, travelers, music notes',
  tower: 'tall spire, wizard symbols, glowing windows, ravens, arcane energy',
  bridge: 'stone arches, flowing water below, worn path, travelers crossing',
  crossroads: 'signpost, worn paths, resting travelers, milestone markers',
  cliffs: 'sheer rock faces plunging to the surf, seabird colonies, wind-bent grass on the brink, crashing waves',
  sea_stacks: 'bare rock pillars rising from the surf off a headland, white spray, wheeling gulls, isolated weathered stone',
  cove: 'a sheltered crescent bay, calm shallow water, a curve of pale sand, fishing boats drawn up, sheltering arms of land',
  headland: 'a low green cape reaching into the sea, wind-cropped turf, a rocky toe at the waterline, a wide horizon',
};

// ─── Seed validation (the schema half of the "world doctor") ──────────────────
//
// `errors` = the seed will not express what the author wrote (typo'd type, POI
// off the map, size silently clamped). `warnings` = it will generate, but a field
// is dead or a construct is a known footgun (unknown keys, `region` on a type
// that ignores it, style knobs outside `overrides`). Authors — human or agent —
// should iterate until BOTH lists are empty.

export interface SeedValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const POI_SIZES = ['small', 'medium', 'large', 'huge'] as const;
const POI_IMPORTANCE = ['low', 'medium', 'high', 'critical'] as const;
const COAST_ANCHORS = ['east', 'west', 'north', 'south', 'nearest'] as const;

// Canonical key sets — anything else on the object is dead weight the engine
// silently ignores, which is exactly what an authoring agent needs to hear about.
const SEED_KEYS = new Set(['name', 'description', 'size', 'biome', 'visualTheme', 'era', 'pois',
  'connections', 'constraints', 'tileWeights', 'lore', 'roadEndpoints', 'island', 'style',
  'climate', 'terrainShape']);
const POI_KEYS = new Set(['id', 'type', 'name', 'description', 'position', 'region', 'size',
  'importance', 'npcs', 'era', 'coast', 'summitM']);
/** Types whose summit height a per-POI `summitM` can override. */
const SUMMIT_POI_TYPES = new Set(['mountain', 'volcano', 'glacier']);
const CONNECTION_KEYS = new Set(['from', 'to', 'type', 'style', 'waypoints', 'width', 'autoBridge']);
const STYLE_KEYS = new Set(['scalePreset', 'ratingPreset', 'overrides']);

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[n];
}

/** Closest candidate within edit distance 2 — "vulcano" → ' (did you mean "volcano"?)'. */
function didYouMean(value: string, candidates: readonly string[]): string {
  let best: string | null = null;
  let bestD = 3;
  for (const c of candidates) {
    const d = levenshtein(value.toLowerCase(), c.toLowerCase());
    if (d < bestD) { bestD = d; best = c; }
  }
  return best ? ` (did you mean "${best}"?)` : '';
}

function unknownKeys(obj: object, known: Set<string>, label: string, warnings: string[]): void {
  for (const k of Object.keys(obj)) {
    if (!known.has(k)) {
      warnings.push(`${label}: unknown field "${k}" is ignored by the engine${didYouMean(k, [...known])}`);
    }
  }
}

/** Validate a world seed: structural errors + dead-field/footgun warnings. */
export function validateWorldSeed(seed: Partial<WorldSeed>): SeedValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  unknownKeys(seed, SEED_KEYS, 'seed', warnings);

  if (!seed.name) errors.push('Missing name');
  if (!seed.size) errors.push('Missing size');
  // The engine clamps to [16,512] SILENTLY (deriveMapSize/planWorldLayout) — make
  // the out-of-range ask loud here so the author learns their 600 became 512.
  if (seed.size && (seed.size.width < 16 || seed.size.width > 512)) {
    errors.push(`Width must be 16-512 (got ${seed.size.width}; the engine would silently clamp)`);
  }
  if (seed.size && (seed.size.height < 16 || seed.size.height > 512)) {
    errors.push(`Height must be 16-512 (got ${seed.size.height}; the engine would silently clamp)`);
  }
  if (!seed.biome || !(BIOMES as readonly string[]).includes(seed.biome)) {
    errors.push(`Invalid biome${seed.biome ? ` "${seed.biome}"${didYouMean(seed.biome, BIOMES)}` : ''}. Use: ${BIOMES.join(', ')}`);
  }
  if (seed.era !== undefined && !isEra(seed.era)) {
    errors.push(`Invalid era "${seed.era}". Use: ${ERAS.join(', ')}`);
  }
  // Climate: a named zone OR an object override (partial ClimateSpec). A bare
  // string must be a known preset; objects are accepted as overrides.
  if (typeof seed.climate === 'string' && !isClimateName(seed.climate)) {
    errors.push(`Invalid climate "${seed.climate}"${didYouMean(seed.climate, CLIMATE_NAMES)}. Use: ${CLIMATE_NAMES.join(', ')}`);
  }
  // `style` MUST nest knobs under `overrides` — a bare knob on `style` resolves to
  // nothing (the classic silently-dropped `style: {mountainRelief: 80}` footgun).
  if (seed.style && typeof seed.style === 'object') {
    for (const k of Object.keys(seed.style)) {
      if (!STYLE_KEYS.has(k)) {
        warnings.push(`style.${k} is ignored — per-knob overrides go under style.overrides.${k}`);
      }
    }
  }
  if (seed.constraints) {
    for (const c of seed.constraints) {
      if (!(CONSTRAINTS as readonly string[]).includes(c)) {
        warnings.push(`Unknown constraint "${c}"${didYouMean(c, CONSTRAINTS)} is ignored`);
      }
    }
  }

  const w = seed.size?.width ?? Infinity;
  const h = seed.size?.height ?? Infinity;
  if (seed.pois) {
    for (const poi of seed.pois) {
      const label = `POI "${poi.id || '?'}"`;
      unknownKeys(poi, POI_KEYS, label, warnings);
      if (!poi.id) errors.push('POI missing id');
      if (!poi.type || !(POI_TYPES as readonly string[]).includes(poi.type)) {
        // A typo'd type is worse than invalid — poi-influence SILENTLY skips it
        // (no terrain, no error), so the feature just doesn't exist.
        errors.push(`Invalid POI type "${poi.type}"${poi.type ? didYouMean(poi.type, POI_TYPES) : ''} — the engine would silently skip it. Use: ${POI_TYPES.join(', ')}`);
      }
      if (!poi.position && !poi.region) {
        errors.push(`${label} needs position or region`);
      }
      if (poi.position && (poi.position.x < 0 || poi.position.x >= w || poi.position.y < 0 || poi.position.y >= h)) {
        errors.push(`${label} position (${poi.position.x},${poi.position.y}) is outside the ${seed.size!.width}x${seed.size!.height} map`);
      }
      if (poi.region) {
        const r = poi.region;
        if (r.x_min > r.x_max || r.y_min > r.y_max) {
          errors.push(`${label} region is inverted (min > max)`);
        }
        if (r.x_min < 0 || r.x_max >= w || r.y_min < 0 || r.y_max >= h) {
          errors.push(`${label} region exceeds the map bounds`);
        }
        // Only region-fill types express a `region` in terrain; on a point type
        // (mountain, lake…) it merely pads island-layout bounds. An author writing
        // "a mountain range across this box" needs to hear that it won't happen.
        if (poi.type && (POI_TYPES as readonly string[]).includes(poi.type) && !REGION_FILL_POI_TYPES.includes(poi.type)) {
          warnings.push(`${label} (${poi.type}): region has no terrain effect — only ${REGION_FILL_POI_TYPES.join('/')} fill regions; a ${poi.type} stamps at its position only`);
        }
      }
      if (poi.size !== undefined && !(POI_SIZES as readonly string[]).includes(poi.size)) {
        errors.push(`${label} invalid size "${poi.size}". Use: ${POI_SIZES.join(', ')}`);
      }
      if (poi.importance !== undefined && !(POI_IMPORTANCE as readonly string[]).includes(poi.importance)) {
        errors.push(`${label} invalid importance "${poi.importance}". Use: ${POI_IMPORTANCE.join(', ')}`);
      }
      if (poi.coast !== undefined && !(COAST_ANCHORS as readonly string[]).includes(poi.coast)) {
        errors.push(`${label} invalid coast anchor "${poi.coast}". Use: ${COAST_ANCHORS.join(', ')}`);
      }
      if (poi.era !== undefined && !isEra(poi.era)) {
        errors.push(`Invalid POI era "${poi.era}". Use: ${ERAS.join(', ')}`);
      }
      if (poi.summitM !== undefined) {
        if (typeof poi.summitM !== 'number' || poi.summitM <= 0 || poi.summitM > 200) {
          errors.push(`${label} summitM must be a height in metres (0, 200]`);
        } else if (poi.type && !SUMMIT_POI_TYPES.has(poi.type)) {
          warnings.push(`${label} (${poi.type}): summitM only applies to ${[...SUMMIT_POI_TYPES].join('/')} — ignored here`);
        }
      }
    }
    const seen = new Set<string>();
    for (const poi of seed.pois) {
      if (poi.id && seen.has(poi.id)) errors.push(`Duplicate POI id "${poi.id}"`);
      if (poi.id) seen.add(poi.id);
    }
  }

  if (seed.connections) {
    const poiIds = new Set((seed.pois || []).map(p => p.id));
    for (const conn of seed.connections) {
      unknownKeys(conn, CONNECTION_KEYS, `Connection ${conn.from}→${conn.to}`, warnings);
      if (!poiIds.has(conn.from)) errors.push(`Connection from unknown POI: ${conn.from}${didYouMean(conn.from, [...poiIds])}`);
      if (!poiIds.has(conn.to)) errors.push(`Connection to unknown POI: ${conn.to}${didYouMean(conn.to, [...poiIds])}`);
      if (conn.type && !(CONNECTION_TYPES as readonly string[]).includes(conn.type)) {
        errors.push(`Invalid connection type "${conn.type}". Use: ${CONNECTION_TYPES.join(', ')}`);
      }
      if (conn.style && !(CONNECTION_STYLES as readonly string[]).includes(conn.style)) {
        errors.push(`Invalid connection style "${conn.style}". Use: ${CONNECTION_STYLES.join(', ')}`);
      }
      if (conn.width !== undefined && (conn.width < 1 || conn.width > 3)) {
        errors.push(`Connection width must be 1-3, got: ${conn.width}`);
      }
      if (conn.waypoints) {
        if (!Array.isArray(conn.waypoints)) {
          errors.push('Connection waypoints must be an array');
        } else {
          for (let i = 0; i < conn.waypoints.length; i++) {
            const wp = conn.waypoints[i];
            if (typeof wp.x !== 'number' || typeof wp.y !== 'number') {
              errors.push(`Waypoint ${i} must have numeric x and y coordinates`);
            }
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Create a default world seed */
export function createDefaultWorldSeed(name = 'New World'): WorldSeed {
  return {
    name,
    description: 'A mysterious land awaiting exploration.',
    size: { width: 32, height: 24 },
    biome: 'temperate',
    visualTheme: BIOME_VISUAL_THEMES.temperate,
    pois: [],
    connections: [],
    constraints: [],
    lore: {
      history: 'The land has a rich but forgotten history.',
      factions: [],
      quests: [],
    },
  };
}

/** Enhance a POI with default visual style if missing */
export function enhancePOI(poi: POI): POI & { visualStyle: string; description: string } {
  return {
    ...poi,
    visualStyle: POI_VISUAL_STYLES[poi.type] || '',
    description: poi.description || `A ${poi.size || ''} ${poi.type} in the region.`.trim(),
  };
}
