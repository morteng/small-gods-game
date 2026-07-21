// T1 perf pass — flotsam (S6 flow-advected debris/fauna) is sub-pixel decoration once
// the camera zooms out past the settlement→world transition; it was built + drawn every
// frame regardless of zoom. `gpu-render-frame.ts` now gates it on the CAMERA's own zoom
// (never the resolution-governor's art-pixel tier — that entanglement was a past bug,
// see CLAUDE.md "GPU-scene zoom-LOD gates key on CAMERA zoom, never xform.sx"). This pins
// the pure predicate + threshold, mirroring the grass billboards' GRASS_MIN_ZOOM gate.

import { describe, it, expect } from 'vitest';
import { FLOTSAM_MIN_ZOOM, flotsamEnabled } from '@/render/gpu/gpu-render-frame';

describe('T1 — flotsam zoom gate', () => {
  it('is enabled at gameplay zoom (well above the threshold)', () => {
    expect(flotsamEnabled(1)).toBe(true);
    expect(flotsamEnabled(0.5)).toBe(true);
  });

  it('is disabled once the camera zooms out past FLOTSAM_MIN_ZOOM', () => {
    expect(flotsamEnabled(0.15)).toBe(false);
    expect(flotsamEnabled(0.08)).toBe(false);
  });

  it('the threshold itself counts as enabled (>=), and just below does not', () => {
    expect(flotsamEnabled(FLOTSAM_MIN_ZOOM)).toBe(true);
    expect(flotsamEnabled(FLOTSAM_MIN_ZOOM - 0.001)).toBe(false);
  });

  it('the threshold sits at a sane, positive sub-gameplay zoom', () => {
    expect(FLOTSAM_MIN_ZOOM).toBeGreaterThan(0);
    expect(FLOTSAM_MIN_ZOOM).toBeLessThan(1);
  });
});
