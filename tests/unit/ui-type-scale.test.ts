import { describe, it, expect } from 'vitest';
import {
  FS, SIZE_BREAKPOINTS, sizeClassFor, shellTypeScale, minHitSize, minShellFontScale,
} from '@/render/ui/ui-tokens';

/**
 * The responsive shell type scale (user product direction, 2026-07-25).
 *
 * The same UI runs on a phone at 30cm, a desktop at arm's length and a TV across
 * a room, so shell text is sized from the EFFECTIVE VIEWPORT WIDTH as well as
 * DPR — never DPR alone, which knows nothing about viewing distance.
 *
 * Two rules this pins, because both were violated in the shipped screens and the
 * user saw it: (1) a strict tier hierarchy with a FLOOR, and (2) integer scales
 * only. The companion rule — dense content SCROLLS rather than shrinking — is
 * enforced per-screen in the screens' own tests.
 */

const RETINA = 2; // uiScaleFor(dpr=2)

describe('size classes', () => {
  it('splits phone / desktop / TV on effective CSS width', () => {
    expect(sizeClassFor(390)).toBe('compact');   // iPhone 12 mini, a real target
    expect(sizeClassFor(SIZE_BREAKPOINTS.compact - 1)).toBe('compact');
    expect(sizeClassFor(SIZE_BREAKPOINTS.compact)).toBe('regular');
    expect(sizeClassFor(1280)).toBe('regular');  // ordinary laptop
    expect(sizeClassFor(SIZE_BREAKPOINTS.regular)).toBe('large');
    expect(sizeClassFor(1920)).toBe('large');    // 1080p at couch distance
  });

  it('never assumes a wide viewport — a tiny width is still a valid class', () => {
    expect(sizeClassFor(0)).toBe('compact');
    expect(sizeClassFor(240)).toBe('compact');
  });
});

describe('shell type scale', () => {
  it('keeps a strict display > heading > menu > caption hierarchy in every class', () => {
    for (const w of [390, 1280, 1920]) {
      const t = shellTypeScale(w, RETINA);
      expect(t.display, `display@${w}`).toBeGreaterThan(t.heading);
      expect(t.heading, `heading@${w}`).toBeGreaterThan(t.menu);
      expect(t.menu, `menu@${w}`).toBeGreaterThan(t.caption);
    }
  });

  it('is INTEGER at every breakpoint and DPR — no fractional glyph scaling, ever', () => {
    for (const w of [320, 390, 700, 1280, 1400, 1920, 3840]) {
      for (const s of [1, 2, 3]) {
        const t = shellTypeScale(w, s);
        for (const [tier, v] of Object.entries(t)) {
          if (tier === 'cls') continue;
          expect(Number.isInteger(v), `${tier}@${w}/${s} = ${String(v)}`).toBe(true);
          expect(v as number).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('grows with viewing distance: compact < regular < large', () => {
    const phone = shellTypeScale(390, RETINA);
    const desktop = shellTypeScale(1280, RETINA);
    const tv = shellTypeScale(1920, RETINA);
    expect(phone.menu).toBeLessThan(desktop.menu);
    expect(desktop.menu).toBeLessThan(tv.menu);
  });

  it('DESKTOP menu type is visibly larger than the old shell default', () => {
    // The user's actual complaint: menus drew at `FS.body * s` and read too small.
    // Regression guard on the fix — desktop must exceed that, not merely differ.
    const old = FS.body * RETINA;
    expect(shellTypeScale(1280, RETINA).menu).toBeGreaterThan(old);
  });

  it('caption is the FLOOR — no tier sits below it', () => {
    for (const w of [390, 1280, 1920]) {
      const t = shellTypeScale(w, RETINA);
      const floor = minShellFontScale(w, RETINA);
      expect(floor).toBe(t.caption);
      for (const v of [t.menu, t.heading, t.display]) {
        expect(v).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  it('the deleted `small` tier is gone — it was the half-size caption bug', () => {
    // `FS.small = 1` rendered captions at HALF body size and let dense lists
    // silently shrink to fit. Its absence is the fix; keep it absent.
    expect((FS as Record<string, number>).small).toBeUndefined();
  });

  it('still exposes the in-game HUD tiers, which the 10-foot rule does NOT govern', () => {
    // The HUD overlays the world at normal viewing distance; retuning it is a
    // separate decision from retuning the menus.
    expect(FS.body).toBe(2);
    expect(FS.title).toBe(4);
  });
});

describe('hit targets', () => {
  it('compact gets the biggest CSS-px minimum (touch), and all are positive', () => {
    for (const cls of ['compact', 'regular', 'large'] as const) {
      expect(minHitSize(cls, RETINA)).toBeGreaterThan(0);
      expect(Number.isInteger(minHitSize(cls, RETINA))).toBe(true);
    }
    // A finger needs ~44 CSS px no matter how small the glyphs are.
    expect(minHitSize('compact', RETINA)).toBeGreaterThan(minHitSize('regular', RETINA));
  });

  it('scales up with the HUD scale rather than staying fixed in device px', () => {
    expect(minHitSize('regular', 4)).toBeGreaterThan(minHitSize('regular', 2));
  });
});
