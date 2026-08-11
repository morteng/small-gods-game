// SITE PARAMS AT A TILE — the resolver `detectCrossings` has always accepted and nothing has
// ever supplied.
//
// WHY THIS EXISTS: `map-generator` called `detectCrossings` with a CONSTANT
// `defaults: { era: 'late-medieval', prosperity: 'modest' }`, so every crossing in every
// generated world resolved the same site. Run that through `bridgeClassFor` (era rank 3 ⇒
// tech 3, economy 1) and only the road CLASS varies:
//   highway (importance 3) → dressed-stone · everything else → timber
// Two bridge looks, world-wide, forever — the user's "the same ugly bridge model every time".
// The `log-plank` rung was not merely rare, it was UNREACHABLE: it needs `tech < 1`, and any
// medieval era is rank ≥2, so no generated world has ever built one.
//
// A crossing is built by the people who live near it, so its site params come from the nearest
// POI: a great walled town raises a masonry arcade, a hamlet lays a plank. Away from every
// settlement the vale is wilderness and nobody is paying for anything.

import type { WorldSeed } from '@/core/types';
import type { CrossingSiteParams } from './detect-crossings';

/** POI `size` → economic weight. Absent ⇒ the middle rung (a plain unqualified settlement). */
const SIZE_RANK: Record<string, number> = { small: 0, medium: 1, large: 2, huge: 3 };
/** POI `importance` → economic weight. Absent ⇒ the middle rung. */
const IMPORTANCE_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** Rank 0..3 → the wealth vocabulary the envelope scores.
 *
 *  These four are chosen so each rung lands on a DISTINCT economy value, because the consumers
 *  bucket the vocabulary coarsely (`PROSPERITY_RANK`: destitute/poor → 0, modest/comfortable → 1,
 *  rich → 2, opulent → 3). The obvious-looking `[poor, modest, comfortable, rich]` collapses two
 *  rungs onto economy 1, so a LARGE town scored exactly like a modest one and no road crossing
 *  could ever clear the `economy >= 2` gate for dressed stone — the whole point of resolving the
 *  site. Never re-order this without re-reading that table. */
const WEALTH_BY_RANK = ['poor', 'modest', 'rich', 'opulent'] as const;

/** Beyond this (tiles) a crossing is out in the country and takes the wilderness floor. Sized to
 *  a generous settlement catchment rather than a built footprint: the bridge a town pays for is
 *  the one on its approach roads, not only the one inside its walls. */
const INFLUENCE_TILES = 22;

/** What a crossing with no settlement in reach is worth building. `poor` (rank 0) — with a low
 *  road class this is what finally reaches the `log-plank` rung. */
const WILDERNESS_PROSPERITY = 'poor';

/**
 * Build the `siteParamsAt` resolver for a world: era + prosperity at a tile, read off the
 * nearest POI that has a position.
 *
 * Pure and allocation-light — `detectCrossings` calls it once per candidate crossing (a handful
 * per world), so the linear POI scan is deliberate: no spatial index to keep in sync, and POI
 * counts are in the tens.
 */
export function makeCrossingSiteResolver(
  worldSeed: WorldSeed | null | undefined,
  fallback: CrossingSiteParams,
): (x: number, y: number) => CrossingSiteParams {
  const pois = (worldSeed?.pois ?? []).filter((p) => p.position);
  if (!pois.length) return () => fallback;
  const worldEra = worldSeed?.era ?? fallback.era;

  return (x, y) => {
    let best: (typeof pois)[number] | undefined;
    let bestD2 = Infinity;
    for (const p of pois) {
      const dx = p.position!.x - x, dy = p.position!.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = p; }
    }
    if (!best || bestD2 > INFLUENCE_TILES * INFLUENCE_TILES) {
      return { ...fallback, era: worldEra, prosperity: WILDERNESS_PROSPERITY };
    }
    // Size and importance are different claims — a huge slum and a small treasury are both
    // real — so take the STRONGER rather than averaging them away. Only fields the author
    // actually SET count: defaulting an absent field to the middle rung and then taking the max
    // lets the default outvote a stated one, so `size:'small'` with no importance scored the
    // same as a plain medium town and no POI could ever be poor.
    const ranks = [SIZE_RANK[best.size ?? ''], IMPORTANCE_RANK[best.importance ?? '']]
      .filter((v): v is number => v !== undefined);
    const rank = ranks.length ? Math.max(...ranks) : 1;
    return {
      ...fallback,
      // A POI may override the world era for its own buildings; its bridge is one of them.
      era: best.era ?? worldEra,
      prosperity: WEALTH_BY_RANK[Math.max(0, Math.min(3, rank))],
    };
  };
}
