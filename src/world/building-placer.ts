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
import { blueprintEntity } from '@/blueprint/entity';
import { toCollision } from '@/blueprint/compile/to-collision';
import { toAnchors } from '@/blueprint/compile/to-anchors';
import {
  planSettlement, orderedSlotsFor, WATER_TYPES, SITE_RULES,
  type SettlementPlan,
} from './settlement-plan';

/** Road tile types — door paths stop when they reach an existing road */
const ROAD_TYPES = new Set(['dirt_road', 'stone_road', 'bridge']);

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
): SettlementResult {
  const cx = poi.position?.x ?? 0;
  const cy = poi.position?.y ?? 0;
  const entities:  Entity[] = [];
  const roadType  = zoneRule.internalRoadType ?? 'dirt_road';
  const buildingCount = rng.int(zoneRule.buildingCount.min, zoneRule.buildingCount.max);
  const radius = rng.int(zoneRule.radius.min, zoneRule.radius.max);

  // 1. Plan: road graph + frontage slots.
  const plan = planSettlement({ x: cx, y: cy }, zoneRule, tiles, connectedDirections, rng);
  const roadTiles: RoadTile[] = plan.edges.flatMap(e =>
    e.tiles.map(t => ({ x: t.x, y: t.y, type: roadType })));
  const roadSet = new Set(roadTiles.map(rt => `${rt.x},${rt.y}`));

  const constraint: PlacementConstraint = {
    allowedTerrain: ['grass', 'dirt', 'sand', 'scrubland', 'farm_field', 'sacred_grove',
                      'hills', 'glen', 'dirt_road', 'stone_road'],
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
        if (roadSet.has(`${x + dx},${y + dy}`)) return false;
        if (ROAD_TYPES.has(tiles[y + dy]?.[x + dx]?.type)) return false;
      }
    }
    if (nearWater !== undefined && !nearWaterTile(x, y, w, h, tiles, nearWater)) return false;
    return true;
  };

  // 2. Execute: claim frontage slots (door faces its road tile), spiral fallback.
  let placed = 0;
  const roster = presetsForEra(zoneRule, era);

  for (let attempt = 0; attempt < buildingCount * 4 && placed < buildingCount && roster.length > 0; attempt++) {
    const presetName = roster[placed % roster.length];
    const rb = synthesizeBlueprint(presetName);
    if (!rb) continue;
    const site = SITE_RULES[presetName];

    // Main door: outward facing + local cell, from the blueprint anchor
    // (inverting toAnchors' half-tile outward offset — doorCells order is
    // unrelated to which door is main).
    const anchors = toAnchors(rb, 0, 0);
    const door = anchors.find(a => a.main) ?? anchors[0];
    const facing: [number, number] = door?.facing ?? [0, 1];
    const doorCell = door
      ? [door.x - (facing[0] > 0 ? 1 : facing[0] < 0 ? 0 : 0.5),
         door.y - (facing[1] > 0 ? 1 : facing[1] < 0 ? 0 : 0.5)]
      : (toCollision(rb).doorCells[0] ?? '0,0').split(',').map(Number);
    let origin: PlacementResult | null = null;

    for (const slot of orderedSlotsFor(plan, facing, site, rng)) {
      // Align the footprint edge on the DOOR side flush against the road —
      // the door fronts the road across at most its own yard strip (some
      // presets keep a lawn row between the body and the footprint edge).
      const { w, h } = rb.footprint;
      const ox = facing[0] > 0 ? slot.roadX - w
        : facing[0] < 0 ? slot.roadX + 1
        : slot.roadX - doorCell[0];
      const oy = facing[1] > 0 ? slot.roadY - h
        : facing[1] < 0 ? slot.roadY + 1
        : slot.roadY - doorCell[1];
      if (fitsAt(ox, oy, w, h, site?.nearWater)) {
        origin = { tileX: ox, tileY: oy };
        break;
      }
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
      // Planned roads aren't on the tile grid yet — keep footprints off them.
      if (origin) {
        const { tileX, tileY } = origin;
        outer: for (let dy = 0; dy < rb.footprint.h; dy++) {
          for (let dx = 0; dx < rb.footprint.w; dx++) {
            if (roadSet.has(`${tileX + dx},${tileY + dy}`)) { origin = null; break outer; }
          }
        }
      }
      viaSlot = false;
    }
    if (!origin) continue;

    const entity = blueprintEntity(
      `${poi.id}_bld_${placed}`, rb, origin.tileX, origin.tileY, { poiId: poi.id },
    );

    clearFootprint(
      origin.tileX, origin.tileY, rb.footprint.w, rb.footprint.h,
      registry, world, tiles,
    );

    registry.add(entity);
    entities.push(entity);

    // Door tile stays walkable so mortals can reach the entrance (collision
    // already treats the door cell as passable; keep the tile flag in sync).
    const [doorLx, doorLy] = [doorCell[0], doorCell[1]];
    const doorTile = tiles[origin.tileY + doorLy]?.[origin.tileX + doorLx];
    if (doorTile) doorTile.walkable = true;

    // Slot placements sit door-on-road by construction; fallback placements
    // get a short carved connector from the door's OUTWARD neighbour (the
    // door cell itself belongs to the footprint) toward the centre.
    if (zoneRule.internalRoads && !viaSlot) {
      const doorX = origin.tileX + doorLx + facing[0];
      const doorY = origin.tileY + doorLy + facing[1];
      const path = bresenhamLine(doorX, doorY, cx, cy);
      for (let pi = 0; pi < Math.min(6, path.length); pi++) {
        const pt = path[pi];
        const t = tiles[pt.y]?.[pt.x];
        if (!t || WATER_TYPES.has(t.type)) break;
        // Never carve through a building footprint (the door tile itself is walkable).
        if (t.walkable === false) break;
        const hitRoad = roadSet.has(`${pt.x},${pt.y}`) || ROAD_TYPES.has(t.type);
        roadTiles.push({ x: pt.x, y: pt.y, type: roadType });
        roadSet.add(`${pt.x},${pt.y}`);
        if (hitRoad) break;
      }
    }

    placed++;
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
