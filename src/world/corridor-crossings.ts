// src/world/corridor-crossings.ts
// Road-wear economy S3 — corridor crossing DETECTION (§9 decision 4: "the trail gets its log").
// Spec: docs/superpowers/specs/2026-07-17-road-wear-economy-spec.md §5, §9.4, §10.
//
// The founding image of the epic is a single squared log thrown across a stream on a HUMBLE
// TRAIL — a path the graph does not yet own. A promoted trample corridor (an emergent NPC
// desire-line, pre-road-adoption; `trample.ts`) that happens to cross a narrow water run has
// earned that log the moment the feet keep landing on both banks. Adoption (S4) later inherits
// the site onto the RoadEdge it builds — but the log must NOT wait for graph membership.
//
// This module is the PURE DETECTION half. It scans the trample grid for chains of promoted cells
// that step across a short water run and lands on a promoted far bank, and returns deterministic
// crossing SITES. The store/entity half (`CrossingTierStore` + reconcile, S3) consumes these
// sites and owns the tier-0 log entity exactly as it owns edge crossings — same store, an
// `edgeId | corridorId` union key, no parallel system.
//
// Nothing here touches the sim, the grid, entities, or persistence. Like `road-use.ts` it is a
// pure function over (grid, map, water-predicate): deterministic, RNG-free (the `no-random-in-sim`
// guard philosophy applies — this is consumed from sim-adjacent year-pass code), row-major scan
// order, output sorted by `corridorId`. It runs at most ~2×/fiction-year, so the O(W×H) sweep
// (TrampleGrid exposes no promoted-cell iterator) is comfortably within budget.

import type { GameMap } from '@/core/types';
import type { TrampleGrid } from '@/sim/trample';

/** A detected place where a promoted trample corridor crosses a narrow water run and continues
 *  on a promoted far bank — a candidate site for a strategically-placed tier-0 log. */
export interface CorridorCrossingSite {
  /** Canonical id, stable for the life of the trail: `corridor:<x>,<y>` keyed on the
   *  lexicographically-smaller bank cell. Both scan directions dedupe to the same id. */
  corridorId: string;
  /** The two promoted LAND bank cells, in (y,x) lexicographic order (smaller first). */
  banks: [{ x: number; y: number }, { x: number; y: number }];
  /** The water cells between the banks, in bank-a → bank-b order. */
  water: Array<{ x: number; y: number }>;
  /** Unit axis of the crossing, bank-a → bank-b: [1,0] or [0,1] (4-dir crossings only). */
  axis: [number, number];
  /** Bank-to-bank distance in tiles (= water run + 1) — matches CrossingSpec.spanTiles semantics. */
  spanTiles: number;
}

/** §9.4: a corridor log lands only where "a water run ≤ 3 tiles wide" — a log spans a stream, not
 *  a river (the §10 water-gauge rule: wider reaches need bents/piers, which are graph-tier work). */
export const MAX_CORRIDOR_WATER_RUN = 3;

/** The 4-directional crossing axes we scan. Only +x and +y so each crossing is discovered ONCE
 *  (marching the other way from the far bank would re-find the same pair); the smaller bank is
 *  always the near bank in row-major order, so the id is canonical without a second pass. */
const AXES: ReadonlyArray<[number, number]> = [
  [1, 0],
  [0, 1],
];

/** Lateral offset (perpendicular, either sign) within which two same-axis, same-start sites are
 *  treated as the SAME corridor — one log per corridor, not one per file of walkers (a wide trail
 *  crosses 2–3 cells abreast; those parallel rows must collapse to a single site). */
const LATERAL_DEDUPE_CELLS = 2;

