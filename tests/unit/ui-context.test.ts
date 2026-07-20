import { describe, it, expect } from 'vitest';
import { UiContext, EMPTY_INPUT, type UiInput } from '@/render/ui/ui-context';
import { MonospaceFont } from '@/render/ui/text/font';
import { UiPage, UI_VERTEX_FLOATS } from '@/render/ui/ui-batcher';

function ctx() {
  return new UiContext();
}

describe('MonospaceFont', () => {
  it('measures by glyph count and skips whitespace quads', () => {
    const f = new MonospaceFont(6, 9, 1);
    expect(f.measure('abc', 1)).toBe(18);
    expect(f.measure('abc', 2)).toBe(36);
    expect(f.lineHeight(1)).toBe(9);
    expect(f.layout('a b', 0, 0, 1)).toHaveLength(2); // space emits no quad
  });
});

describe('ui-context immediate mode', () => {
  it('panel draws a fill + 4 border edges', () => {
    const c = ctx();
    c.begin();
    c.panel(0, 0, 100, 40);
    c.end();
    const g = c.batcher.flush().find((gr) => gr.page === UiPage.Solid)!;
    // fill (6 verts) + border (4 edges × 6) = 30 verts
    expect(g.vertexCount).toBe(5 * 6);
  });

  it('button records a hit region every frame', () => {
    const c = ctx();
    c.begin();
    c.button('go', 'Go', 10, 10, 60, 20);
    const { hits } = c.end();
    expect(hits).toEqual([{ id: 'go', x: 10, y: 10, w: 60, h: 20 }]);
  });

  it('is inert under the empty (S1) input snapshot', () => {
    const c = ctx();
    c.begin(EMPTY_INPUT);
    const clicked = c.button('go', 'Go', 10, 10, 60, 20);
    c.end();
    expect(clicked).toBe(false);
    expect(c.hot()).toBeNull();
  });

  it('S2 contract: hot when pointer inside, click on release', () => {
    const inside: UiInput = { px: 40, py: 20, down: false, released: true };
    const c = ctx();
    c.begin(inside);
    const clicked = c.button('go', 'Go', 10, 10, 60, 20);
    c.end();
    expect(c.hot()).toBe('go');
    expect(clicked).toBe(true);
  });

  it('S2 contract: pointer outside ⇒ not hot, no click', () => {
    const outside: UiInput = { px: 200, py: 200, down: false, released: true };
    const c = ctx();
    c.begin(outside);
    const clicked = c.button('go', 'Go', 10, 10, 60, 20);
    c.end();
    expect(c.hot()).toBeNull();
    expect(clicked).toBe(false);
  });

  it('disabled buttons never click even when hot', () => {
    const inside: UiInput = { px: 40, py: 20, down: false, released: true };
    const c = ctx();
    c.begin(inside);
    const clicked = c.button('go', 'Go', 10, 10, 60, 20, { disabled: true });
    c.end();
    expect(clicked).toBe(false);
  });

  it('pressed-but-not-released is active, not yet a click', () => {
    const pressing: UiInput = { px: 40, py: 20, down: true, released: false };
    const c = ctx();
    c.begin(pressing);
    const clicked = c.button('go', 'Go', 10, 10, 60, 20);
    c.end();
    expect(c.hot()).toBe('go');
    expect(clicked).toBe(false);
  });

  it('begin() clears geometry + hits from the prior frame', () => {
    // explicit MonospaceFont ⇒ deterministic 1 quad/char (default is the pixel font)
    const c = new UiContext({ font: new MonospaceFont() });
    c.begin();
    c.button('a', 'A', 0, 0, 10, 10);
    c.begin();
    c.label('hi', 0, 0);
    const { hits } = c.end();
    expect(hits).toEqual([]); // button from last frame is gone
    // label 'hi' = 2 glyph blocks on Solid page
    const g = c.batcher.flush().find((gr) => gr.page === UiPage.Solid)!;
    expect(g.vertexCount).toBe(2 * 6);
    expect(g.vertices.length).toBe(2 * 6 * UI_VERTEX_FLOATS);
  });
});

// Card polish: long choice labels ('text — hint') used to run past the card edge —
// the button primitive now ellipsis-clips its label to the button's inner width.
describe('button label ellipsis-clip', () => {
  it('ellipsize returns short text unchanged', () => {
    const c = ctx();
    expect(c.ellipsize('GO', 1, 200)).toBe('GO');
  });

  it('ellipsize clips a long run to fit and appends …', () => {
    const c = ctx();
    const out = c.ellipsize('SOOTHE THEIR MEANING — A LONG EXPLANATORY HINT THAT OVERFLOWS', 1, 120);
    expect(out.endsWith('…')).toBe(true);
    expect(c.measure(out, 1)).toBeLessThanOrEqual(120);
    expect(out.length).toBeGreaterThan(1); // kept a meaningful prefix, not just '…'
  });

  it('a long button label never emits glyph pixels outside the button rect', () => {
    const c = ctx();
    const bx = 10, bw = 90;
    c.begin();
    c.button('choice', 'CLAIM THEIR DEVOTION — PROMISE PROSPERITY IN EXCHANGE FOR WORSHIP', bx, 10, bw, 20, { scale: 1 });
    c.end();
    const g = c.batcher.flush().find((gr) => gr.page === UiPage.Solid)!;
    let maxX = -Infinity;
    let minX = Infinity;
    for (let i = 0; i < g.vertices.length; i += UI_VERTEX_FLOATS) {
      maxX = Math.max(maxX, g.vertices[i]);
      minX = Math.min(minX, g.vertices[i]);
    }
    expect(maxX).toBeLessThanOrEqual(bx + bw); // nothing right of the border
    expect(minX).toBeGreaterThanOrEqual(bx);   // nothing left of it either
  });

  it('short labels still centre exactly as before', () => {
    const a = ctx();
    a.begin();
    a.button('go', 'GO', 10, 10, 60, 20);
    a.end();
    const b = ctx();
    b.begin();
    b.label('GO', Math.round(10 + (60 - b.measure('GO', 1)) / 2), Math.round(10 + (20 - b.lineHeight(1)) / 2));
    b.end();
    // the button's glyph quads (beyond its bg fill + border) match the hand-centred label
    const quadsA = a.batcher.flush().find((g) => g.page === UiPage.Solid)!;
    const quadsB = b.batcher.flush().find((g) => g.page === UiPage.Solid)!;
    // extract x positions; button adds 5 rects (fill + 4 border edges) = 30 verts first
    const textA = Array.from(quadsA.vertices).filter((_, i) => i % UI_VERTEX_FLOATS === 0).slice(30);
    const textB = Array.from(quadsB.vertices).filter((_, i) => i % UI_VERTEX_FLOATS === 0);
    expect(textA).toEqual(textB);
  });
});

