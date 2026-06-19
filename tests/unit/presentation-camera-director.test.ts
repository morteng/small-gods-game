import { describe, it, expect } from 'vitest';
import { CameraDirector } from '@/presentation/camera-director';
import { focusCameraOnTile } from '@/render/focus-camera';
import { quantizeIsoZoom } from '@/render/iso/iso-camera';
import type { Camera } from '@/core/types';

const cam = (zoom: number): Camera => ({ x: 0, y: 0, zoom, dragging: false, lastX: 0, lastY: 0 });
const VP = { width: 800, height: 600 };

function drive(dir: CameraDirector, camera: Camera, ms: number, step = 16): void {
  for (let t = 0; t < ms; t += step) dir.update(step, camera);
}

describe('CameraDirector', () => {
  it('activates on focusTile and lands on the framed, pixel-perfect target', () => {
    const c = cam(1 / 8);
    const dir = new CameraDirector();
    dir.focusTile(c, 20, 12, VP, { moveMs: 320, holdMs: 320 });
    expect(dir.isActive()).toBe(true);

    drive(dir, c, 360); // through the move phase

    // End zoom = one rung closer (toward 1:1), snapped to the iso ladder.
    const expectedZoom = quantizeIsoZoom(1 / 8, 1);
    expect(c.zoom).toBeCloseTo(expectedZoom, 6);

    // End position = the tile framed at the target zoom.
    const ref = cam(expectedZoom);
    focusCameraOnTile(ref, 20, 12, VP.width, VP.height);
    expect(c.x).toBeCloseTo(ref.x, 3);
    expect(c.y).toBeCloseTo(ref.y, 3);
  });

  it('eases rather than snaps: mid-move is strictly between start and target', () => {
    const c = cam(1 / 8);
    const dir = new CameraDirector();
    dir.focusTile(c, 40, 40, VP, { moveMs: 800, holdMs: 400 });
    const ref = cam(quantizeIsoZoom(1 / 8, 1));
    focusCameraOnTile(ref, 40, 40, VP.width, VP.height);

    drive(dir, c, 400); // ~halfway through an 800ms move
    expect(dir.isActive()).toBe(true);
    // Strictly between origin (0) and the target — proves interpolation.
    const between = (v: number, target: number) => Math.abs(v) > 1 && Math.abs(v) < Math.abs(target) - 1;
    expect(between(c.x, ref.x)).toBe(true);
    expect(between(c.y, ref.y)).toBe(true);
  });

  it('releases after the hold completes', () => {
    const c = cam(1 / 8);
    const dir = new CameraDirector();
    dir.focusTile(c, 5, 5, VP, { moveMs: 200, holdMs: 200 });
    drive(dir, c, 250);
    expect(dir.isActive()).toBe(true); // still holding
    drive(dir, c, 250);
    expect(dir.isActive()).toBe(false); // released
  });

  it('cancel() stops immediately and leaves the camera put', () => {
    const c = cam(1 / 8);
    const dir = new CameraDirector();
    dir.focusTile(c, 9, 9, VP, { moveMs: 400, holdMs: 400 });
    drive(dir, c, 100);
    const x = c.x, y = c.y, z = c.zoom;
    dir.cancel();
    expect(dir.isActive()).toBe(false);
    dir.update(16, c); // no-op once inactive
    expect(c.x).toBe(x); expect(c.y).toBe(y); expect(c.zoom).toBe(z);
  });

  it('zoomIn:0 frames without changing zoom (pan-only cinematic)', () => {
    const c = cam(1 / 8);
    const dir = new CameraDirector();
    dir.focusTile(c, 30, 30, VP, { moveMs: 200, holdMs: 0, zoomIn: 0 });
    drive(dir, c, 240);
    expect(c.zoom).toBeCloseTo(1 / 8, 6);
  });
});
