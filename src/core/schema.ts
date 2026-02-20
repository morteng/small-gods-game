import type { WorldSeed, POI } from '@/core/types';

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
};

/** Validate a world seed and return any errors */
export function validateWorldSeed(seed: Partial<WorldSeed>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!seed.name) errors.push('Missing name');
  if (!seed.size) errors.push('Missing size');
  if (seed.size && (seed.size.width < 16 || seed.size.width > 64)) {
    errors.push('Width must be 16-64');
  }
  if (seed.size && (seed.size.height < 16 || seed.size.height > 48)) {
    errors.push('Height must be 16-48');
  }
  if (!seed.biome || !(BIOMES as readonly string[]).includes(seed.biome)) {
    errors.push(`Invalid biome. Use: ${BIOMES.join(', ')}`);
  }

  if (seed.pois) {
    for (const poi of seed.pois) {
      if (!poi.id) errors.push('POI missing id');
      if (!poi.type || !(POI_TYPES as readonly string[]).includes(poi.type)) {
        errors.push(`Invalid POI type "${poi.type}". Use: ${POI_TYPES.join(', ')}`);
      }
      if (!poi.position && !poi.region) {
        errors.push(`POI "${poi.id}" needs position or region`);
      }
    }
  }

  if (seed.connections) {
    const poiIds = new Set((seed.pois || []).map(p => p.id));
    for (const conn of seed.connections) {
      if (!poiIds.has(conn.from)) errors.push(`Connection from unknown POI: ${conn.from}`);
      if (!poiIds.has(conn.to)) errors.push(`Connection to unknown POI: ${conn.to}`);
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

  return { valid: errors.length === 0, errors };
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
