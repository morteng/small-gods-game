import { describe, it, expect } from 'vitest';
import { UiContext, type UiInput } from '@/render/ui/ui-context';
import { UiBatcher, UI_VERTEX_FLOATS } from '@/render/ui/ui-batcher';
import { toggle } from '@/render/ui/kit/toggle';
import { slider } from '@/render/ui/kit/slider';
import { tabbar } from '@/render/ui/kit/tabbar';
import { modalFrame, modalOuterRect, backdropClicked } from '@/render/ui/kit/modal';
import { list } from '@/render/ui/kit/list';
import { slotTile } from '@/render/ui/kit/slot-tile';
import { keyChip } from '@/render/ui/kit/key-chip';
import { FS, SPACING } from '@/render/ui/ui-tokens';
import type { Rect } from '@/render/ui/kit/rect';

/** Every emitted quad's (x,y) corner must land inside `bounds` — the geometry
 *  contract every kit widget promises ("the widget only paints itself"). */
function assertQuadsWithin(groups: ReturnType<UiBatcher['flush']>, bounds: Rect): void {
  let total = 0;
  for (const g of groups) {
    total += g.vertexCount;
    for (let i = 0; i < g.vertexCount * UI_VERTEX_FLOATS; i += UI_VERTEX_FLOATS) {
      const x = g.vertices[i];
      const y = g.vertices[i + 1];
      expect(x).toBeGreaterThanOrEqual(bounds.x);
      expect(x).toBeLessThanOrEqual(bounds.x + bounds.w);
      expect(y).toBeGreaterThanOrEqual(bounds.y);
      expect(y).toBeLessThanOrEqual(bounds.y + bounds.h);
    }
  }
  expect(total).toBeGreaterThan(0);
}

function inputAt(x: number, y: number, released = true): UiInput {
  return { px: x, py: y, down: false, released };
}

describe('kit/toggle', () => {
  const opts = { id: 'snd', label: 'SOUND', x: 0, y: 0, w: 200, h: 20, value: false, scale: 2 };

  it('registers a pill hit region sized to fit ON/OFF, right-aligned to the widget', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin();
    toggle(c, opts);
    const { hits } = c.end();

    expect(hits).toHaveLength(1);
    const pill = hits[0];
    expect(pill.id).toBe('snd');
    const expectedW = Math.max(c.measure('ON', 2), c.measure('OFF', 2)) + 16 * 2;
    expect(pill.w).toBe(expectedW);
    expect(pill.x + pill.w).toBe(opts.w); // right edge flush with the widget's right edge
    expect(pill.y).toBe(0);
    expect(pill.h).toBe(20);

    assertQuadsWithin(c.batcher.flush(), { x: opts.x, y: opts.y, w: opts.w, h: opts.h });
  });

  it('click-return contract: a release inside the pill flips it', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin();
    toggle(c, opts);
    const pill = c.end().hits[0];

    const c2 = new UiContext({ batcher: new UiBatcher() });
    c2.begin(inputAt(pill.x + pill.w / 2, pill.y + pill.h / 2));
    const flipped = toggle(c2, opts);
    c2.end();
    expect(flipped).toBe(true);
  });

  it('a release outside the pill does not flip it', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin(inputAt(2, 2)); // far left — label area, not the pill
    const flipped = toggle(c, opts);
    c.end();
    expect(flipped).toBe(false);
  });
});

describe('kit/slider', () => {
  const opts = { id: 'vol', label: 'VOLUME', x: 0, y: 0, w: 100, h: 20, value: 0.5, scale: 1 };

  it('registers the track row (below the label line) as its hit region', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin();
    slider(c, opts);
    const { hits } = c.end();
    expect(hits).toHaveLength(1);
    const lh = c.lineHeight(1);
    expect(hits[0]).toEqual({ id: 'vol', x: 0, y: lh, w: 100, h: 20 - lh });
    assertQuadsWithin(c.batcher.flush(), { x: opts.x, y: opts.y, w: opts.w, h: opts.h });
  });

  it('click-return contract: clicking the track jumps to that fraction (no step)', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin(inputAt(10, 15)); // 10% across a 100px-wide track starting at x=0
    const out = slider(c, opts);
    c.end();
    expect(out).toBeCloseTo(0.1, 5);
  });

  it('clicking the track jumps to the clicked fraction even when it equals the current value', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin(inputAt(50, 15)); // dead centre == the current value (0.5)
    const out = slider(c, opts);
    c.end();
    expect(out).toBe(0.5); // an interaction happened — never null just because the number matches
  });

  it('returns null when nothing happened this frame (no click, no adjust)', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin(); // EMPTY_INPUT — nowhere near the track
    const out = slider(c, opts);
    c.end();
    expect(out).toBeNull();
  });

  it('a step snaps the click result to the nearest step', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin(inputAt(24, 15)); // frac 0.24, step 0.1 -> 0.2
    const out = slider(c, { ...opts, step: 0.1 });
    c.end();
    expect(out).toBeCloseTo(0.2, 5);
  });

  it('caller-fed `adjust` nudges by `step` without any pointer interaction', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin(); // no pointer interaction at all
    const out = slider(c, { ...opts, step: 0.1, adjust: 1 });
    c.end();
    expect(out).toBeCloseTo(0.6, 5);
  });

  it('a disabled slider registers no hit region and ignores adjust', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin(inputAt(10, 15));
    const out = slider(c, { ...opts, disabled: true, adjust: 1 });
    const { hits } = c.end();
    expect(hits).toEqual([]);
    expect(out).toBeNull();
  });
});

