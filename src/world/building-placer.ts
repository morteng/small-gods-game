/**
 * Building Placer
 *
 * Generic constraint-based building placement + plan/execute settlement
 * layout (growth slice S1). `planSettlement` (settlement-plan.ts) builds the
 * road graph + frontage slots; this module executes it:
 *   1. Carve the planned road edges into roadTiles
 *   2. For each roster building, claim the best frontage slot whose side
 *      opposes the door facing — the door cell lands adjacent to the road,
 *      looking at it. Site rules order candidates (centre/edge affinity)
 *      and enforce hard constraints (dock needs water within 2 tiles).
 *   3. No slot fits → spiral-search fallback near the centre (with the
 *      site rule's water constraint) + a short carved door path.
 */

import type { Entity, Tile, Era, GameMap } from '@/core/types';
import type { World } from '@/world/world';
import { makeTerrainProbe } from '@/world/terrain-affordance';
import { siteFitness, type SiteProfile } from '@/world/site-fitness';
import type { EntityRegistry } from './entity-registry';
import type { ZoneRule } from '@/map/poi-zones';
import { presetsForEra } from '@/map/poi-zones';
import type { POI } from '@/core/types';
import { Random } from '@/core/noise';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { expandSite, siteToPlan } from '@/blueprint/connectome/site';
import { catalogue } from '@/catalogue/pack';
import { loadDefaultPacks } from '@/catalogue/default-packs';
import type { ResolvedBlueprint } from '@/blueprint/types';
import { blueprintEntity } from '@/blueprint/entity';
import { toCollision } from '@/blueprint/compile/to-collision';
import { toAnchors } from '@/blueprint/compile/to-anchors';
import { placeBarrier } from '@/world/place-barrier';
import { isBuilding as isBuildingEntity, tileBlockedByBuilding } from '@/world/building-collision';
import { OccupancyGrid, buildingSolidCells } from '@/world/occupancy-grid';
import { buildingVisualCells } from '@/blueprint/footprint';
import { deriveCroftEnclosures, deriveSettlementRing, type EnclosureCtx } from '@/world/enclosure';
import {
  planSettlement, orderedSlotsFor, subdivideLots, widenMarket, assignWards, planCivics,
  WATER_TYPES, BUILDABLE_TERRAIN, SITE_RULES,
  type SettlementPlan, type Lot, type FrontageSlot,
} from './settlement-plan';

/** Road tile types — door paths stop when they reach an existing road */
const ROAD_TYPES = new Set(['dirt_road', 'stone_road', 'bridge']);

/**
 * A preset's terrain disposition, derived from its site rule (generative, not
 * per-preset hand-tuning): a focus or centre-affine building (church / manor /
 * tavern at the heart) is `prominent` — it buys the sunlit, far-seen eminence;
 * everything else is `humble` — a snug, sheltered, level spot.
 */
function siteProfileFor(presetName: string): SiteProfile {
  const rule = SITE_RULES[presetName];
  return rule?.focus || rule?.affinity === 'center' ? 'prominent' : 'humble';
}

/** Civic precinct type → Blueprint preset to emit through the generate→sprite
 *  pipeline. The mill is a working building (class:'building', S6); the well and
 *  graveyard are civic PROPS (class:'prop', render Slice 1) — both flow through
 *  `blueprintEntity`. A civic type with no entry reserves ground but emits nothing
 *  (an agent-registered precinct without art). */
const CIVIC_PRESETS: Record<string, string> = { mill: 'watermill', well: 'well', graveyard: 'graveyard' };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlacementConstraint {
  allowedTerrain: string[];
  margin: number;                  // min tiles clearance from other buildings
  requiresRoadAccess: boolean;
  nearWater?: number;              // max distance to water tile
}

export interface PlacementResult {
  tileX: number;
  tileY: number;
}

/** A road tile to carve into the tile grid */
export interface RoadTile {
  x: number;
  y: number;
  type: string;                    // e.g. 'dirt_road', 'stone_road'
}

export interface SettlementResult {
  entities:  Entity[];
  roadTiles: RoadTile[];
  /** The road graph + slots the layout was executed from (S1; growth slices extend it). */
  plan: SettlementPlan;
}

/** Vegetation/ nature entity categories that should be removed when building. */
const NATURE_CATEGORIES = new Set(['vegetation', 'terrain-feature']);

/**
 * Remove nature entities (trees, boulders, etc.) that overlap with the
 * given footprint rectangle. Also updates ground tiles to 'grass' (or the
 * specified tile type) under the building.
 */
function clearFootprint(
  x: number, y: number, w: number, h: number,
  registry: EntityRegistry,
  world: World | null | undefined,
  tiles: Tile[][],
  newGroundType = 'grass',
): void {
  // 1. Remove nature entities in the footprint
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const entities = registry.getAtTile(x + dx, y + dy);
      for (const e of entities) {
        const def = tryGetEntityKindDef(e.kind);
        if (def && NATURE_CATEGORIES.has(def.category)) {
          registry.remove(e.id);
          // Also remove from world if provided
          if (world) world.removeEntity(e.id);
        }
      }
    }
  }

  // 2. Update ground tiles under the building
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tile = tiles[y + dy]?.[x + dx];
      if (tile) {
        tile.type = newGroundType;
        tile.walkable = false; // Building footprint is not walkable
      }
    }
  }
}

