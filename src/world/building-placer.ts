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

import type { Entity, Tile, Era } from '@/core/types';
import type { World } from '@/world/world';
import type { EntityRegistry } from './entity-registry';
import type { ZoneRule } from '@/map/poi-zones';
import { presetsForEra } from '@/map/poi-zones';
import type { POI } from '@/core/types';
import { Random } from '@/core/noise';
import { synthesizeBlueprint } from '@/blueprint/presets';
import type { ResolvedBlueprint } from '@/blueprint/types';
import { blueprintEntity } from '@/blueprint/entity';
import { toCollision } from '@/blueprint/compile/to-collision';
import { toAnchors } from '@/blueprint/compile/to-anchors';
import { placeBarrier } from '@/world/place-barrier';
import { isBuilding as isBuildingEntity, tileBlockedByBuilding } from '@/world/building-collision';
import { OccupancyGrid, buildingSolidCells } from '@/world/occupancy-grid';
import { deriveCroftEnclosures, deriveSettlementRing, type EnclosureCtx } from '@/world/enclosure';
import {
  planSettlement, orderedSlotsFor, subdivideLots, widenMarket, assignWards, planCivics,
  WATER_TYPES, BUILDABLE_TERRAIN, SITE_RULES,
  type SettlementPlan, type Lot, type FrontageSlot,
} from './settlement-plan';

/** Road tile types — door paths stop when they reach an existing road */
const ROAD_TYPES = new Set(['dirt_road', 'stone_road', 'bridge']);

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
export function findCentralPlacement(
  cx: number, cy: number, fp: { w: number; h: number },
  fits: (x: number, y: number, w: number, h: number) => boolean, maxRadius: number,
): PlacementResult | null {
  const ax = cx - Math.floor(fp.w / 2), ay = cy - Math.floor(fp.h / 2);
  for (let r = 0; r <= maxRadius; r++) {
    for (const { x, y } of spiralRing(ax, ay, r)) {
      if (fits(x, y, fp.w, fp.h)) return { tileX: x, tileY: y };
    }
  }
  return null;
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
): SettlementResult {
  const cx = poi.position?.x ?? 0;
  const cy = poi.position?.y ?? 0;
  const entities:  Entity[] = [];
  const roadType  = zoneRule.internalRoadType ?? 'dirt_road';
  const buildingCount = rng.int(zoneRule.buildingCount.min, zoneRule.buildingCount.max);
  const radius = rng.int(zoneRule.radius.min, zoneRule.radius.max);

  // 1. Plan: road graph + market widening + burgage lots + wards.
  const plan = planSettlement({ x: cx, y: cy }, zoneRule, tiles, connectedDirections, rng);
  plan.poiId = poi.id;
  widenMarket(plan, tiles);
  subdivideLots(plan, tiles, worldSeed);
  assignWards(plan, radius, tiles, worldSeed);
  planCivics(plan, tiles, worldSeed);

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
      // Every civic with a preset (mill building + well/graveyard props) goes
      // through the SAME pipeline: synthesize its blueprint, carve the footprint
      // solid, emit a blueprint entity. Name-derived seed keeps it deterministic
      // (no rng). The mill is a workplace; well/graveyard are civic props.
      const presetName = CIVIC_PRESETS[c.type];
      if (!presetName) continue;   // agent-registered precinct with no art: ground only
      const rb = synthesizeBlueprint(presetName);
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
      if (isBuildingEntity(civic)) occ.claimCells(buildingSolidCells(toCollision(rb), c.x, c.y), 'building');
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
        const hitRoad = occ.is(pt.x, pt.y, 'road') || ROAD_TYPES.has(t.type);
        roadTiles.push({ x: pt.x, y: pt.y, type: roadType });
        occ.claim(pt.x, pt.y, 'road');
        if (hitRoad) break;
      }
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
    const rb = synthesizeBlueprint(presetName);
    if (!rb) continue;
    const site = SITE_RULES[presetName];
    const origin = findCentralPlacement(
      cx, cy, rb.footprint, (x, y, w, h) => fitsAt(x, y, w, h, site?.nearWater), radius,
    );
    if (!origin) continue;   // no central room (rare) → focus omitted this gen
    const { facing, doorCell } = doorOf(rb);
    commit(rb, origin, facing, doorCell, false);
  }

  // 2b. Fill dwellings on frontage lots, round-robin the non-focus roster.
  const focusPlaced = placed;
  for (let attempt = 0; attempt < buildingCount * 4 && placed < buildingCount && fillPool.length > 0; attempt++) {
    const presetName = fillPool[(placed - focusPlaced) % fillPool.length];
    const rb = synthesizeBlueprint(presetName);
    if (!rb) continue;
    const site = SITE_RULES[presetName];
    const { facing, doorCell } = doorOf(rb);
    let origin: PlacementResult | null = null;

    // Pass 1: claim a burgage lot (footprint fully inside the lot — regular
    // spacing + back yard). Pass 2: any fitting slot for footprints no lot can hold.
    const orderedSlots = orderedSlotsFor(plan, facing, site, rng);
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

  // 3. Enclose (DC-3, barriers half): ring built crofts with hedges/fences and,
  // for villages and towns, the whole settlement with a palisade or town wall.
  // Gates open where roads (and water) cross the line. Barriers are committed
  // straight to the World (registry + indexes), so they are NOT added to
  // `result.entities` (which the map-generator re-indexes) — avoiding a double
  // index. Skipped for non-settlements (no lots) or when no world is bound.
  if (world && plan.lots.length > 0 && placed > 0) {
    const ctx: EnclosureCtx = { era };

    // A building structure cell — barrier rings gate (open) rather than run
    // through it. The occupancy grid holds every solid building cell (roster +
    // the mill) claimed during placement, so this is the same notion of "inside
    // the walls" the old registry read (`tileBlockedByBuilding`) gave.
    const isBuilding = (x: number, y: number) => occ.is(x, y, 'building');

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
