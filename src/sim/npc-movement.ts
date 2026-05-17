import type { Direction, GameMap, Entity } from '@/core/types';
import { npcProps, forEachNpc } from '@/world/npc-helpers';
import type { World } from '@/world/world';


const MOVE_INTERVAL_MS = 400;

function tileWalkable(map: GameMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const t = map.tiles[y]?.[x];
  return t?.walkable === true && t.state === 'realized';
}

export function tickNpcMovementEntities(world: World, map: GameMap, dtMs: number): void {
  forEachNpc(world, (e) => {
    const p = npcProps(e);
    p.moveCooldown = (p.moveCooldown ?? 0) - dtMs;
    if (p.moveCooldown > 0) return;
    p.moveCooldown = MOVE_INTERVAL_MS;

    const dirs: Direction[] = ['up', 'down', 'left', 'right'];
    const dir = dirs[Math.floor(Math.random() * 4)];
    const tx = Math.floor(e.x) + (dir === 'left' ? -1 : dir === 'right' ? 1 : 0);
    const ty = Math.floor(e.y) + (dir === 'up'   ? -1 : dir === 'down'  ? 1 : 0);
    if (tileWalkable(map, tx, ty)) {
      world.registry.update(e.id, { x: tx, y: ty });
      p.direction = dir;
    }
  });
}
