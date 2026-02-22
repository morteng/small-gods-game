/**
 * Small Gods - Map Generator
 *
 * Three generation modes:
 * 1. Noise-based procedural (primary — new system)
 * 2. WFC-based (kept for future dungeon use)
 * 3. Legacy noise (simple fallback)
 *
 * Pure functions — no DOM access.
 */

import { WFCEngine } from '@/wfc';
import { Random, fractalNoise } from '@/core/noise';
import type { GameMap, WorldSeed, Tile, BuildingInstance, TerrainConfig, POI } from '@/core/types';
import { generateTerrainFields, classifyBiomes, sampleTiles } from '@/terrain/terrain-generator';
import { applyPoiInfluences } from '@/terrain/poi-influence';
import { EntityRegistry } from '@/world/entity-registry';
import { placeSettlement } from '@/world/building-placer';
import { getZoneRule } from '@/map/poi-zones';

/** Options for noise-based generation */
export interface NoiseGenOptions {
  villageCount?: number;
  forestDensity?: number;
  waterLevel?: number;
}

/** Options for WFC-based generation */
export interface WFCGenOptions {
  forestDensity?: number;
  waterLevel?: number;
  villageCount?: number;
  animated?: boolean;
  onProgress?: (message: string) => void;
}

/** Tile type walkability lookup */
const WALKABLE_TYPES: Record<string, boolean> = {
  grass: true,
  sand: true,
  forest: true,
  dense_forest: true,
  pine_forest: true,
  glen: true,
  sacred_grove: true,
  meadow: true,
  scrubland: true,
  hills: true,
  dirt: true,
  dirt_road: true,
  stone_road: true,
  farm_field: true,
  swamp: true,
  building_wood: true,
  building_stone: true,
};

/** Non-walkable tile types */
const BLOCKING_TYPES = new Set([
  'deep_water', 'shallow_water', 'river', 'ocean',
  'mountain', 'peak', 'rocky',
]);

/** Water tile types — roads bridge over these instead of overwriting */
const WATER_TYPES = new Set(['deep_water', 'shallow_water', 'river', 'ocean', 'water']);

function tileWalkable(type: string): boolean {
  if (BLOCKING_TYPES.has(type)) return false;
  return WALKABLE_TYPES[type] ?? true;
}

// ─── Result type for noise generation ────────────────────────────────────────

export interface NoiseGenResult {
  map:      GameMap;
  registry: EntityRegistry;
}

// ─── Primary noise-based generator ───────────────────────────────────────────

/**
 * Primary world generation: noise fields → biomes → tiles → settlements.
 * Replaces WFC as the main generation path.
 */
export async function generateWithNoise(
  width:     number,
  height:    number,
  seed:      number,
  worldSeed: WorldSeed | null,
  options: { onProgress?: (msg: string) => void } = {},
): Promise<NoiseGenResult> {
  const report = options.onProgress ?? (() => {});
  const maxDim = Math.max(width, height);

  report('Generating terrain fields...');
  const config: TerrainConfig = {
    seed,
    width,
    height,
    elevationScale: 6.0 / maxDim,
    moistureScale:  8.0 / maxDim,
    seaLevel: 0.35,
    poleFalloff: true,
    continentWarp: 2.0,
  };

  const fields = generateTerrainFields(config);

  // Apply POI influences on the noise fields before biome classification
  if (worldSeed?.pois?.length) {
    report('Applying POI terrain influences...');
    applyPoiInfluences(fields, worldSeed.pois, config);
  }

  report('Classifying biomes...');
  const biomeMap  = classifyBiomes(fields, config);
  const tileTypes = sampleTiles(biomeMap, fields, config);

  // Convert to Tile[][]
  report('Building tile grid...');
  const tiles: Tile[][] = tileTypes.map((row, y) =>
    row.map((type, x) => ({ type, x, y, walkable: tileWalkable(type) })),
  );

  // Place settlements for each POI (before inter-POI roads so roads take priority)
  report('Placing settlements...');
  const registry = new EntityRegistry();
  const buildings: BuildingInstance[] = [];
  const villages: GameMap['villages'] = [];
  const rng = new Random((seed * 6271 + 9999) | 0);

  if (worldSeed?.pois) {
    for (const poi of worldSeed.pois) {
      if (poi.position) {
        villages.push({ x: poi.position.x, y: poi.position.y, name: poi.name, type: poi.type });
      }
      const zoneRule = getZoneRule(poi.type);
      if (!poi.position) continue;

      const connectedDirs = worldSeed.connections
        ? computeConnectedDirections(poi.id, worldSeed.connections, worldSeed.pois)
        : [];

      const result = placeSettlement(poi, zoneRule, tiles, registry, connectedDirs, rng);

      // Apply road tiles to the grid
      for (const rt of result.roadTiles) {
        const t = tiles[rt.y]?.[rt.x];
        if (t) { t.type = rt.type; t.walkable = true; }
      }

      // Convert WorldEntity buildings → BuildingInstance for backwards compat
      for (const e of result.entities) {
        if (e.category === 'building' && e.templateId) {
          buildings.push({
            id: e.id,
            templateId: e.templateId,
            tileX: e.tileX,
            tileY: e.tileY,
            poiId: e.poiId,
            state: 'intact',
          });
        }
      }
    }
  }

  // Apply inter-POI connection roads AFTER settlements so they take priority
  if (worldSeed?.connections) {
    report('Carving road connections...');
    carveConnections(tiles, worldSeed.connections, worldSeed.pois ?? []);
  }

  const map: GameMap = {
    tiles,
    width,
    height,
    villages,
    seed,
    success: true,
    worldSeed: worldSeed ?? null,
    stats: { iterations: 0, backtracks: 0 },
    buildings,
  };

  return { map, registry };
}

