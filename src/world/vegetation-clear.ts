/**
 * Reconciliation sweep: remove nature entities (trees, rocks, debris) that ended
 * up under a road, river, or building footprint.
 *
 * Map generation writes terrain, buildings, and vegetation in several passes
 * that are NOT strictly ordered — biome brushes seed vegetation, then roads and
 * rivers paint tiles over it, and POI-zone brushes can drop flora after the
 * buildings exist. Rather than make every writer defensively check the others,
 * this is the single place that enforces the world rule:
 *
 *   roads and rivers clear vegetation, and nothing vegetates on a building.
 *
 * Deterministic (no RNG) and idempotent — safe to run once at the end of
 * generation, or again after a later edit that paints roads/buildings.
 *
 * TWO clearance signals, OR'd together:
 *   1. TILE proximity   — distance to any road/river/bridge CELL (`isRoadOrRiver`).
 *   2. CENTERLINE proximity — distance to the road graph's POLYLINES (the same
 *      source the swept ribbon is built from). Roads now render as a smooth ribbon
 *      that RDP-simplifies + Catmull-Rom-smooths the rasterized cells, so the
 *      drawn road snakes diagonally THROUGH cells the tile grid never marked as
 *      road. Tile proximity alone misses those, leaving trees standing in the
 *      ribbon. Clearing against the polyline (with a canopy-sized margin that
 *      absorbs the <1-tile smoothing deviation) closes that gap.
 *
 * CANOPY-AWARE: a tree's drawn canopy is ~2-3 tiles across, far wider than its
 * trunk cell, so a trunk a couple tiles off the road still splats foliage over it.
 * Trees clear within a wide radius; low undergrowth (grass/fern/shrub) only clears
 * when it actually sits in the corridor.
 */
import type { GameMap, EntityId, Entity } from '@/core/types';
import type { World } from '@/world/world';
import type { RoadGraph } from '@/world/road-graph';
import { tryGetEntityKindDef } from '@/world/entity-kinds';
import { isBuilding } from '@/world/building-collision';
import { elevationAt } from '@/world/heightfield';

/**
 * Treeline: normalised elevation above which no TREE grows — the high ground carries
 * no forest. Forests that a biome brush draped over a massif get culled above this so
 * a peak reads as a rocky crag, not a tree-covered mound, and trees stop poking
 * through the summit.
 *
 * It culls TREES ONLY (the `tree` tag). It used to cull every nature entity, which
 * deleted the rocks, tussock and dwarf shrubs that make a crag read AS a crag — the
 * alpine ground above ~17.8 m came out completely bare, and the hills brush's whole
 * output on mountain/peak was thrown away right after it was placed (see WCV 97). The
 * smooth, per-species thinning of the canopy as it climbs toward its ceiling now lives
 * at PLACEMENT time (`VegetationParams.altitude`, vegetation-placer.ts); this stays as
 * the hard backstop that guarantees no tree survives on a bare summit.
 */
export const TREELINE_ELEV = 0.72;

/** Entity categories considered "nature" and therefore clearable. */
const NATURE_CATEGORIES = new Set(['vegetation', 'terrain-feature']);

/**
 * Tag on entities the riparian pass DELIBERATELY placed in/beside the water margin
 * (`WATER_PLACED_TAG` in `riparian-scatter.ts`). A boulder standing in a river is the
 * whole point of that pass, so the corridor sweep must not treat it as an obstruction
 * — it stays put in the river/road corridor but is still cleared under a building.
 */
const WATER_PLACED_TAG = 'waterPlaced';

/** Tile types that must be clear of vegetation. */
export function isRoadOrRiver(type: string): boolean {
  return (
    type === 'river' ||
    type === 'road' || type.startsWith('road_') ||
    type.startsWith('dirt_road') || type.startsWith('stone_road') ||
    type === 'bridge' || type.startsWith('bridge_')
  );
}

/**
 * Clearance radius (TILES) of the road/river corridor. A big tree's CANOPY
 * overhangs well past its trunk cell, so trees clear within a wide band; low
 * undergrowth only clears when it genuinely sits in the corridor. The band is
 * measured from the road/river CELL centre AND from the road-graph centerline, so
 * the diagonal swept ribbon (which leaves the rasterized cells) still reads as a
 * real clearing without carving a bald motorway.
 */
export const TREE_CLEAR_RADIUS = 2.2;
export const UNDERGROWTH_CLEAR_RADIUS = 0.9;
/** Back-compat alias (older callers / tests referenced the single radius). */
export const CORRIDOR_CLEAR_RADIUS = UNDERGROWTH_CLEAR_RADIUS;

/** A tree has a big canopy; everything else (shrub/fern/grass/rock) is low. */
function clearRadiusFor(e: Entity): number {
  return e.tags?.includes('tree') ? TREE_CLEAR_RADIUS : UNDERGROWTH_CLEAR_RADIUS;
}

