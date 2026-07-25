import { describe, it, expect } from 'vitest';
import { UiContext } from '@/render/ui/ui-context';
import { UiPage, UiSpace, type UiDrawGroup } from '@/render/ui/ui-batcher';
import { drawNewGameScreen, type NewGameView, type NewGameAction } from '@/render/ui/shell/newgame-screen';
import type { Rect } from '@/render/ui/kit';

const W = 1280, H = 720, S = 2;

function view(over: Partial<NewGameView> = {}): NewGameView {
  return { error: null, ...over };
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

function withinBounds(r: Rect, w: number, h: number): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;
}

describe('new-game screen — geometry and input', () => {
  it('paints inside the target and reserves a non-degenerate island rect', () => {
    const c = new UiContext();
    c.begin();
    const res = drawNewGameScreen(c, W, H, S, view());
    const { hits } = c.end();
    expect(res.island.w).toBeGreaterThan(0);
    expect(res.island.h).toBeGreaterThan(0);
    expect(withinBounds(res.island, W, H)).toBe(true);
    const ids = hits.map(h => h.id);
    expect(ids).toContain('newgame.random');
    expect(ids).toContain('newgame.back');
    const b = screenBounds(c.batcher.flush());
    expect(b.minX).toBeGreaterThanOrEqual(0);
    expect(b.maxX).toBeLessThanOrEqual(W);
    expect(b.minY).toBeGreaterThanOrEqual(0);
    expect(b.maxY).toBeLessThanOrEqual(H);
  });

  it('the island rect never overlaps a GPU button hit region', () => {
    const c = new UiContext();
    c.begin();
    const res = drawNewGameScreen(c, W, H, S, view());
    const { hits } = c.end();
    const overlaps = (a: Rect, b: { x: number; y: number; w: number; h: number }): boolean =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    for (const hit of hits) {
      expect(overlaps(res.island, hit), `island overlaps ${hit.id}`).toBe(false);
    }
  });

  it('a click on RANDOM WORLD fires random', () => {
    const c = new UiContext();
    c.begin();
    drawNewGameScreen(c, W, H, S, view());
    const { hits } = c.end();
    const row = hits.find(h => h.id === 'newgame.random')!;
    const cx = row.x + row.w / 2, cy = row.y + row.h / 2;
    c.begin({ px: cx, py: cy, down: true, released: false });
    drawNewGameScreen(c, W, H, S, view());
    c.end();
    c.begin({ px: cx, py: cy, down: false, released: true });
    const res = drawNewGameScreen(c, W, H, S, view());
    c.end();
    expect(res.action).toEqual<NewGameAction>({ kind: 'random' });
  });

  it('a click on BACK fires back', () => {
    const c = new UiContext();
    c.begin();
    drawNewGameScreen(c, W, H, S, view());
    const { hits } = c.end();
    const row = hits.find(h => h.id === 'newgame.back')!;
    const cx = row.x + row.w / 2, cy = row.y + row.h / 2;
    c.begin({ px: cx, py: cy, down: true, released: false });
    drawNewGameScreen(c, W, H, S, view());
    c.end();
    c.begin({ px: cx, py: cy, down: false, released: true });
    const res = drawNewGameScreen(c, W, H, S, view());
    c.end();
    expect(res.action).toEqual<NewGameAction>({ kind: 'back' });
  });

  it('shows a refusal message when the caller supplies one', () => {
    const c1 = new UiContext();
    c1.begin();
    drawNewGameScreen(c1, W, H, S, view());
    c1.end();
    const noErrorVerts = c1.batcher.flush().reduce((sum, g) => sum + g.vertexCount, 0);

    const c2 = new UiContext();
    c2.begin();
    drawNewGameScreen(c2, W, H, S, view({ error: 'THAT DOES NOT LOOK LIKE A WORLD CODE.' }));
    c2.end();
    const withErrorVerts = c2.batcher.flush().reduce((sum, g) => sum + g.vertexCount, 0);
    expect(withErrorVerts).toBeGreaterThan(noErrorVerts);
  });

  it('stays inside the target and keeps the island in bounds even in a very cramped window', () => {
    for (const [w, h] of [[1280, 720], [420, 640], [360, 300], [320, 200]] as const) {
      const c = new UiContext();
      c.begin();
      const res = drawNewGameScreen(c, w, h, S, view());
      const { hits } = c.end();
      expect(withinBounds(res.island, w, h), `island out of bounds at ${w}x${h}`).toBe(true);
      const ids = hits.map(hh => hh.id);
      expect(ids, `buttons missing at ${w}x${h}`).toEqual(expect.arrayContaining(['newgame.random', 'newgame.back']));
      const b = screenBounds(c.batcher.flush());
      expect(b.minX, `x underflow at ${w}x${h}`).toBeGreaterThanOrEqual(0);
      expect(b.maxX, `x overflow at ${w}x${h}`).toBeLessThanOrEqual(w);
      expect(b.minY, `y underflow at ${w}x${h}`).toBeGreaterThanOrEqual(0);
      expect(b.maxY, `y overflow at ${w}x${h}`).toBeLessThanOrEqual(h);
    }
  });
});
