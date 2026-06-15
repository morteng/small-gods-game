import { describe, it, expect, beforeEach } from 'vitest';
import { pickTile } from '@/ui/pick-tile';
import { createCamera } from '@/render/camera';

describe('pickTile (iso-only)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // The renderer is WebGPU-only and iso-projected; picking is the inverse iso
  // transform regardless of any legacy `?render=` flag (those modes were removed).
  it('uses iso math', () => {
    const cam = createCamera();
    cam.zoom = 1;
    // (64, 96) in screen coords → (2, 1) in iso tile coords
    const { tx, ty } = pickTile(cam, 64, 96);
    expect(tx).toBe(2);
    expect(ty).toBe(1);
  });

  it('ignores any stale render-mode flag and still picks via iso', () => {
    localStorage.setItem('smallgods.render.mode', 'topdown');
    const cam = createCamera();
    cam.zoom = 1;
    expect(pickTile(cam, 64, 96)).toEqual({ tx: 2, ty: 1 });
    localStorage.removeItem('smallgods.render.mode');
  });
});
