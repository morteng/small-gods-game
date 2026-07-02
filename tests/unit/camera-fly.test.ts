import { describe, it, expect } from 'vitest';
import { applyCameraFly } from '@/game/camera-follow';
import { createState } from '@/core/state';
import { TILE_SIZE } from '@/core/constants';

const VP = { width: 800, height: 600 };

describe('applyCameraFly — P5 alert-pin camera-fly tween', () => {
  it('is a no-op when no fly is queued', () => {
    const state = createState();
    const before = { ...state.camera };
    applyCameraFly(state, VP);
    expect(state.camera.x).toBe(before.x);
    expect(state.camera.y).toBe(before.y);
    expect(state.camera.zoom).toBe(before.zoom);
    expect(state.cameraFly).toBeNull();
  });

  it('converges to frame the anchor centred at the target zoom, then clears itself', () => {
    const state = createState();
    state.camera.x = 0; state.camera.y = 0; state.camera.zoom = 1;
    const tx = 40, ty = 25, zoom = 0.5;
    state.cameraFly = { tx, ty, zoom };

    let steps = 0;
    while (state.cameraFly && steps < 1000) { applyCameraFly(state, VP); steps++; }

    expect(state.cameraFly).toBeNull();          // self-terminated
    expect(steps).toBeLessThan(200);             // converges quickly (~0.5 s @ 60 fps)
    expect(state.camera.zoom).toBeCloseTo(zoom, 6);
    // camera framed so the anchor tile centre sits at the viewport centre
    const viewW = VP.width / zoom, viewH = VP.height / zoom;
    expect(state.camera.x).toBeCloseTo((tx + 0.5) * TILE_SIZE - viewW / 2, 6);
    expect(state.camera.y).toBeCloseTo((ty + 0.5) * TILE_SIZE - viewH / 2, 6);
  });

  it('moves monotonically toward the target (no overshoot)', () => {
    const state = createState();
    state.camera.x = 0; state.camera.y = 0; state.camera.zoom = 1;
    state.cameraFly = { tx: 100, ty: 0, zoom: 1 }; // same zoom → pure pan in +x
    const targetX = (100 + 0.5) * TILE_SIZE - VP.width / 2;
    let prev = state.camera.x;
    for (let i = 0; i < 5; i++) {
      applyCameraFly(state, VP);
      expect(state.camera.x).toBeGreaterThan(prev);        // advancing
      expect(state.camera.x).toBeLessThanOrEqual(targetX + 1e-6); // never past
      prev = state.camera.x;
    }
  });

  it('cancelling the fly (cameraFly=null) stops the tween immediately', () => {
    const state = createState();
    state.camera.x = 0; state.camera.y = 0; state.camera.zoom = 1;
    state.cameraFly = { tx: 40, ty: 25, zoom: 0.5 };
    applyCameraFly(state, VP);
    const midX = state.camera.x, midY = state.camera.y, midZoom = state.camera.zoom;
    // user pan/zoom clears the fly upstream — the tween must yield at once
    state.cameraFly = null;
    applyCameraFly(state, VP);
    expect(state.camera.x).toBe(midX);
    expect(state.camera.y).toBe(midY);
    expect(state.camera.zoom).toBe(midZoom);
  });
});
