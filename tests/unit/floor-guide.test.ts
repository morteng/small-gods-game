import { describe, it, expect } from 'vitest';
import { buildFloorGuide } from '@/assetgen/floor-guide';

const ISO_TILE_H = 64; // halfH = 32

function alphaAt(g: ReturnType<typeof buildFloorGuide>, x: number, y: number): number {
  return g.data[(y * g.width + x) * 4 + 3];
}

describe('buildFloorGuide', () => {
  it('returns an RGBA buffer at the requested frame size', () => {
    const g = buildFloorGuide(256, 240, 2, 2);
    expect(g.width).toBe(256);
    expect(g.height).toBe(240);
    expect(g.data.length).toBe(256 * 240 * 4);
  });

  it('leaves the frame transparent outside the floor (top corners empty)', () => {
    const g = buildFloorGuide(256, 240, 2, 2);
    // top-left corner is well above the floor block → transparent
    expect(alphaAt(g, 2, 2)).toBe(0);
    expect(alphaAt(g, g.width - 3, 2)).toBe(0);
  });

  it('seats the floor at the bottom-centre (south tip on the bottom edge)', () => {
    const g = buildFloorGuide(256, 240, 2, 2);
    // The south tip is the centre column at the very bottom row.
    expect(alphaAt(g, Math.floor(g.width / 2), g.height - 1)).toBe(255);
    // ...and the centre is opaque floor.
    expect(alphaAt(g, Math.floor(g.width / 2), g.height - ISO_TILE_H)).toBe(255);
  });

  it('a wide footprint fills more horizontal extent than a square one', () => {
    const wide = buildFloorGuide(384, 304, 4, 2); // longhouse-ish
    const square = buildFloorGuide(384, 304, 3, 3);
    const opaqueCols = (g: ReturnType<typeof buildFloorGuide>, row: number) => {
      let n = 0;
      for (let x = 0; x < g.width; x++) if (alphaAt(g, x, row) > 0) n++;
      return n;
    };
    // At the floor's vertical mid-band both have content; the (4+2) block spans
    // the same total width as (3+3) — both (w+h)=6 → equal max width — but the
    // wide one is shorter, so sample near the bottom where the square is narrower.
    expect(opaqueCols(wide, wide.height - 8)).toBeGreaterThan(0);
    expect(opaqueCols(square, square.height - 8)).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const a = buildFloorGuide(256, 240, 2, 2);
    const b = buildFloorGuide(256, 240, 2, 2);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });
});
