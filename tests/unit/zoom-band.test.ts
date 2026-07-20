import { describe, it, expect } from 'vitest';
import {
  zoomBand,
  SOUL_IN_ABOVE,
  SOUL_OUT_BELOW,
  SETTLEMENT_IN_ABOVE,
  SETTLEMENT_OUT_BELOW,
} from '@/game/affordance/zoom-band';

describe('zoomBand — UI v2 W0/D1 three-band selector', () => {
  it('is `soul` at high zoom, `settlement` at mid zoom, `world` fully zoomed out', () => {
    expect(zoomBand(1)).toBe('soul');
    expect(zoomBand(0.5)).toBe('soul');         // the 1/2 rung: ~16 px tile → readable
    expect(zoomBand(0.2)).toBe('settlement');
    expect(zoomBand(1 / 8)).toBe('world');      // the 1/8 rung
    expect(zoomBand(0.02)).toBe('world');       // fully zoomed out
  });

  it('snaps hard at the soul↔settlement thresholds regardless of the prior band', () => {
    expect(zoomBand(SOUL_IN_ABOVE, 'settlement')).toBe('soul');   // ≥ IN_ABOVE ⇒ soul
    expect(zoomBand(SOUL_OUT_BELOW, 'soul')).toBe('settlement');  // ≤ OUT_BELOW ⇒ drops out
  });

  it('snaps hard at the settlement↔world thresholds regardless of the prior band', () => {
    expect(zoomBand(SETTLEMENT_IN_ABOVE, 'world')).toBe('settlement'); // ≥ IN_ABOVE ⇒ settlement
    expect(zoomBand(SETTLEMENT_OUT_BELOW, 'settlement')).toBe('world'); // ≤ OUT_BELOW ⇒ world
  });

  it('holds the prior band through the soul↔settlement dead-zone (no flicker)', () => {
    const mid = (SOUL_IN_ABOVE + SOUL_OUT_BELOW) / 2;
    expect(mid).toBeGreaterThan(SOUL_OUT_BELOW);
    expect(mid).toBeLessThan(SOUL_IN_ABOVE);
    expect(zoomBand(mid, 'soul')).toBe('soul');
    expect(zoomBand(mid, 'settlement')).toBe('settlement');
  });

  it('holds the prior band through the settlement↔world dead-zone (no flicker)', () => {
    const mid = (SETTLEMENT_IN_ABOVE + SETTLEMENT_OUT_BELOW) / 2;
    expect(mid).toBeGreaterThan(SETTLEMENT_OUT_BELOW);
    expect(mid).toBeLessThan(SETTLEMENT_IN_ABOVE);
    expect(zoomBand(mid, 'settlement')).toBe('settlement');
    expect(zoomBand(mid, 'world')).toBe('world');
  });

  it('a monotonic sweep up then back down never flickers: world→settlement→soul→settlement→world', () => {
    const seen: string[] = [];
    let band = zoomBand(0.02); // start deep in `world`, default prev irrelevant here
    seen.push(band);
    // climb from 0.02 up to 1.0 in small steps
    for (let z = 0.02; z <= 1.0; z += 0.005) {
      band = zoomBand(z, band);
      if (seen[seen.length - 1] !== band) seen.push(band);
    }
    expect(seen).toEqual(['world', 'settlement', 'soul']);
    // then back down to 0.02
    for (let z = 1.0; z >= 0.02; z -= 0.005) {
      band = zoomBand(z, band);
      if (seen[seen.length - 1] !== band) seen.push(band);
    }
    expect(seen).toEqual(['world', 'settlement', 'soul', 'settlement', 'world']);
  });

  it('the ladder rungs straddling the soul boundary never land in its dead-zone', () => {
    // 1/2 and 1/3 are the rungs on either side of the readable-chrome floor; neither
    // sits inside [SOUL_OUT_BELOW, SOUL_IN_ABOVE), so quantized zooming can't stall.
    expect(0.5 >= SOUL_IN_ABOVE).toBe(true);
    expect(1 / 3 <= SOUL_OUT_BELOW).toBe(true);
  });

  it('the ladder rungs straddling the settlement boundary never land in its dead-zone', () => {
    // 1/6 and 1/8 straddle the settlement↔world floor.
    expect(1 / 6 >= SETTLEMENT_IN_ABOVE).toBe(true);
    expect(1 / 8 <= SETTLEMENT_OUT_BELOW).toBe(true);
  });

  it('defaults the prior band to `soul` (the readable, safe default)', () => {
    const mid = (SOUL_IN_ABOVE + SOUL_OUT_BELOW) / 2;
    expect(zoomBand(mid)).toBe('soul');
  });
});
