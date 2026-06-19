import { describe, it, expect } from 'vitest';
import { liftAt, liftDrawList, tileLiftPx, type TerrainLiftField } from '@/render/gpu/terrain-lift';
import type { DrawItem } from '@/render/iso/draw-list';

// 2x2 field; only tile (1,1) is elevated. half = ISO half-tile (64,32).
const field: TerrainLiftField = {
  heights: new Float32Array([0, 0, 0, 1]), // row-major: (0,0)(1,0)(0,1)(1,1)
  globals: { grid: [2, 2], half: [64, 32], zPxPerM: 2, seaLevel: 0, reliefM: 10 },
};
// tile (1,1) elev 1 ⇒ (1-0)*10*2 = 20px lift.

describe('liftAt', () => {
  it('is zero over flat sea-level tiles', () => {
    // screen (0,0) ⇒ tile (0,0), elev 0
    expect(liftAt(field, 0, 0)).toBe(0);
  });
  it('matches the shader heightPx over an elevated tile', () => {
    // worldToScreen(1,1) = ((1-1)*64, (1+1)*32) = (0, 64) ⇒ tile (1,1)
    expect(liftAt(field, 0, 64)).toBe(20);
  });
  it('clamps out-of-range screen points to the nearest edge tile', () => {
    expect(liftAt(field, 100000, 100000)).toBe(20); // clamps to (1,1)
    expect(liftAt(field, -100000, -100000)).toBe(0); // clamps to (0,0)
  });
  it('returns 0 for a degenerate field', () => {
    const empty: TerrainLiftField = { heights: new Float32Array(), globals: { grid: [0, 0], half: [64, 32], zPxPerM: 2, seaLevel: 0, reliefM: 10 } };
    expect(liftAt(empty, 0, 64)).toBe(0);
  });
});

describe('tileLiftPx', () => {
  it('is zero over a flat sea-level tile', () => {
    expect(tileLiftPx(field, 0, 0)).toBe(0);
  });
  it('matches the shader heightPx at an elevated tile centre', () => {
    // tile (1,1) elev 1 ⇒ 20px. Tile-centre 1.5 rounds to cell (1,1).
    expect(tileLiftPx(field, 1.5, 1.5)).toBe(20);
  });
  it('clamps out-of-range tiles to the nearest edge cell', () => {
    expect(tileLiftPx(field, 99, 99)).toBe(20);  // clamps to (1,1)
    expect(tileLiftPx(field, -99, -99)).toBe(0); // clamps to (0,0)
  });
  it('returns 0 for a degenerate field', () => {
    const empty: TerrainLiftField = { heights: new Float32Array(), globals: { grid: [0, 0], half: [64, 32], zPxPerM: 2, seaLevel: 0, reliefM: 10 } };
    expect(tileLiftPx(empty, 1.5, 1.5)).toBe(0);
  });
});

describe('liftDrawList', () => {
  it('passes items through unchanged when there is no field', () => {
    const items: DrawItem[] = [{ t: 'image', src: {} as CanvasImageSource, dx: 0, dy: 0, dw: 8, dh: 8 }];
    expect(liftDrawList(items, null)).toBe(items);
  });

  it('lifts an image by the terrain height under its foot', () => {
    // foot = (dx+dw/2, dy+dh-footLift). With no maps, footLift=0.
    // Put the foot at screen (0,64) ⇒ tile (1,1) ⇒ lift 20.
    // dx+dw/2 = 0 ⇒ dx = -dw/2; dy+dh = 64.
    const it: DrawItem = { t: 'image', src: {} as CanvasImageSource, dx: -4, dy: 56, dw: 8, dh: 8 };
    const [out] = liftDrawList([it], field) as DrawItem[];
    expect(out.t).toBe('image');
    if (out.t === 'image') expect(out.dy).toBe(56 - 20);
  });

  it('does not clone items whose lift is zero', () => {
    const it: DrawItem = { t: 'image', src: {} as CanvasImageSource, dx: -4, dy: -8, dw: 8, dh: 8 }; // foot at (0,0)
    const [out] = liftDrawList([it], field) as DrawItem[];
    expect(out).toBe(it);
  });

  it('lifts a circle by its bottom contact', () => {
    // bottom = (cx, cy+r). Put at (0,64) ⇒ tile (1,1) ⇒ lift 20.
    const it: DrawItem = { t: 'circle', cx: 0, cy: 54, r: 10, color: '#3a7a3a' };
    const [out] = liftDrawList([it], field) as DrawItem[];
    if (out.t === 'circle') expect(out.cy).toBe(54 - 20);
  });

  it('lifts a poly by its lowest vertex', () => {
    // lowest vertex at (0,64) ⇒ tile (1,1) ⇒ lift 20; all ys shift up by 20.
    const it: DrawItem = {
      t: 'poly', color: '#8B5A2B',
      points: [{ x: -2, y: 60 }, { x: 2, y: 60 }, { x: 0, y: 64 }],
    };
    const [out] = liftDrawList([it], field) as DrawItem[];
    if (out.t === 'poly') {
      expect(out.points.map((p) => p.y)).toEqual([40, 40, 44]);
    }
  });
});
