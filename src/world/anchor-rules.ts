// src/world/anchor-rules.ts
//
// The snap RULES + the pure MATCHER. A rule says which anchor kinds attract, how close they
// must be, and what facing relationship they need; `matchAnchors` applies the rule set to a
// set of anchors (and the road polylines) and returns the LINKS — the connections that used
// to be re-derived ad hoc in building-placer / barrier / crossing code.
//
// Fully deterministic: candidate links are scored by gap then broken by a stable lexicographic
// key, and assignment is greedy best-first. No Math.random, no iteration-order dependence.
// See docs/superpowers/specs/2026-06-20-anchor-snap-fit-connectome-design.md.

import type { Anchor, AnchorKind } from './anchors';

/** A road as the matcher sees it: an id + its centre polyline (tile coords). */
export interface RoadPolyline {
  id: string;
  points: ReadonlyArray<{ x: number; y: number }>;
}

/**
 * Facing requirement between two anchors:
 *  - `oppose`  : they look at each other (dot(fa, fb) < -tol) — two doorways meeting.
 *  - `toward`  : the source anchor's facing points at the partner (dot(fa, dir) > tol) — a
 *                door/gate facing a road whose own normal is ambiguous.
 *  - `any`     : no facing constraint — a bank meeting the road surface.
 */
export type FacingMode = 'oppose' | 'toward' | 'any';

/** Relation a link records on the connectome (mirrors WorldNode RelationKind sans `contains`). */
export type LinkRelation = 'connects' | 'spans' | 'serves';

export interface SnapRule {
  /** Source kind (the anchor whose facing matters for `toward`). */
  a: AnchorKind;
  /** Partner kind. `'road'` partners are matched against road polylines, not anchors. */
  b: AnchorKind;
  /** Max Euclidean gap in tiles. */
  maxGap: number;
  facing: FacingMode;
  relation: LinkRelation;
  /** Anchor↔anchor only: link two anchors ONLY if they carry the same non-empty `pair` key
   *  (a stair flight's foot + head). Prevents two distinct runs whose boundary ports sit on the
   *  same tile from cross-matching under `oppose`+gap alone. Ignored for `b: 'road'` rules. */
  requireSamePair?: boolean;
}

export interface AnchorEndpoint {
  kind: AnchorKind;
  x: number;
  y: number;
  id?: string;
  ownerId?: string;
}

export interface AnchorLink {
  a: AnchorEndpoint;
  b: AnchorEndpoint;
  relation: LinkRelation;
  gap: number;
}

/** Default rule table — symmetric in spirit; the matcher treats `b: 'road'` as polyline-snap. */
export const DEFAULT_RULES: readonly SnapRule[] = [
  { a: 'door',     b: 'road', maxGap: 1.6, facing: 'toward', relation: 'connects' },
  { a: 'frontage', b: 'road', maxGap: 1.6, facing: 'toward', relation: 'connects' },
  { a: 'gate',     b: 'road', maxGap: 2.0, facing: 'toward', relation: 'connects' },
  { a: 'service',  b: 'road', maxGap: 2.2, facing: 'toward', relation: 'serves'   },
  { a: 'wall_end', b: 'wall_end', maxGap: 1.0, facing: 'any', relation: 'connects' },
  // A stair flight's foot + head ports, emitted as a pair by the road-grade scan. `oppose` (they
  // look at each other along the climb) + `requireSamePair` (only the same run's two ports) +
  // maxGap ≥ the run cap (MAX_FLIGHT_RUN_TILES) pins each foot to its own head.
  { a: 'stair_anchor', b: 'stair_anchor', maxGap: 4.5, facing: 'oppose', relation: 'spans', requireSamePair: true },
  // A gate opening's inner + outer ports (place-barrier emits the pair 1 tile either side of the
  // shared opening cell, along the outward ring normal). `oppose` (outer faces out, inner faces
  // in) + `requireSamePair` pins each opening's two ports to each other; maxGap covers the exact
  // 2-tile separation with rounding slack.
  { a: 'gate_anchor', b: 'gate_anchor', maxGap: 2.5, facing: 'oppose', relation: 'spans', requireSamePair: true },
];

const COS_TOL = 0.25; // ~75° cone — generous; placement already roughly aligns these.

function dot(ax: number, ay: number, bx: number, by: number): number {
  return ax * bx + ay * by;
}

/** Closest point on segment [a,b] to p, plus the squared distance. */
function closestOnSegment(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): { x: number; y: number; d2: number } {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const x = ax + dx * t, y = ay + dy * t;
  return { x, y, d2: (px - x) ** 2 + (py - y) ** 2 };
}

interface RoadHit { x: number; y: number; dist: number; roadId: string }

/**
 * Best road point for an anchor that PASSES the rule (gap + facing). We can't pick the globally
 * nearest road first and filter after — a door may sit equidistant from two roads but only face
 * one. So every road's nearest point is tested against the rule, and the closest qualifying one
 * wins.
 */
