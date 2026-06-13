/**
 * Settlement wear-mask ground (growth slice S2).
 *
 * The settlement is a LAYER composited over the natural biome, not a biome
 * replacement: a wear field (multi-source BFS falloff from roads + market)
 * trampls high-wear soft ground to dirt and culls vegetation at mid wear,
 * with seeded per-tile dither so the edges stay organic — never disc-shaped.
 * Low-wear tiles keep their biome, so untouched ground pokes through between
 * the back lots and a pine-forest village reads differently from a scrubland
 * one.
 *
 * Explicit surfaces (roads, building footprints, water, farm fields) are
 * never touched — fields ARE replaced ground, the near-full-wear case.
 */

import type { Tile, GameMap } from '@/core/types';
import type { World } from '@/world/world';
import type { SettlementPlan } from './settlement-plan';
import { WATER_TYPES } from './settlement-plan';
import { noise } from '@/core/noise';
import { tryGetEntityKindDef } from './entity-kinds';

/** Biome ground soft enough to trample to dirt. */
const SOFT_GROUND = new Set(['grass', 'scrubland', 'hills', 'glen', 'sacred_grove', 'meadow']);

/** Wear decays to zero this many tiles from the nearest road/market tile. */
const WEAR_FALLOFF = 4;
/** Above this (±dither): trampled dirt. */
const TRAMPLE_THRESHOLD = 0.62;
/** Above this (±dither): vegetation culled. */
const CULL_THRESHOLD = 0.32;

const VEGETATION_CATEGORIES = new Set(['vegetation', 'terrain-feature']);

/**
 * Apply the wear mask for one settlement. Call AFTER the plan's road tiles
 * are carved into the grid and buildings are placed.
 */
export function applySettlementWear(
  plan: SettlementPlan,
  tiles: Tile[][],
  world: World | null | undefined,
  seed: number,
): number {
  const sources = [
    ...plan.edges.flatMap(e => e.tiles),
    ...plan.market,
  ];
  if (sources.length === 0) return 0;

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

  let changed = 0;
  for (const [key, d] of dist) {
    if (d === 0) continue;                       // the road itself
    const [x, y] = key.split(',').map(Number);
    const t = tiles[y]?.[x];
    if (!t || t.walkable === false) continue;    // footprints, water
    const wear = 1 - d / WEAR_FALLOFF;
    const jitter = (noise(x, y, seed + 509) - 0.5) * 0.3;

    if (wear > CULL_THRESHOLD + jitter && world) {
      for (const e of world.registry.getAtTile(x, y)) {
        const def = tryGetEntityKindDef(e.kind);
        if (def && VEGETATION_CATEGORIES.has(def.category)) {
          world.registry.remove(e.id);
          world.removeEntity(e.id);
        }
      }
    }
    if (wear > TRAMPLE_THRESHOLD + jitter && SOFT_GROUND.has(t.type)) {
      t.type = 'dirt';
      t.walkable = true;
      changed++;
    }
  }
  return changed;
}

/** Apply wear for every settlement plan produced during worldgen. */
export function applyAllSettlementWear(
  plans: SettlementPlan[],
  map: GameMap,
  world: World,
  seed: number,
): number {
  let total = 0;
  for (const plan of plans) total += applySettlementWear(plan, map.tiles, world, seed);
  return total;
}
