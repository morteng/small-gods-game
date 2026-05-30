/**
 * A* pathfinding on the tile grid.
 *
 * Pure functions — no side effects. The caller supplies the map; the
 * pathfinder returns a sequence of integer tile coordinates or null.
 *
 * Terrain costs steer NPCs toward roads and away from forests/hills.
 * Water, mountains, and void tiles are impassable.
 */

import type { GameMap, Tile, Entity, EntityId } from '@/core/types';
import type { World } from '@/world/world';
import { tryGetEntityKindDef } from '@/world/entity-kinds';

// ─── Terrain cost ───────────────────────────────────────────────────────────

/**
 * Cost multiplier for moving through a single tile.
 * Roads are fast, forests slow, water/mountains impassable.
 */
export function tileCost(tile: Tile): number {
  const t = tile.type;

  // Roads, bridges, dirt paths: fast
  if (
    t === 'road' ||
    t.startsWith('road_') ||
    t.startsWith('dirt_road') ||
    t.startsWith('stone_road') ||
    t === 'bridge' ||
    t.startsWith('bridge_') ||
    t === 'dirt'
  ) {
    return 0.5;
  }

  // Forests: slow going
  if (t.includes('forest')) return 2.0;

  // Hills: moderate slowdown
  if (t === 'hill' || t === 'hills') return 1.5;

  // Impassable terrain
  if (
    t === 'water' ||
    t === 'deep_water' ||
    t === 'shallow_water' ||
    t === 'river' ||
    t === 'mountain' ||
    t === 'peak' ||
    t === 'cliffs'
  ) {
    return Infinity;
  }

  // Default (grass, meadow, lot, sand, beach, rocky, etc.)
  return 1.0;
}

// ─── Walkability ────────────────────────────────────────────────────────────

/**
 * Returns true when a tile can be entered: in-bounds, realized, walkable,
 * terrain is not impassable, AND no blocking entity occupies the tile.
 *
 * @param world - When provided, also checks for blocking entities (buildings,
 *                boulders, etc.) at the given tile position.
 * @param excludeEntityId - Optional entity ID to exclude from blocking checks
 *                          (used to prevent an NPC from blocking itself).
 */
export function isWalkable(
  map: GameMap,
  x: number,
  y: number,
  world?: World,
  excludeEntityId?: EntityId,
): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const t = map.tiles[y]?.[x];
  if (!t || t.state !== 'realized' || !t.walkable) return false;
  if (tileCost(t) === Infinity) return false;

  // Check for blocking entities if world is provided
  if (world) {
    const blocking = getBlockingEntities(world, x, y, excludeEntityId);
    if (blocking.length > 0) return false;
  }

  return true;
}

/**
 * Find blocking entities at a tile position.
 * A tile is blocked if any entity at that position (floor(x), floor(y)) has:
 * - tag 'obstacle', OR
 * - category 'building'
 *
 * @param excludeEntityId - Optional entity ID to exclude (prevents self-blocking).
 */
function getBlockingEntities(
  world: World,
  tileX: number,
  tileY: number,
  excludeEntityId?: EntityId,
): Entity[] {
  const region = { x: tileX, y: tileY, w: 1, h: 1 };
  const entities = world.query({ region });
  return entities.filter(e => {
    // Skip excluded entity (e.g., the NPC checking its own path)
    if (excludeEntityId && e.id === excludeEntityId) return false;
    // Entity must be at this tile (using floor since entities can have sub-tile positions)
    if (Math.floor(e.x) !== tileX || Math.floor(e.y) !== tileY) return false;
    // Check if entity blocks movement
    return entityBlocksMovement(e);
  });
}

/**
 * Returns true if the entity should block NPC movement.
 * Blocks if: has 'obstacle' tag, or category is 'building'.
 */
function entityBlocksMovement(e: Entity): boolean {
  const def = tryGetEntityKindDef(e.kind);
  if (!def) return false;
  // Buildings always block
  if (def.category === 'building') return true;
  // Explicit obstacle tag
  if (e.tags?.includes('obstacle')) return true;
  return false;
}

