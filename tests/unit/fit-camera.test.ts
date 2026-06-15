import { describe, it, expect } from 'vitest';
import { fitCameraToMap } from '@/render/fit-camera';
import { createCamera } from '@/render/camera';
import { worldToScreen as isoWorldToScreen } from '@/render/iso/iso-projection';

// Apply the iso render transform: screen = (isoProjection - camera) * zoom.
function isoScreen(tx: number, ty: number, cam: { x: number; y: number; zoom: number }) {
  const { sx, sy } = isoWorldToScreen(tx, ty, 0, 0, 0);
  return { x: (sx - cam.x) * cam.zoom, y: (sy - cam.y) * cam.zoom };
}

describe('fitCameraToMap', () => {
  const VIEW_W = 800, VIEW_H = 600;

  it('all four map corners land inside the viewport', () => {
    const cam = createCamera();
    fitCameraToMap(cam, 100, 80, VIEW_W, VIEW_H);
    const corners = [[0, 0], [100, 0], [100, 80], [0, 80]];
    for (const [tx, ty] of corners) {
      const { x, y } = isoScreen(tx, ty, cam);
      expect(x).toBeGreaterThanOrEqual(-1);
      expect(x).toBeLessThanOrEqual(VIEW_W + 1);
      expect(y).toBeGreaterThanOrEqual(-1);
      expect(y).toBeLessThanOrEqual(VIEW_H + 1);
    }
  });

  it('map center lands at viewport center', () => {
    const cam = createCamera();
    fitCameraToMap(cam, 100, 80, VIEW_W, VIEW_H);
    const { x, y } = isoScreen(50, 40, cam);
    expect(x).toBeCloseTo(VIEW_W / 2);
    expect(y).toBeCloseTo(VIEW_H / 2);
  });

  it('a huge map forces a zoom below the old 0.25 floor (floor was loosened)', () => {
    const cam = createCamera();
    fitCameraToMap(cam, 2000, 2000, VIEW_W, VIEW_H);
    expect(cam.zoom).toBeLessThan(0.25);
    expect(cam.zoom).toBeGreaterThan(0); // still positive / not over-clamped to 0
  });

  it('ignores degenerate inputs (no NaN camera)', () => {
    const cam = createCamera();
    const before = { ...cam };
    fitCameraToMap(cam, 0, 0, VIEW_W, VIEW_H);
    expect(cam).toEqual(before);
  });
});
