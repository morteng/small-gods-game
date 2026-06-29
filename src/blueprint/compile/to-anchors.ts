// src/blueprint/compile/to-anchors.ts
// World-space anchors for a placed blueprint, driven by each part's threshold openings
// (doors/gates). The anchor kind is the opening's kind, so a gate reads as a 'gate' anchor.
import type { ResolvedBlueprint, WallFace } from '../types';
import { getFeatureType } from '../registry';
import { faceCell, FACE_FACING } from '../wall-geometry';
import type { Anchor, AnchorKind } from '@/world/anchors';
import { rotateCell, rotateFacing } from '../orientation';

export function toAnchors(rb: ResolvedBlueprint, originX: number, originY: number): Anchor[] {
  const out: Anchor[] = [];
  // The door cell + its outward facing are computed canonically, then rotated by the
  // placement orientation so the pathing anchor lands on the rotated sprite's real door
  // and points the right way (door-faces-road). o=0 ⇒ identity.
  const o = rb.orientation ?? 0;
  const { w, h } = rb.footprint;
  for (const part of rb.parts) {
    for (const f of part.features) {
      const ft = getFeatureType(f.type);
      if (!ft?.threshold) continue;   // only passable openings get a pathing anchor
      const face = (f.face ?? 'south') as WallFace;
      const t = (f.params.t as number) ?? 0.5;
      const [cx0, cy0] = faceCell(part, face, t);
      const fdir0 = FACE_FACING[face];
      const [cx, cy] = o ? rotateCell(cx0, cy0, w, h, o) : [cx0, cy0];
      const fdir = o ? rotateFacing(fdir0[0], fdir0[1], o) : fdir0;
      const x = originX + cx + (fdir[0] > 0 ? 1 : fdir[0] < 0 ? 0 : 0.5);
      const y = originY + cy + (fdir[1] > 0 ? 1 : fdir[1] < 0 ? 0 : 0.5);
      out.push({ kind: f.type as AnchorKind, x, y, facing: fdir, main: f.params.main === true });
    }
  }
  return out;
}
