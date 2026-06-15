import { describe, it, expect } from 'vitest';
import { focusCameraOnTile } from '@/render/focus-camera';
import { createCamera } from '@/render/camera';
import { worldToScreen as isoWorldToScreen } from '@/render/iso/iso-projection';

describe('focusCameraOnTile', () => {
  it('iso: tile center lands at viewport center (zoom 1)', () => {
    const cam = createCamera();
    focusCameraOnTile(cam, 10, 20, 800, 600);
    // The iso renderer draws at (isoProjection - camera) * zoom.
    const { sx, sy } = isoWorldToScreen(10.5, 20.5, 0, -cam.x, -cam.y);
    expect(sx).toBeCloseTo(400);
    expect(sy).toBeCloseTo(300);
  });

  it('iso: stays centered when zoomed in', () => {
    const cam = createCamera();
    cam.zoom = 2;
    focusCameraOnTile(cam, 10, 20, 800, 600);
    // screen = (isoProjection - camera) * zoom ; assert it equals viewport center.
    const { sx, sy } = isoWorldToScreen(10.5, 20.5, 0, 0, 0);
    expect((sx - cam.x) * cam.zoom).toBeCloseTo(400);
    expect((sy - cam.y) * cam.zoom).toBeCloseTo(300);
  });
});
