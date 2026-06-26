import { describe, it, expect } from 'vitest';
import {
  cameraMotionPx, tickMotionCooldown, dragLodMesh,
  DRAG_LOD_SUB, DRAG_LOD_MOTION_PX, MOTION_COOLDOWN_FRAMES,
} from '@/render/gpu/drag-lod';

describe('drag-lod — motion detection', () => {
  it('reports 0 motion on the first frame (no previous pose)', () => {
    expect(cameraMotionPx(null, { x: 5, y: 5, zoom: 2 })).toBe(0);
  });

  it('measures screen-px motion = world delta × zoom', () => {
    // moved 3 world-px in x, 4 in y, at zoom 2 → (3+4)*2 = 14 screen px
    expect(cameraMotionPx({ x: 0, y: 0, zoom: 2 }, { x: 3, y: 4, zoom: 2 })).toBe(14);
  });

  it('re-arms the cooldown on a pan past the threshold', () => {
    const prev = { x: 0, y: 0, zoom: 1 };
    const cur = { x: DRAG_LOD_MOTION_PX + 1, y: 0, zoom: 1 }; // moved > threshold at zoom 1
    expect(tickMotionCooldown(prev, cur, 0)).toBe(MOTION_COOLDOWN_FRAMES);
  });

  it('re-arms on a zoom change even with no pan', () => {
    const prev = { x: 0, y: 0, zoom: 1 };
    const cur = { x: 0, y: 0, zoom: 1.2 };
    expect(tickMotionCooldown(prev, cur, 0)).toBe(MOTION_COOLDOWN_FRAMES);
  });

  it('does NOT re-arm on sub-threshold drift (slow camera-follow)', () => {
    const prev = { x: 0, y: 0, zoom: 1 };
    const cur = { x: DRAG_LOD_MOTION_PX * 0.5, y: 0, zoom: 1 }; // below threshold
    expect(tickMotionCooldown(prev, cur, 0)).toBe(0);
  });

  it('counts down (not below 0) when the camera is still', () => {
    const still = { x: 1, y: 1, zoom: 1 };
    expect(tickMotionCooldown(still, still, 3)).toBe(2);
    expect(tickMotionCooldown(still, still, 1)).toBe(0);
    expect(tickMotionCooldown(still, still, 0)).toBe(0);
  });

  it('lingers for exactly MOTION_COOLDOWN_FRAMES still frames after a move', () => {
    const a = { x: 0, y: 0, zoom: 1 };
    const b = { x: 100, y: 0, zoom: 1 };
    let cd = tickMotionCooldown(a, b, 0); // the move
    expect(cd).toBe(MOTION_COOLDOWN_FRAMES);
    let stillFrames = 0;
    while (cd > 0) { cd = tickMotionCooldown(b, b, cd); stillFrames++; }
    expect(stillFrames).toBe(MOTION_COOLDOWN_FRAMES);
  });
});

describe('drag-lod — mesh override', () => {
  const W = 384, H = 272;

  it('passes the natural knobs through when inactive', () => {
    expect(dragLodMesh(false, 50000, 3, W, H)).toEqual({ maxQuads: 50000, superSample: 3 });
    expect(dragLodMesh(false, undefined, 1, W, H)).toEqual({ maxQuads: undefined, superSample: 1 });
  });

  it('forces sub-2 coarsening + superSample 1 when active', () => {
    const { maxQuads, superSample } = dragLodMesh(true, undefined, 4, W, H);
    const expectedCap = Math.floor(W / DRAG_LOD_SUB) * Math.floor(H / DRAG_LOD_SUB);
    expect(maxQuads).toBe(expectedCap);
    expect(superSample).toBe(1);
  });

  it('never REFINES a view already coarser than sub-2 (min with natural)', () => {
    // a tiny natural cap (very zoomed out) must survive — motion can't add quads
    const tinyCap = 100;
    expect(dragLodMesh(true, tinyCap, 1, W, H).maxQuads).toBe(tinyCap);
  });

  it('the active cap makes the grid pick exactly DRAG_LOD_SUB', () => {
    // The cap equals floor(W/sub)*floor(H/sub) — the documented "pick exactly sub" value.
    const cap = dragLodMesh(true, 1e9, 1, W, H).maxQuads!;
    const sub = DRAG_LOD_SUB;
    expect(cap).toBe(Math.floor(W / sub) * Math.floor(H / sub));
  });
});
