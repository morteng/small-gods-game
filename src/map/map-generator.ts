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
import { styledShapeSpec } from '@/terrain/terrain-shape';
import { styledClimate } from '@/terrain/climate';
import { applyPoiInfluences } from '@/terrain/poi-influence';
import { generateHydrology, buildVolcanoScorchMask } from '@/terrain/hydrology';
import { buildRoadGraph } from '@/world/road-graph';
import { mergeParallelRoads } from '@/world/connectome/merge-parallel-roads';
import { gateApproachPlan, realGateAnchors } from '@/world/connectome/gate-approach';
import { settlementRingContracts } from '@/world/connectome/wall-contracts';
import { wireGateToRoad } from '@/world/wire-gate';
import { corridorCells } from '@/world/road-corridors';
import type { RoadGraph } from '@/world/road-graph';
import { collectAnchors } from '@/world/anchor-collect';
import { matchAnchors } from '@/world/anchor-rules';
import { erodeElevation } from '@/terrain/erosion';
import { placeSettlement } from '@/world/building-placer';
import { stampFarmland } from '@/world/farmland';
import { stampIrrigation } from '@/world/irrigation';
import { buildCrossingStructureEntities } from '@/world/connectome/crossing-structures';
import { deriveBuiltJunctions } from '@/world/junction-artifacts';
import { buildStairStructureEntities } from '@/world/connectome/stair-structures';
import { buildEntranceStoopEntities } from '@/world/connectome/entrance-stoops';
import { buildAqueductStructureEntities } from '@/world/connectome/aqueduct-structures';
import { buildWaterNetwork, referenceFlow, reachHalfWidths } from '@/terrain/river-network';
import { REACH_CARVE } from '@/world/river-deformation';
import { getComposedHeightfield } from '@/world/road-deformation';
import { styledRiverFlowThreshold } from '@/terrain/hydrology';
import { getHeightfield, ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { curveRenderElev } from '@/render/gpu/terrain-field';
import { worldStyleOf } from '@/core/world-style';
import { buildRiparianEntities } from '@/world/riparian-scatter';
import { buildCoastalLandmarks, SETTLEMENT_TYPES } from '@/world/coastal-landmarks';
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
  'mountain', 'peak', 'rocky', 'volcanic_rock',
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
    shape: styledShapeSpec(worldSeed),
    // Absolute relief (metres) so biome classification gates snow/rock on real
    // altitude, not a fraction — a low-relief world won't snow-cap a 7 m bump.
    reliefM: worldStyleOf(worldSeed ?? undefined).mountainRelief,
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

  // Generate rivers from drainage basins. The flow threshold scales INVERSELY with the
  // world's riverDensity style knob (>1 = more/finer rivers, <1 = fewer trunk rivers).
  report('Carving rivers...');
  const riverFlowThreshold = styledRiverFlowThreshold(worldSeed, width, height);
  // Volcano craters must stay dry (heat evaporates the pit-fill pond) — same mask
  // the render-path recompute (hydrology-store) derives, so tiles and water agree.
  const scorchMask = buildVolcanoScorchMask(
    worldSeed?.pois, width, height, fields.elevation, config.seaLevel ?? 0.35, config.reliefM ?? 48);
  const hydrology = generateHydrology(fields, config, { riverFlowThreshold, scorchMask });
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

  // Widen the river RASTER to match the river that is actually drawn and carved.
  // The hydrology raster above is a 1-cell D8 centreline, but the VISIBLE + carved
  // river follows the smooth connectome at the reach's channel half-width (up to ~2.2
  // tiles → a ~5-tile band). If the raster stays 1 cell, settlements site on "grass"
  // that is under painted water and roads carve dirt over the visible channel, only
  // bridging the single raster cell. We re-stamp the SAME disc swath the render mask
  // uses (render-water-mask.ts `buildRenderWaterType`) into the tile raster so every
  // downstream consumer — building placer, road walker, pathfinding, picking — agrees
  // with what is on screen. This runs BEFORE settlements + roads (below) so they avoid
  // and bridge the full channel. The network is reused by the aqueduct pass later.
  const waterNet = buildWaterNetwork(hydrology, width, height, riverFlowThreshold);
  const refFlow = referenceFlow(waterNet);
  for (const reach of waterNet.reaches) {
    // Paint the channel at the SAME per-vertex width the carve uses (W ∝ √Q): thin at the
    // spring, widening toward the mouth, stepping up at confluences. Using the per-class
    // constant here painted a uniform-width ribbon the whole length — the river read flat.
    const halfWidths = reachHalfWidths(reach, refFlow);
    reach.centerline.forEach((p, i) => {
      const r = Math.max(0.5, halfWidths[i] ?? REACH_CARVE[reach.klass].halfWidth);
      const r2 = r * r;
      const x0 = Math.max(0, Math.floor(p.x - r)), x1 = Math.min(width - 1, Math.ceil(p.x + r));
      const y0 = Math.max(0, Math.floor(p.y - r)), y1 = Math.min(height - 1, Math.ceil(p.y + r));
      for (let cy = y0; cy <= y1; cy++) {
        const dy = cy + 0.5 - p.y;
        for (let cx = x0; cx <= x1; cx++) {
          const dx = cx + 0.5 - p.x;
          if (dx * dx + dy * dy > r2) continue;
          const t = tiles[cy]?.[cx];
          if (!t || WATER_TYPES.has(t.type)) continue;  // never overwrite ocean/lake/existing water
          t.type = 'river';
          t.walkable = false;
        }
      }
    });
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

  // Coastal landmarks (sea arch / cliff-face / cave / hoodoo) are SHELVED: the mesh
  // landform pass read poorly in-world (billboards, seams), so it's disabled pending a
  // rethink. The generators (`buildCoastalLandmarks`, the landform part types + presets)
  // remain in the tree, unused, so re-enabling is a one-line change here.
  void buildCoastalLandmarks; void SETTLEMENT_TYPES;

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
  const barrierRuns: import('@/world/barrier').PlacedBarrier[] = [];
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
        mapStub,  // terrain-aware site selection (height is analytic from seed)
      );
      settlementPlans.push(result.plan);
      barrierRuns.push(...result.barriers);
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
    // Make roads LEAD TO GATES: town rings become obstacles (so A* can't pierce a curtain except
    // at an opening) and each ring endpoint's connection is threaded through its nearest real gate.
    // Connections touching no ring are returned unchanged, so a ringless world routes identically.
    const approach = gateApproachPlan(barrierRuns, worldSeed.connections, worldSeed.pois ?? []);

    // Interior-to-gate stitch: the barrier/enclosure pass sites a ring's gates independently of
    // the settlement's OWN street layout, so the two can fall a tile or two short of each other
    // (#28 — carve-connections connectivity bug). Stitch every real gate to the settlement's
    // nearest interior road NOW, before the inter-POI approach road below claims the gate tile —
    // once that road is carved, the gate reads as "already on a road" and a later BFS run from the
    // gate would trivially find THAT same road first, never noticing the short interior gap on the
    // other side. `wireGateToRoad` only carves cells that aren't already road, so a gate whose
    // interior street already reaches it costs one bounded no-op search.
    const gateStitchMap = { tiles } as GameMap;
    for (const a of realGateAnchors(barrierRuns)) {
      // Same obstacle set as the approach walker below: never through a curtain, never across
      // a building footprint or a protected green.
      wireGateToRoad({ x: a.x, y: a.y } as import('@/world/anchors').Anchor, gateStitchMap, 12,
        (x, y) => tileBlockedByBuilding(world, x, y) || greenTiles.has(`${x},${y}`)
          || approach.wallObstacles.has(`${x},${y}`));
    }

    // Snapshot the pre-(inter-POI-road) tile state — taken AFTER settlements AND the interior-gate
    // stitch above (their streets are already carved, so they're preserved in the snapshot) — so a
    // road merged away below (#26) un-carves only the terrain/water it itself covered.
    // `rasterizeRoadGraph` shows the carve is exactly the edge's POLYLINE cells, so the polyline IS
    // the footprint to restore.
    const preRoad = tiles.map((row) => row.map((t) => ({ type: t.type, walkable: t.walkable })));
    roadGraph = buildRoadGraph(approach.connections, worldSeed.pois ?? [], tiles, fields, {
      isObstacle: (x, y) => tileBlockedByBuilding(world, x, y) || greenTiles.has(`${x},${y}`)
        || approach.wallObstacles.has(`${x},${y}`),
    });

    // #26 — MERGE near-parallel duplicate road corridors. Connectivity-preserving: drops the
    // redundant edge of each parallel pair ONLY when its endpoints stay connected without it
    // (so the network never splits), then UN-CARVES that edge's polyline cells that no KEPT road
    // still traces, back to the snapshot — the graph-derived surface/deformation auto-excludes the
    // dropped edge. Usually a no-op (most worlds have no parallel corridors); runs BEFORE
    // crossing/stair siting so they site on the merged network.
    const { graph: mergedRoads, removed } = mergeParallelRoads(roadGraph);
    if (removed.length) {
      const removedSet = new Set(removed);
      const keptCells = new Set<string>();
      for (const e of mergedRoads.edges) if (e.feature === 'road') for (const c of e.polyline) keptCells.add(`${Math.round(c.x)},${Math.round(c.y)}`);
      for (const e of roadGraph.edges) {
        if (!removedSet.has(e.id)) continue;
        for (const c of e.polyline) {
          const x = Math.round(c.x), y = Math.round(c.y);
          if (keptCells.has(`${x},${y}`)) continue;       // a kept road still traces this tile
          const snap = preRoad[y]?.[x], t = tiles[y]?.[x];
          if (snap && t) { t.type = snap.type; t.walkable = snap.walkable; }
        }
      }
      roadGraph = mergedRoads;
    }

    // Orphan-gate fallback (post-merge): the interior-to-gate stitch above already closed the
    // common gap, but a gate's APPROACH road can still vanish after this point — an unconnected
    // POI never routed one, or #26's parallel-road merge just un-carved it. Re-run the same BFS
    // spur so such a gate isn't left road-locked. Always calling (rather than a proximity
    // pre-check) is deliberate: `wireGateToRoad` only carves cells that aren't already road, so a
    // gate that's fine costs one bounded no-op search — see the interior-stitch comment above for
    // why a "some road is nearby" heuristic under-connects.
    const spurMap = { tiles } as GameMap;
    for (const a of realGateAnchors(barrierRuns)) {
      // Spur routing honours the same obstacles as the approach walker: never through
      // a curtain, a building footprint or a green, never across water (wire-gate itself
      // refuses WATER_TYPES).
      wireGateToRoad({ x: a.x, y: a.y } as import('@/world/anchors').Anchor, spurMap, 12,
        (x, y) => tileBlockedByBuilding(world, x, y) || greenTiles.has(`${x},${y}`)
          || approach.wallObstacles.has(`${x},${y}`));
    }

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
    const deckHf = getHeightfield(seed, width, height, styledIslandSpec(worldSeed) ?? null, worldSeed?.pois ?? null, styledShapeSpec(worldSeed));
    const deckGamma = worldStyleOf(worldSeed ?? undefined).terrainHeightGamma;
    const deckElevAt = (x: number, y: number): number =>
      curveRenderElev(deckHf[y * width + x] ?? ELEVATION_SEA_LEVEL, ELEVATION_SEA_LEVEL, deckGamma);
    for (const e of buildCrossingStructureEntities(roadGraph, width, {
      deckElevAt,
      // A wet bank anchor (a channel wider than the detected bridge run) snaps outward to dry
      // ground so the deck seats its abutments on land, not in the river (bridge.seating).
      isWater: (x, y) => WATER_TYPES.has(tiles[y]?.[x]?.type ?? ''),
      // Pier/arch height tracks the real bank-to-bed clearance (same raw heightfield + relief the
      // stair siter reads), so a deep gorge gets tall supports and a shallow brook short ones.
      elevAt: (x, y) => deckHf[Math.round(y) * width + Math.round(x)] ?? ELEVATION_SEA_LEVEL,
      reliefM: worldStyleOf(worldSeed ?? undefined).mountainRelief,
      cellBlocked: (x, y) => {
        const t = tiles[y]?.[x];
        if (!t) return true; // off-map → unusable
        return tileBlockedByBuilding(world, x, y) || ROAD_TILES.has(t.type) || WATER_TYPES.has(t.type);
      },
    })) world.addEntity(e);

    // (Road stair flights are sited AFTER map assembly below, on the COMPOSED heightfield.)

    // ENTRANCE STOOPS (outdoor-architectural stairs — the kit's entrance/site siting
    // authority): a building standing proud of the grade it faces (a hall on a hillside pad,
    // a temple on a rise) gets a perron from grade up to its door, read from the SAME
    // normalised grade the road stairs use. Flush sites — most buildings — get none.
    report('Setting entrance steps...');
    for (const e of buildEntranceStoopEntities(world.query({ tag: 'building' }), {
      elevAt: (x, y) => deckHf[Math.round(y) * width + Math.round(x)] ?? ELEVATION_SEA_LEVEL,
      reliefM: worldStyleOf(worldSeed ?? undefined).mountainRelief,
      liftElevAt: deckElevAt,
      cellBlocked: (x, y) => {
        const t = tiles[y]?.[x];
        if (!t) return true;
        // A stoop foots OUTSIDE its own door — keep it off water, roads and other buildings.
        return tileBlockedByBuilding(world, x, y) || ROAD_TILES.has(t.type) || WATER_TYPES.has(t.type);
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
      waterNet,
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
    barrierRuns,
    roadGraph,
  };

  // Settlement wear: trample high-traffic ground to dirt + cull vegetation
  // near roads, with seeded dither — the biome pokes through between lots.
  // Runs after the POI brushes so flavour flora near streets gets culled too.
  report('Applying settlement wear...');
  const worn = applyAllSettlementWear(settlementPlans, map, world, seed);
  if (worn > 0) report(`Trampled ${worn} tiles`);

  // Tilled fields around farm buildings — the open soil a settlement's farms work, beyond the
  // built-up core. Runs after settlement+roads+wear so it takes only the soil still free of
  // buildings, roads and water (fields are walkable ground, so they never block placement).
  report('Tilling farm fields...');
  const tilled = stampFarmland(map, world);
  if (tilled > 0) report(`Tilled ${tilled} field tiles`);

  // Irrigation (G7): dig ditches from each field patch to its nearest water and flag the
  // served fields `irrigated`. Runs right after farmland so the patches exist; pure tile pass.
  report('Digging irrigation ditches...');
  const dug = stampIrrigation(map, world);
  if (dug > 0) report(`Dug ${dug} ditch tiles`);

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

  // Contract DECLARATIONS the walled-town recipe commits: each defensive ring asks the connectome
  // for a landward gate reached by a road and a curtain crossed only at gates. `evaluateContracts`
  // (lint:world / MCP / Fate) grades them into the leveled report.
  map.contracts = { declarations: settlementRingContracts(barrierRuns) };

  // STAIR SITES (G3b): where a road's line climbs steeper than its class grade envelope,
  // the connectome wants a stair flight (the envelope's named reconciliation structure).
  // Sited AFTER map assembly so grade detection AND the foot lift read the COMPOSED
  // heightfield (base ⊕ road cuts/embankments ⊕ river carve ⊕ wall footings) — the ground
  // the renderer actually lifts entities by. Reading the raw field sited flights where the
  // road's own cut had already eased the climb, and floated/sank them over carved corridors.
  // A flight must not stand in water, on a building, or on a wall curtain (only openings).
  if (roadGraph) {
    report('Siting stairs...');
    const composed = getComposedHeightfield(map);
    const stairStyle = worldStyleOf(worldSeed ?? undefined);
    const wallCells = gateApproachPlan(barrierRuns, [], worldSeed?.pois ?? []).wallObstacles;
    for (const e of buildStairStructureEntities(roadGraph, {
      elevAt: (x, y) => composed[Math.round(y) * width + Math.round(x)] ?? ELEVATION_SEA_LEVEL,
      reliefM: stairStyle.mountainRelief,
      liftElevAt: (x, y) => curveRenderElev(composed[y * width + x] ?? ELEVATION_SEA_LEVEL, ELEVATION_SEA_LEVEL, stairStyle.terrainHeightGamma),
      cellBlocked: (x, y) => {
        const t = tiles[y]?.[x];
        if (!t) return true;
        return tileBlockedByBuilding(world, x, y) || WATER_TYPES.has(t.type) || wallCells.has(`${x},${y}`);
      },
    })) world.addEntity(e);
  }

  // JUNCTION ARTIFACTS (world-compiler WP-C): record the typed objects that own every
  // feature×feature overlap the builders just committed — Bridges over crossings, Gatehouse/
  // WaterGate at each barrier opening — so the world carries its junctions as first-class data
  // the claims ledger resolves against. Pure read of committed state; no placement change.
  map.junctions = deriveBuiltJunctions(world, map);

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
