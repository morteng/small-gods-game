import { describe, it, expect } from 'vitest';
import { createCamera, screenToWorld, pan, zoomAt, centerOn } from '../../src/render/camera';

describe('Camera', () => {
  it('creates default camera at origin', () => {
    const cam = createCamera();
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
    expect(cam.zoom).toBe(1);
  });

  it('screenToWorld converts at zoom 1', () => {
    const cam = createCamera();
    const { wx, wy } = screenToWorld(cam, 32, 48, 16);
    expect(wx).toBe(2);
    expect(wy).toBe(3);
  });

  it('pan moves camera', () => {
    const cam = createCamera();
    pan(cam, 100, 50);
    expect(cam.x).toBe(-100);
    expect(cam.y).toBe(-50);
  });

  it('zoomAt clamps to range', () => {
    const cam = createCamera();
    zoomAt(cam, 100, 0, 0); // extreme zoom
    expect(cam.zoom).toBe(8); // max
    zoomAt(cam, 0.001, 0, 0);
    expect(cam.zoom).toBe(0.25); // min
  });

  it('centerOn positions camera', () => {
    const cam = createCamera();
    centerOn(cam, 100, 100, 800, 600);
    expect(cam.x).toBe(100 - 400);
    expect(cam.y).toBe(100 - 300);
  });
});
