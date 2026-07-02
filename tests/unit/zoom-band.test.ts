import { describe, it, expect } from 'vitest';
import { zoomBand, ZOOM_BAND_IN_ABOVE, ZOOM_BAND_OUT_BELOW } from '@/game/affordance/zoom-band';

describe('zoomBand — P5 two-band selector', () => {
  it('is `in` at high zoom and `out` at low zoom', () => {
    expect(zoomBand(1)).toBe('in');
    expect(zoomBand(0.5)).toBe('in');       // the 1/2 rung: a tile is ~16 px → readable
    expect(zoomBand(1 / 3)).toBe('out');    // the 1/3 rung: a tile is ~11 px → aggregate
    expect(zoomBand(0.05)).toBe('out');     // fully zoomed out
  });

  it('snaps hard at the two thresholds regardless of the prior band', () => {
    expect(zoomBand(ZOOM_BAND_IN_ABOVE, 'out')).toBe('in');   // ≥ IN_ABOVE ⇒ in
    expect(zoomBand(ZOOM_BAND_OUT_BELOW, 'in')).toBe('out');  // ≤ OUT_BELOW ⇒ out
  });

  it('holds the prior band through the hysteresis dead-zone (no flicker)', () => {
    const mid = (ZOOM_BAND_IN_ABOVE + ZOOM_BAND_OUT_BELOW) / 2;
    expect(mid).toBeGreaterThan(ZOOM_BAND_OUT_BELOW);
    expect(mid).toBeLessThan(ZOOM_BAND_IN_ABOVE);
    expect(zoomBand(mid, 'in')).toBe('in');
    expect(zoomBand(mid, 'out')).toBe('out');
  });

  it('the ladder rungs straddling the boundary never land in the dead-zone', () => {
    // 1/2 and 1/3 are the rungs on either side of the readable-chrome floor; neither
    // sits inside [OUT_BELOW, IN_ABOVE), so quantized zooming can't stall the band.
    expect(0.5 >= ZOOM_BAND_IN_ABOVE).toBe(true);
    expect(1 / 3 <= ZOOM_BAND_OUT_BELOW).toBe(true);
  });

  it('defaults the prior band to `in` (the readable, safe default)', () => {
    const mid = (ZOOM_BAND_IN_ABOVE + ZOOM_BAND_OUT_BELOW) / 2;
    expect(zoomBand(mid)).toBe('in');
  });
});
