import { describe, it, expect } from 'vitest';
import { UiContext, type UiInput } from '@/render/ui/ui-context';
import { UiPage, UiSpace, type UiDrawGroup } from '@/render/ui/ui-batcher';
import { drawTitleScreen, titleRows, type TitleView, type TitleAction } from '@/render/ui/shell/title-screen';

const W = 1280, H = 720, S = 2;

function view(over: Partial<TitleView> = {}): TitleView {
  return {
    continueLine: 'DAY 34 · A SMALL SHRINE · 2H 15M',
    continueBlocked: null,
    hasAnySave: true,
    buildLine: 'BUILD 118',
    ...over,
  };
}

/** Draw one frame; returns the action fired plus the context (for hit regions). */
function frame(v: TitleView, input?: UiInput): { action: TitleAction | null; c: UiContext; groups: UiDrawGroup[] } {
  const c = new UiContext();
  c.begin(input);
  const action = drawTitleScreen(c, W, H, S, v);
  c.end();
  return { action, c, groups: c.batcher.flush() };
}

/** Drive a real click at (x,y): a press frame, then a release frame. */
function clickAt(v: TitleView, x: number, y: number): TitleAction | null {
  const c = new UiContext();
  c.begin({ px: x, py: y, down: true, released: false });
  drawTitleScreen(c, W, H, S, v);
  const { hits } = c.end();
  expect(hits.length).toBeGreaterThan(0);
  c.begin({ px: x, py: y, down: false, released: true });
  const action = drawTitleScreen(c, W, H, S, v);
  c.end();
  return action;
}

/** Screen-space bounding box of every SOLID-page vertex (see the note in
 *  shell-save-load-screens.test.ts): aggregate once, assert once. Per-vertex
 *  `expect()` calls are what push these geometry tests past the 5 s timeout. */
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

function totalVerts(groups: UiDrawGroup[]): number {
  return groups.reduce((s, g) => s + g.vertexCount, 0);
}

