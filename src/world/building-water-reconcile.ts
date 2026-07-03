/**
 * Post-carve building/water reconciliation (WP-I, task #22).
 *
 * Buildings are placed on validated dry ground: `building-placer.ts`'s `fitsAt` /
 * `findPlacement` reject any `WATER_TYPES` cell in a footprint at PLACEMENT time.
 * But the inter-POI connection carve (`buildRoadGraph`, `src/world/road-graph.ts`)
 * runs AFTER every settlement is placed, and — by design — a `river`/`wall` feature
 * ignores building obstacles ("Rivers/walls ignore the obstacle (only roads obey
 * it)", `road-graph.ts`): a real river doesn't detour around a building, so its
 * carve stamps straight through one if an authored river's centerline happens to
 * reach for a POI a building already occupies (e.g. a river terminating IN a swamp
 * whose shrine sits near the swamp's centre). The building was valid when placed;
 * the ground changed under it afterward.
 *
 * This is the same kind of "final authority" reconciliation `reconcileBarriersWithBuildings`
 * (`place-barrier.ts`) already runs for barrier rings after buildings settle: once every
 * terrain-mutating pass (rivers, roads, crossings) is done, nudge any building whose
 * footprint now touches water to the nearest dry, unoccupied, off-road ground — never
 * leave one floating on water. Pure geometry over the tile grid + registry, no rng,
 * deterministic; the search is a small local spiral (a nudge, not a re-placement) so a
 * relocated building still reads as "the shrine that sits by the river", not teleported.
 */
import type { Tile } from '@/core/types';
import type { World } from '@/world/world';
import { WATER_TYPES } from '@/core/constants';
import { BUILDABLE_TERRAIN } from '@/world/settlement-plan';
import { isBuilding, tileBlockedByBuilding } from '@/world/building-collision';
import { clearFootprint } from '@/world/building-placer';

/** Road tile types — a nudged building must not land on a carved road either. */
const ROAD_TYPES = new Set(['dirt_road', 'stone_road', 'bridge']);

/** A relocated building: id + its new footprint origin (callers with a stale
 *  copy of the origin — e.g. `GameMap.buildings` — should patch it). */
export interface WaterReconcileMove {
  id: string;
  x: number;
  y: number;
}

/** Kept small: this is a NUDGE to the nearest dry ground, not a re-placement —
 *  a building that can't find dry land within this radius is left in place (rare;
 *  a lint finding better surfaces that than a silent large teleport). */
const MAX_SEARCH_RADIUS = 12;

function footprintCells(x: number, y: number, w: number, h: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: x + dx, y: y + dy });
  return out;
}

function footprintTouchesWater(x: number, y: number, w: number, h: number, tiles: Tile[][]): boolean {
  for (const c of footprintCells(x, y, w, h)) {
    const t = tiles[c.y]?.[c.x];
    if (t && WATER_TYPES.has(t.type)) return true;
  }
  return false;
}

/** Dry, buildable, off-road, unoccupied (by any OTHER building) footprint. */
function footprintFits(
  x: number, y: number, w: number, h: number, tiles: Tile[][], world: World, selfId: string,
): boolean {
  const width = tiles[0]?.length ?? 0, height = tiles.length;
  if (x < 0 || y < 0 || x + w > width || y + h > height) return false;
  for (const c of footprintCells(x, y, w, h)) {
    const t = tiles[c.y]?.[c.x];
    if (!t || !BUILDABLE_TERRAIN.has(t.type) || ROAD_TYPES.has(t.type)) return false;
    if (tileBlockedByBuilding(world, c.x, c.y, selfId)) return false;
  }
  return true;
}

/** Chebyshev ring of candidate top-left origins at exactly radius `r` from (cx,cy). */
function ring(cx: number, cy: number, r: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === r) pts.push({ x: cx + dx, y: cy + dy });
    }
  }
  return pts;
}

/**
 * Nudge every building whose footprint overlaps water (checked AFTER every
 * terrain-mutating carve has run) to the nearest dry, unoccupied, off-road spot.
 * Returns the moves actually made, so a caller holding a stale copy of a
 * building's origin (`GameMap.buildings`) can patch it in step.
 */
export function reconcileBuildingsWithWater(world: World, tiles: Tile[][]): WaterReconcileMove[] {
  const moves: WaterReconcileMove[] = [];
  for (const e of world.registry.all()) {
    if (!isBuilding(e)) continue;
    const fp = e.properties?.footprint as { w: number; h: number } | undefined;
    const w = fp?.w ?? 1, h = fp?.h ?? 1;
    const x0 = Math.floor(e.x), y0 = Math.floor(e.y);
    if (!footprintTouchesWater(x0, y0, w, h, tiles)) continue;

    let dest: { x: number; y: number } | null = null;
    for (let r = 1; r <= MAX_SEARCH_RADIUS && !dest; r++) {
      for (const p of ring(x0, y0, r)) {
        if (footprintFits(p.x, p.y, w, h, tiles, world, e.id)) { dest = p; break; }
      }
    }
    if (!dest) continue;   // no dry ground within reach — left in place (lint still catches it)

    clearFootprint(dest.x, dest.y, w, h, world.registry, world, tiles);
    world.updateEntity(e.id, { x: dest.x, y: dest.y });
    moves.push({ id: e.id, x: dest.x, y: dest.y });
  }
  return moves;
}
