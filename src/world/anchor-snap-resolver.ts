// src/world/anchor-snap-resolver.ts
//
// The authoring seam. When Fate (or a command) says "attach THIS to THAT" — a market stall to a
// bridge deck, a shrine to a road — it shouldn't compute coordinates. It names two features; the
// resolver finds the best compatible anchor pair between them under the snap rules and returns a
// concrete link + the connectome relation to record. Pure; the live command-registry / Fate
// wiring is a thin call on top of this.

import type { Anchor } from './anchors';
import { matchAnchors, type AnchorLink, type RoadPolyline, type SnapRule } from './anchor-rules';
import { connect, type WorldNode } from './connectome/world-node';

export interface AttachQuery {
  /** The feature being attached — its anchors (door/frontage/gate/service/wall_end). */
  source: Anchor[];
  /** The feature it attaches TO — its anchors (e.g. another building's wall_end). */
  targetAnchors?: Anchor[];
  /** Or the road/deck surface it attaches to. */
  targetRoads?: RoadPolyline[];
  rules?: readonly SnapRule[];
  blocked?: (x: number, y: number) => boolean;
}

/**
 * Best link attaching `source` to the target, or null if nothing snaps. Deterministic: defers to
 * `matchAnchors`, then filters to links that actually cross from source to target.
 */
export function resolveAttach(q: AttachQuery): AnchorLink | null {
  // Ensure every anchor is identifiable so membership filtering is exact.
  const src = q.source.map((a, i) => ({ ...a, id: a.id ?? `src:${i}`, ownerId: a.ownerId ?? 'src' }));
  const tgt = (q.targetAnchors ?? []).map((a, i) => ({ ...a, id: a.id ?? `tgt:${i}`, ownerId: a.ownerId ?? 'tgt' }));
  const srcIds = new Set(src.map((a) => a.id));
  const tgtIds = new Set(tgt.map((a) => a.id));
  const roadIds = new Set((q.targetRoads ?? []).map((r) => r.id));

  const links = matchAnchors([...src, ...tgt], {
    rules: q.rules,
    roads: q.targetRoads,
    blocked: q.blocked,
  });

  const crossing = links.filter((l) => {
    const aIsSrc = l.a.id !== undefined && srcIds.has(l.a.id);
    const bIsTgt = (l.b.id !== undefined && tgtIds.has(l.b.id)) || (l.b.ownerId !== undefined && roadIds.has(l.b.ownerId));
    return aIsSrc && bIsTgt;
  });
  // matchAnchors already returns gap-ascending; take the closest valid attach.
  return crossing[0] ?? null;
}

/**
 * Resolve an attach intent and, if it snaps, record it on the connectome as a typed relation from
 * `fromId` to `toId`. Returns the new tree (unchanged if nothing snapped) plus the link for
 * inspection/geometry. The verb Fate / the command bus call.
 */
export function attachInConnectome(
  root: WorldNode, fromId: string, toId: string, q: AttachQuery,
): { root: WorldNode; link: AnchorLink | null } {
  const link = resolveAttach(q);
  if (!link) return { root, link: null };
  return { root: connect(root, fromId, link.relation, toId), link };
}
