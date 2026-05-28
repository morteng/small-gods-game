import { describe, it, expect, beforeEach } from 'vitest';
import { pickTile } from '@/ui/pick-tile';
import { createCamera } from '@/render/camera';

describe('pickTile: mode dispatch', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses iso math by default', () => {
    const cam = createCamera();
    cam.zoom = 1;
    // (64, 96) in screen coords → (2, 1) in iso tile coords
    const { tx, ty } = pickTile(cam, 64, 96);
    expect(tx).toBe(2);
    expect(ty).toBe(1);
  });

  it('uses topdown math when flag is "topdown"', () => {
    localStorage.setItem('smallgods.render.mode', 'topdown');
    const cam = createCamera();
    cam.zoom = 1;
    // TILE_SIZE = 32 → (64/32, 96/32) = (2, 3)
    expect(pickTile(cam, 64, 96)).toEqual({ tx: 2, ty: 3 });
    localStorage.removeItem('smallgods.render.mode');
  });
});
