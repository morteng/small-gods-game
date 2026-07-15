import { describe, it, expect } from 'vitest';
import {
  createIsoCamera, centerOnTile, ISO_ZOOM_MIN, ISO_ZOOM_MAX,
  ISO_ZOOM_RUNGS, quantizeIsoZoom, floorIsoZoom,
} from '@/render/iso/iso-camera';
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
    expect(ISO_ZOOM_MIN).toBe(0.05);
    expect(ISO_ZOOM_MAX).toBe(2); // 2:1 cap — one clean integer magnify rung above native
  });

  it('centerOnTile sets camera so the tile renders at viewport center', () => {
    const c = createIsoCamera();
    centerOnTile(c, 10, 10, 800, 600);
    const { sx, sy } = worldToScreen(10, 10, 0, -c.x, -c.y);
    expect(sx).toBeCloseTo(400);
    expect(sy).toBeCloseTo(300);
  });

  describe('pixel-perfect zoom ladder', () => {
    it('rungs are 1/n zooming out and top out at 2:1, ascending, spanning the range', () => {
      expect(ISO_ZOOM_RUNGS[0]).toBeCloseTo(ISO_ZOOM_MIN); // 1/20 = 0.05
      expect(ISO_ZOOM_RUNGS[ISO_ZOOM_RUNGS.length - 1]).toBe(ISO_ZOOM_MAX); // 2
      expect(ISO_ZOOM_RUNGS).toContain(1);
      expect(ISO_ZOOM_RUNGS).toContain(2); // one integer magnify rung above 1:1 (clean 2× upscale)
      // strictly ascending
      for (let i = 1; i < ISO_ZOOM_RUNGS.length; i++) {
        expect(ISO_ZOOM_RUNGS[i]).toBeGreaterThan(ISO_ZOOM_RUNGS[i - 1]);
      }
      // every rung is an integer (zoom-in) or a reciprocal-integer (zoom-out)
      for (const r of ISO_ZOOM_RUNGS) {
        const ok = Number.isInteger(r) || Number.isInteger(1 / r);
        expect(ok).toBe(true);
      }
    });

    it('quantizeIsoZoom snaps to the nearest rung (dir 0)', () => {
      expect(quantizeIsoZoom(1.1)).toBe(1);  // nearer 1 than 2
      expect(quantizeIsoZoom(5)).toBe(2);    // above the 2:1 cap → clamps to 2
      expect(quantizeIsoZoom(1.7)).toBe(2);  // nearer 2 than 1
      expect(quantizeIsoZoom(0.9)).toBe(1);
      expect(quantizeIsoZoom(0.49)).toBeCloseTo(0.5);
    });

    it('quantizeIsoZoom steps exactly one rung up/down regardless of magnitude', () => {
      // a tiny wheel factor must still advance one full rung, not stall
      expect(quantizeIsoZoom(0.5, 1)).toBe(1);
      expect(quantizeIsoZoom(1, 1)).toBe(2);   // native → the 2:1 magnify rung
      expect(quantizeIsoZoom(2, 1)).toBe(2);   // already at the 2:1 cap
      expect(quantizeIsoZoom(1, -1)).toBeCloseTo(0.5);
      expect(quantizeIsoZoom(0.5, -1)).toBeCloseTo(1 / 3);
    });

    it('quantizeIsoZoom clamps at the ends', () => {
      expect(quantizeIsoZoom(ISO_ZOOM_MAX, 1)).toBe(ISO_ZOOM_MAX);
      expect(quantizeIsoZoom(ISO_ZOOM_MIN, -1)).toBeCloseTo(ISO_ZOOM_MIN);
    });

    it('floorIsoZoom returns the largest rung not exceeding z (so fit still fits)', () => {
      expect(floorIsoZoom(0.9)).toBeCloseTo(0.5);
      expect(floorIsoZoom(0.13)).toBeCloseTo(1 / 8); // 0.125 ≤ 0.13 < 1/7
      expect(floorIsoZoom(0.04)).toBeCloseTo(ISO_ZOOM_MIN); // below floor → min rung
      expect(floorIsoZoom(10)).toBe(ISO_ZOOM_MAX);
    });
  });
});