export function detectCorridorCrossings(
  trample: TrampleGrid,
  map: GameMap,
  isWater: (x: number, y: number) => boolean,
): CorridorCrossingSite[] {
  const W = map.width;
  const H = map.height;

  const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;
  /** A promoted trample trail cell that is dry land (a bank, not open water). */
  const isPromotedLand = (x: number, y: number): boolean =>
    inBounds(x, y) && trample.isPromoted(x, y) && !isWater(x, y);
  /** Dry land a walker can stand on (not water, not a blocked footprint) — the minimum a wobble
   *  far-bank must satisfy even when it is not itself promoted. */
  const isWalkableLand = (x: number, y: number): boolean => {
    if (!inBounds(x, y) || isWater(x, y)) return false;
    return map.tiles[y]?.[x]?.walkable !== false;
  };

  const candidates: CorridorCrossingSite[] = [];

  // Row-major sweep: for every promoted bank cell, try to step across water in +x and +y.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isPromotedLand(x, y)) continue;

      for (const [dx, dy] of AXES) {
        // The immediate neighbour along the axis must be water for this to be a crossing.
        let cx = x + dx;
        let cy = y + dy;
        if (!inBounds(cx, cy) || !isWater(cx, cy)) continue;

        // March the consecutive water run, capped at MAX_CORRIDOR_WATER_RUN.
        const water: Array<{ x: number; y: number }> = [];
        while (water.length < MAX_CORRIDOR_WATER_RUN && inBounds(cx, cy) && isWater(cx, cy)) {
          water.push({ x: cx, y: cy });
          cx += dx;
          cy += dy;
        }
        // If the next cell is STILL water, the run is longer than the cap → no log here.
        if (inBounds(cx, cy) && isWater(cx, cy)) continue;

        // (cx,cy) is the first land beyond the water — the axis-aligned far bank F.
        if (!isWalkableLand(cx, cy)) continue;

        // Accept when F is itself a promoted trail, OR (trail wobble) when F is walkable land and
        // one of its two lateral neighbours — perpendicular to the crossing axis — carries the
        // promoted trail (the desire line jitters one cell off the axis on the far side). The
        // banks reported are ALWAYS the axis-aligned cells; the wobble only relaxes which cell
        // must be promoted. Kept deliberately simple: one cell of lateral tolerance, far side only.
        let accept = isPromotedLand(cx, cy);
        if (!accept) {
          const px = dy; // perpendicular unit (axis rotated 90°)
          const py = dx;
          accept = isPromotedLand(cx + px, cy + py) || isPromotedLand(cx - px, cy - py);
        }
        if (!accept) continue;

        // Near bank (x,y) is the (y,x)-lexicographically-smaller cell by scan construction (F is
        // reached by stepping +x/+y), so banks are already in canonical order and the id keys on it.
        const site: CorridorCrossingSite = {
          corridorId: `corridor:${x},${y}`,
          banks: [{ x, y }, { x: cx, y: cy }],
          water,
          axis: [dx, dy],
          spanTiles: water.length + 1,
        };
        candidates.push(site);
      }
    }
  }

  return dedupeParallelRows(candidates);
}

/**
 * Collapse parallel candidate rows to one site per corridor. A wide corridor crosses the same
 * water run 2–3 cells abreast, producing several candidate sites that share an axis and a start
 * position along that axis but sit within a couple of cells of each other laterally. We keep the
 * lexicographically-smallest `corridorId` in each such cluster and suppress the rest — one log per
 * corridor, not one per file of walkers. Output is sorted by `corridorId` (determinism).
 */
function dedupeParallelRows(candidates: CorridorCrossingSite[]): CorridorCrossingSite[] {
  // Sort by id first so "keep the lexicographically-smallest" falls out of greedy first-wins.
  const sorted = candidates.slice().sort((a, b) => (a.corridorId < b.corridorId ? -1 : a.corridorId > b.corridorId ? 1 : 0));

  const kept: CorridorCrossingSite[] = [];
  for (const cand of sorted) {
    const axisIsX = cand.axis[0] === 1;
    // `along` fixes WHERE the crossing starts on its axis; `lateral` is the perpendicular file.
    const candAlong = axisIsX ? cand.banks[0].x : cand.banks[0].y;
    const candLateral = axisIsX ? cand.banks[0].y : cand.banks[0].x;

    const conflicts = kept.some((k) => {
      if (k.axis[0] !== cand.axis[0] || k.axis[1] !== cand.axis[1]) return false;
      const kAlong = axisIsX ? k.banks[0].x : k.banks[0].y;
      if (kAlong !== candAlong) return false; // a different crossing further along the same stream
      const kLateral = axisIsX ? k.banks[0].y : k.banks[0].x;
      return Math.abs(kLateral - candLateral) <= LATERAL_DEDUPE_CELLS;
    });
    if (!conflicts) kept.push(cand);
  }
  return kept; // already in corridorId order (input was sorted, greedy preserves it)
}
