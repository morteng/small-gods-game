import { describe, it, expect } from 'vitest';
import { UiContext, type UiHit } from '@/render/ui/ui-context';
import { UiPage, UiSpace, type UiDrawGroup } from '@/render/ui/ui-batcher';
import { shellTypeScaleFor } from '@/render/ui/ui-tokens';
import {
  drawHallScreen, hallRows,
  type HallAction, type HallNodeView, type HallPedestalView, type HallView,
} from '@/render/ui/shell/hall-screen';

const W = 1280, H = 720, S = 2;

function nodes(reached: readonly [boolean, boolean, boolean]): HallNodeView[] {
  return [
    { tier: 'claim', label: 'CLAIM', reached: reached[0], hint: 'THE DOMAIN IS HEARD' },
    { tier: 'command', label: 'COMMAND', reached: reached[1], hint: 'YOU MAY ACT IN IT' },
    { tier: 'doctrine', label: 'DOCTRINE', reached: reached[2], hint: 'BELIEF SUSTAINS ITSELF' },
  ];
}

function pedestal(over: Partial<HallPedestalView> = {}): HallPedestalView {
  return {
    domain: 'storm',
    label: 'Storm',
    blurb: 'Thunder over the fields, and the sense that someone meant it.',
    verb: 'call_storm',
    conviction: 0.7,
    threshold: 0.5,
    materialize: 1,
    tier: 'command',
    unlocked: true,
    reachLine: 'BELIEVED BY 12 — REACH 5',
    dimensions: { faith: 0.6, understanding: 0.4, devotion: 0.5 },
    nextHint: 'DEVOTION MUST DEEPEN BEFORE THIS BELIEF SUSTAINS ITSELF',
    nodes: nodes([true, true, false]),
    castBlocked: null,
    ...over,
  };
}

const HARVEST = pedestal({
  domain: 'harvest',
  label: 'Harvest',
  blurb: 'Grain that comes in heavier than the season deserved.',
  verb: 'bless_harvest',
  conviction: 0.2,
  threshold: 0.5,
  materialize: 0.4,
  tier: 'dormant',
  unlocked: false,
  reachLine: 'BELIEVED BY 3 — REACH 1',
  dimensions: { faith: 0.2, understanding: 0.1, devotion: 0.15 },
  nextHint: 'MORE MUST BELIEVE BEFORE THIS DOMAIN ANSWERS',
  nodes: nodes([false, false, false]),
  castBlocked: 'NOT YET BELIEVED',
});

function view(over: Partial<HallView> = {}): HallView {
  return {
    spirit: {
      name: 'The Small God',
      tierLine: 'A SMALL GOD',
      massLine: 'BELIEF ENOUGH FOR A HAMLET',
      intimacyLine: 'THEY KNOW YOUR NAME',
      intimacy: 0.45,
      faded: false,
      fadedLine: null,
    },
    pedestals: [pedestal(), HARVEST],
    emptyLine: null,
    ...over,
  };
}

function frame(
  v: HallView, selected: string | null = null,
  w = W, h = H, s = S,
): { action: HallAction | null; hits: readonly UiHit[]; groups: UiDrawGroup[] } {
  const c = new UiContext();
  c.begin();
  const action = drawHallScreen(c, w, h, s, v, selected);
  const { hits } = c.end();
  return { action, hits, groups: c.batcher.flush() };
}

function clickAt(v: HallView, x: number, y: number, selected: string | null = null): HallAction | null {
  const c = new UiContext();
  c.begin({ px: x, py: y, down: true, released: false });
  drawHallScreen(c, W, H, S, v, selected);
  c.end();
  c.begin({ px: x, py: y, down: false, released: true });
  const action = drawHallScreen(c, W, H, S, v, selected);
  c.end();
  return action;
}

/** Every non-blank text run the screen drew — the honest way to assert that a
 *  particular line made it onto the screen (a vertex count cannot tell WHICH
 *  content it counted). */
