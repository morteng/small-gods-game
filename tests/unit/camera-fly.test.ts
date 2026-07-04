import { describe, it, expect } from 'vitest';
import { applyCameraFly } from '@/game/camera-follow';
import { createState } from '@/core/state';
import { worldToScreen } from '@/render/iso/iso-projection';

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
    // camera framed so the anchor tile centre sits at the viewport centre —
    // in ISO-SCREEN space (the space the renderer pans; see gpu-render-frame).
    const p = worldToScreen(tx + 0.5, ty + 0.5, 0, 0, 0);
    expect(state.camera.x).toBeCloseTo(p.sx - VP.width / zoom / 2, 6);
    expect(state.camera.y).toBeCloseTo(p.sy - VP.height / zoom / 2, 6);
  });

  it('moves monotonically toward the target (no overshoot)', () => {
    const state = createState();
    state.camera.x = 0; state.camera.y = 0; state.camera.zoom = 1;
    state.cameraFly = { tx: 100, ty: 0, zoom: 1 }; // same zoom → pure pan in +x
    const targetX = worldToScreen(100 + 0.5, 0.5, 0, 0, 0).sx - VP.width / 2;
    let prev = state.camera.x;
    for (let i = 0; i < 5; i++) {
      applyCameraFly(state, VP);
      expect(state.camera.x).toBeGreaterThan(prev);        // advancing
      expect(state.camera.x).toBeLessThanOrEqual(targetX + 1e-6); // never past
      prev = state.camera.x;
    }
  });

  it('drops a non-finite fly instead of easing NaN into the camera', () => {
    const state = createState();
    state.camera.x = 100; state.camera.y = 100; state.camera.zoom = 1;
    state.cameraFly = { tx: NaN, ty: 25, zoom: 0.5 };
    applyCameraFly(state, VP);
    expect(state.cameraFly).toBeNull();            // dropped, not eased
    expect(state.camera.x).toBe(100);              // camera untouched
    expect(state.camera.y).toBe(100);
    expect(state.camera.zoom).toBe(1);
  });

  it('self-heals a NaN-poisoned camera by snapping to the fly target', () => {
    const state = createState();
    state.camera.x = NaN; state.camera.y = NaN; state.camera.zoom = 1;
    const tx = 40, ty = 25, zoom = 0.5;
    state.cameraFly = { tx, ty, zoom };
    applyCameraFly(state, VP);
    expect(state.cameraFly).toBeNull();            // settled in one step
    expect(state.camera.zoom).toBe(zoom);
    const p = worldToScreen(tx + 0.5, ty + 0.5, 0, 0, 0);
    expect(state.camera.x).toBeCloseTo(p.sx - VP.width / zoom / 2, 6);
    expect(state.camera.y).toBeCloseTo(p.sy - VP.height / zoom / 2, 6);
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
