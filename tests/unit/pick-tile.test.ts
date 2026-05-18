import { describe, it, expect, beforeEach } from 'vitest';
import { pickTile } from '@/ui/pick-tile';
import { createCamera } from '@/render/camera';

describe('pickTile: mode dispatch', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses topdown math when flag absent', () => {
    const cam = createCamera();
    cam.zoom = 1;
    const { tx, ty } = pickTile(cam, 64, 96);
    // TILE_SIZE = 32 → (64/32, 96/32) = (2, 3)
    expect(tx).toBe(2);
    expect(ty).toBe(3);
  });

  it('uses iso math when flag is "iso"', () => {
    localStorage.setItem('smallgods.render.mode', 'iso');
    const cam = createCamera();
    cam.zoom = 1;
    cam.x = 0; cam.y = 0;
    expect(pickTile(cam, 0, 0)).toEqual({ tx: 0, ty: 0 });
    localStorage.removeItem('smallgods.render.mode');
  });
});