function bestRoadPoint(
  a: Anchor, roads: ReadonlyArray<RoadPolyline>, rule: SnapRule,
): RoadHit | null {
  let best: RoadHit | null = null;
  const consider = (x: number, y: number, roadId: string): void => {
    const dist = Math.hypot(a.x - x, a.y - y);
    if (dist > rule.maxGap) return;
    if (rule.facing === 'toward') {
      const dx = x - a.x, dy = y - a.y, m = Math.hypot(dx, dy) || 1;
      if (dot(a.facing[0], a.facing[1], dx / m, dy / m) < COS_TOL) return;
    }
    if (!best || dist < best.dist) best = { x, y, dist, roadId };
  };
  for (const road of roads) {
    const pts = road.points;
    if (pts.length === 1) { consider(pts[0].x, pts[0].y, road.id); continue; }
    for (let i = 1; i < pts.length; i++) {
      const c = closestOnSegment(a.x, a.y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
      consider(c.x, c.y, road.id);
    }
  }
  return best;
}

/** Stable key for ordering candidate links deterministically. */
function endpointKey(e: AnchorEndpoint): string {
  return `${e.ownerId ?? ''}|${e.id ?? ''}|${e.kind}|${e.x.toFixed(3)},${e.y.toFixed(3)}`;
}

export interface MatchOptions {
  rules?: readonly SnapRule[];
  roads?: ReadonlyArray<RoadPolyline>;
  /** Optional: reject a link whose midpoint is blocked by an unrelated occupant. */
  blocked?: (x: number, y: number) => boolean;
}

/**
 * Match anchors into links under the rule set. Deterministic and pure.
 *
 * Structure→road rules (`b: 'road'`) snap each source anchor to the nearest point on any road
 * polyline. Anchor↔anchor rules pair the two kinds. Each anchor links at most once PER relation
 * kind (a door snaps to one road, not five), assigned greedily by smallest gap.
 */
export function matchAnchors(anchors: ReadonlyArray<Anchor>, opts: MatchOptions = {}): AnchorLink[] {
  const rules = opts.rules ?? DEFAULT_RULES;
  const roads = opts.roads ?? [];
  const blocked = opts.blocked;
  const links: AnchorLink[] = [];

  // Track which anchors are already consumed, per relation kind.
  const used = new Set<string>();
  const usedKey = (e: AnchorEndpoint, rel: LinkRelation) => `${rel}:${endpointKey(e)}`;
  const toEndpoint = (a: Anchor): AnchorEndpoint => ({ kind: a.kind, x: a.x, y: a.y, id: a.id, ownerId: a.ownerId });

  const midBlocked = (ax: number, ay: number, bx: number, by: number): boolean =>
    blocked ? blocked(Math.round((ax + bx) / 2), Math.round((ay + by) / 2)) : false;

  // ── Structure→road rules ───────────────────────────────────────────────────
  const roadRules = rules.filter((r) => r.b === 'road' && r.a !== 'road');
  for (const rule of roadRules) {
    const candidates: AnchorLink[] = [];
    for (const a of anchors) {
      if (a.kind !== rule.a) continue;
      const near = bestRoadPoint(a, roads, rule);
      if (!near) continue;
      if (midBlocked(a.x, a.y, near.x, near.y)) continue;
      candidates.push({
        a: toEndpoint(a),
        b: { kind: 'road', x: near.x, y: near.y, ownerId: near.roadId },
        relation: rule.relation,
        gap: near.dist,
      });
    }
    assign(candidates, used, usedKey, links, false);
  }

  // ── Anchor↔anchor rules ────────────────────────────────────────────────────
  const pairRules = rules.filter((r) => r.b !== 'road');
  for (const rule of pairRules) {
    const as = anchors.filter((a) => a.kind === rule.a);
    const bs = anchors.filter((a) => a.kind === rule.b);
    const candidates: AnchorLink[] = [];
    for (const a of as) {
      for (const b of bs) {
        if (a === b) continue;
        // Same-kind rules (wall_end↔wall_end, stair↔stair): avoid the mirror pair by ordering on key.
        if (rule.a === rule.b && endpointKey(toEndpoint(a)) >= endpointKey(toEndpoint(b))) continue;
        if (rule.requireSamePair && (a.pair === undefined || a.pair !== b.pair)) continue;
        const gap = Math.hypot(a.x - b.x, a.y - b.y);
        if (gap > rule.maxGap) continue;
        if (rule.facing === 'oppose' && dot(a.facing[0], a.facing[1], b.facing[0], b.facing[1]) > -COS_TOL) continue;
        if (rule.facing === 'toward') {
          const dx = b.x - a.x, dy = b.y - a.y, m = Math.hypot(dx, dy) || 1;
          if (dot(a.facing[0], a.facing[1], dx / m, dy / m) < COS_TOL) continue;
        }
        if (midBlocked(a.x, a.y, b.x, b.y)) continue;
        candidates.push({ a: toEndpoint(a), b: toEndpoint(b), relation: rule.relation, gap });
      }
    }
    assign(candidates, used, usedKey, links, true);
  }

  // Final stable order so callers/serialization see a canonical link list.
  links.sort((p, q) => p.gap - q.gap || endpointKey(p.a).localeCompare(endpointKey(q.a)) || endpointKey(p.b).localeCompare(endpointKey(q.b)));
  return links;
}

/**
 * Greedy best-first assignment. `consumeBoth` controls whether the partner endpoint is also
 * marked used (true for anchor↔anchor; false for road, since many doors share one road).
 */
function assign(
  candidates: AnchorLink[],
  used: Set<string>,
  usedKey: (e: AnchorEndpoint, rel: LinkRelation) => string,
  out: AnchorLink[],
  consumeBoth: boolean,
): void {
  candidates.sort((p, q) => p.gap - q.gap
    || endpointKey(p.a).localeCompare(endpointKey(q.a))
    || endpointKey(p.b).localeCompare(endpointKey(q.b)));
  for (const link of candidates) {
    const ka = usedKey(link.a, link.relation);
    const kb = usedKey(link.b, link.relation);
    if (used.has(ka)) continue;
    if (consumeBoth && used.has(kb)) continue;
    used.add(ka);
    if (consumeBoth) used.add(kb);
    out.push(link);
  }
}
