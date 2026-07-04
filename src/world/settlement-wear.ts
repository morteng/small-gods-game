/**
 * Settlement wear — gen-time PREWARM of the desire-line trample grid.
 *
 * The settlement is a LAYER composited over the natural biome, not a biome
 * replacement: authored roads + the market seed the SAME `TrampleGrid` the live
 * NPC-traffic systems feed (`@/sim/trample`). A multi-source BFS falloff from
 * roads/market converts to accumulated wear, so a freshly-generated settlement
 * already shows worn lanes — and that wear is PRIMED, so runtime footfall
 * continues carving from where gen left off instead of starting from bare grass.
 * Vegetation in the mid-wear band is culled (an entity op, kept here alongside
 * the ground wear it belongs with).
 *
 * This is the gen-time entry point of ONE mechanism; the runtime entry point is
 * `src/sim/systems/trample-system.ts`. Promotion / eligibility / original-tile
 * bookkeeping all live on the grid — this file only seeds it.
 *
 * Explicit surfaces (roads, building footprints, water, farm fields) are never
 * trampled — the grid's `isTrampleEligible` gate handles that; here we also skip
 * the tended village green so the lush common reads against the worn lanes.
 */

import type { Tile, GameMap } from '@/core/types';
import type { World } from '@/world/world';
import type { TrampleGrid } from '@/sim/trample';
import { TRAMPLE } from '@/sim/trample';
import type { SettlementPlan } from './settlement-plan';
import { WATER_TYPES } from './settlement-plan';
import { noise } from '@/core/noise';
import { tryGetEntityKindDef } from './entity-kinds';

/** Wear decays to zero this many tiles from the nearest road/market tile. */
const WEAR_FALLOFF = 4;
/** Above this normalized wear (±dither): vegetation culled. */
const CULL_THRESHOLD = 0.32;
/**
 * Maps normalized wear [0..1] to grid accumulator units. Chosen so a tile at the
 * old trample threshold (~0.62) seeds just past the grid's PROMOTE_HI — the
 * generated dirt lanes match the previous wear pattern closely, then stay primed.
 */
const WEAR_TO_ACCUM = TRAMPLE.PROMOTE_HI / 0.62; // ≈ 194

export const VEGETATION_CATEGORIES = new Set(['vegetation', 'terrain-feature']);

/**
 * Remove every sightline-blocking vegetation / terrain-feature entity on a tile (the shared cull
 * used by both settlement-wear and the WP-S killing field). Grass is a TILE, not an entity, so it
 * survives. Returns the number of entities culled.
 */
export function cullVegetationEntities(world: World, x: number, y: number): number {
  let n = 0;
  for (const e of world.registry.getAtTile(x, y)) {
    const def = tryGetEntityKindDef(e.kind);
    if (def && VEGETATION_CATEGORIES.has(def.category)) {
      world.registry.remove(e.id);
      world.removeEntity(e.id);
      n++;
    }
  }
  return n;
}

/**
 * Seed the trample grid for one settlement (and cull mid-wear vegetation). Call
 * AFTER the plan's road tiles are carved and buildings are placed. Does NOT
 * realise dirt — call `grid.settle(map)` once after seeding every settlement.
 */
export function prewarmSettlementWear(
  grid: TrampleGrid,
  plan: SettlementPlan,
  tiles: Tile[][],
  world: World | null | undefined,
  seed: number,
): void {
  const sources = [
    ...plan.edges.flatMap(e => e.tiles),
    ...plan.market,
  ];
  if (sources.length === 0) return;

  // S3b — the village green is tended open ground: never seed wear on it, so the
  // lush common reads against the worn lanes around it.
  const greenTiles = new Set<string>();
  for (const c of plan.civics) {
    if (c.type !== 'green') continue;
    for (let dy = 0; dy < c.h; dy++) for (let dx = 0; dx < c.w; dx++) greenTiles.add(`${c.x + dx},${c.y + dy}`);
  }

  // Multi-source BFS distance to the nearest road/market tile.
  const dist = new Map<string, number>();
  let frontier = sources.filter(s => tiles[s.y]?.[s.x]);
  for (const s of frontier) dist.set(`${s.x},${s.y}`, 0);
  for (let d = 1; d < WEAR_FALLOFF; d++) {
    const next: { x: number; y: number }[] = [];
    for (const { x, y } of frontier) {
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        const key = `${nx},${ny}`;
        if (dist.has(key)) continue;
        const t = tiles[ny]?.[nx];
        if (!t || WATER_TYPES.has(t.type)) continue;
        dist.set(key, d);
        next.push({ x: nx, y: ny });
      }
    }
    frontier = next;
  }

  for (const [key, d] of dist) {
    if (d === 0) continue;                       // the road itself
    if (greenTiles.has(key)) continue;           // S3b: the green stays tended
    const [x, y] = key.split(',').map(Number);
    const t = tiles[y]?.[x];
    if (!t || t.walkable === false) continue;    // footprints, water
    const wear = 1 - d / WEAR_FALLOFF;
    const jitter = (noise(x, y, seed + 509) - 0.5) * 0.3;

    if (wear > CULL_THRESHOLD + jitter && world) cullVegetationEntities(world, x, y);

    // Seed wear on this tile. Eligibility (soft ground) is enforced by the grid
    // at promotion time; seeding a road/farm tile is harmless (it can't promote).
    const accum = Math.round((wear + jitter) * WEAR_TO_ACCUM);
    if (accum > 0) grid.deposit(x, y, accum);
  }
}

/**
 * Prewarm every settlement plan into the grid, then realise the initial dirt
 * lanes. Returns the number of tiles promoted to dirt at gen (for the gen report).
 */
export function prewarmAllSettlementWear(
  grid: TrampleGrid,
  plans: SettlementPlan[],
  map: GameMap,
  world: World,
  seed: number,
): number {
  for (const plan of plans) prewarmSettlementWear(grid, plan, map.tiles, world, seed);
  const before = countDirt(map);
  grid.settle(map);
  return countDirt(map) - before;
}

function countDirt(map: GameMap): number {
  let n = 0;
  for (const row of map.tiles) for (const t of row) if (t.type === 'dirt') n++;
  return n;
}
