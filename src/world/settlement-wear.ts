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

import type { Tile, GameMap, Entity } from '@/core/types';
import type { World } from '@/world/world';
import type { TrampleGrid } from '@/sim/trample';
import { TRAMPLE } from '@/sim/trample';
import type { Anchor } from '@/world/anchors';
import type { SettlementPlan } from './settlement-plan';
import { WATER_TYPES } from './settlement-plan';
import { isBuilding } from './building-collision';
import { noise } from '@/core/noise';
import { tryGetEntityKindDef } from './entity-kinds';
import { WATER_PLACED_TAG } from './riparian-scatter';

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
 * survives. Riparian rocks/bank flora (`riparian-scatter.ts`, tagged `waterPlaced`) are exempt —
 * they're placed IN the water margin on purpose, exactly like the corridor sweep's exemption in
 * `vegetation-clear.ts`; without it a settlement or town wall within `WEAR_FALLOFF`/
 * `KILL_FIELD_REACH` of a river silently deletes the boulders the riparian pass just placed
 * (this was a real gap — those two OLDER passes run before the corridor sweep and never checked
 * the tag). Returns the number of entities culled.
 */
export function cullVegetationEntities(world: World, x: number, y: number): number {
  let n = 0;
  for (const e of world.registry.getAtTile(x, y)) {
    const def = tryGetEntityKindDef(e.kind);
    if (!def || !VEGETATION_CATEGORIES.has(def.category)) continue;
    if (e.tags?.includes(WATER_PLACED_TAG)) continue;
    world.registry.remove(e.id);
    world.removeEntity(e.id);
    n++;
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

  // Building-anchored wear: the doorsteps mortals actually cross and the trodden
  // ground round busy premises — seeded from the placed buildings, above and
  // beyond the road/market halo. Kept a self-contained deposit source so it reads
  // (and merges) independently of the BFS/cull pass above.
  if (world) depositBuildingWear(grid, plan, tiles, world, greenTiles);
}

// ── Building-anchored deposit sources (doorsteps + busy perimeters) ─────────────

/** Doorstep of a BUSY building (temple/church, market, mill, well, tavern): the tile
 *  mortals cross and its immediate neighbours, seeded PAST PROMOTE_HI (120) so gen
 *  realises a worn threshold — where that tile is soft ground, not already a road. */
const DOORSTEP_BUSY_CORE = 165;
const DOORSTEP_BUSY_ADJ = 128;
/** Doorstep of an ordinary dwelling: seeded BELOW PROMOTE_HI, so gen leaves it primed
 *  (not yet dirt) — runtime footfall finishes the job, or it stays grass if the house
 *  is quiet. */
const DOORSTEP_ORDINARY_CORE = 74;
const DOORSTEP_ORDINARY_ADJ = 42;
/** A light one-tile ring of trodden ground round a busy building — primed, rarely
 *  promoted at gen, so the premises read lived-in once traffic starts. */
const PERIMETER_BUSY = 56;

/** Building kinds (blueprint preset) with enough footfall to wear a real doorstep +
 *  perimeter at gen: the market, mill, well, and houses of worship / drink. Matched on
 *  the preset name so era packs' variants ("village-church", "market_stall") fall in.
 *  Exported: the doorstep→graph gravel pass (`doorstep-gravel.ts`) reuses this exact
 *  busy/ordinary split so its reach/strength split agrees with the dirt-doorstep one. */
export const BUSY_KIND = /church|chapel|minster|temple|shrine|market|stall|tavern|inn|mill|well|forge|smith/i;

export function isBusyKind(kind: string): boolean {
  return BUSY_KIND.test(kind);
}

/** The ground tile a door opens onto: step one full tile out from the anchor's wall-face
 *  point along its outward facing (the anchor x/y already carries the half-tile offset).
 *  Exported: `doorstep-gravel.ts` radiates its graph-hooked apron from this same point. */
export function doorstepTile(a: Anchor): { x: number; y: number } {
  return { x: Math.floor(a.x + a.facing[0] * 0.5), y: Math.floor(a.y + a.facing[1] * 0.5) };
}

/** The main door anchor of a placed structure (world-space, stored at placement), or null.
 *  Exported for the same reason as `doorstepTile` above. */
export function mainDoorAnchor(e: Entity): Anchor | null {
  const anchors = (e.properties as { anchors?: Anchor[] } | undefined)?.anchors;
  if (!anchors || anchors.length === 0) return null;
  return anchors.find(a => a.kind === 'door' && a.main)
    ?? anchors.find(a => a.kind === 'door')
    ?? null;
}

/**
 * Deposit doorstep + busy-perimeter wear from every placed building of this settlement.
 * Iterated in id order for determinism; deposits commute + saturate, so the trample grid
 * is byte-stable regardless. Everything flows through `grid.deposit()` → the shared
 * PROMOTE_HI / settle() path, so it caps at `dirt` (never road-class) and stays primed.
 *
 * Returns diagnostics (buildings seen, doorsteps seeded, door-anchor fallbacks) for the
 * gen report — the counts that let a tuner see busy doorsteps promoting while quiet ones
 * only prime.
 */
export function depositBuildingWear(
  grid: TrampleGrid,
  plan: SettlementPlan,
  tiles: Tile[][],
  world: World,
  skip: ReadonlySet<string>,
): { buildings: number; doorsteps: number; doorFallback: number; perimeter: number } {
  const stats = { buildings: 0, doorsteps: 0, doorFallback: 0, perimeter: 0 };
  if (!plan.poiId) return stats;

  // This settlement's placed structures — buildings AND civic props (well/graveyard),
  // which `isBuilding` (category-gated) misses but that carry real doorstep traffic.
  const owned = world.registry.all().filter(e => {
    if ((e.properties as { poiId?: string } | undefined)?.poiId !== plan.poiId) return false;
    if (isBuilding(e)) return true;
    return (e.tags ?? []).includes('civic') || (e.tags ?? []).includes('fixture');
  });
  owned.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const inBoundsSoft = (x: number, y: number): boolean => {
    const t = tiles[y]?.[x];
    return !!t && !WATER_TYPES.has(t.type) && !skip.has(`${x},${y}`);
  };
  const deposit = (x: number, y: number, amt: number): void => {
    if (amt > 0 && inBoundsSoft(x, y)) grid.deposit(x, y, amt);
  };

  for (const e of owned) {
    stats.buildings++;
    const busy = isBusyKind(e.kind);
    const ox = Math.floor(e.x), oy = Math.floor(e.y);
    const fp = (e.properties as { footprint?: { w: number; h: number } } | undefined)?.footprint;
    const w = fp?.w ?? 1, h = fp?.h ?? 1;

    // (a) Doorstep blob at the main door's outward tile (+ its 4-neighbours). A structure
    // with no resolvable door (a well, a graveyard) has no threshold — it gets perimeter
    // wear only; counted as a fallback.
    const door = mainDoorAnchor(e);
    const core = busy ? DOORSTEP_BUSY_CORE : DOORSTEP_ORDINARY_CORE;
    const adj = busy ? DOORSTEP_BUSY_ADJ : DOORSTEP_ORDINARY_ADJ;
    if (door) {
      const s = doorstepTile(door);
      deposit(s.x, s.y, core);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) deposit(s.x + dx, s.y + dy, adj);
      stats.doorsteps++;
    } else {
      stats.doorFallback++;
    }

    // (b) Busy premises: a light ring of trodden ground one tile off the footprint.
    if (busy) {
      for (let dx = -1; dx <= w; dx++) {
        deposit(ox + dx, oy - 1, PERIMETER_BUSY);
        deposit(ox + dx, oy + h, PERIMETER_BUSY);
      }
      for (let dy = 0; dy < h; dy++) {
        deposit(ox - 1, oy + dy, PERIMETER_BUSY);
        deposit(ox + w, oy + dy, PERIMETER_BUSY);
      }
      stats.perimeter++;
    }
  }
  return stats;
}