describe('kit/tabbar', () => {
  const tabs = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];
  const opts = { id: 'tb', tabs, selected: 'a', x: 0, y: 0, w: 99, h: 20, scale: 1 };

  it('splits w into equal integer columns, the last absorbing any remainder', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin();
    tabbar(c, opts);
    const { hits } = c.end();
    expect(hits).toEqual([
      { id: 'tb.a', x: 0, y: 0, w: 33, h: 20 },
      { id: 'tb.b', x: 33, y: 0, w: 33, h: 20 },
      { id: 'tb.c', x: 66, y: 0, w: 33, h: 20 },
    ]);
    assertQuadsWithin(c.batcher.flush(), { x: opts.x, y: opts.y, w: opts.w, h: opts.h });
  });

  it('click-return contract: releasing on a tab returns its id', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin(inputAt(50, 10)); // inside tab 'b' (33..66)
    const picked = tabbar(c, opts);
    c.end();
    expect(picked).toBe('b');
  });

  it('returns null when the click lands on the already-selected tab is still the picked id (not null-guarded)', () => {
    // picking the CURRENTLY selected tab still reports it — the kit doesn't
    // suppress "reselecting"; the caller decides whether that's a no-op.
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin(inputAt(10, 10)); // inside tab 'a', already selected
    const picked = tabbar(c, opts);
    c.end();
    expect(picked).toBe('a');
  });

  it('a release outside every tab returns null', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin(inputAt(500, 500));
    const picked = tabbar(c, opts);
    c.end();
    expect(picked).toBeNull();
  });
});

describe('kit/modal', () => {
  const opts = { w: 200, h: 150, screenW: 400, screenH: 300, title: 'Settings' };

  it('centres the panel and returns the exact inset content rect', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin();
    const content = modalFrame(c, opts);
    c.end();

    const outer = modalOuterRect(opts);
    expect(outer).toEqual({ x: 100, y: 75, w: 200, h: 150 });

    const titleH = c.lineHeight(FS.title);
    const expectedContentY = outer.y + SPACING.md + titleH + SPACING.md;
    expect(content).toEqual({
      x: outer.x + SPACING.lg,
      y: expectedContentY,
      w: outer.w - 2 * SPACING.lg,
      h: outer.y + outer.h - SPACING.lg - expectedContentY,
    });
    // content sits strictly inside the outer panel
    expect(content.x).toBeGreaterThan(outer.x);
    expect(content.x + content.w).toBeLessThan(outer.x + outer.w);
    expect(content.y).toBeGreaterThan(outer.y);
    expect(content.y + content.h).toBeLessThan(outer.y + outer.h);

    // the backdrop covers the whole screen, so the widget's own "bounds" IS the screen
    assertQuadsWithin(c.batcher.flush(), { x: 0, y: 0, w: opts.screenW, h: opts.screenH });
  });

  it('draws no hit regions of its own (a modal frame is chrome, not a control)', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin();
    modalFrame(c, opts);
    const { hits } = c.end();
    expect(hits).toEqual([]);
  });

  it('backdropClicked: true outside the frame rect, false inside it (inclusive of the near edge)', () => {
    const outer = modalOuterRect(opts);
    expect(backdropClicked({ x: 0, y: 0 }, outer)).toBe(true);
    expect(backdropClicked({ x: outer.x, y: outer.y }, outer)).toBe(false);
    expect(backdropClicked({ x: outer.x + outer.w / 2, y: outer.y + outer.h / 2 }, outer)).toBe(false);
    expect(backdropClicked({ x: outer.x + outer.w, y: outer.y }, outer)).toBe(true); // far edge is exclusive
  });
});

