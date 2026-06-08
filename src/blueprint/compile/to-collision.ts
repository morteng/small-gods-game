// src/blueprint/compile/to-collision.ts
// Precompute passability: blocked structure cells (union of part claims) + door cells
// (passable). Footprint cells not in `blocked` are walkable lawn.
import type { ResolvedBlueprint, ResolvedPart, ResolvedFeature, WallFace } from '../types';
import { getPartType, type CompileCtx } from '../registry';

const key = (x: number, y: number) => `${x},${y}`;

/** The structure-local cell a door on `face` occupies — midpoint of that edge of the part. */
function doorCellFor(part: ResolvedPart, face: WallFace): [number, number] {
  const { x, y } = part.at, { w, h } = part.size;
  const midX = x + Math.floor(w / 2), midY = y + Math.floor(h / 2);
  switch (face) {
    case 'south': return [midX, y + h - 1];
    case 'north': return [midX, y];
    case 'east':  return [x + w - 1, midY];
    case 'west':  return [x, midY];
  }
}

export function toCollision(rb: ResolvedBlueprint): { footprint: { w: number; h: number }; blocked: string[]; doorCells: string[] } {
  const ctx: CompileCtx = { materials: rb.materials, footprint: rb.footprint };
  const blocked = new Set<string>();
  const doorCells = new Set<string>();
  for (const part of rb.parts) {
    const pt = getPartType(part.type);
    for (const [x, y] of pt.toCollision(part, ctx)) blocked.add(key(x, y));
    for (const f of part.features as ResolvedFeature[]) {
      if (f.type !== 'door') continue;
      const [dx, dy] = doorCellFor(part, (f.face ?? 'south') as WallFace);
      doorCells.add(key(dx, dy));
    }
  }
  return { footprint: { ...rb.footprint }, blocked: [...blocked], doorCells: [...doorCells] };
}
