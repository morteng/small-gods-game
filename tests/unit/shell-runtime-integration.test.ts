import { describe, it, expect, vi } from 'vitest';
import { UiRuntime } from '@/render/ui/ui-runtime';
import { UiPage, UiSpace, type UiDrawGroup } from '@/render/ui/ui-batcher';
import { Shell, EMPTY_HALL_VIEW } from '@/render/ui/shell/shell';
import type { TitleView } from '@/render/ui/shell/title-screen';
import { hallRows, type HallView } from '@/render/ui/shell/hall-screen';

const W = 1280, H = 720, DPR = 2;

function totalVerts(groups: UiDrawGroup[]): number {
  return groups.reduce((s, g) => s + g.vertexCount, 0);
}

/**
 * Assert every screen-space vertex lands inside the target.
 *
 * Reduced to a BOUNDING BOX and asserted four times, not once per vertex: a
 * busy screen emits tens of thousands of vertices, and an `expect` each is
 * enough assertion-object churn to blow the 5 s test timeout on a loaded
 * machine (it did — the title case was already sitting at ~4.5 s before the
 * hall's cases were added to this file). The failure message is just as
 * specific, since it reports the offending extreme.
 */
function expectInsideTarget(groups: UiDrawGroup[], w: number, h: number): void {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const g of groups) {
    if (g.space !== UiSpace.Screen || g.page !== UiPage.Solid) continue;
    for (let i = 0; i < g.vertexCount * 8; i += 8) {
      minX = Math.min(minX, g.vertices[i]);
      maxX = Math.max(maxX, g.vertices[i]);
      minY = Math.min(minY, g.vertices[i + 1]);
      maxY = Math.max(maxY, g.vertices[i + 1]);
    }
  }
  expect(minX).toBeGreaterThanOrEqual(0);
  expect(maxX).toBeLessThanOrEqual(w);
  expect(minY).toBeGreaterThanOrEqual(0);
  expect(maxY).toBeLessThanOrEqual(h);
}

const TITLE: TitleView = {
  continueLine: 'DAY 3', continueBlocked: null, hasAnySave: true, buildLine: 'W 119',
};

function runtimeWithShell(): { rt: UiRuntime; shell: Shell } {
  const shell = new Shell({ now: () => 0, titleView: () => TITLE });
  const rt = new UiRuntime();
  rt.setShell(shell);
  return { rt, shell };
}

