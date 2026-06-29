// src/blueprint/compile/to-collision.ts
// Precompute passability: blocked structure cells (union of part claims) + threshold cells
// (passable) for openings whose kind is a threshold (doors/gates, NOT windows). Footprint
// cells not in `blocked` are walkable lawn.
import type { ResolvedBlueprint, ResolvedFeature, WallFace } from '../types';
import { getPartType, getFeatureType, type CompileCtx } from '../registry';
import { faceCell } from '../wall-geometry';
import { rotateCell, rotateFootprint } from '../orientation';

const key = (x: number, y: number) => `${x},${y}`;

export function toCollision(rb: ResolvedBlueprint): { footprint: { w: number; h: number }; blocked: string[]; doorCells: string[] } {
  const ctx: CompileCtx = { materials: rb.materials, footprint: rb.footprint };
  const blocked = new Set<string>();
  const doorCells = new Set<string>();
  // Cells are computed in the CANONICAL footprint frame, then rotated by the placement
  // orientation so the occupancy claim matches the rotated sprite (the geometry half of
  // the same turn lives in to-geometry's yaw). o=0 ⇒ identity (byte-unchanged).
  const o = rb.orientation ?? 0;
  const { w, h } = rb.footprint;
  const place = (x: number, y: number): [number, number] => o ? rotateCell(x, y, w, h, o) : [x, y];
  for (const part of rb.parts) {
    const pt = getPartType(part.type);
    for (const [x, y] of pt.toCollision(part, ctx)) blocked.add(key(...place(x, y)));
    for (const f of part.features as ResolvedFeature[]) {
      const ft = getFeatureType(f.type);
      if (!ft?.threshold) continue;   // only threshold openings (doors/gates) carve a walkable cell
      const t = (f.params.t as number) ?? 0.5;
      const [dx, dy] = faceCell(part, (f.face ?? 'south') as WallFace, t);
      doorCells.add(key(...place(dx, dy)));
    }
  }
  return { footprint: rotateFootprint(w, h, o), blocked: [...blocked], doorCells: [...doorCells] };
}
