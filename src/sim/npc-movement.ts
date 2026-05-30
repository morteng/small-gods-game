import type { GameMap, Direction } from '@/core/types';
import { npcProps, forEachNpc } from '@/world/npc-helpers';
import type { World } from '@/world/world';
import type { Rng } from '@/core/rng';
import { findPath, pickRandomDestination } from '@/sim/pathfinding';

/** NPC walk speed in tiles per second. At 60 Hz ≈ 20 ticks per tile. */
export const NPC_WALK_SPEED = 3;

/** Seconds between picking a new destination when the NPC is idle. */
const IDLE_PICK_INTERVAL_MS = 2000;

/** Radius in tile-units for random destination search. */
const IDLE_ROAM_RADIUS = 5;

/** Fractional distance threshold to consider a waypoint "arrived".
 * Using ≤1 tick-worth prevents overshoot snapping. */
const WAYPOINT_ARRIVAL = NPC_WALK_SPEED / 60 + 0.01;

/** Derive cardinal direction from a movement delta. */
function directionFromDelta(dx: number, dy: number): Direction {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'down' : 'up';
}

/**
 * Advance one NPC along its current path (or pick a new path if idle).
 *
 * This function is called once per NpcMovementSystem tick (60Hz) for every
 * NPC. It only draws RNG for destination/pathfinding decisions; movement
 * interpolation is deterministic arithmetic so silent replay stays identical.
 */
export function tickNpcMovementEntities(
  world: World,
  map: GameMap,
  dtMs: number,
  rng: Rng,
): void {
  const dt = dtMs / 1000; // seconds

  forEachNpc(world, (e) => {
    const p = npcProps(e);

    // ── Move cooldown ticks down; gates standing still. ──
    p.moveCooldown = (p.moveCooldown ?? 0) - dtMs;

    // ── 1. No path? Pick a destination based on activity target or random roam ──
    if (!p.currentPath || (p.pathIndex ?? -1) < 0 || (p.pathIndex ?? 0) >= p.currentPath.length) {
      if (p.moveCooldown > 0) {
        // NPC standing still — set idle frame
        p.frame = 0;
        return;
      }
      p.moveCooldown = IDLE_PICK_INTERVAL_MS;

      // If the NPC has an activity target and is not already there, path to it
      if (p.activityTargetX !== undefined && p.activityTargetY !== undefined) {
        // If already at the target, clear it and stay put
        if (isAtTile(e.x, e.y, { x: p.activityTargetX, y: p.activityTargetY })) {
          p.activityTargetX = undefined;
          p.activityTargetY = undefined;
          return; // stay put until next activity tick
        }
        const dest = { x: p.activityTargetX, y: p.activityTargetY };
        const result = findPath(map, e.x, e.y, dest.x, dest.y, world, e.id);
        if (result && result.path.length >= 2) {
          p.currentPath = result.path;
          p.pathIndex = 0;
          p.pathSpeedMul = 1;
        }
        return;
      }

      // Idle or wander: pick a random walkable destination within roam radius
      const dest = pickRandomDestination(map, e.x, e.y, IDLE_ROAM_RADIUS, rng, world, e.id);
      if (!dest) return;

      const result = findPath(map, e.x, e.y, dest.x, dest.y, world, e.id);
      if (!result || result.path.length < 2) return;

      p.currentPath = result.path;
      p.pathIndex = 0; // next tile is path[0] (the start tile — we skip to 1 in step 2)
      p.pathSpeedMul = 1;
    }

    // ── 2. Advance toward next waypoint ──
    const path = p.currentPath;
    let pathIdx = p.pathIndex ?? 0;

    // Skip the current tile (path[0] is where we already are)
    while (pathIdx < path.length && isAtTile(e.x, e.y, path[pathIdx])) {
      pathIdx++;
    }
    p.pathIndex = pathIdx;

    if (pathIdx >= path.length) {
      // Path exhausted — NPC reached the end
      p.currentPath = undefined;
      p.pathIndex = -1;
      p.frame = 0;
      return;
    }

    const target = path[pathIdx];
    const tx = target.x + 0.5; // tile center
    const ty = target.y + 0.5;
    const speed = NPC_WALK_SPEED * (p.pathSpeedMul ?? 1);
    const step = speed * dt;

    const dx = tx - e.x;
    const dy = ty - e.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= step || dist <= WAYPOINT_ARRIVAL) {
      // Snap to waypoint
      e.x = tx;
      e.y = ty;
      world.registry.update(e.id, { x: e.x, y: e.y });
      // direction will update on the next tick when we aim at the next waypoint
    } else {
      // Move toward waypoint
      const ratio = step / dist;
      e.x += dx * ratio;
      e.y += dy * ratio;
      world.registry.update(e.id, { x: e.x, y: e.y });

      // Face the direction we're moving
      p.direction = directionFromDelta(dx, dy);

      // Animate walk cycle
      if (p.frame === 0) p.frame = 1;
      p.frameTimer += dtMs;
      if (p.frameTimer >= 150) {
        p.frameTimer -= 150;
        p.frame = p.frame >= 8 ? 1 : p.frame + 1;
      }
    }
  });
}

/** Returns true when the entity position is within range of a tile center. */
function isAtTile(x: number, y: number, tile: { x: number; y: number }): boolean {
  const dx = x - (tile.x + 0.5);
  const dy = y - (tile.y + 0.5);
  return Math.sqrt(dx * dx + dy * dy) < WAYPOINT_ARRIVAL;
}
