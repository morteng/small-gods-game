import { describe, it, expect } from 'vitest';
import { deriveUiPalette, UI_PALETTE } from '@/render/ui/ui-palette';

describe('ui-palette', () => {
  it('derivation is deterministic', () => {
    const a = deriveUiPalette();
    const b = deriveUiPalette();
    expect(a).toEqual(b);
    expect(a).toEqual(UI_PALETTE);
  });

  it('every token is a valid 0..1 RGBA tuple', () => {
    for (const [name, c] of Object.entries(UI_PALETTE)) {
      expect(c, name).toHaveLength(4);
      for (const ch of c) {
        expect(ch, name).toBeGreaterThanOrEqual(0);
        expect(ch, name).toBeLessThanOrEqual(1);
      }
    }
  });

  it('hover is lighter and press is darker than the rest button', () => {
    const lum = (c: readonly number[]) => c[0] + c[1] + c[2];
    expect(lum(UI_PALETTE.buttonHotBg)).toBeGreaterThan(lum(UI_PALETTE.buttonBg));
    expect(lum(UI_PALETTE.buttonActiveBg)).toBeLessThan(lum(UI_PALETTE.buttonBg));
  });

  it('panel surface is semi-transparent (diegetic, world shows through)', () => {
    expect(UI_PALETTE.panelBg[3]).toBeLessThan(1);
  });
});
