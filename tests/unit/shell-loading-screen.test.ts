import { describe, it, expect } from 'vitest';
import { UiContext } from '@/render/ui/ui-context';
import { UiPage, UiSpace, type UiDrawGroup } from '@/render/ui/ui-batcher';
import { drawLoadingScreen, CHRONICLE_ROTATE_MS, type LoadingView } from '@/render/ui/shell/loading-screen';
import { wrapLines, rotationIndex } from '@/render/ui/shell/text-layout';
import { Shell } from '@/render/ui/shell/shell';
import { UI_PALETTE } from '@/render/ui/ui-palette';

const W = 1280, H = 720, S = 2;

function view(over: Partial<LoadingView> = {}): LoadingView {
  return { progress: 0, label: '', chronicle: [], elapsedMs: 0, ...over };
}

function draw(v: LoadingView, w = W, h = H): UiDrawGroup[] {
  const c = new UiContext();
  c.begin();
  drawLoadingScreen(c, w, h, S, v);
  c.end();
  return c.batcher.flush();
}

/** Every screen-space vertex on `page` as [x,y] pairs. Vertex stride is 8 floats
 *  (x,y,u,v,r,g,b,a) — the same reader `ui-runtime.test.ts` uses. */
function verts(groups: UiDrawGroup[], page: UiPage): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const g of groups) {
    if (g.space !== UiSpace.Screen || g.page !== page) continue;
    for (let i = 0; i < g.vertexCount * 8; i += 8) out.push([g.vertices[i], g.vertices[i + 1]]);
  }
  return out;
}
function totalVerts(groups: UiDrawGroup[]): number {
  return groups.reduce((s, g) => s + g.vertexCount, 0);
}
/** Rightmost x of any vertex painted in `color` — the honest way to measure the
 *  progress FILL, which shares its row band with the (full-width) track behind
 *  it, so a y-band filter alone would just report the track's edge every time.
 *  Vertex stride is 8 floats: x,y,u,v,r,g,b,a. */
function maxXOfColor(groups: UiDrawGroup[], color: readonly number[]): number {
  let mx = -Infinity;
  for (const g of groups) {
    if (g.space !== UiSpace.Screen || g.page !== UiPage.Solid) continue;
    for (let i = 0; i < g.vertexCount * 8; i += 8) {
      const same =
        Math.abs(g.vertices[i + 4] - color[0]) < 1e-4 &&
        Math.abs(g.vertices[i + 5] - color[1]) < 1e-4 &&
        Math.abs(g.vertices[i + 6] - color[2]) < 1e-4 &&
        Math.abs(g.vertices[i + 7] - color[3]) < 1e-4;
      if (same) mx = Math.max(mx, g.vertices[i]);
    }
  }
  return mx;
}

