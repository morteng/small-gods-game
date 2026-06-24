// src/world/anchor-query.ts
//
// The consumer-facing read for MOUNT anchors — the 2026-06-13 spec's `world.queryAnchors`.
// A building's mount sockets (where a sign hangs / a bird perches / smoke leaves) are not
// stored on the entity; they are derived ON DEMAND from the stored resolved blueprint, so
// adding them changes nothing about saved/snapshotted entities. A consumer that scans many
// buildings every frame should cache the result itself.
import type { Entity } from '@/core/types';
import type { Anchor, MountAnchorKind } from './anchors';
import { blueprintOf } from '@/blueprint/entity';
import { toMountAnchors } from '@/blueprint/compile/to-mount-anchors';

export interface MountAnchorQuery {
  /** Keep only these socket kinds (a single kind or a set). */
  role?: MountAnchorKind | MountAnchorKind[];
  /** Keep only sockets that accept this attachment token (e.g. 'perch', 'sign'). */
  accepts?: string;
}

/** Every mount anchor of a placed building, stamped with a stable owner + id. `[]` for a
 *  non-building entity (or one without a stored blueprint). Ids are full-set indices, so a
 *  given socket keeps its id regardless of how a later query filters. */
export function mountAnchorsOf(e: Entity): Anchor[] {
  const bp = blueprintOf(e);
  if (!bp) return [];
  return toMountAnchors(bp.rb, e.x, e.y).map((a, i) => ({
    ...a, ownerId: a.ownerId ?? e.id, id: a.id ?? `${e.id}:m${i}`,
  }));
}

/** Mount anchors of `e`, filtered by socket kind and/or accepted attachment token.
 *  `queryMountAnchors(e, { accepts: 'perch' })` → every spot a bird can land. */
export function queryMountAnchors(e: Entity, q: MountAnchorQuery = {}): Anchor[] {
  let out = mountAnchorsOf(e);
  if (q.role) {
    const roles = Array.isArray(q.role) ? q.role : [q.role];
    out = out.filter(a => roles.includes(a.kind as MountAnchorKind));
  }
  if (q.accepts) out = out.filter(a => a.accepts?.includes(q.accepts!));
  return out;
}
