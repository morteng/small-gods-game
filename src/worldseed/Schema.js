/**
 * World Seed Schema
 *
 * Defines the structure for world seeds that combine:
 * - WFC map generation constraints
 * - AI painting style prompts
 * - DM agent world knowledge
 */

/**
 * @typedef {Object} WorldSeed
 * @property {string} name - World name
 * @property {string} [description] - High-level world description for DM
 * @property {Object} size - Map dimensions
 * @property {number} size.width - Width (16-64)
 * @property {number} size.height - Height (16-48)
 * @property {string} biome - Climate type
 * @property {string} [visualTheme] - Overall art style for AI painting
 * @property {POI[]} pois - Points of interest
 * @property {Connection[]} connections - Roads, rivers, walls
 * @property {string[]} constraints - Generation rules
 * @property {Object} [tileWeights] - Override tile probabilities
 * @property {Object} [lore] - Extended world lore for DM agent
 */

/**
 * @typedef {Object} POI
 * @property {string} id - Unique identifier
 * @property {string} type - POI type (village, city, castle, etc.)
 * @property {string} [name] - Display name
 * @property {string} [description] - Lore description for DM agent
 * @property {string} [visualStyle] - Art style hints for AI painting
 * @property {Object} [position] - Exact position {x, y}
 * @property {Object} [region] - Area bounds {x_min, x_max, y_min, y_max}
 * @property {string} [size] - small, medium, large
 * @property {number} [density] - 0-1 for regions
 * @property {string} [importance] - low, medium, high, critical
 * @property {NPC[]} [npcs] - NPCs at this location
 * @property {Object} [secrets] - Hidden info only DM knows
 */

/**
 * @typedef {Object} NPC
 * @property {string} name - NPC name
 * @property {string} role - occupation/class
 * @property {string} [description] - Physical description for sprites
 * @property {string} [personality] - For DM roleplay
 * @property {string[]} [knowledge] - What they know
 */

/**
 * @typedef {Object} Connection
 * @property {string} from - Source POI id
 * @property {string} to - Target POI id
 * @property {string} type - road, river, wall
 * @property {string} [style] - dirt, stone, bridge
 * @property {string} [description] - Lore for the path
 */

const POI_TYPES = [
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
  'crossroads'
];

const BIOMES = [
  'temperate',
  'desert',
  'arctic',
  'tropical',
  'volcanic',
  'swamp',
  'highland'
];

const CONSTRAINTS = [
  'no_water_in_region',
  'force_water_in_region',
  'roads_connect_all_settlements',
  'castle_on_high_ground',
  'ports_require_coast',
  'forests_cluster',
  'rivers_flow_to_water',
  'villages_near_water',
  'mountains_border_map'
];

/**
 * Default visual themes for biomes
 */
const BIOME_VISUAL_THEMES = {
  temperate: 'lush green meadows, gentle rolling hills, oak forests, clear blue skies, wildflowers',
  desert: 'golden sand dunes, rocky outcrops, palm oases, intense sun, mirages',
  arctic: 'snow-covered tundra, ice formations, aurora borealis, evergreen forests, frozen lakes',
  tropical: 'dense jungle, exotic flowers, waterfalls, humid mist, colorful birds',
  volcanic: 'dark basalt rocks, lava flows, ash clouds, sulfur vents, charred trees',
  swamp: 'murky waters, moss-draped trees, fog, lily pads, fireflies',
  highland: 'dramatic cliffs, mountain peaks, heather moors, rushing streams, ancient stones'
};

/**
 * Default visual styles for POI types
 */
const POI_VISUAL_STYLES = {
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
  crossroads: 'signpost, worn paths, resting travelers, milestone markers'
};

/**
 * Validate a world seed
 */
function validateWorldSeed(seed) {
  const errors = [];

  if (!seed.name) errors.push('Missing name');
  if (!seed.size) errors.push('Missing size');
  if (seed.size && (seed.size.width < 16 || seed.size.width > 64)) {
    errors.push('Width must be 16-64');
  }
  if (seed.size && (seed.size.height < 16 || seed.size.height > 48)) {
    errors.push('Height must be 16-48');
  }
  if (!seed.biome || !BIOMES.includes(seed.biome)) {
    errors.push(`Invalid biome. Use: ${BIOMES.join(', ')}`);
  }

  if (seed.pois) {
    for (const poi of seed.pois) {
      if (!poi.id) errors.push('POI missing id');
      if (!poi.type || !POI_TYPES.includes(poi.type)) {
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
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Create a default world seed
 */
function createDefaultWorldSeed(name = 'New World') {
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
      quests: []
    }
  };
}

/**
 * Enhance POI with default visual style if missing
 */
function enhancePOI(poi) {
  return {
    ...poi,
    visualStyle: poi.visualStyle || POI_VISUAL_STYLES[poi.type] || '',
    description: poi.description || `A ${poi.size || ''} ${poi.type} in the region.`.trim()
  };
}

/**
 * Generate AI painting prompt from world seed
 */
function generatePaintingPrompt(worldSeed, region = null) {
  const parts = [
    'Beautiful fantasy isometric game world map',
    'highly detailed painterly illustration',
    worldSeed.visualTheme || BIOME_VISUAL_THEMES[worldSeed.biome] || ''
  ];

  // Add POI-specific styles
  if (worldSeed.pois) {
    for (const poi of worldSeed.pois) {
      if (poi.visualStyle) {
        parts.push(poi.visualStyle);
      }
    }
  }

  parts.push('Studio Ghibli art style, vibrant colors, professional game art');

  return parts.filter(Boolean).join(', ');
}

/**
 * Generate DM knowledge summary from world seed
 */
function generateDMKnowledge(worldSeed) {
  const knowledge = {
    worldName: worldSeed.name,
    worldDescription: worldSeed.description,
    biome: worldSeed.biome,
    locations: [],
    connections: [],
    lore: worldSeed.lore || {}
  };

  if (worldSeed.pois) {
    for (const poi of worldSeed.pois) {
      const location = {
        id: poi.id,
        name: poi.name || poi.id,
        type: poi.type,
        description: poi.description,
        importance: poi.importance || 'medium',
        npcs: poi.npcs || [],
        secrets: poi.secrets || {}
      };
      knowledge.locations.push(location);
    }
  }

  if (worldSeed.connections) {
    for (const conn of worldSeed.connections) {
      knowledge.connections.push({
        from: conn.from,
        to: conn.to,
        type: conn.type,
        description: conn.description || `A ${conn.style || conn.type} connecting ${conn.from} and ${conn.to}`
      });
    }
  }

  return knowledge;
}

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    POI_TYPES,
    BIOMES,
    CONSTRAINTS,
    BIOME_VISUAL_THEMES,
    POI_VISUAL_STYLES,
    validateWorldSeed,
    createDefaultWorldSeed,
    enhancePOI,
    generatePaintingPrompt,
    generateDMKnowledge
  };
} else {
  window.WorldSeed = window.WorldSeed || {};
  Object.assign(window.WorldSeed, {
    POI_TYPES,
    BIOMES,
    CONSTRAINTS,
    BIOME_VISUAL_THEMES,
    POI_VISUAL_STYLES,
    validateWorldSeed,
    createDefaultWorldSeed,
    enhancePOI,
    generatePaintingPrompt,
    generateDMKnowledge
  });
}