describe('drawLoadingScreen — the WebGPU heir to the DOM loading overlay', () => {
  it('paints a full-HEIGHT scrim BAND (not a full-bleed wash) behind the text column, plus the wordmark and the bar', () => {
    // UI v3 sky-transition spike: the animated sky backdrop IS the loading
    // background now — the scrim is a narrow band behind the text column
    // (title-screen.ts's own idiom), not a full-frame wash. It still spans
    // the whole HEIGHT (nothing above/below it to leak an un-scrimmed
    // sliver) but is narrower than the viewport width, and centred.
    const groups = draw(view({ progress: 0.5, label: 'Carving rivers…' }));
    expect(totalVerts(groups)).toBeGreaterThan(0);
    const all = verts(groups, UiPage.Solid);
    const xs = all.map(([x]) => x);
    const ys = all.map(([, y]) => y);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(H);
    expect(Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(W);
    // centred on the viewport's midline
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(W / 2, 0);
  });

  it('every painted vertex stays inside the target (nothing bleeds off-screen)', () => {
    const groups = draw(view({
      progress: 1,
      label: 'A VERY LONG PHASE LABEL THAT WOULD OTHERWISE RUN OFF BOTH EDGES OF THE VIEWPORT ENTIRELY',
      chronicle: ['The river rose in the night and the millers cursed the small god of eaves, who had promised otherwise.'],
      elapsedMs: 0,
    }));
    // Reduced to a BOUNDING BOX and asserted four times rather than once per
    // vertex. The claim is identical — min ≥ 0 and max ≤ edge over every vertex
    // IS "every vertex is inside" — and the failure still names the offending
    // extreme. But a busy screen emits tens of thousands of vertices, and an
    // `expect` object each was enough churn to blow the 5 s timeout on a loaded
    // machine (it did, in a full-suite run). Same reduction
    // `shell-runtime-integration.test.ts` already made for its two cases.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of verts(groups, UiPage.Solid)) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    expect(minX).toBeGreaterThanOrEqual(0);
    expect(minY).toBeGreaterThanOrEqual(0);
    expect(maxX).toBeLessThanOrEqual(W);
    expect(maxY).toBeLessThanOrEqual(H);
  });

  it('the progress fill WIDTH tracks the fraction (measured from the painted pixels)', () => {
    // The fill is the only thing painted in the accent, so its rightmost accent
    // vertex IS its width — measured, not inferred from the drawer's arithmetic.
    const accent = UI_PALETTE.accent;
    const quarter = maxXOfColor(draw(view({ progress: 0.25 })), accent);
    const half = maxXOfColor(draw(view({ progress: 0.5 })), accent);
    const full = maxXOfColor(draw(view({ progress: 1 })), accent);
    expect(quarter).toBeLessThan(half);
    expect(half).toBeLessThan(full);
    // a full bar reaches exactly the track's right edge
    const trackW = Math.round(Math.min(340 * S, W * 0.6));
    const trackX = Math.round(W / 2 - trackW / 2);
    expect(full).toBe(trackX + trackW);
    // and the quarter bar is a quarter of the way across it
    expect(quarter - trackX).toBe(Math.round(trackW * 0.25));
  });

  it('clamps an out-of-range fraction instead of overflowing the track', () => {
    const accent = UI_PALETTE.accent;
    const over = maxXOfColor(draw(view({ progress: 4.2 })), accent);
    const full = maxXOfColor(draw(view({ progress: 1 })), accent);
    expect(over).toBe(full);
    // a negative fraction paints no fill at all
    expect(maxXOfColor(draw(view({ progress: -1 })), accent)).toBe(-Infinity);
  });

  it('a tiny non-zero fraction still paints at least one pixel column', () => {
    // A bar that reads as empty at 0.2% looks like a hung boot.
    const a = totalVerts(draw(view({ progress: 0 })));
    const b = totalVerts(draw(view({ progress: 0.002 })));
    expect(b).toBeGreaterThan(a);
  });

  it('draws no chronicle block on a fresh world, and one on a restored world', () => {
    const fresh = totalVerts(draw(view({ progress: 0.5, label: 'X' })));
    const restored = totalVerts(draw(view({
      progress: 0.5, label: 'X', chronicle: ['THE FIRST YEAR PASSED QUIETLY'],
    })));
    expect(restored).toBeGreaterThan(fresh);
  });

  it('rotates through chronicle excerpts on the frame clock, with no timers', () => {
    const texts = ['ALPHA ALPHA', 'BETA BETA', 'GAMMA GAMMA'];
    // Starts on the LAST (most recent) annal, matching the DOM loader.
    expect(rotationIndex(texts.length, 0, CHRONICLE_ROTATE_MS)).toBe(2);
    expect(rotationIndex(texts.length, CHRONICLE_ROTATE_MS, CHRONICLE_ROTATE_MS)).toBe(0);
    expect(rotationIndex(texts.length, 2 * CHRONICLE_ROTATE_MS, CHRONICLE_ROTATE_MS)).toBe(1);
    expect(rotationIndex(texts.length, 3 * CHRONICLE_ROTATE_MS, CHRONICLE_ROTATE_MS)).toBe(2);
    // a single excerpt never rotates; zero excerpts is safe
    expect(rotationIndex(1, 99 * CHRONICLE_ROTATE_MS, CHRONICLE_ROTATE_MS)).toBe(0);
    expect(rotationIndex(0, 5, CHRONICLE_ROTATE_MS)).toBe(0);
    // and the DRAWN geometry actually differs between two rotation steps
    const a = draw(view({ chronicle: texts, elapsedMs: 0 }));
    const b = draw(view({ chronicle: texts, elapsedMs: CHRONICLE_ROTATE_MS }));
    expect(totalVerts(a)).not.toBe(totalVerts(b));
  });

  it('drops the chronicle block rather than overflowing a short window', () => {
    const tall = totalVerts(draw(view({ chronicle: ['SOME REMEMBERED THING'] }), W, 720));
    const short = totalVerts(draw(view({ chronicle: ['SOME REMEMBERED THING'] }), W, 260));
    // the short window paints strictly less (the excerpt was dropped, not clipped)
    expect(short).toBeLessThan(tall);
    for (const [, y] of verts(draw(view({ chronicle: ['SOME REMEMBERED THING'] }), W, 260), UiPage.Solid)) {
      expect(y).toBeLessThanOrEqual(260);
    }
  });

  it('is pure CPU — no DOM and no WebGPU touched', () => {
    // drawing must not require a document at all: proven by the fact that every
    // assertion above ran without one being consulted, plus no exception here.
    expect(() => draw(view({ progress: 0.3, label: 'OK' }))).not.toThrow();
  });
});

describe('wrapLines', () => {
  const measure = (t: string, sc: number): number => t.length * 6 * sc;

  it('wraps greedily to the width and collapses whitespace', () => {
    const lines = wrapLines('AAA BBB CCC DDD', 6 * 1 * 7, 1, measure);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measure(l, 1)).toBeLessThanOrEqual(6 * 7);
    expect(lines.join(' ')).toBe('AAA BBB CCC DDD');
  });

  it('returns an empty array for empty or whitespace-only input', () => {
    expect(wrapLines('', 100, 1, measure)).toEqual([]);
    expect(wrapLines('   \n  ', 100, 1, measure)).toEqual([]);
  });

  it('does not break a single over-long word mid-word', () => {
    const lines = wrapLines('SUPERCALIFRAGILISTIC', 12, 1, measure);
    expect(lines).toEqual(['SUPERCALIFRAGILISTIC']);
  });
});