function labelsDrawn(v: HallView, selected: string | null, w = W, h = H, s = S): string[] {
  const c = new UiContext();
  const seen: string[] = [];
  const realLabel = c.label.bind(c);
  c.label = (text: string, x: number, y: number, scale = 1, ...rest: never[]): void => {
    if (text.trim()) seen.push(text);
    (realLabel as unknown as (...a: unknown[]) => void)(text, x, y, scale, ...rest);
  };
  c.begin();
  drawHallScreen(c, w, h, s, v, selected);
  c.end();
  return seen;
}

function hit(hits: readonly UiHit[], id: string): UiHit {
  const found = hits.find((hh) => hh.id === id);
  expect(found, `no hit region for ${id}`).toBeDefined();
  return found!;
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

function rectsOverlap(a: UiHit, b: UiHit): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('hall screen — rows', () => {
  it('offers SELECT + CAST per pedestal, then BACK', () => {
    expect(hallRows(view()).map((r) => r.id)).toEqual([
      'hall.select.storm', 'hall.cast.storm',
      'hall.select.harvest', 'hall.cast.harvest',
      'hall.back',
    ]);
  });

  it('CAST carries the pedestal VERB, SELECT the domain', () => {
    const rows = hallRows(view());
    expect(rows.find((r) => r.id === 'hall.cast.storm')!.action).toEqual({ kind: 'cast', verb: 'call_storm' });
    expect(rows.find((r) => r.id === 'hall.select.harvest')!.action).toEqual({ kind: 'select', domain: 'harvest' });
    expect(rows.find((r) => r.id === 'hall.back')!.action).toEqual({ kind: 'back' });
  });

  it('a locked pedestal disables CAST and reports its reason', () => {
    const rows = hallRows(view());
    const storm = rows.find((r) => r.id === 'hall.cast.storm')!;
    const harvest = rows.find((r) => r.id === 'hall.cast.harvest')!;
    expect(storm.enabled).toBe(true);
    expect(storm.reason).toBeNull();
    expect(harvest.enabled).toBe(false);
    expect(harvest.reason).toBe('NOT YET BELIEVED');
  });

  it('a FADED god disables EVERY cast with the canon line (tenet 6)', () => {
    const v = view({
      spirit: { ...view().spirit, faded: true, fadedLine: 'ONLY WHISPERS REMAIN' },
    });
    const casts = hallRows(v).filter((r) => r.id.startsWith('hall.cast.'));
    expect(casts).toHaveLength(2);
    for (const row of casts) {
      expect(row.enabled, `${row.id} still castable while faded`).toBe(false);
      expect(row.reason).toBe('ONLY WHISPERS REMAIN');
    }
    // SELECT stays open — reading the hall is never refused.
    for (const row of hallRows(v).filter((r) => r.id.startsWith('hall.select.'))) {
      expect(row.enabled).toBe(true);
    }
  });

  it('falls back to the canon line when the host reports faded with no prose', () => {
    const v = view({ spirit: { ...view().spirit, faded: true, fadedLine: null } });
    expect(hallRows(v).find((r) => r.id === 'hall.cast.storm')!.reason).toBe('ONLY WHISPERS REMAIN');
  });

  it('an empty hall offers only BACK', () => {
    expect(hallRows(view({ pedestals: [], emptyLine: 'NO ONE BELIEVES IN YOU YET' })).map((r) => r.id))
      .toEqual(['hall.back']);
  });

  it('rows are a function of the VIEW ALONE — selection changes no hit id', () => {
    const none = frame(view()).hits.map((hh) => hh.id).sort();
    const storm = frame(view(), 'storm').hits.map((hh) => hh.id).sort();
    const harvest = frame(view(), 'harvest').hits.map((hh) => hh.id).sort();
    expect(storm).toEqual(none);
    expect(harvest).toEqual(none);
  });
});

describe('hall screen — geometry and input', () => {
  it('paints inside the target and registers every row it drew', () => {
    const { groups, hits } = frame(view());
    expect(groups.length).toBeGreaterThan(0);
    const b = screenBounds(groups);
    expect(b.minX).toBeGreaterThanOrEqual(0);
    expect(b.maxX).toBeLessThanOrEqual(W);
    expect(b.minY).toBeGreaterThanOrEqual(0);
    expect(b.maxY).toBeLessThanOrEqual(H);

    const ids = hits.map((hh) => hh.id);
    for (const id of ['hall.select.storm', 'hall.cast.storm', 'hall.select.harvest', 'hall.cast.harvest', 'hall.back']) {
      expect(ids, `${id} missing`).toContain(id);
    }
  });

  it('no two hit regions overlap (a click can only ever mean one thing)', () => {
    const { hits } = frame(view(), 'storm');
    for (let i = 0; i < hits.length; i++) {
      for (let j = i + 1; j < hits.length; j++) {
        expect(
          rectsOverlap(hits[i], hits[j]),
          `${hits[i].id} overlaps ${hits[j].id}`,
        ).toBe(false);
      }
    }
  });

  it('a click on a pedestal SELECTS it', () => {
    const { hits } = frame(view());
    const r = hit(hits, 'hall.select.harvest');
    expect(clickAt(view(), r.x + r.w / 2, r.y + r.h / 2)).toEqual({ kind: 'select', domain: 'harvest' });
  });

  it('a click on an unlocked CAST arms its verb', () => {
    const { hits } = frame(view());
    const r = hit(hits, 'hall.cast.storm');
    expect(clickAt(view(), r.x + r.w / 2, r.y + r.h / 2)).toEqual({ kind: 'cast', verb: 'call_storm' });
  });

  it('a click on a BLOCKED cast fires nothing (the guard is in the handler)', () => {
    const { hits } = frame(view());
    const r = hit(hits, 'hall.cast.harvest');
    expect(clickAt(view(), r.x + r.w / 2, r.y + r.h / 2)).toBeNull();
  });

  it('a click on a FADED god’s cast fires nothing', () => {
    const v = view({ spirit: { ...view().spirit, faded: true, fadedLine: 'ONLY WHISPERS REMAIN' } });
    const { hits } = frame(v);
    const r = hit(hits, 'hall.cast.storm');
    expect(clickAt(v, r.x + r.w / 2, r.y + r.h / 2)).toBeNull();
  });

  it('a click on BACK closes the hall', () => {
    const { hits } = frame(view());
    const r = hit(hits, 'hall.back');
    expect(clickAt(view(), r.x + r.w / 2, r.y + r.h / 2)).toEqual({ kind: 'back' });
  });

  it('a keyboard ACTIVATE fires the focused row', () => {
    const c = new UiContext();
    c.begin();
    drawHallScreen(c, W, H, S, view(), null);
    c.end();
    c.focusNext();
    expect(c.focusId).toBe('hall.select.storm');
    c.activate();
    c.begin();
    const action = drawHallScreen(c, W, H, S, view(), null);
    c.end();
    expect(action).toEqual({ kind: 'select', domain: 'storm' });
  });

  it('a keyboard ACTIVATE cannot fire a DISABLED cast', () => {
    const c = new UiContext();
    c.begin();
    drawHallScreen(c, W, H, S, view(), null);
    c.end();
    // A disabled button never joins the focus ring, so focus can't even land on
    // it — but force it there anyway: the handler guard, not the ring, is what
    // this asserts.
    c.setFocus('hall.cast.harvest');
    c.activate();
    c.begin();
    const action = drawHallScreen(c, W, H, S, view(), null);
    c.end();
    expect(action).toBeNull();
  });

  it('BACK stays reachable and nothing spills out on a cramped viewport', () => {
    for (const [w, h] of [[1280, 720], [1920, 1080], [900, 600], [420, 640], [360, 300], [320, 200]] as const) {
      const { hits, groups } = frame(view(), 'storm', w, h);
      expect(hits.map((hh) => hh.id), `BACK missing at ${w}x${h}`).toContain('hall.back');
      for (const r of hits) {
        expect(r.x, `${r.id} left edge at ${w}x${h}`).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w, `${r.id} right edge at ${w}x${h}`).toBeLessThanOrEqual(w);
        expect(r.y, `${r.id} top edge at ${w}x${h}`).toBeGreaterThanOrEqual(0);
        expect(r.y + r.h, `${r.id} bottom edge at ${w}x${h}`).toBeLessThanOrEqual(h);
      }
      const b = screenBounds(groups);
      expect(b.minX, `x underflow at ${w}x${h}`).toBeGreaterThanOrEqual(0);
      expect(b.maxX, `x overflow at ${w}x${h}`).toBeLessThanOrEqual(w);
      expect(b.minY, `y underflow at ${w}x${h}`).toBeGreaterThanOrEqual(0);
      expect(b.maxY, `y overflow at ${w}x${h}`).toBeLessThanOrEqual(h);
    }
  });

  it('the pedestals still draw at a comfortable viewport (the screen is not all chrome)', () => {
    for (const [w, h] of [[1280, 720], [1920, 1080], [1024, 768]] as const) {
      const { hits } = frame(view(), 'storm', w, h);
      const ped = hits.filter((hh) => hh.id.startsWith('hall.select.'));
      expect(ped.map((p) => p.id).sort(), `pedestals missing at ${w}x${h}`)
        .toEqual(['hall.select.harvest', 'hall.select.storm']);
    }
  });

  it('the empty hall still stands: no pedestal rows, geometry drawn, BACK offered', () => {
    const v = view({ pedestals: [], emptyLine: 'NO ONE BELIEVES IN YOU YET' });
    const { hits, groups } = frame(v);
    expect(hits.map((hh) => hh.id)).toEqual(['hall.back']);
    // The hazy niches + the caption are real geometry — an empty view must not
    // produce a blank screen.
    expect(groups.reduce((sum, g) => sum + g.vertexCount, 0)).toBeGreaterThan(0);
    const b = screenBounds(groups);
    expect(b.minX).toBeGreaterThanOrEqual(0);
    expect(b.maxX).toBeLessThanOrEqual(W);
    expect(b.minY).toBeGreaterThanOrEqual(0);
    expect(b.maxY).toBeLessThanOrEqual(H);
  });

  it('the selected pedestal adds a detail pane — same rows, its numbers shown', () => {
    // The pane's NUMBERS are what selecting is for: reach, the three dimension
    // bars and the next-node hint. Asserted by the text actually drawn (a
    // vertex-count proxy is not sound here — the degradation ladder can trade
    // the header away to make room for the pane, drawing FEWER quads overall).
    const plain = labelsDrawn(view(), null, 1920, 1080);
    const selected = labelsDrawn(view(), 'storm', 1920, 1080);
    expect(plain).not.toContain('BELIEVED BY 12 — REACH 5');
    expect(selected).toContain('BELIEVED BY 12 — REACH 5');
    for (const dim of ['FAITH', 'UNDERSTANDING', 'DEVOTION']) {
      expect(selected, `dimension bar ${dim} missing`).toContain(dim);
    }
    expect(selected.some((t) => t.startsWith('DEVOTION MUST DEEPEN'))).toBe(true);
    expect(frame(view(), 'storm', 1920, 1080).hits.map((hh) => hh.id).sort())
      .toEqual(frame(view(), null, 1920, 1080).hits.map((hh) => hh.id).sort());
  });

  it('a cramped viewport keeps the pane’s NUMBERS, trading the header away', () => {
    // The degradation ladder's middle rung: the flavour blurb and the header go
    // before the numbers do.
    const drawn = labelsDrawn(view(), 'storm', 1280, 740);
    expect(drawn).toContain('BELIEVED BY 12 — REACH 5');
    expect(drawn).toContain('DEVOTION');
    expect(drawn).not.toContain('HALL OF THE GODS');
    expect(drawn.some((t) => t.startsWith('THUNDER OVER THE FIELDS'))).toBe(false);
  });

  it('an unknown selected domain is ignored, not crashed on', () => {
    const { hits } = frame(view(), 'no-such-domain');
    expect(hits.map((hh) => hh.id)).toContain('hall.back');
  });

  it('no text renders below the caption floor, and rows use the menu tier', () => {
    const T = shellTypeScaleFor(W, S);
    const c = new UiContext();
    const scales: number[] = [];
    const realLabel = c.label.bind(c);
    c.label = (text: string, x: number, y: number, scale = 1, ...rest: never[]): void => {
      if (text.trim()) scales.push(scale);
      (realLabel as unknown as (...a: unknown[]) => void)(text, x, y, scale, ...rest);
    };
    c.begin();
    drawHallScreen(c, W, H, S, view(), 'storm');
    c.end();
    expect(scales.length).toBeGreaterThan(0);
    expect(Math.min(...scales)).toBeGreaterThanOrEqual(T.caption);
    expect(scales).toContain(T.menu);
  });
});

