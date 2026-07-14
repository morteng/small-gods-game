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
import { WaterType } from '@/core/types';
import { WATER_TYPES } from '@/core/constants';
import { generateTerrainFields, classifyBiomes, sampleTiles } from '@/terrain/terrain-generator';
import { styledIslandSpec } from '@/terrain/island-mask';
import { styledShapeSpec } from '@/terrain/terrain-shape';
import { styledClimate } from '@/terrain/climate';
import { applyPoiInfluences } from '@/terrain/poi-influence';
import { generateHydrology, buildVolcanoScorchMask } from '@/terrain/hydrology';
import { buildRoadGraph, repairRoadDiagonalGaps, repairConnectionSplits } from '@/world/road-graph';
import { mergeParallelRoads } from '@/world/connectome/merge-parallel-roads';
import { gateApproachPlan, realGateAnchors } from '@/world/connectome/gate-approach';
import { settlementRingContracts } from '@/world/connectome/wall-contracts';
import { defenseRingContracts } from '@/world/connectome/defense-contracts';
// Registers `roads.ribbon-legal` (world-level invariant — `evaluateContracts` runs every
// world-level invariant globally, so this import wires it into the default recipe's lint;
// declaring it per-ring as well would double-report).
import '@/world/connectome/road-contracts';
import { wireGateToRoad } from '@/world/wire-gate';
import { corridorCells } from '@/world/road-corridors';
import type { RoadGraph } from '@/world/road-graph';
import { collectAnchors } from '@/world/anchor-collect';
import { matchAnchors } from '@/world/anchor-rules';
import { erodeElevation } from '@/terrain/erosion';
import { placeSettlement } from '@/world/building-placer';
import { stampFarmland } from '@/world/farmland';
import { stampIrrigation } from '@/world/irrigation';
import { buildCrossingStructureEntities, buildBridgeObject } from '@/world/connectome/crossing-structures';
import { detectCrossings } from '@/world/connectome/detect-crossings';
import type { CrossingSpec } from '@/world/connectome/crossing-builder';
import { buildRoadOccupancyMaskUncached } from '@/world/road-occupancy-mask';
import { deriveBuiltJunctions } from '@/world/junction-artifacts';
import { collectStairPorts, placeStairsFromLinks } from '@/world/connectome/stair-structures';
import { buildEntranceStoopEntities } from '@/world/connectome/entrance-stoops';
import { buildAqueductStructureEntities } from '@/world/connectome/aqueduct-structures';
import { buildWaterNetwork, referenceFlow, reachHalfWidths } from '@/terrain/river-network';

/**
 * Aqueducts are OFF (user call): what we generate doesn't read as an aqueduct yet — better to ship
 * none than bad ones. The pipeline (aqueduct-{sources,route,profile,placement,structures}) stays
 * live and tested; this is the single switch that re-enables emission once the geometry earns it.
 */