describe('UiRuntime × Shell — a screen owns the frame', () => {
  it('with an EMPTY stack the runtime still draws the ordinary HUD', () => {
    // The shell being attached must change nothing until a screen is pushed —
    // that is what keeps every pre-existing surface and test unaffected.
    const { rt } = runtimeWithShell();
    rt.configure({ getPower: () => 0.5 });
    const withShell = totalVerts(rt.frame(W, H, DPR));

    const plain = new UiRuntime();
    plain.configure({ getPower: () => 0.5 });
    expect(withShell).toBe(totalVerts(plain.frame(W, H, DPR)));
  });

  it('a pushed screen draws INSTEAD of the HUD', () => {
    const { rt, shell } = runtimeWithShell();
    rt.configure({ getPower: () => 0.5 });
    const hudGroups = rt.frame(W, H, DPR);
    shell.push('title');
    const titleGroups = rt.frame(W, H, DPR);
    expect(totalVerts(titleGroups)).toBeGreaterThan(0);
    expect(totalVerts(titleGroups)).not.toBe(totalVerts(hudGroups));
    // the HUD's orb hotspot is gone — the title screen's rows are what is hit-tested
    const ids = rt.hitRegions().map(h => h.id);
    expect(ids).not.toContain('ui.orb');
    expect(ids).toContain('title.new');
  });

  it('a screen swallows pointer events ANYWHERE on the surface', () => {
    // In meta mode there is no world underneath to click at all, so the screen
    // must consume unconditionally — not merely over its own widgets.
    const { rt, shell } = runtimeWithShell();
    rt.frame(W, H, DPR);
    expect(rt.consumesPointer(5, 5)).toBe(false); // HUD: only its own widgets
    shell.push('title');
    rt.frame(W, H, DPR);
    expect(rt.consumesPointer(5, 5)).toBe(true);
    expect(rt.consumesPointer(W - 2, H - 2)).toBe(true);
  });

  it('the loading screen also owns the frame, and offers no choices', () => {
    const { rt, shell } = runtimeWithShell();
    shell.show();
    shell.setProgress(0.5, 'CARVING RIVERS…');
    const groups = rt.frame(W, H, DPR);
    expect(totalVerts(groups)).toBeGreaterThan(0);
    expect(rt.hitRegions().map(h => h.id)).not.toContain('title.new');
    expect(shell.describe().choices).toEqual([]);
  });

  it('a title choice reaches the host through onTitleAction (never a direct call)', () => {
    // The runtime reports; the host translates to a meta command. That indirection
    // is what makes a player's click and an agent's emit_command the same path.
    const onTitleAction = vi.fn();
    const { rt, shell } = runtimeWithShell();
    rt.configure({ onTitleAction });
    shell.push('title');
    rt.frame(W, H, DPR);
    const row = rt.hitRegions().find(h => h.id === 'title.new')!;
    const cx = row.x + row.w / 2, cy = row.y + row.h / 2;
    rt.pointerDown(cx, cy);
    rt.frame(W, H, DPR);
    rt.pointerUp(cx, cy);
    rt.frame(W, H, DPR);
    expect(onTitleAction).toHaveBeenCalledWith({ kind: 'new_world' });
  });

  it('Esc while a screen is up routes to onShellEscape, NOT the pause menu', () => {
    const onShellEscape = vi.fn();
    const onMenuToggle = vi.fn();
    const { rt, shell } = runtimeWithShell();
    rt.configure({ onShellEscape, onMenuToggle });
    shell.push('title');
    rt.frame(W, H, DPR);

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: W, bottom: H, width: W, height: H, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(canvas);
    const detach = rt.attach(canvas);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onShellEscape).toHaveBeenCalledTimes(1);
    // the pause menu must NOT have opened underneath the screen
    expect(onMenuToggle).not.toHaveBeenCalled();
    expect(rt.isMenuOpen()).toBe(false);
    detach();
    canvas.remove();
  });

  it('everything a screen draws stays inside the target', () => {
    const { rt, shell } = runtimeWithShell();
    shell.push('title');
    expectInsideTarget(rt.frame(W, H, DPR), W, H);
  });

  it('a gameover choice reaches the host through onGameOverAction', () => {
    const onGameOverAction = vi.fn();
    const { rt, shell } = runtimeWithShell();
    rt.configure({ onGameOverAction });
    shell.push('gameover');
    rt.frame(W, H, DPR);
    const row = rt.hitRegions().find(h => h.id === 'gameover.begin_again')!;
    const cx = row.x + row.w / 2, cy = row.y + row.h / 2;
    rt.pointerDown(cx, cy);
    rt.frame(W, H, DPR);
    rt.pointerUp(cx, cy);
    rt.frame(W, H, DPR);
    expect(onGameOverAction).toHaveBeenCalledWith({ kind: 'begin_again' });
  });

  it('photo mode draws chrome-free and consumes pointer input anyway', () => {
    const { rt, shell } = runtimeWithShell();
    shell.push('photo');
    const groups = rt.frame(W, H, DPR);
    expect(totalVerts(groups)).toBe(0); // no hint wired -> nothing painted
    expect(rt.hitRegions()).toEqual([]);
    expect(rt.consumesPointer(5, 5)).toBe(true); // still modal — no world underneath
  });

  it('a new-world RANDOM WORLD choice reaches onNewGameAction', () => {
    const onNewGameAction = vi.fn();
    const { rt, shell } = runtimeWithShell();
    rt.configure({ onNewGameAction });
    shell.push('newgame');
    rt.frame(W, H, DPR);
    const row = rt.hitRegions().find(h => h.id === 'newgame.random')!;
    const cx = row.x + row.w / 2, cy = row.y + row.h / 2;
    rt.pointerDown(cx, cy);
    rt.frame(W, H, DPR);
    rt.pointerUp(cx, cy);
    rt.frame(W, H, DPR);
    expect(onNewGameAction).toHaveBeenCalledWith({ kind: 'random' });
  });
});

