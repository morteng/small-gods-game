// src/blueprint/compile/to-anchors.ts
// World-space anchors for a placed blueprint. Ports buildingAnchors/outwardFacing,
// driven by each part's door features.
import type { ResolvedBlueprint, ResolvedPart, WallFace } from '../types';
import type { Anchor } from '@/world/anchors';

const FACING: Record<WallFace, [number, number]> = {
  south: [0, 1], north: [0, -1], east: [1, 0], west: [-1, 0],
};

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

export function toAnchors(rb: ResolvedBlueprint, originX: number, originY: number): Anchor[] {
  const out: Anchor[] = [];
  for (const part of rb.parts) {
    for (const f of part.features) {
      if (f.type !== 'door') continue;
      const face = (f.face ?? 'south') as WallFace;
      const [cx, cy] = doorCellFor(part, face);
      const fdir = FACING[face];
      const x = originX + cx + (fdir[0] > 0 ? 1 : fdir[0] < 0 ? 0 : 0.5);
      const y = originY + cy + (fdir[1] > 0 ? 1 : fdir[1] < 0 ? 0 : 0.5);
      out.push({ kind: 'door', x, y, facing: fdir, main: f.params.main === true });
    }
  }
  return out;
}