describe('hall screen — many pedestals scroll, never shrink', () => {
  const MANY = Array.from({ length: 9 }, (_, i) => pedestal({
    domain: `domain${i}`,
    label: `Domain ${i}`,
    verb: `verb_${i}`,
  }));

  it('overflow registers a scroll region instead of drawing every column', () => {
    const c = new UiContext();
    c.begin();
    drawHallScreen(c, W, H, S, view({ pedestals: MANY }), null);
    const { hits, scrollRegions } = c.end();
    expect(scrollRegions.some((r) => r.id === 'hall.pedestals')).toBe(true);
    const drawn = hits.filter((hh) => hh.id.startsWith('hall.select.'));
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThan(MANY.length);
  });

  it('every pedestal row hallRows promises is reachable by scrolling', () => {
    // `describe()` enumerates the FULL row set (an agent must be able to
    // discover every domain); the draw path only registers what the grid
    // currently shows. Union the hits across every plausible scroll offset —
    // the settings-CONTROLS test shape.
    const c = new UiContext();
    const seen = new Set<string>();
    for (let offset = 0; offset < MANY.length; offset++) {
      c.begin();
      if (offset > 0) c.scrollBy('hall.pedestals', 1);
      drawHallScreen(c, W, H, S, view({ pedestals: MANY }), null);
      const { hits } = c.end();
      for (const hh of hits) if (hh.id.startsWith('hall.')) seen.add(hh.id);
    }
    const promised = new Set(hallRows(view({ pedestals: MANY })).map((r) => r.id));
    expect(seen).toEqual(promised);
  });

  it('nothing spills out of the target with a full grid', () => {
    for (const [w, h] of [[1280, 720], [1920, 1080], [640, 480]] as const) {
      const { groups, hits } = frame(view({ pedestals: MANY }), 'domain3', w, h);
      const b = screenBounds(groups);
      expect(b.minX, `x underflow at ${w}x${h}`).toBeGreaterThanOrEqual(0);
      expect(b.maxX, `x overflow at ${w}x${h}`).toBeLessThanOrEqual(w);
      expect(b.minY, `y underflow at ${w}x${h}`).toBeGreaterThanOrEqual(0);
      expect(b.maxY, `y overflow at ${w}x${h}`).toBeLessThanOrEqual(h);
      for (const r of hits) {
        expect(r.x + r.w, `${r.id} right edge at ${w}x${h}`).toBeLessThanOrEqual(w);
        expect(r.y + r.h, `${r.id} bottom edge at ${w}x${h}`).toBeLessThanOrEqual(h);
      }
    }
  });
});