// ── H3: the Hall of the Gods, from `open_screen` to a popped stack ───────────
// The hall is the first shell screen that reads LIVE SIM STATE, and the first
// whose actions split three ways (a bus meta verb, a direct presentation call,
// and a cast that must close the screen before it arms). These cases walk the
// whole route an agent's `open_screen screen=hall` takes.

const HALL: HallView = {
  spirit: {
    name: 'Fooob', tierLine: 'A SMALL GOD', massLine: 'BELIEF ENOUGH FOR A HEARTH OR TWO',
    intimacyLine: 'THEY KNOW YOUR NAME AND LITTLE ELSE', intimacy: 0.2,
    faded: false, fadedLine: null,
  },
  pedestals: [
    {
      domain: 'storm', label: 'Storm & Lightning', blurb: 'They believe you command the sky.',
      verb: 'call_storm', conviction: 0.6, threshold: 0.5, materialize: 1,
      tier: 'command', unlocked: true, reachLine: 'BELIEVED BY 12 — REACH 5',
      dimensions: { faith: 0.5, understanding: 0.3, devotion: 0.4 },
      nextHint: 'DEVOTION PAST SIX IN TEN AND THE BELIEF WILL HOLD ITSELF UP',
      nodes: [
        { tier: 'claim', label: 'CLAIM', reached: true, hint: 'HEARD' },
        { tier: 'command', label: 'COMMAND', reached: true, hint: 'WIELDED' },
        { tier: 'doctrine', label: 'DOCTRINE', reached: false, hint: 'HELD' },
      ],
      castBlocked: null,
    },
    {
      domain: 'flood', label: 'Tempests & Deluge', blurb: 'They believe you command the rains.',
      verb: 'summon_storm', conviction: 0.1, threshold: 0.45, materialize: 0.22,
      tier: 'dormant', unlocked: false, reachLine: 'NO ONE BELIEVES THIS OF YOU YET',
      dimensions: { faith: 0, understanding: 0, devotion: 0 },
      nextHint: 'NOT YET HEARD — CONVICTION HALFWAY TO THE MARK',
      nodes: [
        { tier: 'claim', label: 'CLAIM', reached: false, hint: 'HEARD' },
        { tier: 'command', label: 'COMMAND', reached: false, hint: 'WIELDED' },
        { tier: 'doctrine', label: 'DOCTRINE', reached: false, hint: 'HELD' },
      ],
      castBlocked: 'NOT YET BELIEVED OF YOU',
    },
  ],
  emptyLine: null,
};

function hallRuntime(view: () => HallView = () => HALL): { rt: UiRuntime; shell: Shell } {
  const shell = new Shell({ now: () => 0, titleView: () => TITLE, hallView: view });
  const rt = new UiRuntime();
  rt.setShell(shell);
  return { rt, shell };
}

/** Click a hit region by id, driving the same down/up sequence a real pointer
 *  does (a button fires on RELEASE, and needs a frame between). */
function clickId(rt: UiRuntime, id: string): void {
  const row = rt.hitRegions().find((h) => h.id === id);
  expect(row, `no hit region '${id}'`).toBeTruthy();
  const cx = row!.x + row!.w / 2, cy = row!.y + row!.h / 2;
  rt.pointerDown(cx, cy);
  rt.frame(W, H, DPR);
  rt.pointerUp(cx, cy);
  rt.frame(W, H, DPR);
}

