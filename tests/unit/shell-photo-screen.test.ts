import { describe, it, expect } from 'vitest';
import { UiContext } from '@/render/ui/ui-context';
import { UiPage, UiSpace, type UiDrawGroup } from '@/render/ui/ui-batcher';
import { drawPhotoScreen, type PhotoView } from '@/render/ui/shell/photo-screen';

const W = 1280, H = 720, S = 2;

function totalVerts(groups: UiDrawGroup[]): number {
  return groups.reduce((sum, g) => sum + g.vertexCount, 0);
}

function screenBounds(groups: UiDrawGroup[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const g of groups) {
    if (g.space !== UiSpace.Screen || g.page !== UiPage.Solid) continue;
    for (let i = 0; i < g.vertexCount * 8; i += 8) {
      const x = g.vertices[i], y = g.vertices[i + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

function paint(v: PhotoView): { action: null; groups: UiDrawGroup[]; hits: number } {
  const c = new UiContext();
  c.begin();
  const action = drawPhotoScreen(c, W, H, S, v);
  const { hits } = c.end();
  return { action, groups: c.batcher.flush(), hits: hits.length };
}

describe('photo screen — chrome-free by design', () => {
  it('draws NOTHING and registers NO hit regions with no hint (the common case)', () => {
    const { action, groups, hits } = paint({ hintText: null, alpha: 0 });
    expect(action).toBeNull();
    expect(totalVerts(groups)).toBe(0);
    expect(hits).toBe(0);
  });

  it('draws NOTHING once the hint has fully faded (alpha 0), even with text set', () => {
    const { groups, hits } = paint({ hintText: 'PHOTO SAVED', alpha: 0 });
    expect(totalVerts(groups)).toBe(0);
    expect(hits).toBe(0);
  });

  it('paints the hint (and still no hit regions) while it is visible', () => {
    const { groups, hits } = paint({ hintText: 'PHOTO SAVED', alpha: 1 });
    expect(totalVerts(groups)).toBeGreaterThan(0);
    expect(hits).toBe(0); // chrome-free: nothing here is ever clickable
    const b = screenBounds(groups);
    expect(b.minX).toBeGreaterThanOrEqual(0);
    expect(b.maxX).toBeLessThanOrEqual(W);
    expect(b.minY).toBeGreaterThanOrEqual(0);
    expect(b.maxY).toBeLessThanOrEqual(H);
  });

  it('always returns null — there is nothing to click here', () => {
    expect(paint({ hintText: 'PHOTO SAVED', alpha: 1 }).action).toBeNull();
    expect(paint({ hintText: null, alpha: 0 }).action).toBeNull();
  });

  it('stays inside the target even at a very cramped viewport', () => {
    for (const [w, h] of [[1280, 720], [420, 640], [320, 200]] as const) {
      const c = new UiContext();
      c.begin();
      drawPhotoScreen(c, w, h, S, { hintText: 'PHOTO SAVED', alpha: 1 });
      c.end();
      const b = screenBounds(c.batcher.flush());
      expect(b.minX, `x underflow at ${w}x${h}`).toBeGreaterThanOrEqual(0);
      expect(b.maxX, `x overflow at ${w}x${h}`).toBeLessThanOrEqual(w);
      expect(b.minY, `y underflow at ${w}x${h}`).toBeGreaterThanOrEqual(0);
      expect(b.maxY, `y overflow at ${w}x${h}`).toBeLessThanOrEqual(h);
    }
  });
});