/** True if any cell within `r` tiles of continuous point (x,y) is road/river. */
function nearRoadOrRiverTile(map: GameMap, x: number, y: number, r: number): boolean {
  const span = Math.ceil(r);
  const cx = Math.floor(x), cy = Math.floor(y);
  const r2 = r * r;
  for (let dy = -span; dy <= span; dy++) {
    for (let dx = -span; dx <= span; dx++) {
      const tx = cx + dx, ty = cy + dy;
      const tile = map.tiles[ty]?.[tx];
      if (!tile || !isRoadOrRiver(tile.type)) continue;
      // Distance from the trunk to the cell centre (continuous), so the strip
      // width is symmetric regardless of which cell the trunk floored into.
      const ddx = (tx + 0.5) - x, ddy = (ty + 0.5) - y;
      if (ddx * ddx + ddy * ddy <= r2) return true;
    }
  }
  return false;
}

/** Squared distance from point (px,py) to segment (ax,ay)-(bx,by). */
function distSqToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx, qy = ay + t * dy;
  const ex = px - qx, ey = py - qy;
  return ex * ex + ey * ey;
}

/** Polyline (road graph) corridors, each a flat point list + an AABB for culling. */
interface Corridor {
  pts: { x: number; y: number }[];
  minX: number; minY: number; maxX: number; maxY: number;
}

/** Road + river centerlines from the graph (the swept-ribbon source of truth). */
function corridorsFromGraph(graph: RoadGraph | null | undefined): Corridor[] {
  if (!graph?.edges) return [];
  const out: Corridor[] = [];
  for (const edge of graph.edges) {
    if (edge.feature !== 'road' && edge.feature !== 'river') continue;
    const pts = edge.polyline;
    if (!pts || pts.length === 0) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    out.push({ pts, minX, minY, maxX, maxY });
  }
  return out;
}

/** True if (x,y) is within `r` tiles of any corridor centerline. */
function nearCorridor(corridors: Corridor[], x: number, y: number, r: number): boolean {
  const r2 = r * r;
  for (const c of corridors) {
    // AABB cull (expanded by r) before the per-segment test.
    if (x < c.minX - r || x > c.maxX + r || y < c.minY - r || y > c.maxY + r) continue;
    const pts = c.pts;
    if (pts.length === 1) {
      const ddx = pts[0].x - x, ddy = pts[0].y - y;
      if (ddx * ddx + ddy * ddy <= r2) return true;
      continue;
    }
    for (let i = 0; i < pts.length - 1; i++) {
      if (distSqToSegment(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) <= r2) return true;
    }
  }
  return false;
}

/**
 * Remove vegetation / terrain-feature entities sitting on a building footprint or
 * within the road/river corridor — both the rasterized CELLS and the road graph's
 * swept CENTERLINES, with a canopy-aware radius (see {@link TREE_CLEAR_RADIUS}).
 * Returns the number removed.
 */
export function clearObstructedVegetation(world: World, map: GameMap): number {
  const toRemove: EntityId[] = [];
  const corridors = corridorsFromGraph(map.roadGraph);

  for (const e of world.query({})) {
    const def = tryGetEntityKindDef(e.kind);
    if (!def || !NATURE_CATEGORIES.has(def.category)) continue;

    const tx = Math.floor(e.x);
    const ty = Math.floor(e.y);
    const r = clearRadiusFor(e);

    // Riparian rocks are placed IN the water margin on purpose; the corridor sweep
    // (which clears the river/road corridor) must leave them, or it deletes the very
    // boulders that make a river read as a rocky channel. They stay clearable under a
    // building footprint below.
    const waterPlaced = e.tags?.includes(WATER_PLACED_TAG) ?? false;

    const inCorridor = !waterPlaced &&
      (nearRoadOrRiverTile(map, e.x, e.y, r) || nearCorridor(corridors, e.x, e.y, r));
    const onBuilding = world.registry
      .getAtTile(tx, ty)
      .some((b) => b.id !== e.id && isBuilding(b));
    // Above the treeline no TREE grows — but rocks, tussock and the alpine dwarf shrubs
    // do, and they are what make a summit read as a rocky crag rather than a bald dome.
    // Culling them here (as this used to) threw away the hills brush's entire mountain/
    // peak output the moment it was placed. (Water-placed margin rocks sit at the
    // waterline, well below it — exempted explicitly so the intent survives a retune.)
    const isTree = e.tags?.includes('tree') ?? false;
    const aboveTreeline = !waterPlaced && isTree && elevationAt(map, tx, ty) > TREELINE_ELEV;

    if (inCorridor || onBuilding || aboveTreeline) toRemove.push(e.id);
  }

  for (const id of toRemove) world.removeEntity(id);
  return toRemove.length;
}