// Need to import tryGetEntityKindDef
import { tryGetEntityKindDef } from './entity-kinds';

// ─── Spiral search ────────────────────────────────────────────────────────────

/**
 * Spiral outward from (cx, cy) to find a valid placement position for a
 * building with the given footprint, constraints, and terrain.
 *
 * Returns null if no valid position found within maxRadius.
 */
export function findPlacement(
  center:     { x: number; y: number },
  footprint:  { w: number; h: number },
  constraint: PlacementConstraint,
  tiles:      Tile[][],
  registry:   EntityRegistry,
  maxRadius = 20,
): PlacementResult | null {
  const { w, h } = footprint;
  const { allowedTerrain, margin, nearWater } = constraint;
  const height = tiles.length;
  const width  = tiles[0]?.length ?? 0;

  for (let r = 0; r <= maxRadius; r++) {
    const candidates = spiralRing(center.x, center.y, r);
    for (const { x, y } of candidates) {
      const x0 = x, y0 = y;
      const x1 = x0 + w - 1, y1 = y0 + h - 1;

      // Bounds check
      if (x0 < 0 || y0 < 0 || x1 >= width || y1 >= height) continue;

      // Terrain check — all footprint cells must be in allowedTerrain
      if (!footprintOnTerrain(x0, y0, w, h, tiles, allowedTerrain)) continue;

      // Occupancy check (includes margin) — vegetation is allowed (will be cleared)
      if (!canPlaceIgnoringNature(x0, y0, w, h, margin, registry)) continue;

      // Water adjacency check
      if (nearWater !== undefined) {
        if (!nearWaterTile(x0, y0, w, h, tiles, nearWater)) continue;
      }

      return { tileX: x0, tileY: y0 };
    }
  }
  return null;
}

/**
 * Spiral outward from the settlement centre for the nearest position where the
 * footprint fits (`fits`), centring the footprint on (cx,cy). Used for CENTER-FIRST
 * focus placement (S3): the church/manor anchors a central precinct rather than a
 * frontage lot, because a deep focus footprint won't fit a burgage lot and fronting
 * a lane would push it to the rim.
 */
/**
 * Extra spiral rings to scan past the first fitting ring when a `fitnessAt` is given,
 * so a focus building can climb a couple of tiles off dead-centre onto the better-sited
 * ground (the church crowning the sunlit rise) while staying central. Pure first-fit
 * with no slack when `fitnessAt` is absent.
 */
const FOCUS_FITNESS_SLACK = 2;

export function findCentralPlacement(
  cx: number, cy: number, fp: { w: number; h: number },
  fits: (x: number, y: number, w: number, h: number) => boolean, maxRadius: number,
  fitnessAt?: (x: number, y: number, w: number, h: number) => number,
): PlacementResult | null {
  const ax = cx - Math.floor(fp.w / 2), ay = cy - Math.floor(fp.h / 2);
  if (!fitnessAt) {
    for (let r = 0; r <= maxRadius; r++) {
      for (const { x, y } of spiralRing(ax, ay, r)) {
        if (fits(x, y, fp.w, fp.h)) return { tileX: x, tileY: y };
      }
    }
    return null;
  }
  // Terrain-aware: among the fits within the first hit ring + a small slack, take the
  // best-sited (so the focus stays central but prefers the eminence the terrain offers).
  let best: PlacementResult | null = null;
  let bestScore = -Infinity;
  let firstHitR = -1;
  for (let r = 0; r <= maxRadius; r++) {
    if (firstHitR >= 0 && r > firstHitR + FOCUS_FITNESS_SLACK) break;
    for (const { x, y } of spiralRing(ax, ay, r)) {
      if (!fits(x, y, fp.w, fp.h)) continue;
      if (firstHitR < 0) firstHitR = r;
      const sc = fitnessAt(x, y, fp.w, fp.h);
      if (sc > bestScore) { bestScore = sc; best = { tileX: x, tileY: y }; }
    }
  }
  return best;
}

/** Check placement ignoring vegetation/terrain entities (which get cleared). */
function canPlaceIgnoringNature(
  x: number, y: number, w: number, h: number,
  margin: number, registry: EntityRegistry,
): boolean {
  const x0 = x - margin, y0 = y - margin;
  const x1 = x + w - 1 + margin, y1 = y + h - 1 + margin;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const entities = registry.getAtTile(tx, ty);
      // Only block if there are non-vegetation entities
      const hasBlocking = entities.some(e => {
        const def = tryGetEntityKindDef(e.kind);
        if (!def) return true; // Unknown entity = block
        return !NATURE_CATEGORIES.has(def.category);
      });
      if (hasBlocking) return false;
    }
  }
  return true;
}

// ─── Settlement layout ────────────────────────────────────────────────────────

/**
 * Place buildings for a POI settlement: build the plan, then execute it.
 *
 * Returns all WorldEntity objects created plus the plan itself.
 * The caller is responsible for applying roadTiles to the tile grid.
 */
