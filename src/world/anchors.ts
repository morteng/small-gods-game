// src/world/anchors.ts
//
// An Anchor is a typed connection point on a world feature: a point, an outward unit
// tangent ("which way it faces"), and a kind/tags that say what it attaches to. It is the
// roads-article "profile" (point + direction) lifted to a connection primitive — every
// producer emits anchors, and `matchAnchors` (anchor-rules.ts) snaps compatible ones into
// links. See docs/superpowers/specs/2026-06-20-anchor-snap-fit-connectome-design.md.
//
// Two flavours share this one primitive (the "unified anchor, whole stack" decision —
// docs/superpowers/specs/2026-06-24-establishments-site-connectome-design.md §5):
//   • CONNECTION anchors (door/gate/road/wall_end/water_edge/frontage/service/bank) —
//     ground-plane sockets that `matchAnchors` snaps into links. `z` is omitted.
//   • MOUNT anchors (lintel/roof_ridge/gable_peak/chimney_top/eave/roof_apex) — typed
//     attachment points ON a structure that say "a sign hangs here / a bird lands here".
//     They carry a metric `z` (height above the foot) and an `accepts` token list.
// The mount-kind vocabulary follows the earlier semantic-feature-anchor-tags brainstorm
// (docs/superpowers/specs/2026-06-13-semantic-feature-anchor-tags-design.md). That spec
// homed the tags at the SPRITE layer (normalised to the opaque bbox, persisted in the
// SpritePack); per the 2026-06-24 "unified anchor, whole stack" decision the WORLD-space
// anchor here is now canonical, and a sprite-normalised projection is a downstream lookup.
export type ConnectionAnchorKind =
  | 'door' | 'gate' | 'road' | 'wall_end' | 'water_edge' | 'frontage' | 'service' | 'bank'
  | 'stair_anchor';
/** Where on a structure something can attach — a lintel over a door, the roof ridge, a
 *  gable peak, a chimney top, the eaves line, or a cone/dome apex. */
export type MountAnchorKind =
  | 'lintel' | 'roof_ridge' | 'gable_peak' | 'chimney_top' | 'eave' | 'roof_apex';
export type AnchorKind = ConnectionAnchorKind | MountAnchorKind;
export interface Anchor {
  kind: AnchorKind;
  x: number; y: number;          // world tile coords (fractional ok)
  facing: [number, number];      // outward unit vector
  width?: number;
  main?: boolean;
  /** Height in METRES above the structure foot. Mount anchors set it (a sign at the
   *  lintel, a perch on the ridge); connection anchors leave it undefined (ground plane). */
  z?: number;
  /** Attachment-kind tokens this socket will host — 'sign' | 'lamp' | 'banner' | 'finial'
   *  | 'perch' | 'smoke' | … Matched against an attachable's kind the same way Fixture
   *  `requires`/`satisfies` tokens match (one resolution rule, every scale). */
  accepts?: string[];
  /** Stable, deterministic id (owner-derived). Optional for legacy emitters. */
  id?: string;
  /** The feature that emitted this anchor — building entity id, road edge id, barrier id, … */
  ownerId?: string;
  /** Groups two anchors that must snap to EACH OTHER and nothing else (a stair flight's foot +
   *  head port share one `pair` key). A rule with `requireSamePair` only links anchors whose
   *  `pair` matches — so adjacent runs that share a boundary tile can't cross-match. */
  pair?: string;
  /** Free tags: 'approach', 'street', 'fortified', … */
  tags?: string[];
}

/** Outward unit vector for a footprint-relative cell: toward the nearest footprint edge. */
export function outwardFacing([cx, cy]: [number, number], fp: { w: number; h: number }): [number, number] {
  const dN = cy, dS = fp.h - 1 - cy, dW = cx, dE = fp.w - 1 - cx;
  const m = Math.min(dN, dS, dW, dE);
  if (m === dS) return [0, 1];
  if (m === dE) return [1, 0];
  if (m === dN) return [0, -1];
  return [-1, 0];
}

interface DescriptorLike { footprint: { w: number; h: number }; door: { x: number; y: number } }

/** World-space door anchor for a placed building (origin = footprint top-left in world tiles). */
export function buildingAnchors(desc: DescriptorLike, originX: number, originY: number): Anchor[] {
  const f = outwardFacing([desc.door.x, desc.door.y], desc.footprint);
  const x = originX + desc.door.x + (f[0] > 0 ? 1 : f[0] < 0 ? 0 : 0.5);
  const y = originY + desc.door.y + (f[1] > 0 ? 1 : f[1] < 0 ? 0 : 0.5);
  return [{ kind: 'door', x, y, facing: f, main: true }];
}

/** Nearest anchor of a kind to a point, or undefined. */
export function nearestAnchor(anchors: Anchor[], kind: AnchorKind, x: number, y: number): Anchor | undefined {
  let best: Anchor | undefined, bd = Infinity;
  for (const a of anchors) {
    if (a.kind !== kind) continue;
    const d = (a.x - x) ** 2 + (a.y - y) ** 2;
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}
