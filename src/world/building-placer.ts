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

import type { WorldEntity, Tile, Era, ReligiousSignificance } from '@/core/types';
import type { EntityRegistry } from './entity-registry';
import type { BuildingTemplate } from '@/map/building-templates';
import { getBuildingTemplate } from '@/map/building-templates';
import type { ZoneRule } from '@/map/poi-zones';
import type { POI } from '@/core/types';
import { Random } from '@/core/noise';

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
  entities:  WorldEntity[];
  roadTiles: RoadTile[];
}

// ─── Spiral search ────────────────────────────────────────────────────────────

/**
 * Spiral outward from (cx, cy) to find a valid placement position for a
 * building with the given footprint, constraints, and terrain.
 *
 * Returns null if no valid position found within maxRadius.
 */
export function findPlacement(
  center:     { x: number; y: number },
  template:   BuildingTemplate,
  constraint: PlacementConstraint,
  tiles:      Tile[][],
  registry:   EntityRegistry,
  maxRadius = 20,
): PlacementResult | null {
  const { w, h } = template.footprint;
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

      // Occupancy check (includes margin)
      if (!registry.canPlace(x0, y0, w, h, margin)) continue;

      // Water adjacency check
      if (nearWater !== undefined) {
        if (!nearWaterTile(x0, y0, w, h, tiles, nearWater)) continue;
      }

      return { tileX: x0, tileY: y0 };
    }
  }
  return null;
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
): SettlementResult {
  const cx = poi.position?.x ?? 0;
  const cy = poi.position?.y ?? 0;
  const entities:  WorldEntity[] = [];
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
      const rx = startX + mainDir.dx * i;
      const ry = startY + mainDir.dy * i;
      roadTiles.push({ x: rx, y: ry, type: roadType });
      if (zoneRule.roadLayout === 'branching' && i === Math.floor(roadLength / 2)) {
        // Add one short perpendicular branch
        for (let b = 1; b <= Math.min(3, radius); b++) {
          roadTiles.push({ x: rx + perpDir.dx * b, y: ry + perpDir.dy * b, type: roadType });
          roadTiles.push({ x: rx - perpDir.dx * b, y: ry - perpDir.dy * b, type: roadType });
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

  for (let attempt = 0; attempt < buildingCount * 4 && placed < buildingCount; attempt++) {
    const templateId = zoneRule.buildings[placed % zoneRule.buildings.length];
    const template   = getBuildingTemplate(templateId);
    if (!template) continue;

    // Candidate center: offset along/across road with jitter
    const along = (rng.next() * 2 - 1) * radius * 0.8;
    const perp  = (rng.next() * 2 - 1) * 3;
    const perpDir = { dx: -mainDir.dy, dy: mainDir.dx };

    const targetX = Math.round(cx + mainDir.dx * along + perpDir.dx * perp);
    const targetY = Math.round(cy + mainDir.dy * along + perpDir.dy * perp);

    const result = findPlacement(
      { x: targetX, y: targetY },
      template,
      constraint,
      tiles,
      registry,
      radius,
    );
    if (!result) continue;

    const entityId = `${poi.id}_bld_${placed}`;
    const religious: ReligiousSignificance =
      template.category === 'religious' ? 'sacred'
      : template.category === 'special'  ? 'neutral'
      : 'neutral';

    const entity: WorldEntity = {
      id:                    entityId,
      category:              'building',
      type:                  templateId,
      templateId,
      tileX:                 result.tileX,
      tileY:                 result.tileY,
      footprint:             { ...template.footprint },
      poiId:                 poi.id,
      era:                   template.era ?? era,
      religiousSignificance: template.religiousSignificance ?? religious,
      state:                 'intact',
      metadata:              {},
      sortYOffset:           template.sortYOffset,
    };

    registry.add(entity);
    entities.push(entity);

    // 4. Carve path from door to nearest road tile
    if (zoneRule.internalRoads) {
      const doorX = result.tileX + template.doorCell.x;
      const doorY = result.tileY + template.doorCell.y;
      const path  = bresenhamLine(doorX, doorY, cx, cy);
      for (const pt of path.slice(0, 4)) {
        roadTiles.push({ x: pt.x, y: pt.y, type: roadType });
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