describe('Shell — the stateful glue', () => {
  it('show() REPLACES the title rather than stacking over it', () => {
    // Once generation starts there is nothing to go back to, so the title must
    // not survive underneath the loading screen.
    const shell = new Shell({ now: () => 0 });
    shell.push('title');
    shell.show();
    expect(shell.top()).toBe('loading');
    expect(shell.depth()).toBe(1);
    expect(shell.has('title')).toBe(false);
  });

  it('hide() lands on the in-game HUD', () => {
    const shell = new Shell({ now: () => 0 });
    shell.show();
    shell.hide();
    expect(shell.top()).toBeNull();
    expect(shell.isActive()).toBe(false);
  });

  it('setProgress clamps and requests exactly one render per change', () => {
    let renders = 0;
    const shell = new Shell({ requestRender: () => { renders++; }, now: () => 0 });
    shell.setProgress(-3, 'A');
    expect(shell.loadingView().progress).toBe(0);
    shell.setProgress(9);
    expect(shell.loadingView().progress).toBe(1);
    // the label survives a progress-only update
    expect(shell.loadingView().label).toBe('A');
    expect(renders).toBe(2);
  });

  it('does not kick a render for a no-op stack change', () => {
    let renders = 0;
    const shell = new Shell({ requestRender: () => { renders++; }, now: () => 0 });
    shell.push('pause');
    expect(renders).toBe(1);
    shell.push('pause');   // already on top → no-op
    expect(renders).toBe(1);
    shell.pop();
    expect(renders).toBe(2);
    shell.pop();           // empty → no-op
    expect(renders).toBe(2);
  });

  it('anchors the chronicle rotation to when the excerpts arrived', () => {
    let t = 1000;
    const shell = new Shell({ now: () => t });
    shell.show();
    t = 5000;
    shell.setChronicle(['A', 'B']);   // re-anchors at t=5000
    t = 5000 + CHRONICLE_ROTATE_MS;
    expect(shell.loadingView().elapsedMs).toBe(CHRONICLE_ROTATE_MS);
  });

  it('draw() paints nothing and triggers nothing when the stack is empty', () => {
    const shell = new Shell({ now: () => 0 });
    const c = new UiContext();
    c.begin();
    expect(shell.draw(c, W, H, S)).toEqual({
      island: null, title: null, save: null, load: null, settings: null, gameover: null,
      newgame: null, hall: null,
    });
    c.end();
    expect(totalVerts(c.batcher.flush())).toBe(0);
  });

  it('describe() reports the shell state without drawing (the agent surface)', () => {
    const shell = new Shell({ now: () => 0 });
    expect(shell.describe()).toEqual({
      screen: null, stack: [], choices: [], progress: 0, label: '',
    });
    shell.show();
    shell.setProgress(0.42, 'CARVING RIVERS…');
    const d = shell.describe();
    expect(d.screen).toBe('loading');
    expect(d.stack).toEqual(['loading']);
    expect(d.progress).toBeCloseTo(0.42);
    expect(d.label).toBe('CARVING RIVERS…');
    // a loading screen offers no choices
    expect(d.choices).toEqual([]);
  });

  it('describe() enumerates the TITLE screen choices, reasons included', () => {
    // This is what lets a headless agent navigate the menu with no screenshot:
    // it must be able to read that CONTINUE exists, is refused, and WHY.
    const shell = new Shell({
      now: () => 0,
      titleView: () => ({
        continueLine: null,
        continueBlocked: { reason: 'stale-world', text: 'Saved under an older world (117)' },
        hasAnySave: false,
        buildLine: 'BUILD 118',
      }),
    });
    shell.push('title');
    const d = shell.describe();
    expect(d.screen).toBe('title');
    const byId = new Map(d.choices.map(ch => [ch.id, ch]));
    expect(byId.get('title.continue')).toEqual({
      id: 'title.continue', label: 'CONTINUE', enabled: false,
      note: 'Saved under an older world (117)',
    });
    expect(byId.get('title.new')!.enabled).toBe(true);
    expect(byId.get('title.load')!.enabled).toBe(false);
    expect(byId.get('title.demo')!.enabled).toBe(true);
  });

  it('describe() choices match what the DRAW path actually offers', () => {
    // The anti-drift guarantee: choices are derived from the same `titleRows` the
    // renderer walks, so an agent can never be told about a button that is not
    // really there (or miss one that is).
    const titleView = () => ({
      continueLine: 'DAY 3', continueBlocked: null, hasAnySave: true, buildLine: 'B',
    });
    const shell = new Shell({ now: () => 0, titleView });
    shell.push('title');
    const c = new UiContext();
    c.begin();
    shell.draw(c, W, H, S);
    const { hits } = c.end();
    const drawnIds = hits.filter(hh => hh.id.startsWith('title.')).map(hh => hh.id).sort();
    const describedIds = shell.describe().choices.map(ch => ch.id).sort();
    expect(describedIds).toEqual(drawnIds);
  });

  it('draw() reports the title action the player triggered', () => {
    const titleView = () => ({
      continueLine: 'DAY 3', continueBlocked: null, hasAnySave: true, buildLine: 'B',
    });
    const shell = new Shell({ now: () => 0, titleView });
    shell.push('title');
    // locate NEW WORLD, then click it
    const probe = new UiContext();
    probe.begin();
    shell.draw(probe, W, H, S);
    const row = probe.end().hits.find(hh => hh.id === 'title.new')!;
    const c = new UiContext();
    c.begin({ px: row.x + row.w / 2, py: row.y + row.h / 2, down: true, released: false });
    shell.draw(c, W, H, S);
    c.end();
    c.begin({ px: row.x + row.w / 2, py: row.y + row.h / 2, down: false, released: true });
    const result = shell.draw(c, W, H, S);
    c.end();
    expect(result.title).toEqual({ kind: 'new_world' });
  });

  it('the title screen falls back to an HONEST empty state with no view provider', () => {
    // Never fabricate "you have a save" when nothing supplied the probe results.
    const shell = new Shell({ now: () => 0 });
    shell.push('title');
    const byId = new Map(shell.describe().choices.map(ch => [ch.id, ch]));
    expect(byId.get('title.continue')!.enabled).toBe(false);
    expect(byId.get('title.load')!.enabled).toBe(false);
    expect(byId.get('title.new')!.enabled).toBe(true);
  });

  it('draw() paints the loading screen when it is on top', () => {
    const shell = new Shell({ now: () => 0 });
    shell.show();
    shell.setProgress(0.4, 'PEOPLING THE WORLD…');
    const c = new UiContext();
    c.begin();
    shell.draw(c, W, H, S);
    c.end();
    expect(totalVerts(c.batcher.flush())).toBeGreaterThan(0);
  });
});