// ─── A* ─────────────────────────────────────────────────────────────────────

interface AStarNode {
  x: number;
  y: number;
  g: number;
  h: number;
  f: number;
  parent: AStarNode | null;
}

/** 4-directional movement only (no diagonals). */
const DIRS: [number, number][] = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

export interface PathResult {
  /** Sequence of tile coordinates from start to end (inclusive). */
  path: { x: number; y: number }[];
  /** Sum of terrain costs along the path. */
  cost: number;
}

/**
 * Find the lowest-cost path between two tile positions using A*.
 *
 * @param map      The game map (tile grid with terrain info).
 * @param startX   Fractional or integer — always floored to tile index.
 * @param startY
 * @param endX
 * @param endY
 * @returns Path and total cost, or null if no path exists.
 */
export function findPath(
  map: GameMap,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  world?: World,
  excludeEntityId?: EntityId,
): PathResult | null {
  const sx = Math.floor(startX);
  const sy = Math.floor(startY);
  const ex = Math.floor(endX);
  const ey = Math.floor(endY);

  if (!isWalkable(map, sx, sy, world, excludeEntityId) || !isWalkable(map, ex, ey, world, excludeEntityId)) return null;
  if (sx === ex && sy === ey) return { path: [{ x: sx, y: sy }], cost: 0 };

  const open = new Map<string, AStarNode>();
  const closed = new Set<string>();

  const startNode: AStarNode = {
    x: sx,
    y: sy,
    g: 0,
    h: heuristic(sx, sy, ex, ey),
    f: 0,
    parent: null,
  };
  startNode.f = startNode.g + startNode.h;
  open.set(key(sx, sy), startNode);

  while (open.size > 0) {
    // Find lowest-f node in open set (linear scan — fine for typical map
    // sizes; a binary heap can replace this if profiling shows it matters).
    let current: AStarNode | null = null;
    for (const node of open.values()) {
      if (
        !current ||
        node.f < current.f ||
        (node.f === current.f && node.h < current.h)
      ) {
        current = node;
      }
    }
    if (!current) break;

    const ck = key(current.x, current.y);

    if (current.x === ex && current.y === ey) {
      // Reconstruct path
      const path: { x: number; y: number }[] = [];
      let node: AStarNode | null = current;
      while (node) {
        path.unshift({ x: node.x, y: node.y });
        node = node.parent;
      }
      return { path, cost: current.g };
    }

    open.delete(ck);
    closed.add(ck);

    for (const [dx, dy] of DIRS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const nk = key(nx, ny);

      if (closed.has(nk)) continue;
      if (!isWalkable(map, nx, ny, world, excludeEntityId)) continue;

      const stepCost = tileCost(map.tiles[ny][nx]);
      const g = current.g + stepCost;

      const existing = open.get(nk);
      if (existing && g >= existing.g) continue;

      const h = heuristic(nx, ny, ex, ey);
      open.set(nk, { x: nx, y: ny, g, h, f: g + h, parent: current });
    }
  }

  return null;
}

// ─── Destination picking ────────────────────────────────────────────────────

/**
 * Pick a random walkable tile within `radius` tiles of the current position.
 * Uses rejection sampling; returns null if no walkable tile found after
 * `maxAttempts` tries (very unlikely on a realized map).
 */
export function pickRandomDestination(
  map: GameMap,
  cx: number,
  cy: number,
  radius: number,
  rng: { next: () => number },
  world?: World,
  excludeEntityId?: EntityId,
  maxAttempts = 50,
): { x: number; y: number } | null {
  for (let i = 0; i < maxAttempts; i++) {
    const x = Math.floor(cx) + Math.floor(rng.next() * radius * 2) - radius;
    const y = Math.floor(cy) + Math.floor(rng.next() * radius * 2) - radius;
    if (isWalkable(map, x, y, world, excludeEntityId)) return { x, y };
  }
  return null;
}