describe('UiRuntime × Shell — the Hall of the Gods', () => {
  it('open_screen hall puts the hall on top and it owns the frame', () => {
    // `Shell.push('hall')` IS what `open_screen` does (game.ts's meta handler);
    // the agent-API half — that 'hall' is an accepted screen name at all — is
    // pinned in `screen-id-parity.test.ts`.
    const { rt, shell } = hallRuntime();
    rt.configure({ getPower: () => 0.5 });
    shell.push('hall');
    expect(shell.top()).toBe('hall');
    const groups = rt.frame(W, H, DPR);
    expect(totalVerts(groups)).toBeGreaterThan(0);
    const ids = rt.hitRegions().map((h) => h.id);
    expect(ids).not.toContain('ui.orb');          // the HUD is gone
    expect(ids).toContain('hall.select.storm');
    expect(ids).toContain('hall.cast.storm');
    expect(ids).toContain('hall.back');
    // Modal like every screen: no world underneath to click in meta mode.
    expect(rt.consumesPointer(5, 5)).toBe(true);
  });

  it('describe() reports exactly hallRows — ids, enabled, and refusal notes', () => {
    // The agent-navigation contract: what an agent is TOLD it can do must derive
    // from the same function the renderer walks.
    const { shell } = hallRuntime();
    shell.push('hall');
    expect(shell.describe().choices).toEqual(
      hallRows(HALL).map((r) => ({ id: r.id, label: r.label, enabled: r.enabled, note: r.reason })),
    );
    const byId = new Map(shell.describe().choices.map((c) => [c.id, c]));
    expect(byId.get('hall.cast.storm')!.enabled).toBe(true);
    // A locked pedestal is refused WITH ITS REASON — an agent must learn why,
    // not merely that.
    expect(byId.get('hall.cast.flood')!.enabled).toBe(false);
    expect(byId.get('hall.cast.flood')!.note).toBe('NOT YET BELIEVED OF YOU');
  });

  it('a faded god is described as refusing EVERY cast', () => {
    const faded: HallView = {
      ...HALL,
      spirit: { ...HALL.spirit, faded: true, fadedLine: 'ONLY WHISPERS REMAIN' },
    };
    const { shell } = hallRuntime(() => faded);
    shell.push('hall');
    const casts = shell.describe().choices.filter((c) => c.id.startsWith('hall.cast.'));
    expect(casts).toHaveLength(2);
    for (const c of casts) {
      expect(c.enabled).toBe(false);
      expect(c.note).toBe('ONLY WHISPERS REMAIN');   // canon, VISION tenet 6
    }
  });

  it('a CAST reaches the host through onHallAction with the verb', () => {
    const onHallAction = vi.fn();
    const { rt, shell } = hallRuntime();
    rt.configure({ onHallAction });
    shell.push('hall');
    rt.frame(W, H, DPR);
    clickId(rt, 'hall.cast.storm');
    expect(onHallAction).toHaveBeenCalledWith({ kind: 'cast', verb: 'call_storm' });
  });

  it('a REFUSED cast fires nothing at all', () => {
    // The disabled guard lives in the handler, not only in the paint, so a
    // mis-routed click or a gamepad activate cannot cast a locked power.
    const onHallAction = vi.fn();
    const { rt, shell } = hallRuntime();
    rt.configure({ onHallAction });
    shell.push('hall');
    rt.frame(W, H, DPR);
    clickId(rt, 'hall.cast.flood');
    expect(onHallAction).not.toHaveBeenCalledWith({ kind: 'cast', verb: 'summon_storm' });
  });

  it('SELECT is presentation only — setHallDomain, and it toggles', () => {
    // The host's hook calls `setHallDomain` directly rather than emitting a bus
    // verb (the `setSettingsTab` precedent); selecting must not change WHICH
    // choices exist, only the detail pane.
    const { rt, shell } = hallRuntime();
    rt.configure({ onHallAction: (a) => { if (a.kind === 'select') shell.setHallDomain(a.domain); } });
    shell.push('hall');
    rt.frame(W, H, DPR);
    const before = shell.describe().choices;

    clickId(rt, 'hall.select.flood');
    expect(shell.selectedHallDomain()).toBe('flood');
    rt.frame(W, H, DPR);
    expect(shell.describe().choices).toEqual(before);

    clickId(rt, 'hall.select.flood');   // re-select dismisses the pane
    expect(shell.selectedHallDomain()).toBeNull();
  });

  it('BACK and Esc both route out, and the pop lands on what was underneath', () => {
    const onHallAction = vi.fn();
    const onShellEscape = vi.fn();
    const { rt, shell } = hallRuntime();
    rt.configure({ onHallAction, onShellEscape });
    // The real entry is from a running world (empty stack) or a menu; push a
    // title first so the pop has somewhere honest to land.
    shell.push('title');
    shell.push('hall');
    rt.frame(W, H, DPR);
    clickId(rt, 'hall.back');
    expect(onHallAction).toHaveBeenCalledWith({ kind: 'back' });
    // `back` and Esc are the SAME `close_screen` verb in the host, so both end
    // as one `pop`.
    shell.pop();
    expect(shell.top()).toBe('title');
  });

  it('the hall works with NO WORLD: the empty view draws and offers only BACK', () => {
    // `open_screen screen=hall` is a meta verb — it works with nothing loaded,
    // like every other one. The hall STANDS (hazy niches), the caption is honest,
    // and there is nothing to cast.
    const { rt, shell } = hallRuntime(() => EMPTY_HALL_VIEW);
    shell.push('hall');
    expect(() => rt.frame(W, H, DPR)).not.toThrow();
    expect(totalVerts(rt.frame(W, H, DPR))).toBeGreaterThan(0);
    expect(EMPTY_HALL_VIEW.pedestals).toEqual([]);
    expect(EMPTY_HALL_VIEW.emptyLine).toBeTruthy();
    expect(shell.describe().choices.map((c) => c.id)).toEqual(['hall.back']);
  });

  it('an unwired hallView falls back to the empty hall, never a fabricated one', () => {
    const shell = new Shell({ now: () => 0 });
    const rt = new UiRuntime();
    rt.setShell(shell);
    shell.push('hall');
    expect(() => rt.frame(W, H, DPR)).not.toThrow();
    expect(shell.describe().choices.map((c) => c.id)).toEqual(['hall.back']);
  });

  it('everything the hall draws stays inside the target', () => {
    const { rt, shell } = hallRuntime();
    shell.push('hall');
    shell.setHallDomain('storm');   // the detail pane is the widest layout
    expectInsideTarget(rt.frame(W, H, DPR), W, H);
  });
});

