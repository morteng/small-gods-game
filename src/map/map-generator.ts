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
import type { GameMap, WorldSeed, Tile, BuildingInstance, TerrainConfig, POI, Region, BiomeMap } from '@/core/types';
import { WATER_TYPES } from '@/core/constants';
import { generateTerrainFields, classifyBiomes, sampleTiles } from '@/terrain/terrain-generator';
import { styledIslandSpec } from '@/terrain/island-mask';
import { styledClimate } from '@/terrain/climate';
import { applyPoiInfluences } from '@/terrain/poi-influence';
import { generateHydrology } from '@/terrain/hydrology';
import { buildRoadGraph } from '@/world/road-graph';
import { corridorCells } from '@/world/road-corridors';
import type { RoadGraph } from '@/world/road-graph';
import { collectAnchors } from '@/world/anchor-collect';
import { matchAnchors } from '@/world/anchor-rules';
import { erodeElevation } from '@/terrain/erosion';
import { placeSettlement } from '@/world/building-placer';
import { buildCrossingStructureEntities } from '@/world/connectome/crossing-structures';
import { buildStairStructureEntities } from '@/world/connectome/stair-structures';
import { buildAqueductStructureEntities } from '@/world/connectome/aqueduct-structures';
import { buildWaterNetwork } from '@/terrain/river-network';
import { DEFAULT_RIVER_FLOW_THRESHOLD } from '@/terrain/hydrology';
import { getHeightfield, ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { curveRenderElev } from '@/render/gpu/terrain-field';
import { worldStyleOf } from '@/core/world-style';
import { buildRiparianEntities } from '@/world/riparian-scatter';
import { tileBlockedByBuilding } from '@/world/building-collision';
import { reconcileBarriersWithBuildings } from '@/world/place-barrier';
import type { SettlementPlan } from '@/world/settlement-plan';
import { applyAllSettlementWear } from '@/world/settlement-wear';
import { applyPoiGroundPatches } from '@/world/poi-ground-patches';
import { blueprintOf } from '@/blueprint/entity';
import { clearObstructedVegetation } from '@/world/vegetation-clear';
import { getZoneRule } from '@/map/poi-zones';
import { resolveSettlementEra } from '@/core/era';
import { World } from '@/world/world';
import { biomeRegions } from '@/world/biome-regions';
import { brushForBiome, brushForPoiType } from '@/world/brushes/index';
import '@/world/brushes/index';

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

function tileWalkable(type: string): boolean {
  if (BLOCKING_TYPES.has(type)) return false;
  return WALKABLE_TYPES[type] ?? true;
}

// ─── Result type for noise generation ────────────────────────────────────────

export interface NoiseGenResult {
  map:      GameMap;
  world:    World;
  biomeMap: BiomeMap;
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
    island: styledIslandSpec(worldSeed) ?? undefined,
    climate: styledClimate(worldSeed),
  };

  const fields = generateTerrainFields(config);

  // Apply hydraulic erosion to soften peaks and deposit valleys.
  report('Eroding terrain...');
  fields.elevation = erodeElevation(fields.elevation, width, height, { seed });

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
    row.map((type, x) => ({ type, x, y, walkable: tileWalkable(type), state: 'realized' as const })),
  );

  // Generate rivers from drainage basins
  report('Carving rivers...');
  const hydrology = generateHydrology(fields, config);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (hydrology.riverMask[idx]) {
        const t = tiles[y]?.[x];
        if (!t) continue;
        // Do not overwrite existing water tiles — they're already wet.
        if (WATER_TYPES.has(t.type)) continue;
        t.type = 'river';
        t.walkable = false;
      }
    }
  }

  // Build World early so biome brushes and buildings can use it
  const mapStub: GameMap = {
    tiles, width, height, villages: [], seed, success: true,
    worldSeed: worldSeed ?? null,
    stats: { iterations: 0, backtracks: 0 },
    buildings: [],
  };
  const world = new World(mapStub);

  // Run biome-based brush passes FIRST to populate vegetation / rocks / etc.
  // Buildings placed next will clear nature entities from their footprints.
  report('Running biome brushes...');
  for (const region of biomeRegions(biomeMap)) {
    const brushName = brushForBiome(region.biome);
    if (!brushName) continue;
    world.applyBrush(brushName, region, seed);
  }

  // Riparian band: dress the fresh-water margin (stones in the shallows, willows on
  // the banks) ON TOP of the base vegetation, driven off the hydrology raster so it
  // tracks rivers + lakes but not the sea. In-bounds by construction; guard against
  // the rare id collision with a biome-brush entity on the same cell.
  report('Dressing riverbanks...');
  for (const e of buildRiparianEntities(hydrology, width, height, seed + 4242)) {
    if (!world.registry.has(e.id)) world.addEntity(e);
  }

  // Connectome-placed mini-biomes: stamp distinctive ground (e.g. a temple's
  // sacred grove) keyed on POI type, BEFORE settlements and zone brushes so
  // buildings sit on the patched ground and brushes dress it.
  if (worldSeed?.pois) applyPoiGroundPatches(worldSeed.pois, tiles, seed);

  // Place settlements for each POI (AFTER biome brushes so buildings
  // can clear nature entities that overlap with their footprints)
  report('Placing settlements...');
  const buildings: BuildingInstance[] = [];
  const villages: GameMap['villages'] = [];
  const rng = new Random((seed * 6271 + 9999) | 0);

  // Slice 3 — connectome loosening: reserve the inter-POI trunk corridors so settlements
  // leave room for the direct road route instead of boxing it into a detour. margin:0 keeps
  // the carriageway centreline clear without perturbing the (currently red, spatial-coordination
  // epic) placement net into new overlaps; widening the band waits on that occupancy-authority fix.
  const corridorReserved = corridorCells(worldSeed?.pois ?? [], worldSeed?.connections, { margin: 0 });

  const settlementPlans: SettlementPlan[] = [];
  if (worldSeed?.pois) {
    for (const poi of worldSeed.pois) {
      const zoneRule = getZoneRule(poi.type);
      if (!poi.position) continue;

      const connectedDirs = worldSeed.connections
        ? computeConnectedDirections(poi.id, worldSeed.connections, worldSeed.pois)
        : [];

      const era = resolveSettlementEra(poi, worldSeed);
      const result = placeSettlement(
        poi, zoneRule, tiles, world.registry, connectedDirs, rng, era, world, seed, corridorReserved,
      );
      settlementPlans.push(result.plan);
      villages.push({
        x: poi.position.x, y: poi.position.y, name: poi.name, type: poi.type,
        wards: result.plan.wards.map(w => ({ name: w.name, type: w.type })),
      });

      // Keep World's secondary indexes in sync with entities added directly via registry
      for (const e of result.entities) {
        world.indexExisting(e);
      }

      // Apply road tiles to the grid — but never onto a building's structure
      // cell. A neighbouring settlement placed earlier may already own this tile
      // (its building avoided ITS OWN roads, but not this settlement's), and a
      // building is authoritative over its footprint.
      for (const rt of result.roadTiles) {
        const t = tiles[rt.y]?.[rt.x];
        if (t && !tileBlockedByBuilding(world, rt.x, rt.y)) { t.type = rt.type; t.walkable = true; }
      }

      // Convert Entity buildings → BuildingInstance for backwards compat
      for (const e of result.entities) {
        const props = e.properties ?? {};
        if (props.category === 'building') {
          // Blueprint path (new): use the blueprint preset; legacy path: templateId.
          const templateId = (blueprintOf(e)?.rb.preset ?? props.templateId) as string | undefined;
          if (templateId) {
            buildings.push({
              id: e.id, templateId,
              tileX: e.x, tileY: e.y,
              poiId: props.poiId as string | undefined, state: 'intact',
            });
          }
        }
      }
    }
  }

  // Apply inter-POI connection roads AFTER settlements so they take priority.
  // The road GRAPH is the source of truth (polylines + bridges); the tile carve
  // is derived from it. `buildRoadGraph` carves the tiles as it walks (parity).
  let roadGraph: RoadGraph | undefined;
  if (worldSeed?.connections) {
    report('Carving road connections...');
    // Village greens are protected open commons — inter-POI roads thread AROUND
    // them (just like building footprints), else a road hub like the parish
    // village carves straight across its own green.
    const greenTiles = new Set<string>();
    for (const plan of settlementPlans) {
      for (const c of plan.civics) {
        if (c.type !== 'green') continue;
        for (let dy = 0; dy < c.h; dy++) for (let dx = 0; dx < c.w; dx++) greenTiles.add(`${c.x + dx},${c.y + dy}`);
      }
    }
    // Buildings are already placed: roads route AROUND their structure cells
    // (thread the streets) rather than carving through them.
    roadGraph = buildRoadGraph(worldSeed.connections, worldSeed.pois ?? [], tiles, fields, {
      isObstacle: (x, y) => tileBlockedByBuilding(world, x, y) || greenTiles.has(`${x},${y}`),
    });

    // River-crossing SITES (unified connectome, v0): where a road bridges water, compose a
    // crossing sub-connectome and realize its ancillary structures (toll/guard/shrine/mill/
    // shops/gatehouse) as grey-massing building entities, sized by era × prosperity × road
    // class. Span/piers stay on the road ribbon's interim deck for now. Added BEFORE the
    // static draw cache is built so they render without invalidation.
    report('Siting river crossings...');
    // Ancillary structures route AROUND settlement buildings, carved roads and water (a
    // crossing beside a town must not stamp its toll/shrine onto existing buildings — that
    // was the source of the spatial-invariant INV1/INV3 errors at crossing sites).
    const ROAD_TILES = new Set(['dirt_road', 'stone_road', 'bridge']);
    // Deck elevation: the renderer lifts terrain by `curveRenderElev(getHeightfield…)` (the
    // same base the terrain `heights` buffer is built from). Sample that exact source at the
    // banks so a bridge deck rides its bank height over the water rather than sinking.
    const deckHf = getHeightfield(seed, width, height, styledIslandSpec(worldSeed) ?? null, worldSeed?.pois ?? null);
    const deckGamma = worldStyleOf(worldSeed ?? undefined).terrainHeightGamma;
    const deckElevAt = (x: number, y: number): number =>
      curveRenderElev(deckHf[y * width + x] ?? ELEVATION_SEA_LEVEL, ELEVATION_SEA_LEVEL, deckGamma);
    for (const e of buildCrossingStructureEntities(roadGraph, width, {
      deckElevAt,
      cellBlocked: (x, y) => {
        const t = tiles[y]?.[x];
        if (!t) return true; // off-map → unusable
        return tileBlockedByBuilding(world, x, y) || ROAD_TILES.has(t.type) || WATER_TYPES.has(t.type);
      },
    })) world.addEntity(e);

    // STAIR SITES (G3b): where a road's line climbs steeper than its class grade envelope,
    // the connectome wants a stair flight (the envelope's named reconciliation structure).
    // Stairs SIT on the road (don't block road tiles like the crossing aprons do) but must
    // not stand in water or on a building. Grade is read in normalised heightfield space
    // (deckHf) — the same space the envelope's maxGrade is measured in — and the flight rides
    // the curved render elevation at its foot via liftElev.
    report('Siting stairs...');
    for (const e of buildStairStructureEntities(roadGraph, {
      elevAt: (x, y) => deckHf[Math.round(y) * width + Math.round(x)] ?? ELEVATION_SEA_LEVEL,
      reliefM: worldStyleOf(worldSeed ?? undefined).mountainRelief,
      liftElevAt: deckElevAt,
      cellBlocked: (x, y) => {
        const t = tiles[y]?.[x];
        if (!t) return true;
        return tileBlockedByBuilding(world, x, y) || WATER_TYPES.has(t.type);
      },
    })) world.addEntity(e);

    // AQUEDUCTS (G6): the inverted river. A dry, inland settlement with a HIGHLAND water source
    // above it (a spring headwater / perched-lake outlet in the water connectome) gets a gravity
    // channel — CUT through a rise, hugging the SURFACE where the ground falls gently, and ELEVATED
    // on piered decks across a gorge. It emerges from the connectome the same way a crossing does
    // from road×river: the planner routes the least-trench+arch feasible line and the realizer
    // massings each segment. The channel deck rides its water line via the G4 `liftElev` primitive
    // (same render-elev space as the bridge decks above); surface/cut runs foot-sample to ground.
    report('Raising aqueducts...');
    const reliefM = worldStyleOf(worldSeed ?? undefined).mountainRelief;
    const aqSettlements = villages.map((v) => ({ id: `town:${v.name ?? `${v.x}_${v.y}`}`, x: v.x, y: v.y }));
    // A town already within WET_RADIUS of usable water needs no aqueduct; only genuinely dry/inland
    // towns demand one (and the head + distance + feasibility gates then decide which actually get
    // a buildable line). This is the emergent trigger — water scarcity, not authored placement.
    const WET_RADIUS_TILES = 5;
    const isWaterTile = (x: number, y: number) => WATER_TYPES.has(tiles[y]?.[x]?.type ?? '');
    for (const e of buildAqueductStructureEntities(
      buildWaterNetwork(hydrology, width, height, DEFAULT_RIVER_FLOW_THRESHOLD),
      aqSettlements,
      {
        elevAt: (x, y) => deckHf[Math.round(y) * width + Math.round(x)] ?? ELEVATION_SEA_LEVEL,
        reliefM, width, height,
        liftForWaterM: (m) => curveRenderElev(m / reliefM, ELEVATION_SEA_LEVEL, deckGamma),
        needsAqueduct: (s) => nearestWaterDist(s.x, s.y, isWaterTile, WET_RADIUS_TILES) > WET_RADIUS_TILES,
        blocked: (x, y) => {
          const t = tiles[y]?.[x];
          if (!t) return true;
          return tileBlockedByBuilding(world, x, y) || WATER_TYPES.has(t.type);
        },
      },
    )) world.addEntity(e);
  }

  // All buildings are placed: a building is authoritative over its footprint, so
  // re-filter every barrier ring against the final building set (closes the
  // cross-settlement case where a building landed on an earlier settlement's ring).
  reconcileBarriersWithBuildings(world);

  // Run POI-zone brush passes for additional flavour entities around each POI
  // These run after buildings so they don't place trees on top of structures.
  report('Running POI zone brushes...');
  if (worldSeed?.pois) {
    for (const poi of worldSeed.pois) {
      if (!poi.position) continue;
      const zoneRule = getZoneRule(poi.type);
      const radius = Math.round((zoneRule.radius.min + zoneRule.radius.max) / 2);
      const x0 = Math.max(0, poi.position.x - radius);
      const y0 = Math.max(0, poi.position.y - radius);
      const x1 = Math.min(width  - 1, poi.position.x + radius);
      const y1 = Math.min(height - 1, poi.position.y + radius);
      const region: Region = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
      if (region.w > 0 && region.h > 0) {
        world.applyBrush(brushForPoiType(poi.type), region, seed);
      }
    }
  }

  // Emit one summary warn for accumulated brush drops (overlapping bbox regions
  // produce many duplicate ids; keep that visible without per-call noise).
  world.flushBrushDiagnostics();

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
    settlementPlans,
    roadGraph,
  };

  // Settlement wear: trample high-traffic ground to dirt + cull vegetation
  // near roads, with seeded dither — the biome pokes through between lots.
  // Runs after the POI brushes so flavour flora near streets gets culled too.
  report('Applying settlement wear...');
  const worn = applyAllSettlementWear(settlementPlans, map, world, seed);
  if (worn > 0) report(`Trampled ${worn} tiles`);

  // Reconcile vegetation against terrain/structures: roads and rivers clear
  // trees, and nothing vegetates on a building footprint. Runs last so it
  // catches flora dropped by every prior pass regardless of their order.
  report('Clearing obstructed vegetation...');
  const cleared = clearObstructedVegetation(world, map);
  if (cleared > 0) report(`Cleared ${cleared} obstructed nature entities`);

  // Anchor snap-fit layer: gather every feature's connection anchors and match them into
  // links (door→road, gate→road, wall_end↔wall_end, …). Derived data only — no tile/geometry
  // mutation, so worldgen output and golden hashes are unchanged.
  report('Matching feature anchors...');
  const { anchors, roads } = collectAnchors(world, roadGraph, width);
  map.anchors = anchors;
  map.anchorLinks = matchAnchors(anchors, { roads });

  return { map, world, biomeMap };
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

/** Chebyshev tile distance from (x,y) to the nearest water tile, searched out to `cap` rings.
 *  Returns `cap + 1` when no water lies within `cap` (so callers can treat that as "dry"). */
function nearestWaterDist(
  x: number, y: number, isWater: (x: number, y: number) => boolean, cap: number,
): number {
  if (isWater(x, y)) return 0;
  for (let r = 1; r <= cap; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isWater(x + dx, y + dy)) return r;
      }
    }
  }
  return cap + 1;
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
      row.push({ type, x, y, walkable: WALKABLE_TYPES[type] ?? false, state: 'realized' });
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
