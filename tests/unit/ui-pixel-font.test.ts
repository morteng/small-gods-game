import { describe, it, expect } from 'vitest';
import { BuiltinPixelFont } from '@/render/ui/text/pixel-font';
import { UiPage } from '@/render/ui/ui-batcher';

const f = new BuiltinPixelFont();

describe('BuiltinPixelFont', () => {
  it('measures by 6px advance per char (5px glyph + 1px tracking)', () => {
    expect(f.measure('ABC', 1)).toBe(18);
    expect(f.measure('ABC', 2)).toBe(36);
    expect(f.measure('', 1)).toBe(0);
  });

  it('line height is (7+2) px per scale', () => {
    expect(f.lineHeight(1)).toBe(9);
    expect(f.lineHeight(3)).toBe(27);
  });

  it('emits one Solid-page quad per lit pixel', () => {
    // 'I' is a known glyph: top bar (5) + stem (5 rows × 1) + bottom bar (5) = 15 lit px
    const quads = f.layout('I', 0, 0, 1);
    expect(quads.length).toBe(15);
    expect(quads.every((q) => q.page === UiPage.Solid)).toBe(true);
    expect(quads.every((q) => q.w === 1 && q.h === 1)).toBe(true);
  });

  it('scales each lit pixel to scale×scale and offsets by advance', () => {
    const q1 = f.layout('I', 0, 0, 1);
    const q2 = f.layout('I', 0, 0, 2);
    expect(q2.length).toBe(q1.length); // same lit-pixel count
    expect(q2.every((q) => q.w === 2 && q.h === 2)).toBe(true);
    // second char starts one advance (6 px) to the right at scale 1
    const two = f.layout('II', 0, 0, 1);
    const maxX = Math.max(...two.map((q) => q.x));
    expect(maxX).toBeGreaterThanOrEqual(6);
  });

  it('is case-insensitive (lowercase maps to the uppercase glyph)', () => {
    expect(f.layout('a', 0, 0, 1)).toEqual(f.layout('A', 0, 0, 1));
  });

  it('skips spaces and unknown glyphs but still advances the cursor', () => {
    expect(f.layout(' ', 0, 0, 1)).toHaveLength(0);
    expect(f.layout('~', 0, 0, 1)).toHaveLength(0); // unmapped
    // 'A B' — the space contributes no quads but shifts the 'B' to cell index 2
    const ab = f.layout('A B', 0, 0, 1);
    const minX = Math.min(...ab.map((q) => q.x));
    const maxX = Math.max(...ab.map((q) => q.x));
    expect(minX).toBe(0); // 'A' starts at the origin
    expect(maxX).toBeGreaterThanOrEqual(12); // 'B' is at cell index 2 (×6 px)
  });
});
