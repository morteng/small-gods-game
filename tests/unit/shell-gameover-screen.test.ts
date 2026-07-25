import { describe, it, expect } from 'vitest';
import { UiContext } from '@/render/ui/ui-context';
import { UiPage, UiSpace, type UiDrawGroup } from '@/render/ui/ui-batcher';
import { drawGameOverScreen, gameOverRows, type GameOverView, type GameOverAction } from '@/render/ui/shell/gameover-screen';

const W = 1280, H = 720, S = 2;

function view(over: Partial<GameOverView> = {}): GameOverView {
  return { note: null, ...over };
}

function frame(v: GameOverView): { action: GameOverAction | null; groups: UiDrawGroup[] } {
  const c = new UiContext();
  c.begin();
  const action = drawGameOverScreen(c, W, H, S, v);
  c.end();
  return { action, groups: c.batcher.flush() };
}

function clickAt(v: GameOverView, x: number, y: number): GameOverAction | null {
  const c = new UiContext();
  c.begin({ px: x, py: y, down: true, released: false });
  drawGameOverScreen(c, W, H, S, v);
  const { hits } = c.end();
  expect(hits.length).toBeGreaterThan(0);
  c.begin({ px: x, py: y, down: false, released: true });
  const action = drawGameOverScreen(c, W, H, S, v);
  c.end();
  return action;
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

describe('gameover screen — rows', () => {
  it('always offers KEEP WATCHING and BEGIN AGAIN', () => {
    const rows = gameOverRows();
    expect(rows.map(r => r.id)).toEqual(['gameover.keep_watching', 'gameover.begin_again']);
    expect(rows.find(r => r.id === 'gameover.keep_watching')!.action).toEqual({ kind: 'keep_watching' });
    expect(rows.find(r => r.id === 'gameover.begin_again')!.action).toEqual({ kind: 'begin_again' });
  });
});

describe('gameover screen — geometry and input', () => {
  it('paints inside the target and registers both hit regions', () => {
    const { groups } = frame(view());
    expect(groups.length).toBeGreaterThan(0);
    const b = screenBounds(groups);
    expect(b.minX).toBeGreaterThanOrEqual(0);
    expect(b.maxX).toBeLessThanOrEqual(W);
    expect(b.minY).toBeGreaterThanOrEqual(0);
    expect(b.maxY).toBeLessThanOrEqual(H);

    const c = new UiContext();
    c.begin();
    drawGameOverScreen(c, W, H, S, view());
    const { hits } = c.end();
    const ids = hits.map(h => h.id);
    expect(ids).toContain('gameover.keep_watching');
    expect(ids).toContain('gameover.begin_again');
  });

  it('rows do not overlap (a click can only ever hit one)', () => {
    const c = new UiContext();
    c.begin();
    drawGameOverScreen(c, W, H, S, view());
    const { hits } = c.end();
    const rows = hits.filter(h => h.id.startsWith('gameover.')).sort((a, b) => a.y - b.y);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].y).toBeGreaterThanOrEqual(rows[i - 1].y + rows[i - 1].h);
    }
  });

  it('a click on KEEP WATCHING fires keep_watching', () => {
    const c = new UiContext();
    c.begin();
    drawGameOverScreen(c, W, H, S, view());
    const { hits } = c.end();
    const row = hits.find(h => h.id === 'gameover.keep_watching')!;
    expect(clickAt(view(), row.x + row.w / 2, row.y + row.h / 2)).toEqual({ kind: 'keep_watching' });
  });

  it('a click on BEGIN AGAIN fires begin_again', () => {
    const c = new UiContext();
    c.begin();
    drawGameOverScreen(c, W, H, S, view());
    const { hits } = c.end();
    const row = hits.find(h => h.id === 'gameover.begin_again')!;
    expect(clickAt(view(), row.x + row.w / 2, row.y + row.h / 2)).toEqual({ kind: 'begin_again' });
  });

  it('shows an optional note when the caller supplies one', () => {
    const withNote = frame(view({ note: 'six believers kept the faith' }));
    const withoutNote = frame(view());
    // A rendered note adds geometry — a rough but sufficient proxy that the
    // note actually painted, without asserting exact glyph positions.
    const totalVerts = (gs: UiDrawGroup[]): number => gs.reduce((sum, g) => sum + g.vertexCount, 0);
    expect(totalVerts(withNote.groups)).toBeGreaterThan(totalVerts(withoutNote.groups));
  });

  it('keeps both rows reachable even in a very cramped window', () => {
    // The anti-softlock property (canon, not mercy — see the module header):
    // a faded god must always be able to keep watching or begin again.
    for (const [w, h] of [[1280, 720], [420, 640], [360, 300], [320, 200]] as const) {
      const c = new UiContext();
      c.begin();
      drawGameOverScreen(c, w, h, S, view());
      const { hits } = c.end();
      const ids = hits.filter(h => h.id.startsWith('gameover.')).map(h => h.id);
      expect(ids, `rows missing at ${w}x${h}`).toHaveLength(2);
      for (const hit of hits) {
        expect(hit.x, `row left edge at ${w}x${h}`).toBeGreaterThanOrEqual(0);
        expect(hit.x + hit.w, `row right edge at ${w}x${h}`).toBeLessThanOrEqual(w);
      }
      const b = screenBounds(c.batcher.flush());
      expect(b.minX, `x underflow at ${w}x${h}`).toBeGreaterThanOrEqual(0);
      expect(b.maxX, `x overflow at ${w}x${h}`).toBeLessThanOrEqual(w);
      expect(b.minY, `y underflow at ${w}x${h}`).toBeGreaterThanOrEqual(0);
      expect(b.maxY, `y overflow at ${w}x${h}`).toBeLessThanOrEqual(h);
    }
  });

  it('a keyboard ACTIVATE fires the focused row', () => {
    const c = new UiContext();
    c.begin();
    drawGameOverScreen(c, W, H, S, view());
    c.end();
    c.focusNext();
    expect(c.focusId).toBe('gameover.keep_watching');
    c.activate();
    c.begin();
    const action = drawGameOverScreen(c, W, H, S, view());
    c.end();
    expect(action).toEqual({ kind: 'keep_watching' });
  });
});
