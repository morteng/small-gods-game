import type { System, SystemContext } from '@/core/scheduler';
import type { GameMap, Region, Tile } from '@/core/types';
import { bumpTilesRev } from '@/core/tile-rev';
import { forEachNpc, npcProps } from '@/world/npc-helpers';
import { dominantCohortBelief, type CohortBeliefStats, type SettlementCohorts } from '@/sim/cohorts';
import type { Oracle } from '@/world/oracle';

export const BASE_RADIUS = 3;
export const FAITH_BONUS = 4;
export const UNDERSTANDING_BONUS = 2;

/** Tile-realization radius for a believer. Faith is primary (+4), understanding
 *  secondary (+2); BASE_RADIUS guarantees the cradle opens at understanding≈0. */
export function perceptionReach(faith: number, understanding: number): number {
  return BASE_RADIUS + Math.floor(faith * FAITH_BONUS + understanding * UNDERSTANDING_BONUS);
}

/**
 * Tile-realization radius for a settlement's STATISTICAL population (P1, user
 * ruling 2026-07-13: aggregate cohort belief realizes tiles too, not just named
 * believers). The named formula applied at the settlement's population MEANS
 * (a devout minority dilutes into the crowd), plus a crowd term that grows
 * logarithmically with the aggregate believer count — 500 statistical faithful
 * open a visibly wider footprint than 5, without a big town realizing the map.
 */
export function cohortPerceptionReach(stats: CohortBeliefStats): number {
  return perceptionReach(stats.meanFaith, stats.meanUnderstanding)
    + Math.floor(Math.log2(1 + stats.believerCount));
}

export class PerceptionSystem implements System {
  readonly name = 'perception';
  readonly tickHz = 2;

  constructor(
    private readonly oracle: Oracle,
    private readonly getMap: () => GameMap | null,
    /** If provided, the substrate type for (x, y). Defaults to current tile.type. */
    private readonly getSubstrate?: (x: number, y: number) => string,
    /** P1 (two-tier population): the statistical tier — each settlement with
     *  aggregate believers contributes a reach disc at its POI anchor. Absent
     *  getter ⇒ pre-P1 behavior (named believers only). */
    private readonly getCohorts?: () => ReadonlyMap<string, SettlementCohorts> | null | undefined,
  ) {}

  tick(ctx: SystemContext): void {
    // Fall back to world.tiles when no explicit map provider is set
    const map = this.getMap() ?? ctx.world.tiles;
    if (!map) return;

    // Collect believer points with their reach
    const reaches: Array<{ x: number; y: number; r: number }> = [];
    forEachNpc(ctx.world, (e) => {
      const p = npcProps(e);
      let domFaith = 0;
      let domUnderstanding = 0;
      for (const b of Object.values(p.beliefs)) {
        if (b.faith > domFaith) {
          domFaith = b.faith;
          domUnderstanding = b.understanding;
        }
      }
      const r = perceptionReach(domFaith, domUnderstanding);
      reaches.push({ x: Math.floor(e.x), y: Math.floor(e.y), r });
    });

    // Statistical tier (P1, ruling 2): a settlement's aggregate believers open
    // a reach disc at its authored POI anchor. Sorted poiId order so the
    // realized set (and its event order) is replay-stable.
    const cohorts = this.getCohorts?.();
    const pois = map.worldSeed?.pois;
    if (cohorts && pois) {
      for (const poiId of [...cohorts.keys()].sort()) {
        const stats = dominantCohortBelief(cohorts.get(poiId)!);
        if (!stats) continue;
        const poi = pois.find(p => p.id === poiId);
        if (!poi?.position) continue;
        reaches.push({
          x: Math.floor(poi.position.x),
          y: Math.floor(poi.position.y),
          r: cohortPerceptionReach(stats),
        });
      }
    }

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

    if (ordered.length > 0) bumpTilesRev(map);
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