// D2: row-granular scroll (UI v2 W0). rowH=25, rect.h=100 ⇒ 4 rows fully fit.
describe('UiContext.scrollList (D2)', () => {
  const RECT = { x: 0, y: 0, w: 200, h: 100 };
  const ROW_H = 25;

  it('windows: only fully-fitting rows are drawn, starting at offset 0', () => {
    const c = ctx();
    c.begin();
    const drawn: number[] = [];
    c.scrollList('list', RECT, ROW_H, 10, (i) => drawn.push(i));
    c.end();
    expect(drawn).toEqual([0, 1, 2, 3]);
  });

  it('a list that fits entirely draws every row and no partial row', () => {
    const c = ctx();
    c.begin();
    const drawn: number[] = [];
    c.scrollList('list', RECT, ROW_H, 3, (i) => drawn.push(i)); // 3 < visibleRows(4)
    c.end();
    expect(drawn).toEqual([0, 1, 2]);
  });

  it('scrollBy steps the offset and the next draw windows around it', () => {
    const c = ctx();
    c.begin();
    c.scrollBy('list', 3); // one notch worth of rows
    const drawn: number[] = [];
    c.scrollList('list', RECT, ROW_H, 10, (i) => drawn.push(i));
    c.end();
    expect(drawn).toEqual([3, 4, 5, 6]);
  });

  it('clamps the offset to [0, rowCount - visibleRows] on the high end', () => {
    const c = ctx();
    c.begin();
    c.scrollBy('list', 999); // wildly past the end
    const drawn: number[] = [];
    c.scrollList('list', RECT, ROW_H, 10, (i) => drawn.push(i));
    c.end();
    expect(drawn).toEqual([6, 7, 8, 9]); // maxOffset = 10 - 4
  });

  it('clamps the offset to 0 on the low end (never negative)', () => {
    const c = ctx();
    c.begin();
    c.scrollBy('list', -999);
    const drawn: number[] = [];
    c.scrollList('list', RECT, ROW_H, 10, (i) => drawn.push(i));
    c.end();
    expect(drawn).toEqual([0, 1, 2, 3]);
  });

  it('keeps offsets isolated per id', () => {
    const c = ctx();
    c.begin();
    c.scrollBy('a', 5);
    const drawnA: number[] = [];
    const drawnB: number[] = [];
    c.scrollList('a', RECT, ROW_H, 10, (i) => drawnA.push(i));
    c.scrollList('b', RECT, ROW_H, 10, (i) => drawnB.push(i));
    c.end();
    expect(drawnA).toEqual([5, 6, 7, 8]);
    expect(drawnB).toEqual([0, 1, 2, 3]); // untouched by 'a's scroll
  });

  it('registers a scroll region matching the rect, for the wheel router', () => {
    const c = ctx();
    c.begin();
    c.scrollList('list', RECT, ROW_H, 10, () => {});
    const { scrollRegions } = c.end();
    expect(scrollRegions).toEqual([{ id: 'list', ...RECT }]);
  });

  it('draws no overflow chrome (indicators/track) when the whole list fits', () => {
    const c = ctx();
    c.begin();
    c.scrollList('list', RECT, ROW_H, 4, () => {}); // rowCount === visibleRows
    c.end();
    expect(c.batcher.flush()).toEqual([]); // drawRow is a no-op ⇒ nothing else drawn
  });

  it('draws overflow chrome (indicators/track) only when overflowing', () => {
    const c = ctx();
    c.begin();
    c.scrollList('list', RECT, ROW_H, 10, () => {}); // rowCount > visibleRows
    c.end();
    const groups = c.batcher.flush();
    expect(groups.length).toBeGreaterThan(0);
    const total = groups.reduce((s, g) => s + g.vertexCount, 0);
    expect(total).toBeGreaterThan(0);
  });

  it('offset survives across frames (begin() does not reset it)', () => {
    const c = ctx();
    c.begin();
    c.scrollBy('list', 3);
    c.scrollList('list', RECT, ROW_H, 10, () => {});
    c.end();
    // a fresh frame — no scrollBy this time — must still read the same offset
    c.begin();
    const drawn: number[] = [];
    c.scrollList('list', RECT, ROW_H, 10, (i) => drawn.push(i));
    c.end();
    expect(drawn).toEqual([3, 4, 5, 6]);
  });
});
