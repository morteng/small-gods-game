// src/blueprint/parts/prim.ts
// Escape hatch: drop a raw assetgen prim in `params.prim` for anything the semantic
// part vocabulary doesn't (yet) cover. Passed through to the geometry compiler verbatim.
import type { PartType } from '../registry';
import type { Part as Prim } from '@/assetgen/compose';

export const primPartType: PartType = {
  type: 'prim',
  paramSchema: { prim: { kind: 'any', doc: 'raw assetgen Part object (passed through)' } },
  resolve: (part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p): Prim[] {
    const raw = p.params.prim;
    return raw && typeof raw === 'object' ? [raw as Prim] : [];
  },
  toCollision(p) {
    const cells: Array<[number, number]> = [];
    for (let i = 0; i < p.size.w; i++) for (let j = 0; j < p.size.h; j++) cells.push([p.at.x + i, p.at.y + j]);
    return cells;
  },
  toAnchors: () => [],
  toBrief: () => '',
};
