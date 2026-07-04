// D6 — barrier foot-z lift on a SLOPE. A barrier run decomposes into pieces (curtain chunks +
// towers) that meet at shared grade points. Each piece is a sprite lifted onto the GPU terrain by
// ONE sampled height. If the sample point is the sprite's bbox centre (± the building `dw/4`
// convention), pieces of different width/height sample DIFFERENT tiles — so on a slope two pieces
// that share a grade anchor lift by different amounts and their seam splits. The lift must sample
// terrain at the piece's true anchor (refX,refY), so co-anchored pieces always lift together.
import { describe, it, expect } from 'vitest';
import { barrierPieceItem } from '@/render/iso/iso-barrier';
import { liftDrawList, type TerrainLiftField } from '@/render/gpu/terrain-lift';
import { worldToScreen } from '@/render/iso/iso-projection';
import type { BarrierPiece } from '@/render/iso/sprite-canvas';
import type { DrawItem } from '@/render/iso/draw-list';

// A west→east ramp: height = tile-x. reliefM·zPxPerM = 10 ⇒ lift = 10·x px. Adjacent tiles differ,
// so a 1-tile error in the sample point is a 10px error in the lift.
const RAMP: TerrainLiftField = {
  heights: Float32Array.from({ length: 6 * 6 }, (_, i) => i % 6),
  globals: { grid: [6, 6], half: [64, 32], zPxPerM: 10, seaLevel: 0, reliefM: 1 },
};

/** A fake lit pack of the given crop size (barrierPieceItem only reads albedo w/h + map presence). */
const piece = (w: number, h: number, anchorNX: number, anchorNY: number): BarrierPiece => ({
  pack: { albedo: { width: w, height: h } as unknown as BarrierPiece['pack']['albedo'], materialData: {} as never },
  refX: 3, refY: 1, anchorNX, anchorNY, sortX: 3, sortY: 1,   // same grade anchor for both
});

const anchorScreenY = (it: DrawItem, p: BarrierPiece): number =>
  it.t === 'image' ? it.dy + p.anchorNY * it.dh : NaN;

describe('D6 — barrier pieces lift by their anchor tile on a slope', () => {
  // A wide, shallow curtain chunk and a narrow, tall tower — both anchored at the SAME grade point.
  const chunk = piece(228, 298, 0.216, 0.701);
  const tower = piece(120, 360, 0.5, 0.9);
  const o = { originX: 0, originY: 0 };

  it('co-anchored chunk + tower lift TOGETHER (no seam split on the ramp)', () => {
    const items = [barrierPieceItem(o, chunk), barrierPieceItem(o, tower)];
    const [lc, lt] = liftDrawList(items, RAMP) as DrawItem[];
    // Both anchors sit at worldToScreen(3,1) = (128,128) ⇒ tile (3,1), height 3 ⇒ 30px lift.
    const grade = worldToScreen(3, 1, 0, 0, 0).sy;      // 128
    expect(anchorScreenY(lc, chunk)).toBeCloseTo(grade - 30, 0);
    expect(anchorScreenY(lt, tower)).toBeCloseTo(grade - 30, 0);
    // The seam is the whole point: the two pieces must not separate.
    expect(Math.abs(anchorScreenY(lc, chunk) - anchorScreenY(lt, tower))).toBeLessThan(1);
  });
});
