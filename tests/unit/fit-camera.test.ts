import { describe, it, expect } from 'vitest';
import { fitCameraToMap, clampCameraToMap } from '@/render/fit-camera';
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

describe('clampCameraToMap', () => {
  const VIEW_W = 800, VIEW_H = 600;
  // Some part of the map's iso bbox must stay within the viewport on each axis.
  const overlapsView = (cam: { x: number; y: number; zoom: number }, W: number, H: number) => {
    const c0 = isoScreen(W / 2, H / 2, cam); // map centre
    // The centre tile must be on-screen (sufficient: island never fully gone).
    return c0.x >= -1 && c0.x <= VIEW_W + 1 && c0.y >= -1 && c0.y <= VIEW_H + 1;
  };

  it('an extreme pan can no longer push the island off-screen', () => {
    const cam = createCamera();
    fitCameraToMap(cam, 120, 90, VIEW_W, VIEW_H);
    cam.x += 1e6; cam.y -= 1e6;                       // shove far away
    clampCameraToMap(cam, 120, 90, VIEW_W, VIEW_H);
    expect(overlapsView(cam, 120, 90)).toBe(true);
  });

  it('when zoomed in, the viewport stays inside the map (no panning past the shore)', () => {
    const cam = createCamera();
    cam.zoom = 1; cam.x = 1e6; cam.y = 1e6;
    clampCameraToMap(cam, 300, 300, VIEW_W, VIEW_H);
    // viewport [x, x+view] must lie within the iso bbox x-range.
    const halfW = 64; // ISO_TILE_W / 2
    expect(cam.x).toBeLessThanOrEqual(300 * halfW);
    expect(cam.x + VIEW_W / cam.zoom).toBeGreaterThanOrEqual(-300 * halfW);
  });

  it('a fitted camera is already within bounds (clamp is a no-op there)', () => {
    const cam = createCamera();
    fitCameraToMap(cam, 100, 80, VIEW_W, VIEW_H);
    const before = { ...cam };
    clampCameraToMap(cam, 100, 80, VIEW_W, VIEW_H);
    expect(cam.x).toBeCloseTo(before.x);
    expect(cam.y).toBeCloseTo(before.y);
  });

  it('ignores degenerate inputs', () => {
    const cam = createCamera();
    const before = { ...cam };
    clampCameraToMap(cam, 0, 0, VIEW_W, VIEW_H);
    expect(cam).toEqual(before);
  });
});
