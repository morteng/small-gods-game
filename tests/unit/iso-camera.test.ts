import { describe, it, expect } from 'vitest';
import { createIsoCamera, centerOnTile, ISO_ZOOM_MIN, ISO_ZOOM_MAX } from '@/render/iso/iso-camera';
import { worldToScreen } from '@/render/iso/iso-projection';

describe('iso-camera', () => {
  it('createIsoCamera returns default-position camera at zoom 1', () => {
    const c = createIsoCamera();
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
    expect(c.zoom).toBe(1);
    expect(c.dragging).toBe(false);
  });

  it('exposes iso zoom range constants', () => {
    expect(ISO_ZOOM_MIN).toBe(0.5);
    expect(ISO_ZOOM_MAX).toBe(4);
  });

  it('centerOnTile sets camera so the tile renders at viewport center', () => {
    const c = createIsoCamera();
    centerOnTile(c, 10, 10, 800, 600);
    const { sx, sy } = worldToScreen(10, 10, 0, -c.x, -c.y);
    expect(sx).toBeCloseTo(400);
    expect(sy).toBeCloseTo(300);
  });
});
