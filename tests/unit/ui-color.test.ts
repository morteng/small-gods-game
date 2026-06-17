import { describe, it, expect } from 'vitest';
import { parseUiColor, oklchToRgba, shade, withAlpha } from '@/render/ui/ui-color';

const close = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) < eps;

describe('ui-color', () => {
  it('oklch white/black map to sRGB extremes', () => {
    const white = oklchToRgba(1, 0, 0);
    expect(white.slice(0, 3).every((c) => close(c, 1))).toBe(true);
    const black = oklchToRgba(0, 0, 0);
    expect(black.slice(0, 3).every((c) => close(c, 0))).toBe(true);
  });

  it('parses oklch with alpha (the canvas-palette format)', () => {
    const [r, g, b, a] = parseUiColor('oklch(0.20 0.02 60 / 0.65)');
    expect(a).toBeCloseTo(0.65, 5);
    // dark surface: all channels low
    expect(r).toBeLessThan(0.3);
    expect(g).toBeLessThan(0.3);
    expect(b).toBeLessThan(0.3);
  });

  it('parses #hex (3/6/8) and rgb()', () => {
    expect(parseUiColor('#fff')).toEqual([1, 1, 1, 1]);
    expect(parseUiColor('#ff0000')).toEqual([1, 0, 0, 1]);
    const [, , , a] = parseUiColor('#00000080');
    expect(a).toBeCloseTo(128 / 255, 5);
    expect(parseUiColor('rgb(255, 0, 0)')).toEqual([1, 0, 0, 1]);
  });

  it('unknown input is loud magenta, not silent black', () => {
    expect(parseUiColor('not-a-color')).toEqual([1, 0, 1, 1]);
  });

  it('is deterministic for the same input', () => {
    expect(parseUiColor('oklch(0.78 0.13 85)')).toEqual(parseUiColor('oklch(0.78 0.13 85)'));
  });

  it('shade lightens toward white / darkens toward black; withAlpha replaces alpha', () => {
    const base = [0.5, 0.5, 0.5, 1] as const;
    expect(shade(base, 1)[0]).toBeCloseTo(1, 5);
    expect(shade(base, -1)[0]).toBeCloseTo(0, 5);
    expect(withAlpha(base, 0.3)[3]).toBeCloseTo(0.3, 5);
  });
});
