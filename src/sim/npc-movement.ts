import type { Direction, GameMap, NpcInstance, Entity } from '@/core/types';
import { npcProps, forEachNpc } from '@/world/npc-helpers';
import type { World } from '@/world/world';

const MOVE_INTERVAL_MIN_MS = 1200;
const MOVE_INTERVAL_MAX_MS = 3200;

const DIRS: ReadonlyArray<{ dx: number; dy: number; dir: Direction }> = [
  { dx:  0, dy: -1, dir: 'up'    },
  { dx:  0, dy:  1, dir: 'down'  },
  { dx: -1, dy:  0, dir: 'left'  },
  { dx:  1, dy:  0, dir: 'right' },
];

function isWalkable(map: GameMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  return map.tiles[y]?.[x]?.walkable === true;
}

function nextInterval(seed: number, tick: number): number {
  // Cheap deterministic-ish jitter — combine seed with tick count
  const h = Math.imul(seed ^ tick, 2654435761) >>> 0;
  const t = (h % 1000) / 1000;
  return MOVE_INTERVAL_MIN_MS + t * (MOVE_INTERVAL_MAX_MS - MOVE_INTERVAL_MIN_MS);
}

/**
 * Per-frame random-walk update. Each NPC walks to a random walkable cardinal
 * neighbour every 1.2–3.2 s. Placeholder until role-based schedules land.
 */
export function tickNpcMovement(npcs: NpcInstance[], map: GameMap, deltaMs: number): void {
  for (const npc of npcs) {
    if (npc.moveCooldown === undefined) {
      npc.moveCooldown = nextInterval(npc.seed, 0);
    }
    npc.moveCooldown -= deltaMs;
    if (npc.moveCooldown > 0) continue;

    // Pick a random direction, then scan all four if blocked.
    const start = Math.abs(Math.imul(npc.seed ^ Math.floor(performance.now()), 2654435761)) % DIRS.length;
    let moved = false;
    for (let i = 0; i < DIRS.length; i++) {
      const { dx, dy, dir } = DIRS[(start + i) % DIRS.length];
      const nx = npc.tileX + dx;
      const ny = npc.tileY + dy;
      if (!isWalkable(map, nx, ny)) continue;
      npc.tileX = nx;
      npc.tileY = ny;
      npc.direction = dir;
      // Kick frame off idle so the walk cycle plays.
      if (npc.frame === 0) {
        npc.frame = 1;
        npc.frameTimer = 0;
      }
      moved = true;
      break;
    }
    if (!moved) {
      // Boxed in — face a random direction so the next attempt varies.
      npc.direction = DIRS[start].dir;
    }
    npc.moveCooldown = nextInterval(npc.seed, Math.floor(performance.now()));
  }
}

// ─── Entity-based variant (Spec A migration target) ───────────────────────────

const MOVE_INTERVAL_MS_ENTITY = 400;

function tileWalkableEntity(map: GameMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  return map.tiles[y]?.[x]?.walkable === true;
}

export function tickNpcMovementEntities(world: World, map: GameMap, dtMs: number): void {
  forEachNpc(world, (e) => {
    const p = npcProps(e);
    p.moveCooldown = (p.moveCooldown ?? 0) - dtMs;
    if (p.moveCooldown > 0) return;
    p.moveCooldown = MOVE_INTERVAL_MS_ENTITY;

    const dirs: Direction[] = ['up', 'down', 'left', 'right'];
    const dir = dirs[Math.floor(Math.random() * 4)];
    const tx = Math.floor(e.x) + (dir === 'left' ? -1 : dir === 'right' ? 1 : 0);
    const ty = Math.floor(e.y) + (dir === 'up'   ? -1 : dir === 'down'  ? 1 : 0);
    if (tileWalkableEntity(map, tx, ty)) {
      world.registry.update(e.id, { x: tx, y: ty });
      p.direction = dir;
    }
  });
}