/**
 * Carve road/river tiles along connection waypoints.
 * Falls back to a straight line when no waypoints are defined.
 * Supports road width and auto-bridging over water tiles.
 */
function carveConnections(
  tiles: Tile[][],
  connections: WorldSeed['connections'],
  pois: POI[],
): void {
  // Build POI position lookup for waypoint fallback
  const poiPositions = new Map(
    pois.filter(p => p.position).map(p => [p.id, p.position!]),
  );

  for (const conn of connections) {
    const roadType = conn.type === 'river' ? 'river'
      : conn.style === 'stone' ? 'stone_road' : 'dirt_road';
    const autoBridge = conn.autoBridge ?? (conn.type !== 'river');
    const roadWidth  = conn.width ?? 1;

    // Build point list: use waypoints or fall back to straight POI-to-POI line
    let points: { x: number; y: number }[];
    if (conn.waypoints?.length) {
      points = conn.waypoints;
    } else {
      const fromPos = poiPositions.get(conn.from);
      const toPos   = poiPositions.get(conn.to);
      if (!fromPos || !toPos) continue;
      points = [fromPos, toPos];
    }

    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      if (roadWidth <= 1) {
        bresenhamApply(tiles, a.x, a.y, b.x, b.y, roadType, autoBridge);
      } else {
        // Perpendicular offset for road width — same pattern as WFC engine
        const ddx = b.x - a.x, ddy = b.y - a.y;
        const len = Math.sqrt(ddx * ddx + ddy * ddy);
        const px = len > 0 ? -ddy / len : 0;
        const py = len > 0 ?  ddx / len : 0;
        for (let w = 0; w < roadWidth; w++) {
          const off = w - Math.floor(roadWidth / 2);
          const ox = Math.round(px * off), oy = Math.round(py * off);
          bresenhamApply(tiles, a.x + ox, a.y + oy, b.x + ox, b.y + oy, roadType, autoBridge);
        }
      }
    }
  }
}

/**
 * Apply a road/river tile type along a Bresenham line.
 * When autoBridge is true, water tiles become 'bridge' instead of being overwritten.
 */
function bresenhamApply(
  tiles: Tile[][],
  x0: number, y0: number,
  x1: number, y1: number,
  type: string,
  autoBridge = false,
): void {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  while (true) {
    const t = tiles[y]?.[x];
    if (t) {
      if (WATER_TYPES.has(t.type)) {
        if (autoBridge) { t.type = 'bridge'; t.walkable = true; }
        // else: skip water — do not overwrite
      } else {
        t.type = type;
        t.walkable = (type !== 'river');
      }
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 <  dx) { err += dx; y += sy; }
  }
}

/**
 * Compute unit direction vectors from a POI toward each connected POI.
 * Used to align settlement roads with incoming connections.
 */
function computeConnectedDirections(
  poiId:       string,
  connections: WorldSeed['connections'],
  pois:        POI[],
): { dx: number; dy: number }[] {
  const poiMap   = new Map(pois.filter(p => p.position).map(p => [p.id, p.position!]));
  const selfPos  = poiMap.get(poiId);
  if (!selfPos) return [];

  const dirs: { dx: number; dy: number }[] = [];
  for (const conn of connections) {
    const otherId = conn.from === poiId ? conn.to
                  : conn.to   === poiId ? conn.from
                  : null;
    if (!otherId) continue;
    const otherPos = poiMap.get(otherId);
    if (!otherPos) continue;
    const ddx = otherPos.x - selfPos.x;
    const ddy = otherPos.y - selfPos.y;
    const len = Math.sqrt(ddx * ddx + ddy * ddy);
    if (len < 0.001) continue;
    dirs.push({ dx: ddx / len, dy: ddy / len });
  }
  return dirs;
}

