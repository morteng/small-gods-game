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
  const implicitDoorCells = new Set<string>();   // toDoorCells offers — see below; only used as a fallback
  // Cells are computed in the CANONICAL footprint frame, then rotated by the placement
  // orientation so the occupancy claim matches the rotated sprite (the geometry half of
  // the same turn lives in to-geometry's yaw). o=0 ⇒ identity (byte-unchanged).
  const o = rb.orientation ?? 0;
  const { w, h } = rb.footprint;
  const place = (x: number, y: number): [number, number] => o ? rotateCell(x, y, w, h, o) : [x, y];
  for (const part of rb.parts) {
    const pt = getPartType(part.type);
    for (const [x, y] of pt.toCollision(part, ctx)) blocked.add(key(...place(x, y)));
    for (const [x, y] of pt.toDoorCells?.(part, ctx) ?? []) implicitDoorCells.add(key(...place(x, y)));
    for (const f of part.features as ResolvedFeature[]) {
      const ft = getFeatureType(f.type);
      if (!ft?.threshold) continue;   // only threshold openings (doors/gates) carve a walkable cell
      const t = (f.params.t as number) ?? 0.5;
      const [dx, dy] = faceCell(part, (f.face ?? 'south') as WallFace, t);
      doorCells.add(key(...place(dx, dy)));
    }
  }
  // Implicit door: an open-frame part (the market stall — see `blueprint/parts/lightweight.ts`,
  // its `toDoorCells`) declares its own door cell(s) explicitly rather than carving one through a
  // (nonexistent) wall via a `door` FEATURE — it has no threshold feature at all, so the loop
  // above never populates `doorCells` for it. `resolveBuildingDraw`
  // (sim/population/building-capacity.ts) resolves spawns/visitors onto `collision.doorCells[0]`,
  // and `world/building-placer.ts`'s `commit()`/`doorOf` reopens whatever `walkable=false`
  // clearFootprint stamped at that SAME cell — two independent readers that used to guess
  // differently (an unrotated `[0,0]`/legacy-template default vs. an orientation-rotated
  // placement) and disagree once a building got rotated to front a road. Only used when NO real
  // threshold exists, so it never overrides an authored door; a walled part (`body`) with no door
  // FEATURE leaves `toDoorCells` undefined, so "no door" stays a visible authoring gap rather than
  // a silently invented one (tests/unit/blueprint-to-collision.test.ts pins exactly that case).
  if (doorCells.size === 0) for (const k of implicitDoorCells) doorCells.add(k);
  return { footprint: rotateFootprint(w, h, o), blocked: [...blocked], doorCells: [...doorCells] };
}