describe('title screen — rows and refusal logic', () => {
  it('offers CONTINUE with its summary when the autosave is healthy', () => {
    const rows = titleRows(view());
    const cont = rows.find(r => r.id === 'title.continue')!;
    expect(cont.enabled).toBe(true);
    expect(cont.note).toBe('DAY 34 · A SMALL SHRINE · 2H 15M');
  });

  it('DISABLES continue and states the reason when there is no save', () => {
    const rows = titleRows(view({
      continueLine: null,
      continueBlocked: { reason: 'none', text: 'No world yet' },
    }));
    const cont = rows.find(r => r.id === 'title.continue')!;
    expect(cont.enabled).toBe(false);
    expect(cont.note).toBe('No world yet');
  });

  it('DISABLES continue on a stale WORLD version and shows that reason, not the summary', () => {
    // The honesty requirement (spec §5.2): a save from an older world must say
    // so, never be silently replaced by a freshly generated one.
    const rows = titleRows(view({
      continueLine: 'DAY 34 · A SMALL SHRINE',
      continueBlocked: { reason: 'stale-world', text: 'Saved under an older world (117; this build is 118)' },
    }));
    const cont = rows.find(r => r.id === 'title.continue')!;
    expect(cont.enabled).toBe(false);
    expect(cont.note).toContain('older world');
    expect(cont.note).not.toContain('DAY 34');
  });

  it('DISABLES continue on a stale SAVE version', () => {
    const rows = titleRows(view({
      continueBlocked: { reason: 'stale-save', text: 'Saved by an older version of the game' },
    }));
    expect(titleRows(view()).find(r => r.id === 'title.continue')!.enabled).toBe(true);
    expect(rows.find(r => r.id === 'title.continue')!.enabled).toBe(false);
  });

  it('disables LOAD WORLD when no slot holds a save, and says why', () => {
    const rows = titleRows(view({ hasAnySave: false }));
    const load = rows.find(r => r.id === 'title.load')!;
    expect(load.enabled).toBe(false);
    expect(load.note).toBe('NO SAVED WORLDS YET');
  });

  it('claims NOTHING about saves while the probe is still in flight', () => {
    // An IndexedDB open can take many seconds on a cold profile (~10s seen live).
    // Until it resolves, "NO SAVED WORLDS YET" is a FALSE statement that flips to
    // real metadata moments later — so both save-reading rows must say "looking",
    // not assert an absence. `probing` is deliberately distinct from
    // `hasAnySave: false`, which is a positive finding.
    const rows = titleRows(view({
      probing: true,
      continueLine: null,
      continueBlocked: { reason: 'none', text: 'Looking for a saved world…' },
      hasAnySave: false,
    }));
    const cont = rows.find(r => r.id === 'title.continue')!;
    const load = rows.find(r => r.id === 'title.load')!;

    expect(cont.enabled).toBe(false);
    expect(load.enabled).toBe(false);
    // Neither row may assert an absence...
    expect(cont.note).toMatch(/looking/i);
    expect(load.note).toMatch(/looking/i);
    for (const r of [cont, load]) {
      expect(r.note ?? '', `${r.id} asserted an absence while probing`).not.toMatch(/NO SAVED/i);
    }
  });

  it('once the probe resolves empty, the rows DO state the absence', () => {
    // The flip side: "looking" must not persist after the answer is known.
    const rows = titleRows(view({
      probing: false,
      continueLine: null,
      continueBlocked: { reason: 'none', text: 'No saved world yet' },
      hasAnySave: false,
    }));
    const load = rows.find(r => r.id === 'title.load')!;
    expect(load.note).toBe('NO SAVED WORLDS YET');
    expect(load.note).not.toMatch(/looking/i);
  });

  it('a resolved probe WITH saves enables LOAD and drops the note', () => {
    const load = titleRows(view({ probing: false, hasAnySave: true }))
      .find(r => r.id === 'title.load')!;
    expect(load.enabled).toBe(true);
    expect(load.note).toBeNull();
  });

  it('always offers NEW WORLD, DEMO WORLD and SETTINGS', () => {
    // The anti-softlock guarantee for the shell: whatever state the save store is
    // in, the player can always start something.
    const rows = titleRows(view({
      continueLine: null, hasAnySave: false,
      continueBlocked: { reason: 'none', text: 'x' },
    }));
    for (const id of ['title.new', 'title.demo', 'title.settings']) {
      expect(rows.find(r => r.id === id)!.enabled).toBe(true);
    }
  });

  it('tells the player the demo world is not saved', () => {
    expect(titleRows(view()).find(r => r.id === 'title.demo')!.note).toMatch(/NOTHING IS SAVED/);
  });
});

