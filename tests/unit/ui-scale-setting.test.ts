import { describe, it, expect, afterEach } from 'vitest';
import { uiScaleFor } from '@/render/ui/ui-layer';
import {
  setUiScaleMultiplier, getUiScaleMultiplier, UI_SCALE_STEPS, shellTypeScaleFor,
} from '@/render/ui/ui-tokens';

/**
 * The UI SCALE setting's APPLY path.
 *
 * P4b shipped this setting as persist-only ("no render-side apply path exists")
 * — then the user reported the shell as too small, which is exactly the situation
 * a UI-scale control exists for, so it was pulled into scope. It multiplies the
 * DPR-derived scale that feeds BOTH the HUD and every shell screen, so one
 * setting moves the whole interface together.
 */

afterEach(() => { setUiScaleMultiplier(1); });

describe('uiScaleFor with a player preference', () => {
  it('defaults to the plain DPR rung', () => {
    expect(uiScaleFor(1)).toBe(1);
    expect(uiScaleFor(2)).toBe(2);
    expect(uiScaleFor(3)).toBe(3);
  });

  it('multiplies the DPR rung by the preference', () => {
    setUiScaleMultiplier(2);
    expect(uiScaleFor(1)).toBe(2);
    expect(uiScaleFor(2)).toBe(4);
  });

  it('ALWAYS yields an integer — fractional glyph scaling is never allowed', () => {
    for (const m of UI_SCALE_STEPS) {
      setUiScaleMultiplier(m);
      for (const dpr of [1, 1.5, 2, 2.5, 3, 4]) {
        const s = uiScaleFor(dpr);
        expect(Number.isInteger(s), `dpr ${dpr} x ${m} = ${s}`).toBe(true);
        expect(s).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('never drops below 1, whatever the inputs', () => {
    setUiScaleMultiplier(0.5);
    expect(uiScaleFor(1)).toBeGreaterThanOrEqual(1);
    expect(uiScaleFor(0)).toBeGreaterThanOrEqual(1);
  });

  it('rejects junk rather than throwing — it can arrive from disk or an agent', () => {
    for (const bad of [Number.NaN, Infinity, -1, 0, 99]) {
      setUiScaleMultiplier(bad);
      expect(getUiScaleMultiplier()).toBe(1);
      expect(uiScaleFor(2)).toBe(2);
    }
  });

  it('moves the SHELL type with it, not just the HUD', () => {
    // The whole point: one setting scales the entire interface. Type at a given
    // viewport must grow when the preference does.
    const before = shellTypeScaleFor(2560, uiScaleFor(2));
    setUiScaleMultiplier(2);
    const after = shellTypeScaleFor(2560, uiScaleFor(2));
    expect(after.menu).toBeGreaterThan(before.menu);
    expect(after.caption).toBeGreaterThan(before.caption);
    // and it is still a strict hierarchy at the larger size
    expect(after.display).toBeGreaterThan(after.heading);
    expect(after.heading).toBeGreaterThan(after.menu);
    expect(after.menu).toBeGreaterThan(after.caption);
  });

  it('offers only steps that actually differ after integer rounding', () => {
    // Coarse on purpose: at dpr 2 a 0.75x step would round back to 2 and the
    // control would appear broken. Every offered step must produce a distinct
    // scale at the common retina rung.
    const seen = new Set<number>();
    for (const m of UI_SCALE_STEPS) {
      setUiScaleMultiplier(m);
      seen.add(uiScaleFor(2));
    }
    expect(seen.size).toBe(UI_SCALE_STEPS.length);
  });
});
