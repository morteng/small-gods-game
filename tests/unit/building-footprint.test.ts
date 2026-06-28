// tests/unit/building-footprint.test.ts
// The ONE footprint derivation (spatial-coordination C1): `structureBox` is the bbox
// of a blueprint's resolved parts (the box the renderer draws over), and
// `buildingVisualCells` enumerates that box in absolute tile coords (the extent a
// barrier gate guard must open across). Both read parts/footprint only, so we drive
// them with minimal blueprint stubs.
import { describe, it, expect } from 'vitest';
import { structureBox, buildingVisualCells } from '@/blueprint/footprint';
import type { ResolvedBlueprint, ResolvedPart } from '@/blueprint/types';

function part(x: number, y: number, w: number, h: number): ResolvedPart {
  return { type: 'body', at: { x, y }, size: { w, h } } as unknown as ResolvedPart;
}
function bp(parts: ResolvedPart[], footprint = { w: 4, h: 4 }): ResolvedBlueprint {
  return { parts, footprint } as unknown as ResolvedBlueprint;
}

describe('structureBox — the renderer/gate-guard shared box', () => {
  it('is the min/max bbox over the parts', () => {
    const s = structureBox(bp([part(0, 0, 2, 3)]));
    expect(s).toEqual({ dx: 0, dy: 0, w: 2, h: 3 });
  });

  it('unions multiple parts into one box (an offset wing widens it)', () => {
    const s = structureBox(bp([part(0, 0, 2, 2), part(2, 1, 1, 2)]));
    // x: 0..3, y: 0..3 → 3×3 box anchored at origin.
    expect(s).toEqual({ dx: 0, dy: 0, w: 3, h: 3 });
  });

  it('carries the box OFFSET when no part sits at the origin', () => {
    const s = structureBox(bp([part(1, 2, 2, 2)]));
    expect(s).toEqual({ dx: 1, dy: 2, w: 2, h: 2 });
  });

  it('falls back to the declared footprint when there are no parts', () => {
    const s = structureBox(bp([], { w: 5, h: 6 }));
    expect(s).toEqual({ dx: 0, dy: 0, w: 5, h: 6 });
  });
});

describe('buildingVisualCells — absolute silhouette tiles', () => {
  it('enumerates every cell of the box, offset to the placement origin', () => {
    const cells = buildingVisualCells(bp([part(0, 0, 2, 2)]), 10, 20);
    expect(new Set(cells)).toEqual(new Set(['10,20', '11,20', '10,21', '11,21']));
  });

  it('count equals box area; respects the part offset', () => {
    const cells = buildingVisualCells(bp([part(1, 0, 2, 3)]), 5, 5);
    expect(cells).toHaveLength(2 * 3);
    // box starts at origin+offset = (6,5)
    expect(cells).toContain('6,5');
    expect(cells).toContain('7,7');
    expect(cells).not.toContain('5,5'); // left of the offset box
  });

  it('a draw-only cell (part wider than its claim) is covered by the visual extent', () => {
    // A 2×2 tower body drawn over its full box; the solid notion may claim less, but
    // the visual extent always covers the whole drawn box.
    const cells = new Set(buildingVisualCells(bp([part(0, 0, 2, 2)]), 0, 0));
    for (const c of ['0,0', '1,0', '0,1', '1,1']) expect(cells.has(c)).toBe(true);
  });
});
