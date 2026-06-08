// src/blueprint/compile/to-collision.ts
// Precompute passability: blocked structure cells (union of part claims) + threshold cells
// (passable) for openings whose kind is a threshold (doors/gates, NOT windows). Footprint
// cells not in `blocked` are walkable lawn.
import type { ResolvedBlueprint, ResolvedFeature, WallFace } from '../types';
import { getPartType, getFeatureType, type CompileCtx } from '../registry';
import { faceCell } from '../wall-geometry';

const key = (x: number, y: number) => `${x},${y}`;

export function toCollision(rb: ResolvedBlueprint): { footprint: { w: number; h: number }; blocked: string[]; doorCells: string[] } {
  const ctx: CompileCtx = { materials: rb.materials, footprint: rb.footprint };
  const blocked = new Set<string>();
  const doorCells = new Set<string>();
  for (const part of rb.parts) {
    const pt = getPartType(part.type);
    for (const [x, y] of pt.toCollision(part, ctx)) blocked.add(key(x, y));
    for (const f of part.features as ResolvedFeature[]) {
      const ft = getFeatureType(f.type);
      if (!ft?.threshold) continue;   // only threshold openings (doors/gates) carve a walkable cell
      const t = (f.params.t as number) ?? 0.5;
      const [dx, dy] = faceCell(part, (f.face ?? 'south') as WallFace, t);
      doorCells.add(key(dx, dy));
    }
  }
  return { footprint: { ...rb.footprint }, blocked: [...blocked], doorCells: [...doorCells] };
}