// ── P5b: game-over / photo / new-world through the Shell ────────────────────

describe('Shell — the P5b screens', () => {
  it('describe() enumerates the GAME-OVER choices, matching what draw() offers', () => {
    const shell = new Shell({ now: () => 0 });
    shell.push('gameover');
    const d = shell.describe();
    expect(d.screen).toBe('gameover');
    expect(d.choices.map(ch => ch.id)).toEqual(['gameover.keep_watching', 'gameover.begin_again']);
    expect(d.choices.every(ch => ch.enabled)).toBe(true);

    const c = new UiContext();
    c.begin();
    shell.draw(c, W, H, S);
    const drawnIds = c.end().hits.filter(hh => hh.id.startsWith('gameover.')).map(hh => hh.id).sort();
    expect(d.choices.map(ch => ch.id).sort()).toEqual(drawnIds);
  });

  it('draw() reports the gameover action the player triggered', () => {
    const shell = new Shell({ now: () => 0 });
    shell.push('gameover');
    const probe = new UiContext();
    probe.begin();
    shell.draw(probe, W, H, S);
    const row = probe.end().hits.find(hh => hh.id === 'gameover.begin_again')!;
    const c = new UiContext();
    c.begin({ px: row.x + row.w / 2, py: row.y + row.h / 2, down: true, released: false });
    shell.draw(c, W, H, S);
    c.end();
    c.begin({ px: row.x + row.w / 2, py: row.y + row.h / 2, down: false, released: true });
    const result = shell.draw(c, W, H, S);
    c.end();
    expect(result.gameover).toEqual({ kind: 'begin_again' });
  });

  it('PHOTO mode draws chrome-free and describes NO choices', () => {
    const shell = new Shell({ now: () => 0, photoView: () => ({ hintText: 'PHOTO SAVED', alpha: 1 }) });
    shell.push('photo');
    expect(shell.describe().choices).toEqual([]);
    const c = new UiContext();
    c.begin();
    const result = shell.draw(c, W, H, S);
    const { hits } = c.end();
    expect(hits).toEqual([]); // nothing clickable
    expect(result).toEqual({
      island: null, title: null, save: null, load: null, settings: null, gameover: null,
      newgame: null, hall: null,
    });
  });

  it('NEW WORLD reserves the paste-code island EVERY frame it is up, action or not', () => {
    const shell = new Shell({ now: () => 0 });
    shell.push('newgame');
    const d = shell.describe();
    expect(d.screen).toBe('newgame');
    expect(d.choices.map(ch => ch.id)).toEqual(['newgame.random', 'newgame.back']);

    const c = new UiContext();
    c.begin();
    const result = shell.draw(c, W, H, S);
    c.end();
    expect(result.island).not.toBeNull();
    expect(result.island!.w).toBeGreaterThan(0);
    expect(result.newgame).toBeNull(); // nothing clicked this frame
  });

  it('draw() reports the RANDOM WORLD action the player triggered', () => {
    const shell = new Shell({ now: () => 0 });
    shell.push('newgame');
    const probe = new UiContext();
    probe.begin();
    shell.draw(probe, W, H, S);
    const row = probe.end().hits.find(hh => hh.id === 'newgame.random')!;
    const c = new UiContext();
    c.begin({ px: row.x + row.w / 2, py: row.y + row.h / 2, down: true, released: false });
    shell.draw(c, W, H, S);
    c.end();
    c.begin({ px: row.x + row.w / 2, py: row.y + row.h / 2, down: false, released: true });
    const result = shell.draw(c, W, H, S);
    c.end();
    expect(result.newgame).toEqual({ kind: 'random' });
  });
});