export function placeSettlement(
  poi:                 POI,
  zoneRule:            ZoneRule,
  tiles:               Tile[][],
  registry:            EntityRegistry,
  connectedDirections: { dx: number; dy: number }[],
  rng:                 Random,
  era:                 Era = 'medieval',
  world?:              World,  // Optional World reference for entity sync
  worldSeed = 0,                // Stable seed for coordinate-keyed lots/wards
  corridorReserved?:   Set<string>, // Slice 3: inter-POI trunk corridor cells to keep clear of lots
  map?:                GameMap,  // Optional: enables terrain-aware site selection (height is analytic from seed)
): SettlementResult {
  const cx = poi.position?.x ?? 0;
  const cy = poi.position?.y ?? 0;
  const entities:  Entity[] = [];
  const roadType  = zoneRule.internalRoadType ?? 'dirt_road';

  // L2b — per-instance building seed. Every `synthesizeBlueprint` below draws a fresh seed
  // from this so each placed instance varies: the generative catalogue→geometry bridge grows
  // its FOOTPRINT from the seed, and a gen-form body varies its plan LENGTH within its lot.
  // Pure function of (worldSeed, poi, call order) — the call order is fixed by the
  // deterministic rng, so worldgen stays fully reproducible (snapshot/replay re-derives it).
  // Drawing per CALL (not per success) means a footprint that didn't fit is re-rolled smaller
  // on the next attempt rather than retried identically.
  const poiHash = [...poi.id].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 7);
  const poiSeed = (worldSeed ^ poiHash) >>> 0;
  let synthSeq = 0;
  const instSeed = (): number => (poiSeed ^ Math.imul(++synthSeq, 0x9e3779b1)) >>> 0;

  // Terrain-aware siting (building-validity S3–S5 substrate, wired live here). The
  // height field is analytic from the seed, so a probe is valid at gen time. Absent a
  // map the placer stays purely distance-based (every legacy caller / test path).
  const terrain = map ? makeTerrainProbe(map) : null;
  // Cache the affordance per tile for this settlement: the fill loop re-orders the same
  // frontage slots once per building (and across both profiles), so the same tiles get
  // probed many times — and each affordance is ~30 height lookups. Pure function of the
  // tile, so caching is behaviour-preserving.
  const affCache = new Map<string, Record<string, unknown>>();
  const affAt = (tx: number, ty: number): Record<string, unknown> => {
    const k = `${tx},${ty}`;
    let a = affCache.get(k);
    if (a === undefined) { a = terrain!.affordanceAt(tx, ty); affCache.set(k, a); }
    return a;
  };
  const siteFitnessAt = (profile: SiteProfile) =>
    terrain ? (tx: number, ty: number) => siteFitness(affAt(tx, ty), profile) : undefined;
  // A POI's authored `size` scales how many buildings it musters (and the radius they
  // spread over) — a "large" market town should bustle where a hamlet stays a handful, but
  // the zone rule's base count ignored it, so even Oakshire (size:large) rolled ~3–4
  // buildings: enough for the church focus and a cottage or two, never the manor rung
  // (focusMin 6) nor the round-robin's later trades (smithy/tavern/bakehouse). Scaling the
  // count by size lets a large village clear those rungs, so its smithy + baker finally
  // plat. Radius grows with √scale so the denser roster still has lots to land on. The rng
  // draws stay in the SAME order (determinism preserved); a size-less POI (every test path)
  // scales by 1.0, so only authored, sized settlements change. Buildings that can't fit
  // simply don't place (occupancy-gated) — never invalidly.
  const SETTLEMENT_SIZE_SCALE: Record<string, number> = { small: 0.7, medium: 1.0, large: 1.8, huge: 2.6 };
  const sizeScale = SETTLEMENT_SIZE_SCALE[poi.size ?? 'medium'] ?? 1.0;
  const buildingCount = Math.max(1, Math.round(rng.int(zoneRule.buildingCount.min, zoneRule.buildingCount.max) * sizeScale));
  const radius = Math.round(rng.int(zoneRule.radius.min, zoneRule.radius.max) * Math.sqrt(sizeScale));

  // 1. Plan: road graph + market widening + burgage lots + wards.
  const plan = planSettlement({ x: cx, y: cy }, zoneRule, tiles, connectedDirections, rng);
  plan.poiId = poi.id;
  widenMarket(plan, tiles);
  subdivideLots(plan, tiles, worldSeed);
  assignWards(plan, radius, tiles, worldSeed);
  // S3b — a nucleated village (large enough to carry foci, the church rung) keeps
  // a central open green; a hamlet stays dense. Bigger settlements get a bigger
  // common. The green is a connectome-placed "mini biome" of tended meadow.
  const greenSize = buildingCount >= 4 ? (buildingCount >= 12 ? 4 : 3) : 0;
  planCivics(plan, tiles, worldSeed, greenSize);

  // Civic precincts (S5): reserve every civic tile against building placement —
  // props don't block via canPlaceIgnoringNature, so the fallback spiral would
  // otherwise drop a cottage on the well — and emit the well + graveyard as
  // standing props. The mill stays a reservation only (a working watermill is a
  // building, deferred to a later slice); any agent-registered civic without a
  // known entity kind likewise reserves ground without yet emitting a prop.
  // Only real settlements (with burgage lots) get civics — a lake / zero-count
  // POI stays empty.
  // S1: ONE settlement-local occupancy authority. Every producer (roads, civics,
  // buildings) claims the cells it writes here and consults it before writing —
  // deconfliction by construction, replacing the old roadSet/civicSet/registry
  // post-hoc filtering. Barriers later gate over 'building' claims.
  const occ = new OccupancyGrid();
  // The VISUAL extent of placed buildings (the bbox the renderer draws over —
  // `buildingVisualCells`), a SUPERSET of the solid 'building' claims in `occ`. The
  // barrier gate guard reads THIS so no slab is left poking out from under a silhouette
  // (door thresholds / draw-only cells live in visual\solid). Placement deconfliction
  // keeps reading `occ`'s solid cells, so worldgen placement is unchanged. (Spatial-
  // coordination C1.)
  const buildingVisual = new Set<string>();

  // Slice 3 — connectome loosening: keep the inter-POI trunk corridor clear of this
  // settlement's lots so the road threads through instead of detouring around sprawl.
  // Claimed as 'road' (settlements FRONT onto it); only cells near this hub matter, so
  // clip to the working radius rather than claiming the whole world per settlement.
  if (corridorReserved && plan.lots.length > 0) {
    const reach = radius + 4;
    for (const k of corridorReserved) {
      const ci = k.indexOf(',');
      const x = +k.slice(0, ci), y = +k.slice(ci + 1);
      if (Math.abs(x - cx) <= reach && Math.abs(y - cy) <= reach && !occ.has(x, y)) {
        occ.claim(x, y, 'road');
      }
    }
  }

  if (plan.lots.length > 0) {
    for (const c of plan.civics) {
      // Occupancy is settlement-local, but two settlements can sit close enough
      // that one's civic precinct (a water-seeking mill especially) lands on a
      // NEIGHBOUR's already-placed building. The world registry is the only
      // cross-settlement authority — skip a civic that would overlap one.
      if (world) {
        let blocked = false;
        for (let dy = 0; dy < c.h && !blocked; dy++) {
          for (let dx = 0; dx < c.w; dx++) {
            if (tileBlockedByBuilding(world, c.x + dx, c.y + dy)) { blocked = true; break; }
          }
        }
        if (blocked) continue;
      }
      occ.claimRect(c.x, c.y, c.w, c.h, 'civic');
      // S3b — the green is a ground-only precinct: paint it as tended meadow (a
      // lusher green than plain grass) so the open common reads against the
      // trampled dirt of the lanes/market around it. Wear leaves it alone.
      if (c.type === 'green') {
        for (let dy = 0; dy < c.h; dy++) {
          for (let dx = 0; dx < c.w; dx++) {
            const t = tiles[c.y + dy]?.[c.x + dx];
            if (t) { t.type = 'meadow'; t.walkable = true; }
          }
        }
      }
      // Every civic with a preset (mill building + well/graveyard props) goes
      // through the SAME pipeline: synthesize its blueprint, carve the footprint
      // solid, emit a blueprint entity. Name-derived seed keeps it deterministic
      // (no rng). The mill is a workplace; well/graveyard are civic props.
      const presetName = CIVIC_PRESETS[c.type];
      if (!presetName) continue;   // agent-registered precinct with no art: ground only
      const rb = synthesizeBlueprint(presetName, [], instSeed());
      if (!rb) continue;
      const civic = blueprintEntity(`${poi.id}_civic_${c.type}`, rb, c.x, c.y, { poiId: poi.id });
      civic.properties!.civic = c.type;
      const civicTags = c.type === 'mill' ? ['settlement', 'civic', 'workplace'] : ['settlement', 'civic'];
      civic.tags = [...new Set([...(civic.tags ?? []), ...civicTags])];
      clearFootprint(c.x, c.y, rb.footprint.w, rb.footprint.h, registry, world, tiles);
      registry.add(civic);
      entities.push(civic);
      // A building-class civic (the mill) is solid for barrier gating, exactly as
      // the old registry-read `tileBlockedByBuilding` treated it; props are not.
      if (isBuildingEntity(civic)) {
        occ.claimCells(buildingSolidCells(toCollision(rb), c.x, c.y), 'building');
        for (const cell of buildingVisualCells(rb, c.x, c.y)) buildingVisual.add(cell);
      }
    }
  }

  const roadTiles: RoadTile[] = [
    ...plan.edges.flatMap(e => e.tiles.map(t => ({ x: t.x, y: t.y, type: roadType }))),
    ...plan.market.map(m => ({ x: m.x, y: m.y, type: roadType })),
  ];
  for (const rt of roadTiles) occ.claim(rt.x, rt.y, 'road');

  // Lot lookup: unclaimed lot owning a given frontage slot, with a tile set
  // for footprint-containment checks.
  const lotTileSets = new Map<Lot, Set<string>>(
    plan.lots.map(l => [l, new Set(l.tiles.map(t => `${t.x},${t.y}`))]));
  const lotForSlot = (slot: FrontageSlot): Lot | undefined =>
    plan.lots.find(l => !l.buildingId
      && l.side[0] === slot.side[0] && l.side[1] === slot.side[1]
      && l.frontage.some(f => f.x === slot.roadX && f.y === slot.roadY));
  const footprintInLot = (lot: Lot, x: number, y: number, w: number, h: number): boolean => {
    const set = lotTileSets.get(lot);
    if (!set) return false;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (!set.has(`${x + dx},${y + dy}`)) return false;
      }
    }
    return true;
  };

  const constraint: PlacementConstraint = {
    allowedTerrain: [...BUILDABLE_TERRAIN],
    margin: 1,
    requiresRoadAccess: zoneRule.internalRoads,
  };
  const terrainSet = constraint.allowedTerrain;

  /** Footprint fits at origin: terrain + occupancy + off-road + site water rule. */
  const fitsAt = (x: number, y: number, w: number, h: number, nearWater?: number): boolean => {
    if (x < 0 || y < 0 || y + h > tiles.length || x + w > (tiles[0]?.length ?? 0)) return false;
    if (!footprintOnTerrain(x, y, w, h, tiles, terrainSet)) return false;
    if (!canPlaceIgnoringNature(x, y, w, h, constraint.margin, registry)) return false;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (occ.has(x + dx, y + dy)) return false;   // road/civic/building claim
        if (ROAD_TYPES.has(tiles[y + dy]?.[x + dx]?.type)) return false;
      }
    }
    if (nearWater !== undefined && !nearWaterTile(x, y, w, h, tiles, nearWater)) return false;
    return true;
  };

  // Establishments placed this gen, for the E2 site-expansion pass below: each core
  // building + the preset it was built from. After the main layout, every core is
  // expanded through `expandSite` and its auxiliary buildings (a tavern's stable) are
  // co-placed in the adjacent yard.
  const placedCores: { core: Entity; preset: string; x: number; y: number; w: number; h: number }[] = [];

  // 2. Execute placement. S3 — CENTER-FIRST: the settlement nucleates around its
  // FOCI (parish church / manor hall). Those anchor a central precinct first
  // (2a); dwellings then fill frontage lots around them (2b).
  let placed = 0;
  const roster = presetsForEra(zoneRule, era);
  // A focus appears only once the settlement is large enough (focusMin rung);
  // below that it's omitted so a tiny hamlet stays dwellings-only.
  const focusPresets = [...new Set(
    roster.filter(p => SITE_RULES[p]?.focus && buildingCount >= (SITE_RULES[p]?.focusMin ?? 0)),
  )];
  const fillRoster = roster.filter(p => !SITE_RULES[p]?.focus);
  const fillPool = fillRoster.length > 0 ? fillRoster : focusPresets;

  // Main door (outward facing + local door cell) from the blueprint anchor —
  // inverting toAnchors' half-tile outward offset (doorCells order is unrelated
  // to which door is main).
  const doorOf = (rb: ResolvedBlueprint): { facing: [number, number]; doorCell: number[] } => {
    const anchors = toAnchors(rb, 0, 0);
    const door = anchors.find(a => a.main) ?? anchors[0];
    const facing: [number, number] = door?.facing ?? [0, 1];
    const doorCell = door
      ? [door.x - (facing[0] > 0 ? 1 : facing[0] < 0 ? 0 : 0.5),
         door.y - (facing[1] > 0 ? 1 : facing[1] < 0 ? 0 : 0.5)]
      : (toCollision(rb).doorCells[0] ?? '0,0').split(',').map(Number);
    return { facing, doorCell };
  };

  // Commit a placed building: create the entity, clear + claim its footprint
  // (occupancy grid 'building' claim — S1), claim intersecting lots, keep the
  // door tile walkable, and (for non-frontage placements) carve a short
  // connector lane from the door toward the centre. Bumps `placed`.
  const commit = (
    rb: ResolvedBlueprint, origin: PlacementResult,
    facing: [number, number], doorCell: number[], viaSlot: boolean,
  ): Entity => {
    const entity = blueprintEntity(`${poi.id}_bld_${placed}`, rb, origin.tileX, origin.tileY, { poiId: poi.id });
    clearFootprint(origin.tileX, origin.tileY, rb.footprint.w, rb.footprint.h, registry, world, tiles);
    registry.add(entity);
    entities.push(entity);
    occ.claimCells(buildingSolidCells(toCollision(rb), origin.tileX, origin.tileY), 'building');
    for (const cell of buildingVisualCells(rb, origin.tileX, origin.tileY)) buildingVisual.add(cell);
    // Claim every lot the footprint INTERSECTS, so live growth (S3) never sees a
    // "free" lot with blocked tiles.
    for (const lot of plan.lots) {
      if (lot.buildingId) continue;
      const hit = lot.tiles.some(t =>
        t.x >= origin.tileX && t.x < origin.tileX + rb.footprint.w &&
        t.y >= origin.tileY && t.y < origin.tileY + rb.footprint.h);
      if (hit) lot.buildingId = entity.id;
    }
    const [doorLx, doorLy] = [doorCell[0], doorCell[1]];
    const doorTile = tiles[origin.tileY + doorLy]?.[origin.tileX + doorLx];
    if (doorTile) doorTile.walkable = true;
    // Frontage slots sit door-on-road by construction; central/fallback
    // placements carve a connector from the door's OUTWARD neighbour to the
    // centre (links the churchyard/manor green to the street).
    if (zoneRule.internalRoads && !viaSlot) {
      const path = bresenhamLine(origin.tileX + doorLx + facing[0], origin.tileY + doorLy + facing[1], cx, cy);
      for (let pi = 0; pi < Math.min(8, path.length); pi++) {
        const pt = path[pi];
        const t = tiles[pt.y]?.[pt.x];
        if (!t || WATER_TYPES.has(t.type)) break;
        if (t.walkable === false) break;   // never carve through a footprint
        if (occ.is(pt.x, pt.y, 'civic')) break;   // S3b: front the green, don't pave across it
        const hitRoad = occ.is(pt.x, pt.y, 'road') || ROAD_TYPES.has(t.type);
        roadTiles.push({ x: pt.x, y: pt.y, type: roadType });
        occ.claim(pt.x, pt.y, 'road');
        if (hitRoad) break;
      }
    }
    // Entrance clearance: keep the ground directly in front of the main door OPEN so
    // nothing parks on the doorstep (the "cottage in front of the church" bug). A focus
    // building (church/manor) reserves a small forecourt; any building reserves at least
    // its single approach tile. Claimed AFTER the connector carve and only on FREE,
    // buildable ground — so existing roads/footprints and the church's own lane survive,
    // and a frontage dwelling (door already on a road) reserves nothing extra.
    const isFocus = !!(rb.preset && SITE_RULES[rb.preset]?.focus);
    const reach = isFocus ? 2 : 1;          // tiles of clear depth in front of the door
    const halfW = isFocus ? 1 : 0;          // perpendicular half-width (focus ⇒ 3 wide)
    const px = -facing[1], py = facing[0];  // perpendicular to the door's facing
    const dxw = Math.round(origin.tileX + doorLx), dyw = Math.round(origin.tileY + doorLy);
    for (let step = 1; step <= reach; step++) {
      for (let s = -halfW; s <= halfW; s++) {
        const fx = dxw + facing[0] * step + px * s;
        const fy = dyw + facing[1] * step + py * s;
        const t = tiles[fy]?.[fx];
        if (!t || WATER_TYPES.has(t.type) || !occ.isFree(fx, fy)) continue;
        occ.claim(fx, fy, 'civic');
      }
    }
    if (rb.preset) {
      placedCores.push({ core: entity, preset: rb.preset, x: origin.tileX, y: origin.tileY, w: rb.footprint.w, h: rb.footprint.h });
    }
    placed++;
    return entity;
  };

  // 2a. Center-first foci: anchor each in a central precinct near the founding
  // node (a free-standing churchyard / manor green). A deep church footprint
  // won't fit a burgage lot and fronting a lane would push it to the rim, so it
  // claims the nearest clear, buildable ground to the centre instead.
  for (const presetName of focusPresets) {
    if (placed >= buildingCount) break;
    const rb = synthesizeBlueprint(presetName, [], instSeed());
    if (!rb) continue;
    const site = SITE_RULES[presetName];
    const fit = siteFitnessAt(siteProfileFor(presetName));
    const origin = findCentralPlacement(
      cx, cy, rb.footprint, (x, y, w, h) => fitsAt(x, y, w, h, site?.nearWater), radius,
      fit && ((x, y, w, h) => fit(x + Math.floor(w / 2), y + Math.floor(h / 2))),
    );
    if (!origin) continue;   // no central room (rare) → focus omitted this gen
    const { facing, doorCell } = doorOf(rb);
    commit(rb, origin, facing, doorCell, false);
  }

  // 2b. Fill dwellings on frontage lots, round-robin the non-focus roster.
  const focusPlaced = placed;
  for (let attempt = 0; attempt < buildingCount * 4 && placed < buildingCount && fillPool.length > 0; attempt++) {
    const presetName = fillPool[(placed - focusPlaced) % fillPool.length];
    const rb = synthesizeBlueprint(presetName, [], instSeed());
    if (!rb) continue;
    const site = SITE_RULES[presetName];
    const { facing, doorCell } = doorOf(rb);
    let origin: PlacementResult | null = null;

    // Pass 1: claim a burgage lot (footprint fully inside the lot — regular
    // spacing + back yard). Pass 2: any fitting slot for footprints no lot can hold.
    const orderedSlots = orderedSlotsFor(plan, facing, site, rng, siteFitnessAt(siteProfileFor(presetName)));
    for (const strictLots of [true, false]) {
      for (const slot of orderedSlots) {
        // Align the footprint edge on the DOOR side flush against the road.
        const { w, h } = rb.footprint;
        const ox = facing[0] > 0 ? slot.roadX - w
          : facing[0] < 0 ? slot.roadX + 1
          : slot.roadX - doorCell[0];
        const oy = facing[1] > 0 ? slot.roadY - h
          : facing[1] < 0 ? slot.roadY + 1
          : slot.roadY - doorCell[1];
        if (!fitsAt(ox, oy, w, h, site?.nearWater)) continue;
        if (strictLots) {
          const lot = lotForSlot(slot);
          if (!lot || !footprintInLot(lot, ox, oy, w, h)) continue;
        }
        origin = { tileX: ox, tileY: oy };
        break;
      }
      if (origin || plan.lots.length === 0) break;
    }

    // Fallback: spiral search near a jittered target (with the water rule).
    let viaSlot = origin !== null;
    if (!origin) {
      const targetX = Math.round(cx + (rng.next() * 2 - 1) * radius * 0.8);
      const targetY = Math.round(cy + (rng.next() * 2 - 1) * radius * 0.8);
      origin = findPlacement(
        { x: targetX, y: targetY }, rb.footprint,
        { ...constraint, nearWater: site?.nearWater }, tiles, registry, radius,
      );
      // Planned roads + civic precincts aren't on the tile grid yet — keep off them.
      if (origin) {
        const { tileX, tileY } = origin;
        outer: for (let dy = 0; dy < rb.footprint.h; dy++) {
          for (let dx = 0; dx < rb.footprint.w; dx++) {
            if (occ.has(tileX + dx, tileY + dy)) { origin = null; break outer; }
          }
        }
      }
      viaSlot = false;
    }
    if (!origin) continue;

    commit(rb, origin, facing, doorCell, viaSlot);
  }

  // 2c. Site expansion (E2): a placed establishment is not a lone footprint but a
  // PREMISES. Expand each core through the site connectome (expandSite → siteToPlan)
  // and co-place the parts its function derives — auxiliary BUILDINGS (a tavern's
  // stable, from its 'stabling' requirement) and ground/façade FIXTURES (a tavern's
  // well, from 'water-supply') — with no per-preset wiring. Everything is sited on
  // free, buildable, off-road ground adjacent to its core by a DETERMINISTIC spiral
  // scan (no rng draw), so the main layout is byte-identical and only the new parts
  // are appended. Runs before enclosure so a croft hedge rings the outbuildings AND
  // fixtures into the yard with their core.
  //
  // Two passes in order: ALL auxiliaries first, THEN all fixtures. The aux pass sees
  // exactly the occupancy state the old single-pass loop did (no fixture has claimed a
  // cell yet), so derived-building placement stays byte-identical; the wells/etc. are
  // a strictly additive second pass.
  if (placedCores.length > 0) {
    loadDefaultPacks();
    const siteCtx = { era, seed: worldSeed, registry: catalogue };
    const sited = placedCores.map((pc) => ({
      pc,
      plan: siteToPlan(expandSite(pc.preset, siteCtx)),
      ccx: pc.x + Math.floor(pc.w / 2),
      ccy: pc.y + Math.floor(pc.h / 2),
    }));
    // Scan rings outward from a core centre; the first fitting origin (in fixed scan
    // order) wins — deterministic, no rng. Capped so a part stays in the yard, never
    // sprawls across the settlement.
    const siteNear = (
      ccx: number, ccy: number, coreW: number, coreH: number, fw: number, fh: number,
    ): { x: number; y: number } | null => {
      for (let r = Math.max(coreW, coreH, 2); r <= Math.max(coreW, coreH) + 5; r++) {
        for (const p of spiralRing(ccx, ccy, r)) {
          if (fitsAt(p.x, p.y, fw, fh)) return p;
        }
      }
      return null;
    };

    // Pass 1 — auxiliary BUILDINGS (solid, on the shared occ grid).
    let auxIdx = 0;
    for (const { pc, plan, ccx, ccy } of sited) {
      for (const aux of plan.auxiliaries) {
        const arb = synthesizeBlueprint(aux.buildingType, [], instSeed());
        if (!arb) continue;
        const { w: aw, h: ah } = arb.footprint;
        const spot = siteNear(ccx, ccy, pc.w, pc.h, aw, ah);
        if (!spot) continue;
        const entity = blueprintEntity(`${poi.id}_aux_${auxIdx++}`, arb, spot.x, spot.y, { poiId: poi.id });
        entity.tags = [...new Set([...(entity.tags ?? []), 'settlement', 'building', 'auxiliary'])];
        entity.properties!.site = pc.core.id;
        entity.properties!.role = aux.role;
        clearFootprint(spot.x, spot.y, aw, ah, registry, world, tiles);
        registry.add(entity);
        entities.push(entity);
        occ.claimCells(buildingSolidCells(toCollision(arb), spot.x, spot.y), 'building');
        for (const cell of buildingVisualCells(arb, spot.x, spot.y)) buildingVisual.add(cell);
        // Reopen the door threshold(s): clearFootprint marked the whole footprint
        // solid, but an auxiliary (a stable) is enterable like any building, so its
        // door cells stay walkable — same rule the core `commit` applies.
        for (const dc of toCollision(arb).doorCells) {
          const [ddx, ddy] = dc.split(',').map(Number);
          const dt = tiles[spot.y + ddy]?.[spot.x + ddx];
          if (dt) dt.walkable = true;
        }
      }
    }

    // Pass 2 — ground/façade FIXTURES, realised iff the fixture type names a prop
    // blueprint (e.g. the catalogue 'well' fixtureType ↔ the 'well' civic prop). Data-
    // only tokens (signage/seating) have no part to draw yet, so they stay graph-only
    // until a prop is authored for them — `synthesizeBlueprint` returns undefined and we
    // skip. A class:'building' match is ignored (those are auxiliaries, handled above).
    // Props aren't solid, so the cells are reserved as 'civic' (a road/building won't
    // reuse them, and the croft hedge rings the well in rather than gating around it).
    let fxIdx = 0;
    for (const { pc, plan, ccx, ccy } of sited) {
      for (const fx of plan.fixtures) {
        const frb = synthesizeBlueprint(fx.type, [], instSeed());
        if (!frb || frb.class === 'building') continue;
        const { w: fw, h: fh } = frb.footprint;
        const spot = siteNear(ccx, ccy, pc.w, pc.h, fw, fh);
        if (!spot) continue;
        const entity = blueprintEntity(`${poi.id}_fx_${fxIdx++}`, frb, spot.x, spot.y, { poiId: poi.id });
        entity.tags = [...new Set([...(entity.tags ?? []), 'settlement', 'fixture'])];
        entity.properties!.site = pc.core.id;
        entity.properties!.fixtureType = fx.type;
        clearFootprint(spot.x, spot.y, fw, fh, registry, world, tiles);
        registry.add(entity);
        entities.push(entity);
        for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) occ.claim(spot.x + dx, spot.y + dy, 'civic');
      }
    }
  }

  // 3. Enclose (DC-3, barriers half): ring built crofts with hedges/fences and,
  // for villages and towns, the whole settlement with a palisade or town wall.
  // Gates open where roads (and water) cross the line. Barriers are committed
  // straight to the World (registry + indexes), so they are NOT added to
  // `result.entities` (which the map-generator re-indexes) — avoiding a double
  // index. Skipped for non-settlements (no lots) or when no world is bound.
  if (world && plan.lots.length > 0 && placed > 0) {
    const ctx: EnclosureCtx = { era };

    // A cell the building is DRAWN over — barrier rings gate (open) rather than
    // run through it. We consult the VISUAL extent (the renderer's structure box),
    // not just the solid walls, so a slab can't peek out from under a door threshold
    // or a draw-only part cell (the residual fence-through-building leak). C1.
    const isBuilding = (x: number, y: number) => buildingVisual.has(`${x},${y}`);

    // Per-croft enclosures (hedge/fence/wall) around each built lot.
    for (const { id, run } of deriveCroftEnclosures(plan.lots, poi.id, rng, ctx, isBuilding)) {
      placeBarrier(world, run, id);
    }

    // Settlement ring — bbox over the built area (lots + roads + market + civics).
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const bump = (x: number, y: number) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    };
    for (const lot of plan.lots) for (const t of lot.tiles) bump(t.x, t.y);
    for (const rt of roadTiles) bump(rt.x, rt.y);
    for (const c of plan.civics) { bump(c.x, c.y); bump(c.x + c.w - 1, c.y + c.h - 1); }

    if (Number.isFinite(minX)) {
      const ring = deriveSettlementRing({
        bbox: { minX, minY, maxX, maxY },
        mapW: tiles[0]?.length ?? 0, mapH: tiles.length,
        buildingCount: placed, poiId: poi.id,
        isWater: (x, y) => WATER_TYPES.has(tiles[y]?.[x]?.type ?? ''),
        isRoad: (x, y) => occ.is(x, y, 'road') || ROAD_TYPES.has(tiles[y]?.[x]?.type ?? ''),
        isBuilding,
        ctx,
      });
      if (ring) placeBarrier(world, ring.run, ring.id);
    }
  }

  return { entities, roadTiles, plan };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate the ring of positions at Manhattan distance r from (cx, cy) */
