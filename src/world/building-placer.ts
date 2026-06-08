/**
 * Building Placer
 *
 * Generic constraint-based building placement + organic road-first settlement
 * layout. Replaces the 10 hardcoded `place*` methods in WFCEngine.
 *
 * Settlement layout algorithm (road-first, organic):
 *   1. Determine main road direction from connected POIs
 *   2. Carve main road through settlement center
 *   3. Add 1-2 branching side paths for larger settlements
 *   4. Place primary building (temple/keep/tavern) at center/crossroads
 *   5. Scatter remaining buildings along road edges with random perpendicular
 *      offset (1-2 tiles), staggered spacing
 *   6. Carve short dirt paths connecting doors to nearest road tile
 */

import type { Entity, Tile, Era } from '@/core/types';
import type { World } from '@/world/world';
import type { EntityRegistry } from './entity-registry';
import type { ZoneRule } from '@/map/poi-zones';
import { presetsForEra } from '@/map/poi-zones';
import type { POI } from '@/core/types';
import { Random } from '@/core/noise';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { blueprintEntity, blueprintOf } from '@/blueprint/entity';

/** Water tile types — road tiles must not be placed on these */
const WATER_TYPES = new Set(['deep_water', 'shallow_water', 'river', 'ocean', 'water']);

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
 * Place buildings for a POI settlement using road-first organic layout.
 *
 * Returns all WorldEntity objects created (buildings + road markers).
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
  const roadTiles: RoadTile[]    = [];
  const roadType  = zoneRule.internalRoadType ?? 'dirt_road';
  const buildingCount = rng.int(zoneRule.buildingCount.min, zoneRule.buildingCount.max);

  // 1. Choose main road axis from connected POIs (or default to horizontal)
  const mainDir = connectedDirections.length > 0
    ? connectedDirections[0]
    : { dx: 1, dy: 0 };

  const radius = rng.int(zoneRule.radius.min, zoneRule.radius.max);

  // 2. Carve main road through center
  if (zoneRule.internalRoads && zoneRule.roadLayout !== 'none') {
    const roadLength = radius * 2 + 1;
    const perpDir = { dx: -mainDir.dy, dy: mainDir.dx };
    const startX = cx - mainDir.dx * radius;
    const startY = cy - mainDir.dy * radius;
    for (let i = 0; i <= roadLength; i++) {
      const rx = Math.round(startX + mainDir.dx * i);
      const ry = Math.round(startY + mainDir.dy * i);
      if (!WATER_TYPES.has(tiles[ry]?.[rx]?.type)) {
        roadTiles.push({ x: rx, y: ry, type: roadType });
      }
      if (zoneRule.roadLayout === 'branching' && i === Math.floor(roadLength / 2)) {
        // Add one short perpendicular branch
        for (let b = 1; b <= Math.min(3, radius); b++) {
          const brx1 = rx + perpDir.dx * b, bry1 = ry + perpDir.dy * b;
          const brx2 = rx - perpDir.dx * b, bry2 = ry - perpDir.dy * b;
          if (!WATER_TYPES.has(tiles[bry1]?.[brx1]?.type)) {
            roadTiles.push({ x: brx1, y: bry1, type: roadType });
          }
          if (!WATER_TYPES.has(tiles[bry2]?.[brx2]?.type)) {
            roadTiles.push({ x: brx2, y: bry2, type: roadType });
          }
        }
      }
    }
  }

  // 3. Place buildings along road
  let placed = 0;
  const constraint: PlacementConstraint = {
    allowedTerrain: ['grass', 'dirt', 'sand', 'scrubland', 'farm_field', 'sacred_grove',
                      'hills', 'glen', 'dirt_road', 'stone_road'],
    margin: 1,
    requiresRoadAccess: zoneRule.internalRoads,
  };
  const roster = presetsForEra(zoneRule, era);

  for (let attempt = 0; attempt < buildingCount * 4 && placed < buildingCount && roster.length > 0; attempt++) {
    const presetName = roster[placed % roster.length];
    const rb = synthesizeBlueprint(presetName);
    if (!rb) continue;

    const along = (rng.next() * 2 - 1) * radius * 0.8;
    const perp  = (rng.next() * 2 - 1) * 3;
    const perpDir = { dx: -mainDir.dy, dy: mainDir.dx };
    const targetX = Math.round(cx + mainDir.dx * along + perpDir.dx * perp);
    const targetY = Math.round(cy + mainDir.dy * along + perpDir.dy * perp);

    const result = findPlacement(
      { x: targetX, y: targetY }, rb.footprint, constraint, tiles, registry, radius,
    );
    if (!result) continue;

    const entity = blueprintEntity(
      `${poi.id}_bld_${placed}`, rb, result.tileX, result.tileY, { poiId: poi.id },
    );

    clearFootprint(
      result.tileX, result.tileY, rb.footprint.w, rb.footprint.h,
      registry, world, tiles,
    );

    registry.add(entity);
    entities.push(entity);

    // Footprint-local door cell, from the precomputed collision mask.
    const [doorLx, doorLy] = (blueprintOf(entity)?.collision.doorCells[0] ?? '0,0').split(',').map(Number);

    // Door tile stays walkable so mortals can reach the entrance (collision
    // already treats the door cell as passable; keep the tile flag in sync).
    const doorTile = tiles[result.tileY + doorLy]?.[result.tileX + doorLx];
    if (doorTile) doorTile.walkable = true;

    if (zoneRule.internalRoads) {
      const doorX = result.tileX + doorLx;
      const doorY = result.tileY + doorLy;
      const roadPositions = new Set(roadTiles.map(rt => `${rt.x},${rt.y}`));
      const path = bresenhamLine(doorX, doorY, cx, cy);
      for (let pi = 0; pi < Math.min(6, path.length); pi++) {
        const pt = path[pi];
        const tileType = tiles[pt.y]?.[pt.x]?.type;
        if (WATER_TYPES.has(tileType)) break;
        roadTiles.push({ x: pt.x, y: pt.y, type: roadType });
        if (roadPositions.has(`${pt.x},${pt.y}`) || ROAD_TYPES.has(tileType)) break;
      }
    }

    placed++;
  }

  return { entities, roadTiles };
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