const EMIT_AQUEDUCTS = false;
import { REACH_CARVE } from '@/world/river-deformation';
import { getComposedHeightfield, reconcileFilletRaster, edgeRoadProfile } from '@/world/road-deformation';
import { getRenderWaterMask } from '@/world/render-water';
import { styledRiverFlowThreshold } from '@/terrain/hydrology';
import { getHeightfield, ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { curveRenderElev } from '@/render/gpu/terrain-field';
import { worldStyleOf } from '@/core/world-style';
import { buildRiparianEntities } from '@/world/riparian-scatter';
import { BOULDER_PAD_MIN_SCALE } from '@/world/boulder-deformation';
import { isTrampleEligible } from '@/sim/trample';
import { buildCoastalLandmarks, SETTLEMENT_TYPES } from '@/world/coastal-landmarks';
import { tileBlockedByBuilding } from '@/world/building-collision';
import { reconcileBarriersWithBuildings } from '@/world/place-barrier';
import { reconcileBuildingsWithWater } from '@/world/building-water-reconcile';
import type { SettlementPlan } from '@/world/settlement-plan';
import { prewarmAllSettlementWear } from '@/world/settlement-wear';
import { clearKillingFields } from '@/world/killing-field';
import { TrampleGrid } from '@/sim/trample';
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
  /** Desire-line trample grid, prewarmed from authored roads/markets. The live
   *  game stores it on `state.trample`; NPC traffic keeps carving from here. */
  trample:  TrampleGrid;
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
  // Progress reports YIELD a macrotask: generateWithNoise is otherwise one long
  // synchronous block (~25s+), during which the loading bar physically cannot
  // repaint. The yield (~1ms each, ~30 total) lets the DOM paint each phase label.
  const notify = options.onProgress ?? (() => {});
  const report = async (msg: string): Promise<void> => {
    notify(msg);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  };
  const maxDim = Math.max(width, height);

  await report('Generating terrain fields...');
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
  await report('Eroding terrain...');
  fields.elevation = erodeElevation(fields.elevation, width, height, { seed });

  // Apply POI influences on the noise fields before biome classification
  if (worldSeed?.pois?.length) {
    await report('Applying POI terrain influences...');
    applyPoiInfluences(fields, worldSeed.pois, config);
  }

  await report('Classifying biomes...');
  const biomeMap  = classifyBiomes(fields, config);
  const tileTypes = sampleTiles(biomeMap, fields, config);

  // Convert to Tile[][]
  await report('Building tile grid...');
  const tiles: Tile[][] = tileTypes.map((row, y) =>
    row.map((type, x) => ({ type, x, y, walkable: tileWalkable(type), state: 'realized' as const })),
  );

  // Generate rivers from drainage basins. The flow threshold scales INVERSELY with the
  // world's riverDensity style knob (>1 = more/finer rivers, <1 = fewer trunk rivers).
  await report('Carving rivers...');
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
  // Widen the raster river to the VISIBLE channel: stamp every tile the render ribbon covers, so
  // the tiles agree with what the shader paints wherever roads haven't yet carved over them.
  // NOTE this pass only stamps TILES — it no longer keeps a private `renderRiver` mask alongside.
  // It used to, and worldgen sited river crossings against that copy while the renderer painted
  // `buildRenderWaterType`; two derivations of "where is the water" is two chances to disagree,
  // and they did (a bank worldgen called dry stood in the drawn river). "Is there water the player
  // can SEE here" is now ONE function, `getRenderWaterMask` (below) — the same one the renderer,
  // the ribbon pin and the lint read.
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
  // "Is there water the player can SEE at this cell?" — ONE truth, `getRenderWaterMask`: the same
  // predicate the RENDERER paints from (`buildRenderWaterType`), the ribbon pin reads, and the
  // `bridge.seating` lint judges on. It used to be a private closure over the `renderRiver` mask
  // stamped just above; that mask is built from the same reaches, but a second derivation is a
  // second chance to disagree — and it did: a bank the generator seated as dry sat in the water
  // the renderer drew, so the deck's abutment stood in the river and only the LINT could see it.
  // Deriving it from the map (memoised on seed+dims, immune to the road/bridge tile overwrites)
  // means worldgen, the renderer and the linter cannot drift apart again.
  let renderWaterMask: ((x: number, y: number) => boolean) | null = null;
  const renderWaterAt = (x: number, y: number): boolean => {
    renderWaterMask ??= getRenderWaterMask(mapStub);   // lazy: mapStub is built just below
    return renderWaterMask(x, y);
  };

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
  await report('Running biome brushes...');
  for (const region of biomeRegions(biomeMap)) {
    const brushName = brushForBiome(region.biome);
    if (!brushName) continue;
    world.applyBrush(brushName, region, seed);
  }

  // Riparian band: dress the fresh-water margin (stones in the shallows, willows on
  // the banks) ON TOP of the base vegetation, driven off the hydrology raster so it
  // tracks rivers + lakes but not the sea. In-bounds by construction; guard against
  // the rare id collision with a biome-brush entity on the same cell.
  await report('Dressing riverbanks...');
  for (const e of buildRiparianEntities(hydrology, width, height, seed + 4242, biomeMap.biomes)) {
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
  await report('Placing settlements...');
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
  // Gate-stitch firings are RECORDED on `map.stats.gateStitches` so the multi-seed
  // sweep harness (scripts/stitch-sweep.ts) can assert zero without log scraping.
  const gateStitches: NonNullable<GameMap['stats']['gateStitches']> = [];
  let roadGraph: RoadGraph | undefined;
  // The road×water crossings, detected once in the road pass and realized in two stages (ancillary
  // structures there, spans after the composed heightfield is final — see the crossing pass below).
  let crossingSpecs: CrossingSpec[] = [];
  if (worldSeed?.connections) {
    await report('Carving road connections...');
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

    // Interior-to-gate stitch — DEGENERATE-CASE REPAIR ONLY. Gates are now committed portal nodes
    // (`deriveSettlementRing` sites them by connection direction, before any road) and `placeSettlement`
    // carves each gate's interior street connector at layout time, so on a healthy seed every gate
    // already reaches an interior road and this pass is a bounded no-op. It stays as a safety net for
    // the degenerate case where a gate's interior corridor was blocked at layout time, and LOGS if it
    // ever has to carve — a nonzero carve here means the by-construction wiring missed and wants a look.
    const gateStitchMap = { tiles } as GameMap;
    for (const a of realGateAnchors(barrierRuns)) {
      // Same obstacle set as the approach walker below: never through a curtain, never across
      // a building footprint or a protected green.
      const r = wireGateToRoad({ x: a.x, y: a.y } as import('@/world/anchors').Anchor, gateStitchMap, 12,
        (x, y) => tileBlockedByBuilding(world, x, y) || greenTiles.has(`${x},${y}`)
          || approach.wallObstacles.has(`${x},${y}`));
      if (r.carved > 0) {
        gateStitches.push({ phase: 'interior', runId: a.runId, x: a.x, y: a.y, carved: r.carved });
        console.warn(`[worldgen] interior-gate stitch FIRED for ${a.runId} gate @ (${a.x},${a.y}) — carved ${r.carved} tile(s); layout-time connector missed`);
      }
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

    // Orphan-gate fallback (post-merge) — DEGENERATE-CASE REPAIR ONLY. Committed gates are wired to
    // interior streets at layout time and threaded by the approach road (gateApproachPlan), so a gate
    // is normally road-connected on both faces before this runs. It stays only to catch a gate whose
    // APPROACH road vanished after this point (an unconnected POI that never routed one, or #26's
    // parallel-road merge un-carving it), and LOGS if it ever has to carve.
    const spurMap = { tiles } as GameMap;
    for (const a of realGateAnchors(barrierRuns)) {
      // Spur routing honours the same obstacles as the approach walker: never through
      // a curtain, a building footprint or a green, never across water (wire-gate itself
      // refuses WATER_TYPES).
      const r = wireGateToRoad({ x: a.x, y: a.y } as import('@/world/anchors').Anchor, spurMap, 12,
        (x, y) => tileBlockedByBuilding(world, x, y) || greenTiles.has(`${x},${y}`)
          || approach.wallObstacles.has(`${x},${y}`));
      if (r.carved > 0) {
        gateStitches.push({ phase: 'orphan', runId: a.runId, x: a.x, y: a.y, carved: r.carved });
        console.warn(`[worldgen] orphan-gate spur FIRED for ${a.runId} gate @ (${a.x},${a.y}) — carved ${r.carved} tile(s); approach road missing`);
      }
    }

    // 4-CONNECTIVITY REPAIR — with every road source now carved (settlement streets, the inter-POI
    // approach graph, gate stitches/spurs), close any DIAGONAL-only junction between them so the
    // network is 4-connected. Two independently-carved roads (an approach anchored a tile off the
    // street it joins) can touch only at a corner; a 4-neighbour flood (NPC walkability + the
    // road-connectivity contract) reads that as a break. Stamps a single land filler per gap,
    // never over water/buildings/walls/greens (the walker's own obstacle set).
    repairRoadDiagonalGaps(tiles, width, height,
      (x, y) => tileBlockedByBuilding(world, x, y) || greenTiles.has(`${x},${y}`) || approach.wallObstacles.has(`${x},${y}`));

    // CONNECTION-SPLIT REPAIR — the end-to-end invariant the passes above each assume: every
    // seed-declared road connection is ONE 4-connected component. The inter-POI walker can end
    // up riding a settlement's interior street; if a later layout change re-routes that street
    // (e.g. a preset's door face moved), the network silently splits into two islands even
    // though every pass "succeeded". Normally a no-op; carves a minimal legal land connector
    // between the closest cells of the split components and WARNS when it fires.
    repairConnectionSplits(tiles, width, height, approach.connections, worldSeed.pois ?? [],
      (x, y) => tileBlockedByBuilding(world, x, y) || greenTiles.has(`${x},${y}`) || approach.wallObstacles.has(`${x},${y}`));

    // River-crossing SITES (unified connectome, v0): where a road bridges water, compose a
    // crossing sub-connectome and realize its ancillary structures (toll/guard/shrine/mill/
    // shops/gatehouse) as grey-massing building entities, sized by era × prosperity × road
    // class. Span/piers stay on the road ribbon's interim deck for now. Added BEFORE the
    // static draw cache is built so they render without invalidation.
    await report('Siting river crossings...');
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
    // WIDTH-AWARE road avoidance: the bare ROAD_TILES tile test only sees the 1-cell walked
    // centerline, but the renderer paints an analytic ribbon up to ~1.44 tiles beyond it
    // (`maxCarriageHalfWidth`) — tolls/shrines nudged "clear" by tile type alone still sat
    // inside the painted road (the `buildings.off-roads-ribbon` residuals). The mask samples
    // the SAME ribbon over a partial map view of everything the geometry reads at this point
    // (roadGraph + barriers for gate fillets + tiles for the banks-stop rule). UNCACHED on
    // purpose: anchor links / fillet reconciliation haven't run yet, so a memoized entry here
    // would poison the final map's identically-keyed cache slot the renderer reads.
    const crossingRoadRibbon = buildRoadOccupancyMaskUncached(
      { tiles, width, height, seed, worldSeed, roadGraph, barrierRuns } as GameMap);
    // Detect ONCE and realize in two stages. The ancillary structures (toll/guard/mill) need the
    // road-carved tiles that exist HERE; the SPAN needs the COMPOSED heightfield (base ⊕ river
    // incision ⊕ road cuts), which is only final after the fillet↔raster reconciliation below —
    // and a deck's entire geometry is a function of the bank→bed clearance it reads there. So the
    // spans are built later, from these same specs (`buildCrossingSpans`, after the reconcile).
    crossingSpecs = detectCrossings(roadGraph, width, {
      isWater: renderWaterAt, bridgeAt: renderWaterAt,
      defaults: { era: 'late-medieval', prosperity: 'modest' },
    });
    for (const e of buildCrossingStructureEntities(roadGraph, width, {
      specs: crossingSpecs,
      withSpan: false,
      deckElevAt,
      // A wet bank anchor (a channel wider than the detected bridge run, OR a meander that shifted
      // the visible ribbon off the thin raster line) snaps outward to dry ground so the deck seats
      // its abutments on land and spans the water the player SEES — read from the render-river mask,
      // not the tile grid (roads carve 'bridge'/'dirt_road' over the channel, hiding it from a
      // raster read exactly at the crossing).
      isWater: renderWaterAt,
      // Locate the crossing on the VISIBLE channel, not the walker's thin raster line — a meander
      // can shift the drawn ribbon a tile off the raster cell the walker bridged, leaving the deck
      // to span dry ground beside the water. Detecting on the render mask puts it where water is.
      bridgeAt: renderWaterAt,
      // Pier/arch height tracks the real bank-to-bed clearance (same raw heightfield + relief the
      // stair siter reads), so a deep gorge gets tall supports and a shallow brook short ones.
      elevAt: (x, y) => deckHf[Math.round(y) * width + Math.round(x)] ?? ELEVATION_SEA_LEVEL,
      reliefM: worldStyleOf(worldSeed ?? undefined).mountainRelief,
      // The terrain's compressed vertical — the bridge object sizes its supports in this space so
      // they span the real bank-to-bed screen gap (else true-metric supports render ~1.6× too tall).
      zPxPerM: worldStyleOf(worldSeed ?? undefined).terrainVerticalExaggeration,
      cellBlocked: (x, y) => {
        const t = tiles[y]?.[x];
        if (!t) return true; // off-map → unusable
        return tileBlockedByBuilding(world, x, y) || ROAD_TILES.has(t.type)
          || crossingRoadRibbon.has(x, y) || renderWaterAt(x, y);
      },
    })) world.addEntity(e);

    // (Road stair flights are sited AFTER map assembly below, on the COMPOSED heightfield.)

    // ENTRANCE STOOPS (outdoor-architectural stairs — the kit's entrance/site siting
    // authority): a building standing proud of the grade it faces (a hall on a hillside pad,
    // a temple on a rise) gets a perron from grade up to its door, read from the SAME
    // normalised grade the road stairs use. Flush sites — most buildings — get none.
    await report('Setting entrance steps...');
    for (const e of buildEntranceStoopEntities(world.query({ tag: 'building' }), {
      elevAt: (x, y) => deckHf[Math.round(y) * width + Math.round(x)] ?? ELEVATION_SEA_LEVEL,
      reliefM: worldStyleOf(worldSeed ?? undefined).mountainRelief,
      liftElevAt: deckElevAt,
      cellBlocked: (x, y) => {
        const t = tiles[y]?.[x];
        if (!t) return true;
        // A stoop foots OUTSIDE its own door — keep it off VISIBLE water, roads and other buildings.
        return tileBlockedByBuilding(world, x, y) || ROAD_TILES.has(t.type) || renderWaterAt(x, y);
      },
    })) world.addEntity(e);

    // AQUEDUCTS (G6): the inverted river. A dry, inland settlement with a HIGHLAND water source
    // above it (a spring headwater / perched-lake outlet in the water connectome) gets a gravity
    // channel — CUT through a rise, hugging the SURFACE where the ground falls gently, and ELEVATED
    // on piered decks across a gorge. It emerges from the connectome the same way a crossing does
    // from road×river: the planner routes the least-trench+arch feasible line and the realizer
    // massings each segment. The channel deck rides its water line via the G4 `liftElev` primitive
    // (same render-elev space as the bridge decks above); surface/cut runs foot-sample to ground.
    //
    // DISABLED (user, WCV 97): the aqueducts we generate don't yet read as aqueducts — the massing
    // and the way they meet the ground aren't good enough to ship, so we'd rather show none than
    // show bad ones. The whole pipeline (sources → route → profile → placement → structures) is
    // intact and tested behind this flag; flip it back on when the geometry is worth looking at.
    if (EMIT_AQUEDUCTS) {
      await report('Raising aqueducts...');
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
  }

  // Every terrain-mutating carve above (rivers/roads/crossings) is done. A `river`/
  // `wall` connection ignores building obstacles by design (see road-graph.ts) — a
  // real river doesn't detour around a building — so an authored river reaching for
  // a POI a building already occupies can retroactively flood part of its footprint
  // (#22). Nudge any such building to the nearest dry, unoccupied, off-road ground
  // before anything downstream (barriers, `buildings[]`) reads its position.
  await report('Reconciling buildings against water...');
  const waterMoves = reconcileBuildingsWithWater(world, tiles);
  if (waterMoves.length) {
    const byId = new Map(waterMoves.map((m) => [m.id, m]));
    for (const b of buildings) {
      const move = byId.get(b.id);
      if (move) { b.tileX = move.x; b.tileY = move.y; }
    }
  }

  // All buildings are placed: a building is authoritative over its footprint, so
  // re-filter every barrier ring against the final building set (closes the
  // cross-settlement case where a building landed on an earlier settlement's ring).
  reconcileBarriersWithBuildings(world);

  // Run POI-zone brush passes for additional flavour entities around each POI
  // These run after buildings so they don't place trees on top of structures.
  await report('Running POI zone brushes...');
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
    stats: { iterations: 0, backtracks: 0, gateStitches },
    buildings,
    settlementPlans,
    barrierRuns,
    roadGraph,
    riparianSeed: seed + 4242, // scatter identity — see the riparian pass above
  };

  // Anchor snap-fit layer: gather every feature's connection anchors and match them into
  // links (door→road, gate→road, wall_end↔wall_end, …). Derived data only — no tile/geometry
  // mutation. Runs here — every anchor-bearing entity (buildings incl. crossing ancillaries,
  // barriers) is final by map assembly, and the fillet↔raster pass just below consumes
  // `map.anchorLinks` for its building-anchor arrival fillets.
  await report('Matching feature anchors...');
  // STAIR PORTS (G3b, anchor-driven): the road-grade scan emits foot/head `stair_anchor` pairs on
  // over-grade runs, matched into `spans` links alongside doors/banks. Computed HERE (before the
  // match) off the COMPOSED heightfield (base ⊕ road cuts/embankments ⊕ river carve ⊕ wall
  // footings) — the ground the renderer lifts entities by — so grade + placement read the same
  // profile. The composed field + style are reused by the placement pass below.
  const stairComposed = getComposedHeightfield(map);
  const stairStyle = worldStyleOf(worldSeed ?? undefined);
  const stairWallCells = roadGraph ? gateApproachPlan(barrierRuns, [], worldSeed?.pois ?? []).wallObstacles : new Set<string>();
  const stairElevAt = (x: number, y: number): number => stairComposed[Math.round(y) * width + Math.round(x)] ?? ELEVATION_SEA_LEVEL;
  const stairPorts = collectStairPorts(roadGraph, {
    elevAt: stairElevAt,
    reliefM: stairStyle.mountainRelief,
    // Both endpoints must be a stamped ground-road tile — NOT a bridge (a stair never foots on a
    // deck), and confirming this rejects a polyline point that rounded off the road.
    isRoadTile: (x, y) => { const t = tiles[y]?.[x]?.type; return t === 'dirt_road' || t === 'stone_road'; },
    // A flight must not stand on the VISIBLE water, a building, or a wall curtain (only openings).
    cellBlocked: (x, y) => tileBlockedByBuilding(world, x, y) || renderWaterAt(x, y) || stairWallCells.has(`${x},${y}`),
  });
  const { anchors, roads } = collectAnchors(world, roadGraph, width, stairPorts);
  map.anchors = anchors;
  map.anchorLinks = matchAnchors(anchors, { roads });

  // Fillet → raster reconciliation (WP-Q): re-derive road tiles along each edge's FILLETED
  // centerline (gate approaches + building-anchor arrivals) so the tiles NPCs walk match the
  // smoothed ribbon the renderer draws. An EXPLICIT final-authority pass, deliberately ONCE,
  // HERE: after every building is placed and water-nudged (a lazy mid-generation trigger once
  // stamped road tiles before crossing structures validated their seats — the INV3
  // road-under-toll regression), after the anchor layer above (its links feed the fillets),
  // and before wear/farmland/vegetation below so they see the final road mask (wear halos
  // cover it, fields avoid it, obstructing flora over it is cleared). `world` is passed so
  // the blocked check consults the real building registry, not just tile flags.
  await report('Reconciling fillet raster...');
  const filletSpans = reconcileFilletRaster(map, world);
  const filletWrites = filletSpans.reduce((a, s) => a + s.cellsWritten, 0);
  if (filletWrites > 0) await report(`Reconciled ${filletWrites} road tiles under filleted approaches`);

  // BRIDGE SPANS — built HERE, on the FINAL terrain. A deck's whole geometry is its bank→bed
  // clearance: the arches spring from the bed, the deck rides their crowns, the abutments land on
  // the banks. That clearance lives in the COMPOSED heightfield (base ⊕ river incision ⊕ road cuts
  // — what the renderer lifts terrain by), NOT in the raw seed heightfield, which has no channel in
  // it at all: sampled raw, every bank→bed drop read ~0, every clearance collapsed onto the 1.2 m
  // floor, and decks landed 42 px BELOW their bank (buried) to 57 px ABOVE it (floating). The
  // reconcile above bumps `roadGraph.rev`, so the composed field is correctly re-derived here.
  if (roadGraph && crossingSpecs.length) {
    await report('Raising bridge spans...');
    const spanComposed = getComposedHeightfield(map);
    const spanStyle = worldStyleOf(worldSeed ?? undefined);
    const spanElevAt = (x: number, y: number): number =>
      curveRenderElev(spanComposed[Math.round(y) * width + Math.round(x)] ?? ELEVATION_SEA_LEVEL,
        ELEVATION_SEA_LEVEL, spanStyle.terrainHeightGamma);
    // The deck's roadway is the road's OWN surface — read from the same `edgeRoadProfile` the
    // painted ribbon derives its pavedness from, so cobble arriving at the bank crosses as cobble.
    const spanNodeById = new Map(roadGraph.nodes.map((n) => [n.id, n]));
    const spanPoiById = new Map((worldSeed?.pois ?? []).map((p) => [p.id, p]));
    let spans = 0;
    for (const spec of crossingSpecs) {
      const e = buildBridgeObject(spec, {
        deckElevAt: spanElevAt,
        reliefM: spanStyle.mountainRelief,
        zPxPerM: spanStyle.terrainVerticalExaggeration,
        roadSurfaceFor: (edgeId) => {
          const edge = roadGraph!.edges.find((x) => x.id === edgeId);
          return edge ? edgeRoadProfile(map, edge, spanNodeById, spanPoiById)?.state.surfaceMaterial : undefined;
        },
      });
      if (e) { world.addEntity(e); spans++; }
    }
    // A crossing whose ribbon could not be seated still gets a deck — the road really does cross
    // water there and the world must resolve that claim — but it is seated from the RAW walker
    // line, so it is NOT guaranteed to sit on the drawn ribbon. On both probe seeds every one of
    // these is a road NODE sited in render water (the ribbon ends mid-channel, so no far bank
    // exists to seat against). Name them: the repair belongs upstream, in road-node siting, and
    // silence here is what let a 20-tile span down a road running into the sea look intentional.
    const declined = crossingSpecs.filter((s) => !s.bankCells).length;
    if (declined > 0) {
      console.warn(`[worldgen] ${declined}/${crossingSpecs.length} crossing(s) have NO ribbon-seated opening — their decks `
        + `fall back to the raw walker line and may not sit on the drawn road (a road NODE sited in the water)`);
    }
    if (spans > 0) await report(`Raised ${spans} bridge span${spans === 1 ? '' : 's'}`);
  }

  // Settlement wear: PREWARM the desire-line trample grid from authored
  // roads/markets — realises the initial worn dirt lanes AND leaves the wear
  // primed so live NPC traffic keeps carving from here (one system, two entry
  // points: this gen prewarm + the runtime trample systems). Also culls flora in
  // the mid-wear band. Runs after the POI brushes so flavour flora is caught too.
  await report('Applying settlement wear...');
  const trample = new TrampleGrid(width, height);
  const worn = prewarmAllSettlementWear(trample, settlementPlans, map, world, seed);
  if (worn > 0) await report(`Trampled ${worn} tiles`);

  // Tilled fields around farm buildings — the open soil a settlement's farms work, beyond the
  // built-up core. Runs after settlement+roads+wear so it takes only the soil still free of
  // buildings, roads and water (fields are walkable ground, so they never block placement).
  await report('Tilling farm fields...');
  const tilled = stampFarmland(map, world);
  if (tilled > 0) await report(`Tilled ${tilled} field tiles`);

  // Irrigation (G7): dig ditches from each field patch to its nearest water and flag the
  // served fields `irrigated`. Runs right after farmland so the patches exist; pure tile pass.
  await report('Digging irrigation ditches...');
  const dug = stampIrrigation(map, world);
  if (dug > 0) await report(`Dug ${dug} ditch tiles`);

  // Killing field (WP-S): clear sightline-blocking trees/scrub in a band outside each town wall on
  // its landward (`open`) legs — the defended glacis. Runs after farmland so the field exemption
  // sees the tilled soil; reuses the settlement-wear vegetation cull. Grass (a tile) stays.
  await report('Clearing killing fields...');
  const razed = clearKillingFields(map, world);
  if (razed > 0) await report(`Cleared ${razed} nature entities from killing fields`);

  // Reconcile vegetation against terrain/structures: roads and rivers clear
  // trees, and nothing vegetates on a building footprint. Runs last so it
  // catches flora dropped by every prior pass regardless of their order.
  await report('Clearing obstructed vegetation...');
  const cleared = clearObstructedVegetation(world, map);
  if (cleared > 0) await report(`Cleared ${cleared} obstructed nature entities`);

  // R5 ground-blend, contact ring: a BIG boulder lodged on dry soft ground kills the
  // grass under it — swap the contact tile to dirt. Permanent gen-time tile (NOT
  // trample wear, which decays and would revert an untrafficked ring); the blob
  // autotiler feathers the patch and the rock sprite covers most of it, so what shows
  // is a bare fringe at the contact line. Runs AFTER every entity-clearing pass so
  // only rocks that SURVIVED to the final world mark the ground (an early stamp left
  // orphan dirt diamonds where a settlement later cleared the rock). Same size gate as
  // the settle pads (boulder-deformation.ts); the pads themselves may still cover a
  // cleared rock, but a 0.08 m dip alone is invisible where the dirt is not.
  let ringed = 0;
  for (const e of world.registry.all()) {
    if (e.kind !== 'granite-boulder') continue;
    if (((e.properties as { scale?: number } | undefined)?.scale ?? 1) < BOULDER_PAD_MIN_SCALE) continue;
    const tx = Math.floor(e.x), ty = Math.floor(e.y);
    const t = tiles[ty]?.[tx];
    if (t && hydrology.waterType[ty * width + tx] === WaterType.Dry && isTrampleEligible(t)) {
      t.type = 'dirt';
      ringed++;
    }
  }
  if (ringed > 0) await report(`Grounded ${ringed} boulders on bare contact tiles`);

  // Contract DECLARATIONS the walled-town recipe commits: each defensive ring asks the connectome
  // for a landward gate reached by a road and a curtain crossed only at gates, PLUS (round 6,
  // WP-T) a raider's-eye check that the circuit is actually closed. `evaluateContracts`
  // (lint:world / MCP / Fate) grades them into the leveled report.
  map.contracts = {
    declarations: [...settlementRingContracts(barrierRuns), ...defenseRingContracts(barrierRuns)],
  };

  // STAIR PLACEMENT (G3b): instantiate the flights BETWEEN the matched `stair_anchor` foot/head
  // pairs (`map.anchorLinks`, computed in the anchor pass above). Each matched run stacks into
  // pieces that EACH lift to their own COMPOSED-heightfield terrain (the ground the renderer lifts
  // entities by) — no floating head. Detection already gated the ports (both endpoints road, net
  // smoothed grade over class, off water/building/wall), so placement just realizes the geometry.
  if (roadGraph) {
    await report('Siting stairs...');
    for (const e of placeStairsFromLinks(map.anchorLinks ?? [], roadGraph, {
      elevAt: stairElevAt,
      reliefM: stairStyle.mountainRelief,
      liftElevAt: (x, y) => curveRenderElev(stairComposed[y * width + x] ?? ELEVATION_SEA_LEVEL, ELEVATION_SEA_LEVEL, stairStyle.terrainHeightGamma),
    })) world.addEntity(e);
  }

  // JUNCTION ARTIFACTS (world-compiler WP-C): record the typed objects that own every
  // feature×feature overlap the builders just committed — Bridges over crossings, Gatehouse/
  // WaterGate at each barrier opening — so the world carries its junctions as first-class data
  // the claims ledger resolves against. Pure read of committed state; no placement change.
  await report('Recording junctions...');
  map.junctions = deriveBuiltJunctions(world, map);

  return { map, world, biomeMap, trample };
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