describe('title screen — geometry and input', () => {
  it('paints the wordmark, the rows and the build line inside the target', () => {
    const { groups } = frame(view());
    expect(totalVerts(groups)).toBeGreaterThan(0);
    const b = screenBounds(groups);
    expect(b.minX).toBeGreaterThanOrEqual(0);
    expect(b.maxX).toBeLessThanOrEqual(W);
    expect(b.minY).toBeGreaterThanOrEqual(0);
    expect(b.maxY).toBeLessThanOrEqual(H);
  });

  it('registers one hit region per menu row', () => {
    const c = new UiContext();
    c.begin();
    drawTitleScreen(c, W, H, S, view());
    const { hits } = c.end();
    const ids = hits.map(hh => hh.id);
    for (const id of ['title.continue', 'title.new', 'title.load', 'title.demo', 'title.settings']) {
      expect(ids).toContain(id);
    }
  });

  it('rows do not overlap vertically (a click can only ever hit one)', () => {
    const c = new UiContext();
    c.begin();
    drawTitleScreen(c, W, H, S, view());
    const { hits } = c.end();
    const rows = hits
      .filter(hh => hh.id.startsWith('title.'))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].y).toBeGreaterThanOrEqual(rows[i - 1].y + rows[i - 1].h);
    }
  });

  it('a click on NEW WORLD fires new_world', () => {
    const c = new UiContext();
    c.begin();
    drawTitleScreen(c, W, H, S, view());
    const { hits } = c.end();
    const row = hits.find(hh => hh.id === 'title.new')!;
    const action = clickAt(view(), row.x + row.w / 2, row.y + row.h / 2);
    expect(action).toEqual({ kind: 'new_world' });
  });

  it('a click on a DISABLED continue row fires nothing', () => {
    const blocked = view({ continueBlocked: { reason: 'stale-world', text: 'older world' } });
    const c = new UiContext();
    c.begin();
    drawTitleScreen(c, W, H, S, blocked);
    const { hits } = c.end();
    const row = hits.find(hh => hh.id === 'title.continue')!;
    expect(clickAt(blocked, row.x + row.w / 2, row.y + row.h / 2)).toBeNull();
  });

  it('a keyboard ACTIVATE fires the focused row, and never a disabled one', () => {
    const blocked = view({ continueBlocked: { reason: 'none', text: 'no world yet' } });
    const c = new UiContext();
    // frame 1 builds the focus ring
    c.begin();
    drawTitleScreen(c, W, H, S, blocked);
    c.end();
    // focusNext from nothing lands on the first FOCUSABLE row; continue is
    // disabled so it is not in the ring at all.
    c.focusNext();
    expect(c.focusId).toBe('title.new');
    c.activate();
    c.begin();
    const action = drawTitleScreen(c, W, H, S, blocked);
    c.end();
    expect(action).toEqual({ kind: 'new_world' });
  });

  it('keyboard focus wraps through every enabled row', () => {
    const v = view();
    const c = new UiContext();
    c.begin();
    drawTitleScreen(c, W, H, S, v);
    c.end();
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) { c.focusNext(); seen.push(c.focusId!); }
    expect(seen).toEqual(['title.continue', 'title.new', 'title.load', 'title.demo', 'title.settings']);
    c.focusNext();
    expect(c.focusId).toBe('title.continue'); // wrapped
  });

  it('keeps every menu row reachable even in a very cramped window', () => {
    // The anti-softlock property for the shell: detail (notes, epigraph, gaps)
    // degrades, but the rows are the only way out of the title screen, so they
    // must always be drawn AND stay inside the target.
    for (const [w, h] of [[1280, 720], [420, 640], [360, 300], [320, 200]] as const) {
      const c = new UiContext();
      c.begin();
      drawTitleScreen(c, w, h, S, view());
      const { hits } = c.end();
      const ids = hits.filter(hh => hh.id.startsWith('title.')).map(hh => hh.id);
      expect(ids, `rows missing at ${w}x${h}`).toHaveLength(5);
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

  it('steps the wordmark DOWN whole integer scales rather than squashing it', () => {
    // 1:1 pixel-perfect law: no fractional scales. A narrow window gets a smaller
    // wordmark at an integer rung, and it always fits.
    const wide = new UiContext();
    wide.begin(); drawTitleScreen(wide, 1600, 900, S, view()); wide.end();
    const narrow = new UiContext();
    narrow.begin(); drawTitleScreen(narrow, 360, 900, S, view()); narrow.end();
    const span = (c: UiContext): number => {
      let lo = Infinity, hi = -Infinity;
      for (const g of c.batcher.flush()) {
        if (g.space !== UiSpace.Screen || g.page !== UiPage.Solid) continue;
        for (let i = 0; i < g.vertexCount * 8; i += 8) {
          lo = Math.min(lo, g.vertices[i]); hi = Math.max(hi, g.vertices[i]);
        }
      }
      return hi - lo;
    };
    expect(span(narrow)).toBeLessThanOrEqual(360);
    expect(span(wide)).toBeGreaterThan(span(narrow));
  });

  it('lays out without overflow on a narrow window', () => {
    const narrow = 420;
    const c = new UiContext();
    c.begin();
    drawTitleScreen(c, narrow, 640, S, view());
    c.end();
    const nb = screenBounds(c.batcher.flush());
    expect(nb.minX).toBeGreaterThanOrEqual(0);
    expect(nb.maxX).toBeLessThanOrEqual(narrow);
  });
});