/**
 * Legacy noise-based generation (fallback)
 */
export function generateMap(width: number, height: number, seed: number, options: NoiseGenOptions = {}): GameMap {
  const { villageCount = 3, forestDensity = 55, waterLevel = 35 } = options;
  const rng = new Random(seed);
  const tiles: Tile[][] = [];
  const villages: { x: number; y: number; name?: string; type: string }[] = [];

  const waterThresh = waterLevel / 100;
  const forestThresh = forestDensity / 100;

  for (let y = 0; y < height; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < width; x++) {
      const e = fractalNoise(x, y, seed);
      const m = fractalNoise(x, y, seed + 500);
      let type: string;
      if (e < waterThresh * 0.7) type = 'deep_water';
      else if (e < waterThresh) type = 'shallow_water';
      else if (e < waterThresh + 0.07) type = 'sand';
      else if (e < 0.75) type = m > (1 - forestThresh) ? 'forest' : 'grass';
      else type = 'grass';
      row.push({ type, x, y, walkable: WALKABLE_TYPES[type] ?? false });
    }
    tiles.push(row);
  }

  for (let i = 0; i < villageCount; i++) {
    let vx: number, vy: number, tries = 0;
    do {
      vx = rng.int(4, width - 5);
      vy = rng.int(4, height - 5);
      tries++;
    } while (tries < 50 && (!tiles[vy]?.[vx] || !WALKABLE_TYPES[tiles[vy][vx].type]));

    if (tries < 50) {
      villages.push({ x: vx, y: vy, type: 'village' });
      const offsets: [number, number][] = [[0,0], [1,0], [-1,0], [0,1], [0,-1], [1,1], [-1,-1]];
      for (const [dx, dy] of offsets) {
        const bx = vx + dx, by = vy + dy;
        if (tiles[by]?.[bx] && WALKABLE_TYPES[tiles[by][bx].type]) {
          tiles[by][bx].type = rng.next() > 0.3 ? 'building_wood' : 'building_stone';
        }
      }
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const t = tiles[vy+dy]?.[vx+dx];
          if (t && (t.type === 'grass' || t.type === 'sand') && (dy === 0 || dx === 0)) {
            t.type = 'dirt_road';
          }
        }
      }
    }
  }

  return {
    tiles,
    villages,
    width,
    height,
    seed,
    success: true,
    worldSeed: null,
    stats: { iterations: 0, backtracks: 0 },
    buildings: [],
  };
}

/**
 * WFC-based generation with multi-phase approach
 * Phase 1: Natural terrain (water, forests, mountains, grass)
 * Phase 2: POI placement (villages, towers, farms)
 * Phase 3: Road carving (connecting POIs)
 */
export async function generateWithWFC(
  width: number,
  height: number,
  seed: number,
  worldSeed: WorldSeed | null,
  options: WFCGenOptions = {}
): Promise<GameMap> {
  const {
    forestDensity = 50,
    waterLevel = 35,
    villageCount = 3,
    animated = false,
    onProgress,
  } = options;

  const report = (msg: string): void => {
    if (onProgress) onProgress(msg);
  };

  report('Initializing WFC engine...');

  try {
    const engine = new WFCEngine(width, height, {
      seed,
      maxBacktracks: 300,
      animated,
      stepsPerFrame: 500,
      terrainOptions: {
        forestDensity: forestDensity / 100,
        waterLevel: waterLevel / 100,
        villageCount,
      },
      onProgress: (p) => {
        if (p.message) {
          report(p.message);
        } else {
          report(`WFC: ${Math.round(p.progress)}% complete...`);
        }
      }
    });

    // Generate with world seed
    const mapData = await engine.generate(worldSeed);

    if (!mapData.success) {
      console.warn('WFC generation had issues, using partial result');
    }

    // Log terrain distribution for debugging
    const distribution: Record<string, number> = {};
    for (let y = 0; y < mapData.height; y++) {
      for (let x = 0; x < mapData.width; x++) {
        const type = mapData.tiles[y][x].type;
        distribution[type] = (distribution[type] || 0) + 1;
      }
    }
    console.log('Terrain distribution:', distribution);

    return {
      tiles: mapData.tiles,
      villages: mapData.villages,
      width: mapData.width,
      height: mapData.height,
      seed,
      success: mapData.success,
      worldSeed: worldSeed,
      stats: mapData.stats,
      buildings: mapData.buildings,
    };

  } catch (e) {
    console.error('WFC generation failed:', e);
    report('WFC failed, using noise generation');
    return generateMap(width, height, seed, {});
  }
}
