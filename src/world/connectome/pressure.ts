// src/world/connectome/pressure.ts
//
// PRESSURE — advisory crowding feedback for the connectome. When an author (agent or
// human) builds or moves features, they want to KNOW where things impinge on each other:
// two springs on top of one another, a lake crowding a settlement, a confluence jammed
// against a road. This computes that pressure and reports it — it NEVER moves anything.
//
// The deliberate stance (user, 2026-06-23): sometimes an author *wants* features squished
// together. So pressure is signal, not enforcement. The studio paints it; an agent reads
// it back as feedback on its last edit ("that move raised pressure at wn:1432"); a
// self-adjusting relaxation pass, if ever wanted, is just one possible CONSUMER of this —
// not built in here.
//
// Model: every feature is a disc — a position + a CLEARANCE radius (the room it would like).
// Two features are "under pressure" when their clearance discs overlap; the overlap depth
// (in tiles) is the pressure between them. A node's pressure is the sum over its overlaps.
// Pure, O(n²) (node counts are tens–hundreds); a spatial grid is a noted follow-up.

/** A feature competing for space: a position (tile coords) and the clearance it wants. */
export interface PressureItem {
  id: string;
  x: number;
  y: number;
  /** Clearance radius (tiles) — how much room the feature would like around its centre. */
  radius: number;
}

/** Two features whose clearance discs overlap, with the overlap depth (tiles). */
export interface PressurePair {
  a: string;
  b: string;
  overlap: number;
}

export interface PressureReport {
  /** Total pressure per item id (sum of its overlaps); absent ⇒ 0 (uncrowded). */
  perItem: Map<string, number>;
  /** Impinging pairs, overlap descending (the worst pinch points first). */
  pairs: PressurePair[];
  /** The single most-crowded item's total pressure (0 when nothing overlaps). */
  maxPressure: number;
}

/**
 * Compute crowding pressure over a set of clearance discs. Advisory only — returns where
 * features impinge and by how much; moves nothing. Deterministic (input order preserved
 * in `pairs` for equal overlaps via a stable sort on overlap then ids).
 */
export function computePressure(items: readonly PressureItem[]): PressureReport {
  const perItem = new Map<string, number>();
  const pairs: PressurePair[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const overlap = a.radius + b.radius - d;
      if (overlap > 0) {
        pairs.push({ a: a.id, b: b.id, overlap });
        perItem.set(a.id, (perItem.get(a.id) ?? 0) + overlap);
        perItem.set(b.id, (perItem.get(b.id) ?? 0) + overlap);
      }
    }
  }
  pairs.sort((p, q) => q.overlap - p.overlap || (p.a < q.a ? -1 : p.a > q.a ? 1 : p.b < q.b ? -1 : 1));
  let maxPressure = 0;
  for (const v of perItem.values()) if (v > maxPressure) maxPressure = v;
  return { perItem, pairs, maxPressure };
}
