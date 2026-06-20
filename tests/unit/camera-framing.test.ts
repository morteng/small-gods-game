import { describe, it, expect } from 'vitest';
import { frameTargets, applyFrame } from '@/render/camera-framing';
import { createIsoCamera } from '@/render/iso/iso-camera';

const VW = 1280, VH = 800;

describe('frameTargets', () => {
  it('returns null for no targets', () => {
    expect(frameTargets([], VW, VH)).toBeNull();
  });

  it('frames a cluster so every target lands on screen (coverage 1)', () => {
    const targets = [
      { x: 100, y: 100 }, { x: 104, y: 100 }, { x: 100, y: 106 }, { x: 103, y: 103 },
    ];
    const r = frameTargets(targets, VW, VH)!;
    expect(r.total).toBe(4);
    expect(r.onScreen).toBe(4);          // the verification: all fit
    expect(r.coverage).toBe(1);
    expect(r.zoom).toBeGreaterThan(0);
    expect(r.bbox).toEqual({ minX: 100, minY: 100, maxX: 104, maxY: 106 });
  });

  it('frames a single point with context (on screen, finite zoom)', () => {
    const r = frameTargets([{ x: 50, y: 50 }], VW, VH)!;
    expect(r.onScreen).toBe(1);
    expect(Number.isFinite(r.zoom)).toBe(true);
    expect(r.zoom).toBeGreaterThan(0);
  });

  it('a realistically-spread set all fits (zoom shrinks to contain them)', () => {
    const spread = [{ x: 20, y: 20 }, { x: 60, y: 24 }, { x: 24, y: 58 }, { x: 55, y: 55 }];
    const r = frameTargets(spread, VW, VH)!;
    expect(r.coverage).toBe(1);
    expect(r.zoom).toBeLessThan(1); // zoomed out to contain the spread
  });

  it('reports HONEST partial coverage when a spread exceeds the zoom-out limit', () => {
    // The whole map can't fit at the coarsest rung — the framing must not lie about it.
    const tooWide = [{ x: 10, y: 10 }, { x: 250, y: 240 }, { x: 10, y: 240 }, { x: 250, y: 10 }];
    const r = frameTargets(tooWide, VW, VH)!;
    expect(r.coverage).toBeLessThan(1);   // the verification surfaces the miss
    expect(r.onScreen).toBeLessThan(r.total);
  });

  it('applyFrame writes the result onto a live camera and re-verifies', () => {
    const cam = createIsoCamera();
    const targets = [{ x: 30, y: 30 }, { x: 36, y: 33 }];
    const r = frameTargets(targets, VW, VH)!;
    applyFrame(cam, r);
    expect(cam.zoom).toBe(r.zoom);
    // Re-project a target through the applied camera → on screen, matching the report.
    // (camera maps world-screen sx,sy → device px = (sx - cam.x) * zoom)
    expect(r.onScreen).toBe(2);
  });
});
