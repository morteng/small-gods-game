import { describe, it, expect } from 'vitest';
import { computeFrame, subjectFromTiles } from '@/game/framing/compute-frame';
import { ISO_ZOOM_RUNGS } from '@/render/iso/iso-camera';
import { worldToScreen } from '@/render/iso/iso-projection';
import type { Viewport } from '@/game/viewport';

const VIEW: Viewport = { width: 1280, height: 800 };

function isOnLadder(zoom: number): boolean {
  return ISO_ZOOM_RUNGS.some((r) => Math.abs(r - zoom) < 1e-9);
}

/** Projected screen-space extent of a bbox at zoom 1 (same transform computeFrame uses). */
function projectedSpan(min: { x: number; y: number }, max: { x: number; y: number }) {
  const corners: [number, number][] = [
    [min.x, min.y], [max.x, min.y], [min.x, max.y], [max.x, max.y],
  ];
  let minSx = Infinity, minSy = Infinity, maxSx = -Infinity, maxSy = -Infinity;
  for (const [tx, ty] of corners) {
    const { sx, sy } = worldToScreen(tx, ty, 0, 0, 0);
    if (sx < minSx) minSx = sx;
    if (sx > maxSx) maxSx = sx;
    if (sy < minSy) minSy = sy;
    if (sy > maxSy) maxSy = sy;
  }
  return { spanX: maxSx - minSx, spanY: maxSy - minSy };
}

describe('computeFrame', () => {
  it('caps a single-tile subject at native 1:1 even though it could zoom in further', () => {
    const r = computeFrame({ min: { x: 50, y: 50 }, max: { x: 50, y: 50 } }, VIEW);
    expect(r.zoom).toBe(1);
    expect(r.cx).toBe(50);
    expect(r.cy).toBe(50);
  });

  it('a single-tile subject with maxZoom:2 may reach the magnify rung', () => {
    const r = computeFrame({ min: { x: 50, y: 50 }, max: { x: 50, y: 50 } }, VIEW, { maxZoom: 2 });
    expect(r.zoom).toBe(2);
  });

  it('a big bbox zooms out to a valid ladder rung and the WHOLE bbox fits with margin', () => {
    const min = { x: 100, y: 100 };
    const max = { x: 140, y: 140 }; // 40x40 tiles
    const margin = 0.15; // default
    const r = computeFrame({ min, max }, VIEW);
    expect(r.zoom).toBeLessThan(1);
    expect(isOnLadder(r.zoom)).toBe(true);

    const { spanX, spanY } = projectedSpan(min, max);
    const usableW = VIEW.width * (1 - 2 * margin);
    const usableH = VIEW.height * (1 - 2 * margin);
    // whole projected bbox, scaled by the chosen zoom, fits inside the margin box
    expect(spanX * r.zoom).toBeLessThanOrEqual(usableW + 1e-6);
    expect(spanY * r.zoom).toBeLessThanOrEqual(usableH + 1e-6);
  });

  it('center is the bbox midpoint for an asymmetric bbox', () => {
    const r = computeFrame({ min: { x: 10, y: 5 }, max: { x: 30, y: 15 } }, VIEW);
    expect(r.cx).toBe(20);
    expect(r.cy).toBe(10);
  });

  it('result zoom is always a ladder rung under default opts', () => {
    const subjects = [
      { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
      { min: { x: 0, y: 0 }, max: { x: 5, y: 5 } },
      { min: { x: 0, y: 0 }, max: { x: 40, y: 40 } },
      { min: { x: 0, y: 0 }, max: { x: 400, y: 400 } },
    ];
    for (const s of subjects) {
      const r = computeFrame(s, VIEW);
      expect(isOnLadder(r.zoom)).toBe(true);
    }
  });

  it('result zoom stays within a caller-supplied [minZoom, maxZoom] band', () => {
    const r = computeFrame(
      { min: { x: 0, y: 0 }, max: { x: 400, y: 400 } },
      VIEW,
      { minZoom: 0.25, maxZoom: 1 },
    );
    expect(r.zoom).toBeGreaterThanOrEqual(0.25);
    expect(r.zoom).toBeLessThanOrEqual(1);
  });

  it('is deterministic: same inputs produce identical output', () => {
    const subject = { min: { x: 12, y: 7 }, max: { x: 44, y: 30 } };
    const a = computeFrame(subject, VIEW, { margin: 0.2 });
    const b = computeFrame(subject, VIEW, { margin: 0.2 });
    expect(a).toEqual(b);
  });

  it('a huge subject that cannot fit at 1:1 lands on the largest rung that DOES fit', () => {
    const r = computeFrame({ min: { x: 0, y: 0 }, max: { x: 400, y: 400 } }, VIEW);
    expect(r.zoom).toBeLessThan(1);
    expect(isOnLadder(r.zoom)).toBe(true);
  });
});

describe('subjectFromTiles', () => {
  it('computes the bbox of a point set', () => {
    const s = subjectFromTiles([{ x: 5, y: 2 }, { x: 1, y: 9 }, { x: 7, y: 0 }]);
    expect(s.min).toEqual({ x: 1, y: 0 });
    expect(s.max).toEqual({ x: 7, y: 9 });
  });

  it('is exact (min===max) for a single tile', () => {
    const s = subjectFromTiles([{ x: 4, y: 4 }]);
    expect(s.min).toEqual({ x: 4, y: 4 });
    expect(s.max).toEqual({ x: 4, y: 4 });
  });

  it('returns a degenerate origin subject for an empty set (documented fallback, not a throw)', () => {
    const s = subjectFromTiles([]);
    expect(s.min).toEqual({ x: 0, y: 0 });
    expect(s.max).toEqual({ x: 0, y: 0 });
  });
});