// ── P5b: the world-code paste island routes to the RIGHT screen only ────────
// SETTINGS' GAMEPLAY tab and NEWGAME's paste field share the same generic
// `ShellDrawResult.island` slot (only one shell screen is ever on top), so a
// regression here would show the wrong DOM form over the wrong screen.

function mountedCanvas(): { canvas: HTMLCanvasElement; container: HTMLElement } {
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  container.appendChild(canvas);
  document.body.appendChild(container);
  return { canvas, container };
}
const worldCodeField = (c: HTMLElement) => c.querySelector('input[aria-label="World code"]') as HTMLInputElement | null;

describe('UiRuntime × Shell — the world-code island routes to NEWGAME only', () => {
  it('shows over NEWGAME, hides on every other shell screen', () => {
    const { canvas, container } = mountedCanvas();
    const shell = new Shell({ now: () => 0, titleView: () => TITLE });
    const rt = new UiRuntime();
    rt.setShell(shell);
    const teardown = rt.attach(canvas);

    const field = worldCodeField(container)!;
    expect(field).toBeTruthy();

    shell.push('title');
    rt.frame(W, H, DPR);
    expect(field.parentElement!.style.display).toBe('none');

    shell.replace('newgame');
    rt.frame(W, H, DPR);
    expect(field.parentElement!.style.display).toBe('flex');
    expect(parseInt(field.parentElement!.style.width)).toBeGreaterThan(0);

    // GAMEPLAY is the one settings tab that ALSO reserves a non-null island
    // rect (the LLM provider form) through the exact same generic
    // `ShellDrawResult.island` slot — the meaningful case to guard against
    // cross-contamination is this one, not an audio/video tab where `r` is
    // null anyway (and would hide the world-code field regardless of routing).
    shell.replace('settings');
    shell.setSettingsTab('gameplay');
    rt.frame(W, H, DPR);
    expect(field.parentElement!.style.display).toBe('none'); // NOT the settings tab's rect

    teardown();
    expect(worldCodeField(container)).toBeNull();
  });

  it('Enter on the paste field reaches onWorldCodeSubmit with the trimmed text', () => {
    const { canvas, container } = mountedCanvas();
    const shell = new Shell({ now: () => 0 });
    const rt = new UiRuntime();
    const submitted: string[] = [];
    rt.configure({ onWorldCodeSubmit: (t) => submitted.push(t) });
    rt.setShell(shell);
    const teardown = rt.attach(canvas);
    shell.push('newgame');
    rt.frame(W, H, DPR);

    const field = worldCodeField(container)!;
    field.value = '  3tx.default.3a  ';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(submitted).toEqual(['3tx.default.3a']);

    teardown();
  });
});
