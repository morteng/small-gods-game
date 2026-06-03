import { describe, it, expect } from 'vitest';
import { fitCameraToMap } from '@/render/fit-camera';
import { createCamera, worldToScreen as topdownWorldToScreen } from '@/render/camera';
import { worldToScreen as isoWorldToScreen } from '@/render/iso/iso-projection';
import { TILE_SIZE } from '@/core/constants';

// Apply the iso render transform: screen = (isoProjection - camera) * zoom.
function isoScreen(tx: number, ty: number, cam: { x: number; y: number; zoom: number }) {
  const { sx, sy } = isoWorldToScreen(tx, ty, 0, 0, 0);
  return { x: (sx - cam.x) * cam.zoom, y: (sy - cam.y) * cam.zoom };
}

describe('fitCameraToMap', () => {
  const VIEW_W = 800, VIEW_H = 600;

  it('topdown: all four map corners land inside the viewport', () => {
    const cam = createCamera();
    fitCameraToMap(cam, 100, 80, VIEW_W, VIEW_H, 'topdown');
    const corners = [[0, 0], [100, 0], [100, 80], [0, 80]];
    for (const [tx, ty] of corners) {
      const { sx, sy } = topdownWorldToScreen(cam, tx, ty, TILE_SIZE);
      expect(sx).toBeGreaterThanOrEqual(-1);
      expect(sx).toBeLessThanOrEqual(VIEW_W + 1);
      expect(sy).toBeGreaterThanOrEqual(-1);
      expect(sy).toBeLessThanOrEqual(VIEW_H + 1);
    }
  });

  it('topdown: map center lands at viewport center', () => {
    const cam = createCamera();
    fitCameraToMap(cam, 100, 80, VIEW_W, VIEW_H, 'topdown');
    const { sx, sy } = topdownWorldToScreen(cam, 50, 40, TILE_SIZE);
    expect(sx).toBeCloseTo(VIEW_W / 2);
    expect(sy).toBeCloseTo(VIEW_H / 2);
  });

  it('iso: all four map corners land inside the viewport', () => {
    const cam = createCamera();
    fitCameraToMap(cam, 100, 80, VIEW_W, VIEW_H, 'iso');
    const corners = [[0, 0], [100, 0], [100, 80], [0, 80]];
    for (const [tx, ty] of corners) {
      const { x, y } = isoScreen(tx, ty, cam);
      expect(x).toBeGreaterThanOrEqual(-1);
      expect(x).toBeLessThanOrEqual(VIEW_W + 1);
      expect(y).toBeGreaterThanOrEqual(-1);
      expect(y).toBeLessThanOrEqual(VIEW_H + 1);
    }
  });

  it('iso: map center lands at viewport center', () => {
    const cam = createCamera();
    fitCameraToMap(cam, 100, 80, VIEW_W, VIEW_H, 'iso');
    const { x, y } = isoScreen(50, 40, cam);
    expect(x).toBeCloseTo(VIEW_W / 2);
    expect(y).toBeCloseTo(VIEW_H / 2);
  });

  it('a huge map forces a zoom below the old 0.25 floor (floor was loosened)', () => {
    const cam = createCamera();
    fitCameraToMap(cam, 2000, 2000, VIEW_W, VIEW_H, 'topdown');
    expect(cam.zoom).toBeLessThan(0.25);
    expect(cam.zoom).toBeGreaterThan(0); // still positive / not over-clamped to 0
  });

  it('ignores degenerate inputs (no NaN camera)', () => {
    const cam = createCamera();
    const before = { ...cam };
    fitCameraToMap(cam, 0, 0, VIEW_W, VIEW_H, 'topdown');
    expect(cam).toEqual(before);
  });
});
