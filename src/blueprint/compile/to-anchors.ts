// src/blueprint/compile/to-anchors.ts
// World-space anchors for a placed blueprint, driven by each part's threshold openings
// (doors/gates). The anchor kind is the opening's kind, so a gate reads as a 'gate' anchor.
import type { ResolvedBlueprint, WallFace } from '../types';
import { getFeatureType } from '../registry';
import { faceCell, FACE_FACING } from '../wall-geometry';
import type { Anchor, AnchorKind } from '@/world/anchors';

export function toAnchors(rb: ResolvedBlueprint, originX: number, originY: number): Anchor[] {
  const out: Anchor[] = [];
  for (const part of rb.parts) {
    for (const f of part.features) {
      const ft = getFeatureType(f.type);
      if (!ft?.threshold) continue;   // only passable openings get a pathing anchor
      const face = (f.face ?? 'south') as WallFace;
      const t = (f.params.t as number) ?? 0.5;
      const [cx, cy] = faceCell(part, face, t);
      const fdir = FACE_FACING[face];
      const x = originX + cx + (fdir[0] > 0 ? 1 : fdir[0] < 0 ? 0 : 0.5);
      const y = originY + cy + (fdir[1] > 0 ? 1 : fdir[1] < 0 ? 0 : 0.5);
      out.push({ kind: f.type as AnchorKind, x, y, facing: fdir, main: f.params.main === true });
    }
  }
  return out;
}
