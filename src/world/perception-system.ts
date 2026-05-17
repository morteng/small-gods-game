import type { System, SystemContext } from '@/core/scheduler';
import type { GameMap, Region, Tile } from '@/core/types';
import { forEachNpc, npcProps } from '@/world/npc-helpers';
import type { Oracle } from '@/world/oracle';

const BASE_RADIUS = 3;
const MAX_FAITH_BONUS = 4;

export class PerceptionSystem implements System {
  readonly name = 'perception';
  readonly tickHz = 2;

  constructor(
    private readonly oracle: Oracle,
    private readonly getMap: () => GameMap | null,
    /** If provided, the substrate type for (x, y). Defaults to current tile.type. */
    private readonly getSubstrate?: (x: number, y: number) => string,
  ) {}

  tick(ctx: SystemContext): void {
    // Fall back to world.tiles when no explicit map provider is set
    const map = this.getMap() ?? ctx.world.tiles;
    if (!map) return;

    // Collect believer points with their reach
    const reaches: Array<{ x: number; y: number; r: number }> = [];
    forEachNpc(ctx.world, (e) => {
      const p = npcProps(e);
      let bestFaith = 0;
      for (const b of Object.values(p.beliefs)) {
        if (b.faith > bestFaith) bestFaith = b.faith;
      }
      const r = BASE_RADIUS + Math.floor(bestFaith * MAX_FAITH_BONUS);
      reaches.push({ x: Math.floor(e.x), y: Math.floor(e.y), r });
    });

    if (reaches.length === 0) return;

    const newlyRealized: Tile[] = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const reach of reaches) {
      const x0 = Math.max(0, reach.x - reach.r);
      const x1 = Math.min(map.width  - 1, reach.x + reach.r);
      const y0 = Math.max(0, reach.y - reach.r);
      const y1 = Math.min(map.height - 1, reach.y + reach.r);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - reach.x, dy = y - reach.y;
          if (dx * dx + dy * dy > reach.r * reach.r) continue;
          const tile = map.tiles[y][x];
          if (tile.state === 'realized') continue;
          newlyRealized.push(tile);
        }
      }
    }

    if (newlyRealized.length === 0) return;

    // Dedup + deterministic order: sort by (y, x)
    const seen = new Set<string>();
    const ordered: Tile[] = [];
    for (const t of newlyRealized) {
      const k = `${t.x},${t.y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      ordered.push(t);
    }
    ordered.sort((a, b) => (a.y - b.y) || (a.x - b.x));

    for (const t of ordered) {
      const substrate = this.getSubstrate ? this.getSubstrate(t.x, t.y) : t.type;
      const decided = this.oracle.realizeTile(t.x, t.y, substrate);
      t.type = decided.type;
      t.state = 'realized';
      t.realizedAt = ctx.now;
      if (t.x < minX) minX = t.x;
      if (t.y < minY) minY = t.y;
      if (t.x > maxX) maxX = t.x;
      if (t.y > maxY) maxY = t.y;
      ctx.log.append({ type: 'tile_collapsed', x: t.x, y: t.y, becameType: decided.type, by: decided.by });
    }

    const region: Region = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    ctx.log.append({ type: 'region_realized', region, cause: 'belief_spread' });
  }
}
