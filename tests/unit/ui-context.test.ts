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