// ── Wall-base wear (the ground a wall was BUILT on) ─────────────────────────────

/** On the wall line itself: seeded past PROMOTE_HI so gen realises packed construction
 *  ground under the curtain — grass never runs untouched into a masonry footing. */
const WALL_BASE_CORE = 150;
/** One tile out on both flanks: the berm/patrol strip. Primed around the promote
 *  threshold (±jitter) so the wall base reads as a worn band with an organic edge. */
const WALL_BASE_FLANK = 96;

/** Substantial barriers whose construction wears the ground (mirrors the foundation
 *  gate in barrier-deformation.ts). A hedge or paling fence disturbs nothing. */
const WALL_WEAR_KINDS = new Set(['wall', 'palisade', 'rampart']);

/**
 * Deposit wear along every substantial barrier run: the wall line seeds promoted
 * (packed bare ground under the curtain), the two flank strips seed primed with a
 * noise-jittered edge. Water and explicit surfaces are excluded by the grid's own
 * eligibility gate (a road through a gate keeps its surface). Pure deposit — the
 * caller's `grid.settle()` realises the dirt.
 */
export function depositBarrierWear(grid: TrampleGrid, map: GameMap, seed: number): number {
  const runs = map.barrierRuns ?? [];
  const core = new Set<string>();
  for (const { run } of runs) {
    if (!WALL_WEAR_KINDS.has(run.kind) || run.path.length < 2) continue;
    for (let i = 1; i < run.path.length; i++) {
      const [ax, ay] = run.path[i - 1], [bx, by] = run.path[i];
      const L = Math.hypot(bx - ax, by - ay);
      if (L <= 1e-6) continue;
      const n = Math.max(1, Math.ceil(L * 2));           // ~half-tile sampling
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        core.add(`${Math.round(ax + (bx - ax) * t)},${Math.round(ay + (by - ay) * t)}`);
      }
    }
  }
  if (core.size === 0) return 0;
  const wet = (x: number, y: number): boolean => {
    const t = map.tiles[y]?.[x];
    return !t || WATER_TYPES.has(t.type);
  };
  // Flank strip as a SET first, so a tile beside two core tiles still deposits once.
  const flank = new Set<string>();
  for (const key of core) {
    const [x, y] = key.split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const fkey = `${x + dx},${y + dy}`;
      if (!core.has(fkey)) flank.add(fkey);
    }
  }
  let touched = 0;
  for (const key of core) {
    const [x, y] = key.split(',').map(Number);
    if (wet(x, y)) continue;
    grid.deposit(x, y, WALL_BASE_CORE);
    touched++;
  }
  for (const key of flank) {
    const [x, y] = key.split(',').map(Number);
    if (wet(x, y)) continue;
    const jitter = (noise(x, y, seed + 977) - 0.5) * 0.5;       // ±25% organic edge
    grid.deposit(x, y, Math.max(1, Math.round(WALL_BASE_FLANK * (1 + jitter))));
    touched++;
  }
  return touched;
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
  depositBarrierWear(grid, map, seed);                    // walls settle into worn ground, not grass
  const before = countDirt(map);
  grid.settle(map);
  return countDirt(map) - before;
}

function countDirt(map: GameMap): number {
  let n = 0;
  for (const row of map.tiles) for (const t of row) if (t.type === 'dirt') n++;
  return n;
}