function spiralRing(cx: number, cy: number, r: number): { x: number; y: number }[] {
  if (r === 0) return [{ x: cx, y: cy }];
  const pts: { x: number; y: number }[] = [];
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === r) {
        pts.push({ x: cx + dx, y: cy + dy });
      }
    }
  }
  return pts;
}

function footprintOnTerrain(
  x: number, y: number, w: number, h: number,
  tiles: Tile[][], allowed: string[],
): boolean {
  const allowedSet = new Set(allowed);
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tile = tiles[y + dy]?.[x + dx];
      if (!tile || !allowedSet.has(tile.type)) return false;
    }
  }
  return true;
}

function nearWaterTile(
  x: number, y: number, w: number, h: number,
  tiles: Tile[][], maxDist: number,
): boolean {
  const waterTypes = new Set(['shallow_water', 'deep_water', 'river']);
  for (let dy = -maxDist; dy < h + maxDist; dy++) {
    for (let dx = -maxDist; dx < w + maxDist; dx++) {
      const tile = tiles[y + dy]?.[x + dx];
      if (tile && waterTypes.has(tile.type)) return true;
    }
  }
  return false;
}

/** Simple Bresenham line between two points */
function bresenhamLine(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0, y = y0;
  while (true) {
    pts.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 <  dx) { err += dx; y += sy; }
  }
  return pts;
}