describe('kit/list', () => {
  const rect = { x: 0, y: 0, w: 50, h: 30 };
  const rowH = 10;

  it('registers one hotspot hit region per visible row', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin();
    list(c, { id: 'slots', rect, rowH, rowCount: 3, drawRow: () => {} });
    const { hits } = c.end();
    expect(hits).toEqual([
      { id: 'slots.row.0', x: 0, y: 0, w: 50, h: 10 },
      { id: 'slots.row.1', x: 0, y: 10, w: 50, h: 10 },
      { id: 'slots.row.2', x: 0, y: 20, w: 50, h: 10 },
    ]);
  });

  it('click-return contract: releasing on a row returns its index, and only that row reports focused', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    const focusFlags: boolean[] = [];
    c.begin(inputAt(25, 15)); // inside row 1 (y 10..20)
    const activated = list(c, {
      id: 'slots',
      rect,
      rowH,
      rowCount: 3,
      drawRow: (_i, _y, focused) => focusFlags.push(focused),
    });
    c.end();
    expect(activated).toBe(1);
    expect(focusFlags).toEqual([false, true, false]);
  });

  it('a release outside every row returns null', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin(inputAt(500, 500));
    const activated = list(c, { id: 'slots', rect, rowH, rowCount: 3, drawRow: () => {} });
    c.end();
    expect(activated).toBeNull();
  });

  it('drawing something in each row keeps every quad inside the list rect', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin();
    list(c, {
      id: 'slots',
      rect,
      rowH,
      rowCount: 3,
      drawRow: (i, y) => c.rect(rect.x + 2, y + 1, rect.w - 4, rowH - 2, [0, 0, 0, 1]),
    });
    c.end();
    assertQuadsWithin(c.batcher.flush(), rect);
  });
});

describe('kit/slot-tile', () => {
  const opts = {
    id: 'autosave',
    x: 0,
    y: 0,
    w: 200,
    h: 64,
    name: 'My World',
    dateLabel: 'Day 3',
    tierLabel: 'Tier I',
    playtimeLabel: '1h 20m',
    deletable: true,
    scale: 1,
  };

  it('reserves the thumbnail rect and hands it to drawThumb without decoding anything itself', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    let thumbRect: Rect | null = null;
    c.begin();
    slotTile(c, { ...opts, drawThumb: (r) => { thumbRect = r; } });
    c.end();
    const sz = opts.h - 2 * SPACING.sm;
    expect(thumbRect).toEqual({ x: SPACING.sm, y: SPACING.sm, w: sz, h: sz });
  });

  it('registers a body hit region (excluding the delete corner) and a delete hit region', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin();
    slotTile(c, opts);
    const { hits } = c.end();
    const body = hits.find((h) => h.id === 'autosave.body')!;
    const del = hits.find((h) => h.id === 'autosave.delete')!;
    expect(body).toBeDefined();
    expect(del).toBeDefined();
    expect(body.x).toBe(0);
    expect(body.y).toBe(0);
    expect(body.w).toBe(opts.w);
    expect(body.h).toBeLessThan(opts.h); // shortened to make room for the delete row
    expect(del.x + del.w).toBeLessThanOrEqual(opts.x + opts.w);
    expect(del.y + del.h).toBe(opts.y + opts.h); // flush with the card's bottom edge
    assertQuadsWithin(c.batcher.flush(), { x: opts.x, y: opts.y, w: opts.w, h: opts.h });
  });

  it('click-return contract: releasing on the body activates, on delete deletes', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin();
    slotTile(c, opts);
    const { hits } = c.end();
    const body = hits.find((h) => h.id === 'autosave.body')!;
    const del = hits.find((h) => h.id === 'autosave.delete')!;

    const cActivate = new UiContext({ batcher: new UiBatcher() });
    cActivate.begin(inputAt(body.x + body.w / 2, body.y + body.h / 2));
    expect(slotTile(cActivate, opts)).toBe('activate');
    cActivate.end();

    const cDelete = new UiContext({ batcher: new UiBatcher() });
    cDelete.begin(inputAt(del.x + del.w / 2, del.y + del.h / 2));
    expect(slotTile(cDelete, opts)).toBe('delete');
    cDelete.end();
  });

  it('a non-deletable tile registers no delete hit region', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin();
    slotTile(c, { ...opts, deletable: false });
    const { hits } = c.end();
    expect(hits.find((h) => h.id === 'autosave.delete')).toBeUndefined();
  });
});

describe('kit/key-chip', () => {
  it('sizes the chip to its label and returns its own rect; draws no hit region', () => {
    const c = new UiContext({ batcher: new UiBatcher() });
    c.begin();
    const rect = keyChip(c, { text: 'esc', x: 5, y: 5, scale: 1 });
    const { hits } = c.end();

    const tw = c.measure('ESC', 1);
    const th = c.lineHeight(1);
    expect(rect).toEqual({
      x: 5,
      y: 5,
      w: tw + 2 * SPACING.tight,
      h: th + 2 * SPACING.hairline,
    });
    expect(hits).toEqual([]); // a key prompt is a hint, not a control

    assertQuadsWithin(c.batcher.flush(), rect);
  });
});
