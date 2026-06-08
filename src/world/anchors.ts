// src/world/anchors.ts
export type AnchorKind = 'door' | 'gate' | 'road' | 'wall_end' | 'water_edge' | 'frontage' | 'service';
export interface Anchor {
  kind: AnchorKind;
  x: number; y: number;          // world tile coords (fractional ok)
  facing: [number, number];      // outward unit vector
  width?: number;
  main?: boolean;
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
