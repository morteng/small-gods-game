import { describe, it, expect } from 'vitest';
import { focusCameraOnTile } from '@/render/focus-camera';
import { createCamera, worldToScreen as topdownWorldToScreen } from '@/render/camera';
import { worldToScreen as isoWorldToScreen } from '@/render/iso/iso-projection';
import { TILE_SIZE } from '@/core/constants';

describe('focusCameraOnTile', () => {
  it('topdown: tile center lands at viewport center (zoom 1)', () => {
    const cam = createCamera();
    focusCameraOnTile(cam, 10, 20, 800, 600, 'topdown');
    const { sx, sy } = topdownWorldToScreen(cam, 10.5, 20.5, TILE_SIZE);
    expect(sx).toBeCloseTo(400);
    expect(sy).toBeCloseTo(300);
  });

  it('topdown: stays centered when zoomed in (the old bug ignored zoom)', () => {
    const cam = createCamera();
    cam.zoom = 2;
    focusCameraOnTile(cam, 10, 20, 800, 600, 'topdown');
    const { sx, sy } = topdownWorldToScreen(cam, 10.5, 20.5, TILE_SIZE);
    expect(sx).toBeCloseTo(400);
    expect(sy).toBeCloseTo(300);
  });

  it('iso: tile center lands at viewport center (zoom 1)', () => {
    const cam = createCamera();
    focusCameraOnTile(cam, 10, 20, 800, 600, 'iso');
    // The iso renderer draws at (isoProjection - camera) * zoom.
    const { sx, sy } = isoWorldToScreen(10.5, 20.5, 0, -cam.x, -cam.y);
    expect(sx).toBeCloseTo(400);
    expect(sy).toBeCloseTo(300);
  });

  it('iso: stays centered when zoomed in', () => {
    const cam = createCamera();
    cam.zoom = 2;
    focusCameraOnTile(cam, 10, 20, 800, 600, 'iso');
    // screen = (isoProjection - camera) * zoom ; assert it equals viewport center.
    const { sx, sy } = isoWorldToScreen(10.5, 20.5, 0, 0, 0);
    expect((sx - cam.x) * cam.zoom).toBeCloseTo(400);
    expect((sy - cam.y) * cam.zoom).toBeCloseTo(300);
  });
});
