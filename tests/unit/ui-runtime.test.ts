import { describe, it, expect, vi } from 'vitest';
import { UiRuntime, type AlertPinView, type TimeStatus, type TimeCommand, type AnnalRow } from '@/render/ui/ui-runtime';
import { UiPage, UiSpace, type UiDrawGroup } from '@/render/ui/ui-batcher';
import type { UiHit } from '@/render/ui/ui-context';
import type { UiSpec, UiSpecChoice } from '@/story/uispec';
import type { BeliefPowerView, InboxItem, PantheonRow } from '@/game/game-query';
import type { WorldLabelView } from '@/game/affordance/world-labels';

const W = 1280, H = 720, DPR = 2;

function totalVerts(groups: UiDrawGroup[]): number {
  return groups.reduce((s, g) => s + g.vertexCount, 0);
}
/** Max x of any screen-space vertex on `page`, within the x-window [lo, hi].
 *  Vertex stride is 8 floats (x,y,u,v,r,g,b,a); x at offset 0. The window lets a
 *  test isolate one side of the HUD (e.g. a left panel from the top-right time
 *  cluster). Used to assert text glyphs stay inside their panel's own edge —
 *  W5's text-clamp guard, robust to panel geometry (both edges are read from the
 *  actual rendered quads, not hardcoded). */
function maxScreenX(groups: UiDrawGroup[], page: UiPage, lo = -Infinity, hi = Infinity): number {
  let mx = -Infinity;
  for (const g of groups) {
    if (g.space !== UiSpace.Screen || g.page !== page) continue;
    for (let i = 0; i < g.vertexCount * 8; i += 8) {
      const x = g.vertices[i];
      if (x >= lo && x <= hi) mx = Math.max(mx, x);
    }
  }
  return mx;
}
function center(h: UiHit): [number, number] {
  return [h.x + h.w / 2, h.y + h.h / 2];
}
/** Drive a full click (down→frame→up→frame) at (x,y); returns the post-click groups. */
function click(rt: UiRuntime, x: number, y: number): UiDrawGroup[] {
  rt.pointerDown(x, y);
  rt.frame(W, H, DPR);
  rt.pointerUp(x, y);
  return rt.frame(W, H, DPR);
}

/** A mounted canvas whose `getBoundingClientRect` reports its own device px 1:1
 *  (jsdom does no layout, so the real rect is all-zero by default) — needed for
 *  D2/D3 tests that dispatch REAL DOM pointer/wheel events through `attach()`'s
 *  `toDevice` conversion and must land at a known device-px coordinate. */
function mountedCanvasForInput(w = W, h = H): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: w, bottom: h, width: w, height: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(canvas);
  return canvas;
}

describe('UiRuntime — HUD + pause menu', () => {
  it('renders the barebones HUD (orb + MENU) when the menu is closed', () => {
    const rt = new UiRuntime();
    rt.configure({ getPower: () => 0.5 });
    const groups = rt.frame(W, H, DPR);
    expect(totalVerts(groups)).toBeGreaterThan(0);
    // an orb hit region is always claimed in HUD mode
    expect(rt.hitRegions().some((h) => h.id === 'ui.orb')).toBe(true);
    expect(rt.isMenuOpen()).toBe(false);
  });

  it('HUD consumes taps only on its widgets, not the empty world', () => {
    const rt = new UiRuntime();
    rt.frame(W, H, DPR);
    const menuHit = rt.hitRegions().find((h) => h.id === 'ui.orb')!;
    const [mx, my] = center(menuHit);
    expect(rt.consumesPointer(mx, my)).toBe(true); // over the orb (opens menu)
    expect(rt.consumesPointer(W / 2, H / 2)).toBe(false); // empty world centre
  });

  it('clicking the orb opens the modal pause menu (which eats all input)', () => {
    const rt = new UiRuntime();
    rt.frame(W, H, DPR);
    const menuHit = rt.hitRegions().find((h) => h.id === 'ui.orb')!;
    click(rt, ...center(menuHit));
    expect(rt.isMenuOpen()).toBe(true);
    expect(rt.consumesPointer(W / 2, H / 2)).toBe(true); // modal: world centre now eaten
  });

  it('Esc toggles the menu and fires the pause hook', () => {
    const toggles: boolean[] = [];
    const rt = new UiRuntime();
    rt.configure({ onMenuToggle: (open) => toggles.push(open) });
    rt.toggleMenu();
    expect(rt.isMenuOpen()).toBe(true);
    rt.toggleMenu();
    expect(rt.isMenuOpen()).toBe(false);
    expect(toggles).toEqual([true, false]);
  });

  it('RESUME closes the menu', () => {
    const rt = new UiRuntime();
    rt.toggleMenu();
    rt.frame(W, H, DPR);
    const resume = rt.hitRegions().find((h) => h.id === 'nav.resume')!;
    click(rt, ...center(resume));
    expect(rt.isMenuOpen()).toBe(false);
  });

  it('clicking the backdrop (outside nav + panel) resumes the game', () => {
    const rt = new UiRuntime();
    rt.toggleMenu();
    rt.frame(W, H, DPR);
    expect(rt.isMenuOpen()).toBe(true);
    // a point well above the nav column and left of the settings panel = backdrop
    click(rt, W / 2, 50);
    expect(rt.isMenuOpen()).toBe(false);
  });

  it('clicking a nav item does NOT count as a backdrop dismiss', () => {
    const rt = new UiRuntime();
    rt.configure({ getLighting: () => true, onToggleLighting: () => true });
    rt.toggleMenu();
    rt.frame(W, H, DPR);
    // clicking SETTINGS (already active) keeps the menu open
    const settings = rt.hitRegions().find((h) => h.id === 'nav.settings')!;
    click(rt, ...center(settings));
    expect(rt.isMenuOpen()).toBe(true);
  });

  it('NEW WORLD fires its hook and closes the menu', () => {
    let newWorlds = 0;
    const rt = new UiRuntime();
    rt.configure({ onNewWorld: () => newWorlds++ });
    rt.toggleMenu();
    rt.frame(W, H, DPR);
    const world = rt.hitRegions().find((h) => h.id === 'nav.world')!;
    click(rt, ...center(world));
    expect(newWorlds).toBe(1);
    expect(rt.isMenuOpen()).toBe(false);
  });

  it('LIGHTING toggle flips state through the hook', () => {
    let lit = true;
    const rt = new UiRuntime();
    rt.configure({ getLighting: () => lit, onToggleLighting: () => (lit = !lit) });
    rt.toggleMenu();
    rt.frame(W, H, DPR);
    const light = rt.hitRegions().find((h) => h.id === 'set.lighting')!;
    click(rt, ...center(light));
    expect(lit).toBe(false);
  });

  it('draws the camera cluster only when the camera hooks are wired', () => {
    const bare = new UiRuntime();
    bare.frame(W, H, DPR);
    expect(bare.hitRegions().some((h) => h.id.startsWith('cam.'))).toBe(false);

    const wired = new UiRuntime();
    wired.configure({ onZoomIn: () => {}, onZoomOut: () => {}, onFitView: () => {}, onZoomActual: () => {} });
    wired.frame(W, H, DPR);
    const camIds = wired.hitRegions().filter((h) => h.id.startsWith('cam.')).map((h) => h.id).sort();
    expect(camIds).toEqual(['cam.fit', 'cam.in', 'cam.one', 'cam.out']);
  });

  it('clicking a camera button fires its hook (HUD, no menu)', () => {
    const fired: string[] = [];
    const rt = new UiRuntime();
    rt.configure({
      onZoomIn: () => fired.push('in'),
      onZoomOut: () => fired.push('out'),
      onFitView: () => fired.push('fit'),
      onZoomActual: () => fired.push('one'),
    });
    rt.frame(W, H, DPR);
    for (const id of ['cam.in', 'cam.out', 'cam.fit', 'cam.one']) {
      const hit = rt.hitRegions().find((h) => h.id === id)!;
      click(rt, ...center(hit));
    }
    expect(fired).toEqual(['in', 'out', 'fit', 'one']);
  });

  it('camera buttons consume taps on themselves (so the world does not pan)', () => {
    const rt = new UiRuntime();
    rt.configure({ onZoomIn: () => {}, onZoomOut: () => {}, onFitView: () => {}, onZoomActual: () => {} });
    rt.frame(W, H, DPR);
    const hit = rt.hitRegions().find((h) => h.id === 'cam.in')!;
    expect(rt.consumesPointer(...center(hit))).toBe(true);
  });

  it('orb fill scales with power (more power ⇒ more accent geometry)', () => {
    const lo = new UiRuntime(); lo.configure({ getPower: () => 0 });
    const hi = new UiRuntime(); hi.configure({ getPower: () => 1 });
    const loSolid = totalVerts(lo.frame(W, H, DPR).filter((g) => g.page === UiPage.Solid));
    const hiSolid = totalVerts(hi.frame(W, H, DPR).filter((g) => g.page === UiPage.Solid));
    expect(hiSolid).toBeGreaterThan(loSolid); // the power fill quad only exists when power>0
  });
});

// ── hover popover (P3): dwell → freeze → chip → fire ─────────────────────────────
const CHIPS = [
  { verb: 'answer_prayer', label: 'answer prayer', cost: 2, unlocked: true, affordable: true, why: 'praying' },
  { verb: 'whisper', label: 'whisper', cost: 1, unlocked: true, affordable: true, why: null },
  { verb: 'smite', label: 'smite', cost: 8, unlocked: false, affordable: true, why: null }, // belief-locked
];
/** A manual timer seam so dwell fires on demand (no real setTimeout in tests). */
function manualTimers() {
  let fn: (() => void) | null = null;
  return {
    timers: { set: (f: () => void) => { fn = f; return 1; }, clear: () => { fn = null; } },
    fire: () => { const f = fn; fn = null; f?.(); },
  };
}

describe('UiRuntime — hover popover', () => {
  it('shows nothing until dwell elapses, then freezes the chips at the cursor', () => {
    const rt = new UiRuntime(manualTimers().timers);
    rt.configure({ getHoverAffordances: () => ({ chips: CHIPS }) });
    rt.pointerMove(400, 400);
    // before dwell: no popover chips drawn
    rt.frame(W, H, DPR);
    expect(rt.hitRegions().some((h) => h.id.startsWith('hover.chip.'))).toBe(false);
    // dwell fires → popover appears
    rt.handleDwell();
    rt.frame(W, H, DPR);
    const chipIds = rt.hitRegions().filter((h) => h.id.startsWith('hover.chip.')).map((h) => h.id).sort();
    expect(chipIds).toEqual(['hover.chip.answer_prayer', 'hover.chip.smite', 'hover.chip.whisper']);
  });

  it('does not show a popover when the game reports no affordances', () => {
    const rt = new UiRuntime(manualTimers().timers);
    rt.configure({ getHoverAffordances: () => null });
    rt.pointerMove(400, 400);
    rt.handleDwell();
    rt.frame(W, H, DPR);
    expect(rt.hitRegions().some((h) => h.id.startsWith('hover.chip.'))).toBe(false);
  });

  it('clicking a castable chip fires its verb and dismisses the popover', () => {
    const fired: string[] = [];
    const rt = new UiRuntime(manualTimers().timers);
    rt.configure({ getHoverAffordances: () => ({ chips: CHIPS }), onHoverChip: (v) => fired.push(v) });
    rt.pointerMove(400, 400);
    rt.handleDwell();
    rt.frame(W, H, DPR);
    const chip = rt.hitRegions().find((h) => h.id === 'hover.chip.answer_prayer')!;
    click(rt, ...center(chip));
    expect(fired).toEqual(['answer_prayer']);
    // popover is gone on the next frame (the click frame already recorded its hits)
    rt.frame(W, H, DPR);
    expect(rt.hitRegions().some((h) => h.id.startsWith('hover.chip.'))).toBe(false);
  });

  it('a belief-locked chip is disabled and never fires', () => {
    const fired: string[] = [];
    const rt = new UiRuntime(manualTimers().timers);
    rt.configure({ getHoverAffordances: () => ({ chips: CHIPS }), onHoverChip: (v) => fired.push(v) });
    rt.pointerMove(400, 400);
    rt.handleDwell();
    rt.frame(W, H, DPR);
    const chip = rt.hitRegions().find((h) => h.id === 'hover.chip.smite')!;
    click(rt, ...center(chip));
    expect(fired).toEqual([]); // disabled → no verb emitted
  });

  it('stays open while the cursor travels onto it, dismisses when it leaves (grace zone)', () => {
    const rt = new UiRuntime(manualTimers().timers);
    rt.configure({ getHoverAffordances: () => ({ chips: CHIPS }) });
    rt.pointerMove(400, 400);
    rt.handleDwell();
    rt.frame(W, H, DPR);
    const chip = rt.hitRegions().find((h) => h.id === 'hover.chip.whisper')!;
    // move onto a chip → sticky (still drawn)
    rt.pointerMove(...center(chip));
    rt.frame(W, H, DPR);
    expect(rt.hitRegions().some((h) => h.id.startsWith('hover.chip.'))).toBe(true);
    // move far away → dismissed
    rt.pointerMove(50, 50);
    rt.frame(W, H, DPR);
    expect(rt.hitRegions().some((h) => h.id.startsWith('hover.chip.'))).toBe(false);
  });

  it('opening the menu clears any hover popover', () => {
    const rt = new UiRuntime(manualTimers().timers);
    rt.configure({ getHoverAffordances: () => ({ chips: CHIPS }) });
    rt.pointerMove(400, 400);
    rt.handleDwell();
    rt.toggleMenu(); // modal takes over
    const groups = rt.frame(W, H, DPR);
    expect(rt.hitRegions().some((h) => h.id.startsWith('hover.chip.'))).toBe(false);
    expect(totalVerts(groups)).toBeGreaterThan(0); // menu still drew
  });
});

// ── inspector (P3.8): target-first panel with state, domains + affordance casts ──
const INSPECTOR = {
  kind: 'npc' as const,
  title: 'Ada',
  subtitle: 'farmer · age 34 · idle',
  state: [{ label: 'Faith', value: 0.8 }, { label: 'Meaning', value: 0.4 }],
  domains: [{ label: 'Storm & Lightning', value: 0.3 }],
  affordances: [
    { verb: 'whisper', label: 'whisper', cost: 1, unlocked: true, affordable: true },
    { verb: 'smite', label: 'smite', cost: 8, unlocked: false, affordable: true }, // belief-locked
  ],
};

describe('UiRuntime — inspector', () => {
  it('draws nothing when there is no selection', () => {
    const rt = new UiRuntime();
    rt.configure({ getInspector: () => null });
    rt.frame(W, H, DPR);
    expect(rt.hitRegions().some((h) => h.id === 'ui.inspector')).toBe(false);
    expect(rt.hitRegions().some((h) => h.id.startsWith('inspector.cast.'))).toBe(false);
  });

  it('renders the panel with a close button and one cast row per affordance', () => {
    const rt = new UiRuntime();
    rt.configure({ getInspector: () => INSPECTOR });
    rt.frame(W, H, DPR);
    expect(rt.hitRegions().some((h) => h.id === 'ui.inspector')).toBe(true);
    expect(rt.hitRegions().some((h) => h.id === 'ui.inspector.close')).toBe(true);
    const casts = rt.hitRegions().filter((h) => h.id.startsWith('inspector.cast.')).map((h) => h.id).sort();
    expect(casts).toEqual(['inspector.cast.smite', 'inspector.cast.whisper']);
  });

  it('clicking a castable affordance fires onInspectorCast', () => {
    const fired: string[] = [];
    const rt = new UiRuntime();
    rt.configure({ getInspector: () => INSPECTOR, onInspectorCast: (v) => fired.push(v) });
    rt.frame(W, H, DPR);
    const whisper = rt.hitRegions().find((h) => h.id === 'inspector.cast.whisper')!;
    click(rt, ...center(whisper));
    expect(fired).toEqual(['whisper']);
  });

  it('a belief-locked affordance is disabled and never fires', () => {
    const fired: string[] = [];
    const rt = new UiRuntime();
    rt.configure({ getInspector: () => INSPECTOR, onInspectorCast: (v) => fired.push(v) });
    rt.frame(W, H, DPR);
    const smite = rt.hitRegions().find((h) => h.id === 'inspector.cast.smite')!;
    click(rt, ...center(smite));
    expect(fired).toEqual([]);
  });

  it('the close button dismisses the inspector', () => {
    let closed = 0;
    const rt = new UiRuntime();
    rt.configure({ getInspector: () => INSPECTOR, onCloseInspector: () => closed++ });
    rt.frame(W, H, DPR);
    const close = rt.hitRegions().find((h) => h.id === 'ui.inspector.close')!;
    click(rt, ...center(close));
    expect(closed).toBe(1);
  });

  it('tucks the camera cluster left of the inspector so they never overlap', () => {
    const cam = { onZoomIn: () => {}, onZoomOut: () => {}, onFitView: () => {}, onZoomActual: () => {} };
    const bare = new UiRuntime();
    bare.configure({ ...cam, getInspector: () => null });
    bare.frame(W, H, DPR);
    const camX0 = bare.hitRegions().find((h) => h.id === 'cam.in')!.x;

    const withPanel = new UiRuntime();
    withPanel.configure({ ...cam, getInspector: () => INSPECTOR });
    withPanel.frame(W, H, DPR);
    const inspector = withPanel.hitRegions().find((h) => h.id === 'ui.inspector')!;
    const camX1 = withPanel.hitRegions().find((h) => h.id === 'cam.in')!;
    expect(camX1.x).toBeLessThan(camX0);            // shifted left
    expect(camX1.x + camX1.w).toBeLessThanOrEqual(inspector.x); // clear of the panel
  });
});

// ── UI v2 W2 (D5): settlement inspector v2 — the variable middle (building-row +
// wards + recent + domains) rides ONE scrollList; ACTS stays bottom-reserved and
// FIXED (its position must not move when the list above it is scrolled). ──
const SETTLEMENT_INSPECTOR = {
  kind: 'settlement' as const,
  title: 'Hollow',
  subtitle: 'village · high · 12 souls',
  state: [],
  domains: [{ label: 'Storm & Lightning', value: 0.2 }],
  affordances: [{ verb: 'omen', label: 'omen', cost: 2, unlocked: true, affordable: true }],
  wards: Array.from({ length: 20 }, (_, i) => ({ name: `Ward ${i}`, type: 'craft' })),
  population: 12,
  housing: 15,
  peace: { lordName: 'Cwen', oath: 'sworn' as const, expiryDays: 3 },
  recent: [{ label: 'BORN', count: 2 }],
  buildingRow: { name: 'a one-room peasant cottage', type: 'residential' },
};

describe('UiRuntime — settlement inspector v2 (UI v2 W2/D5)', () => {
  it('registers ONE scrollList for the variable middle (building-row + wards + recent + domains)', () => {
    const rt = new UiRuntime();
    rt.configure({ getInspector: () => SETTLEMENT_INSPECTOR });
    rt.frame(W, H, DPR);
    expect(rt.scrollRegions().some((r) => r.id === 'ui.inspector.list')).toBe(true);
    // The panel + close + ACTS row still render alongside the new list.
    expect(rt.hitRegions().some((h) => h.id === 'ui.inspector')).toBe(true);
    expect(rt.hitRegions().some((h) => h.id === 'inspector.cast.omen')).toBe(true);
  });

  it('a wheel over the list scrolls it, but the ACTS row never moves (bottom-reserved, fixed)', () => {
    const rt = new UiRuntime();
    rt.configure({ getInspector: () => SETTLEMENT_INSPECTOR });
    rt.frame(W, H, DPR);
    const actsBefore = rt.hitRegions().find((h) => h.id === 'inspector.cast.omen')!;
    const region = rt.scrollRegions().find((r) => r.id === 'ui.inspector.list')!;
    const cx = region.x + region.w / 2, cy = region.y + region.h / 2;

    expect(rt.wheel(cx, cy, 100)).toBe(true); // consumed — a registered scroll region
    rt.frame(W, H, DPR);
    const actsAfter = rt.hitRegions().find((h) => h.id === 'inspector.cast.omen')!;
    expect(actsAfter.y).toBe(actsBefore.y);
    expect(actsAfter.x).toBe(actsBefore.x);
  });

  it('clamps a very long ward row inside the inspector (W5 — text never runs past the panel edge)', () => {
    const rt = new UiRuntime();
    // a ward name long enough that, UNCLAMPED, it would run well past the panel's
    // right edge — the ellipsis clip must keep every glyph inside the panel bg.
    rt.configure({ getInspector: () => ({
      ...SETTLEMENT_INSPECTOR,
      wards: [{ name: 'NORTHWESTFISHERQUARTEROFTHEDROWNEDSENTINELSBESIDETHESUNKENSHRINE', type: 'harbour' }],
    }) });
    const groups = rt.frame(W, H, DPR);
    // the inspector lives on the RIGHT — window out the left pills / tucked clusters.
    const glyphRight = maxScreenX(groups, UiPage.Bitmap, 400);
    const panelRight = maxScreenX(groups, UiPage.Solid, 400);
    expect(glyphRight).toBeLessThanOrEqual(panelRight);
  });

  it('a bare settlement (no wards/recent/domains/building) registers no scroll list', () => {
    const rt = new UiRuntime();
    rt.configure({ getInspector: () => ({
      kind: 'settlement' as const, title: 'Bare', subtitle: 'hamlet',
      state: [], domains: [], affordances: [],
    }) });
    rt.frame(W, H, DPR);
    expect(rt.scrollRegions().some((r) => r.id === 'ui.inspector.list')).toBe(false);
  });

  it('the npc variant still scrolls its state+domain middle (no new npc content — W3 owns that)', () => {
    const bigNpc = { ...INSPECTOR, state: Array.from({ length: 15 }, (_, i) => ({ label: `Stat ${i}`, value: 0.5 })) };
    const rt = new UiRuntime();
    rt.configure({ getInspector: () => bigNpc });
    rt.frame(W, H, DPR);
    expect(rt.scrollRegions().some((r) => r.id === 'ui.inspector.list')).toBe(true);
    const casts = rt.hitRegions().filter((h) => h.id.startsWith('inspector.cast.')).map((h) => h.id).sort();
    expect(casts).toEqual(['inspector.cast.smite', 'inspector.cast.whisper']); // buttons unchanged
  });
});

// ── UI v2 W3 (D6): the npc inspector's soul deepening — status hint + TIES ──
describe('UiRuntime — npc inspector soul deepening (UI v2 W3/D6)', () => {
  it('TIES rows ride the SAME scrollList (still exactly one region) and draw more geometry', () => {
    const withTies = {
      ...INSPECTOR,
      relationships: [
        { name: 'Bo', type: 'friend', trust: 0.4 },
        { name: 'Cade', type: 'rival', trust: 0.9 },
      ],
    };
    const rtBase = new UiRuntime();
    rtBase.configure({ getInspector: () => INSPECTOR });
    const baseGroups = rtBase.frame(W, H, DPR);

    const rtTies = new UiRuntime();
    rtTies.configure({ getInspector: () => withTies });
    const tieGroups = rtTies.frame(W, H, DPR);

    // more rows (a TIES header + one bar per tie) ⇒ strictly more glyph/bar geometry.
    expect(totalVerts(tieGroups)).toBeGreaterThan(totalVerts(baseGroups));
    // still ONE scroll surface for the variable middle — no second scroll region.
    expect(rtTies.scrollRegions().filter((r) => r.id === 'ui.inspector.list')).toHaveLength(1);
    // ACTS/close/panel geometry is untouched — only the scrollable middle grew.
    expect(rtTies.hitRegions().some((h) => h.id === 'ui.inspector.close')).toBe(true);
  });

  it('the status-hint prose line is drawn under the subtitle, pushing the scroll list down', () => {
    const rtBare = new UiRuntime();
    rtBare.configure({ getInspector: () => INSPECTOR });
    rtBare.frame(W, H, DPR);
    const regionBare = rtBare.scrollRegions().find((r) => r.id === 'ui.inspector.list')!;

    const rtHint = new UiRuntime();
    rtHint.configure({ getInspector: () => ({ ...INSPECTOR, statusHint: 'praying, needs you now' }) });
    rtHint.frame(W, H, DPR);
    const regionHint = rtHint.scrollRegions().find((r) => r.id === 'ui.inspector.list')!;

    expect(regionHint.y).toBeGreaterThan(regionBare.y);
    // and it actually drew MORE geometry than the bare panel (the wrapped line itself).
    expect(totalVerts(rtHint.frame(W, H, DPR))).toBeGreaterThan(totalVerts(rtBare.frame(W, H, DPR)));
  });

  it('a very long status hint clamps to 2 lines instead of eating the whole panel', () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const rtShort = new UiRuntime();
    rtShort.configure({ getInspector: () => ({ ...INSPECTOR, statusHint: 'short line' }) });
    rtShort.frame(W, H, DPR);
    const regionShort = rtShort.scrollRegions().find((r) => r.id === 'ui.inspector.list')!;

    const rtLong = new UiRuntime();
    rtLong.configure({ getInspector: () => ({ ...INSPECTOR, statusHint: long }) });
    rtLong.frame(W, H, DPR);
    const regionLong = rtLong.scrollRegions().find((r) => r.id === 'ui.inspector.list')!;

    // A one-line hint pushes the list down by ~1 line; a 40-word hint would wrap
    // to many more lines if unclamped — clamped-to-2 caps the push to ~2 lines.
    const pushOneLine = regionShort.y; // both start from the same panel top
    const pushClamped = regionLong.y;
    expect(pushClamped).toBeGreaterThan(pushOneLine);
    expect(pushClamped).toBeLessThan(pushOneLine * 4); // nowhere near "40 words as one line each"
  });

  it('a settlement inspector never reads statusHint/relationships (npc-only fields)', () => {
    const rt = new UiRuntime();
    rt.configure({ getInspector: () => SETTLEMENT_INSPECTOR });
    const before = totalVerts(rt.frame(W, H, DPR));

    const withExtras = {
      ...SETTLEMENT_INSPECTOR,
      statusHint: 'devoted',
      relationships: [{ name: 'X', type: 'friend', trust: 1 }],
    } as any;
    const rt2 = new UiRuntime();
    rt2.configure({ getInspector: () => withExtras });
    const after = totalVerts(rt2.frame(W, H, DPR));

    expect(after).toBe(before);
  });
});

// ── P4: the declarative UiSpec card (whisper card) ──
const CARD_SPEC: UiSpec = {
  title: 'Whisper to Ada',
  body: [
    { kind: 'npcLine', who: 'Ada', text: 'Something out there means us harm.' },
    { kind: 'paragraph', text: 'Their surface thoughts lie open to your voice.' },
    { kind: 'divider' },
    { kind: 'beliefBar', label: 'Faith', value: 0.6 },
  ],
  choices: [
    { text: 'Soothe their safety', hint: 'eases the deficit',
      command: { verb: 'whisper', source: 'player', target: { kind: 'npc', npcId: 'n1' }, params: { slant: 'need:safety' }, seq: 0 } },
    { text: 'Affirm you are near', hint: 'builds understanding',
      command: { verb: 'whisper', source: 'player', target: { kind: 'npc', npcId: 'n1' }, params: { slant: 'affirm' }, seq: 0 } },
  ],
};

describe('UiRuntime — whisper card (UiSpec)', () => {
  it('presents a modal card: body + one button per choice', () => {
    const rt = new UiRuntime();
    rt.presentUiSpec(CARD_SPEC, () => {});
    rt.frame(W, H, DPR);
    expect(rt.hasCard()).toBe(true);
    expect(rt.hitRegions().some((h) => h.id === 'card.body')).toBe(true);
    const choices = rt.hitRegions().filter((h) => h.id.startsWith('card.choice.')).map((h) => h.id).sort();
    expect(choices).toEqual(['card.choice.0', 'card.choice.1']);
    expect(rt.consumesPointer(W / 2, H / 2)).toBe(true); // modal: eats world input
  });

  it('choosing an option fires onChoose with that choice and dismisses (pause→resume)', () => {
    const picked: UiSpecChoice[] = [];
    const toggles: boolean[] = [];
    const rt = new UiRuntime();
    rt.configure({ onStoryToggle: (a) => toggles.push(a) });
    rt.presentUiSpec(CARD_SPEC, (c) => picked.push(c));
    rt.frame(W, H, DPR);
    const b0 = rt.hitRegions().find((h) => h.id === 'card.choice.0')!;
    click(rt, ...center(b0));
    expect(picked).toHaveLength(1);
    expect(picked[0].command.params?.slant).toBe('need:safety');
    expect(rt.hasCard()).toBe(false);
    expect(toggles).toEqual([true, false]);
  });

  it('a backdrop click cancels the card with no choice emitted', () => {
    const picked: UiSpecChoice[] = [];
    const rt = new UiRuntime();
    rt.presentUiSpec(CARD_SPEC, (c) => picked.push(c));
    rt.frame(W, H, DPR);
    click(rt, 8, 8); // top-left corner = outside the centred card
    expect(picked).toEqual([]);
    expect(rt.hasCard()).toBe(false);
  });

  it('presenting the card clears an open hover popover and suppresses new ones', () => {
    const rt = new UiRuntime();
    rt.configure({ getHoverAffordances: () => ({ chips: [{ verb: 'whisper', label: 'Whisper', cost: 1, unlocked: true, affordable: true, why: null }] }) });
    rt.pointerMove(400, 400);
    rt.handleDwell();
    rt.frame(W, H, DPR);
    expect(rt.hitRegions().some((h) => h.id.startsWith('hover.chip.'))).toBe(true);
    rt.presentUiSpec(CARD_SPEC, () => {});
    rt.handleDwell(); // suppressed while the card owns the screen
    rt.frame(W, H, DPR);
    expect(rt.hitRegions().some((h) => h.id.startsWith('hover.chip.'))).toBe(false);
    expect(rt.hasCard()).toBe(true);
  });
});

// ── Conversation UI C1: the re-presentable (keepOpen) card ──
const CARD_SPEC_2: UiSpec = {
  title: 'Whisper to Ada',
  body: [{ kind: 'npcLine', who: 'Ada', text: '…does it? I had not thought of it that way.' }],
  choices: [
    { text: 'Press further', hint: 'deepens', command: { verb: 'whisper', source: 'player', target: { kind: 'npc', npcId: 'n1' }, params: { slant: 'affirm' }, seq: 0 } },
  ],
};

describe('UiRuntime — conversation card (keepOpen)', () => {
  it('a keepOpen card stays open after a choice and does NOT pause the sim', () => {
    const picked: UiSpecChoice[] = [];
    const toggles: boolean[] = [];
    const rt = new UiRuntime();
    rt.configure({ onStoryToggle: (a) => toggles.push(a) });
    rt.presentUiSpec(CARD_SPEC, (c) => picked.push(c), { keepOpen: true });
    rt.frame(W, H, DPR);
    const b0 = rt.hitRegions().find((h) => h.id === 'card.choice.0')!;
    click(rt, ...center(b0));
    expect(picked).toHaveLength(1);          // onChoose fired
    expect(rt.hasCard()).toBe(true);         // …but the card stayed open
    expect(toggles).toEqual([]);             // …and the sim never paused
  });

  it('updateOpenCard swaps the rendered spec in place', () => {
    const rt = new UiRuntime();
    rt.presentUiSpec(CARD_SPEC, () => {}, { keepOpen: true });
    rt.frame(W, H, DPR);
    expect(rt.hitRegions().filter((h) => h.id.startsWith('card.choice.'))).toHaveLength(2);
    rt.updateOpenCard(CARD_SPEC_2);
    rt.frame(W, H, DPR);
    expect(rt.hitRegions().filter((h) => h.id.startsWith('card.choice.'))).toHaveLength(1);
    expect(rt.hasCard()).toBe(true);
  });

  it('updateOpenCard is a no-op when no card is open', () => {
    const rt = new UiRuntime();
    rt.updateOpenCard(CARD_SPEC_2);
    expect(rt.hasCard()).toBe(false);
  });

  it('a backdrop click still closes a keepOpen card (no lingering pause toggle)', () => {
    const toggles: boolean[] = [];
    const rt = new UiRuntime();
    rt.configure({ onStoryToggle: (a) => toggles.push(a) });
    rt.presentUiSpec(CARD_SPEC, () => {}, { keepOpen: true });
    rt.frame(W, H, DPR);
    click(rt, 8, 8); // outside the centred card
    expect(rt.hasCard()).toBe(false);
    expect(toggles).toEqual([]); // never paused → never a stray resume
  });

  // ── Conversation UI C4: the free-text input row + DOM island ──
  it('a keepOpen (conversation) card reserves a free-text input row; a one-shot card does not', () => {
    const rt = new UiRuntime();
    rt.presentUiSpec(CARD_SPEC, () => {}, { keepOpen: true });
    rt.frame(W, H, DPR);
    expect(rt.hitRegions().some((h) => h.id === 'card.input')).toBe(true);

    rt.presentUiSpec(CARD_SPEC, () => {}); // one-shot info card — no input row
    rt.frame(W, H, DPR);
    expect(rt.hitRegions().some((h) => h.id === 'card.input')).toBe(false);
  });
});

// C4 needs the DOM island, which `attach` mounts into the canvas' parent.
function mountedCanvas(): { canvas: HTMLCanvasElement; container: HTMLElement } {
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  container.appendChild(canvas);
  document.body.appendChild(container);
  return { canvas, container };
}
const whisperField = (c: HTMLElement) => c.querySelector('input[aria-label="Whisper free text"]') as HTMLInputElement | null;

describe('UiRuntime — conversation free-text island (C4)', () => {
  it('shows the field over a conversation card and hides it otherwise', () => {
    const { canvas, container } = mountedCanvas();
    const rt = new UiRuntime();
    const teardown = rt.attach(canvas);

    const field = whisperField(container)!;
    expect(field).toBeTruthy();
    expect(field.parentElement!.style.display).toBe('none'); // hidden with no card

    rt.presentUiSpec(CARD_SPEC, () => {}, { keepOpen: true });
    rt.frame(W, H, DPR);
    expect(field.parentElement!.style.display).toBe('flex'); // shown over the card
    expect(parseInt(field.parentElement!.style.width)).toBeGreaterThan(0); // positioned

    rt.presentUiSpec(CARD_SPEC, () => {}); // one-shot info card
    rt.frame(W, H, DPR);
    expect(field.parentElement!.style.display).toBe('none'); // hidden again

    teardown();
    expect(whisperField(container)).toBeNull(); // island destroyed on teardown
  });

  it('Enter submits the trimmed text to onCardFreeText and clears the field', () => {
    const { canvas, container } = mountedCanvas();
    const sent: string[] = [];
    const rt = new UiRuntime();
    rt.configure({ onCardFreeText: (t) => sent.push(t) });
    const teardown = rt.attach(canvas);
    rt.presentUiSpec(CARD_SPEC, () => {}, { keepOpen: true });
    rt.frame(W, H, DPR);

    const field = whisperField(container)!;
    field.value = '  be brave, Ada  ';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(sent).toEqual(['be brave, Ada']); // trimmed
    expect(field.value).toBe(''); // cleared for the next line

    // whitespace-only submit is a no-op
    field.value = '   ';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(sent).toEqual(['be brave, Ada']);
    teardown();
  });
});

// ── P5: the zoomed-out alert pins (inbox as world-anchored markers) ──
const PINS: AlertPinView[] = [
  { id: 'opp:vale', kind: 'opportunity', x: 400, y: 300, surfaced: false },
  { id: 'prayer:n1', kind: 'prayer', x: 800, y: 500, surfaced: true },
];

describe('UiRuntime — alert pins (P5 zoom-out band)', () => {
  it('draws no pins when the game reports the zoomed-in band (null)', () => {
    const rt = new UiRuntime();
    rt.configure({ getAlertPins: () => null });
    rt.frame(W, H, DPR);
    expect(rt.hitRegions().some((h) => h.id.startsWith('alert.'))).toBe(false);
  });

  it('renders one clickable pin per item with a hotspot at its centre', () => {
    const rt = new UiRuntime();
    rt.configure({ getAlertPins: () => PINS });
    rt.frame(W, H, DPR);
    const ids = rt.hitRegions().filter((h) => h.id.startsWith('alert.')).map((h) => h.id).sort();
    expect(ids).toEqual(['alert.opp:vale', 'alert.prayer:n1']);
    // the hotspot straddles the reported device-px centre
    const hit = rt.hitRegions().find((h) => h.id === 'alert.opp:vale')!;
    expect(hit.x).toBeLessThanOrEqual(400);
    expect(hit.x + hit.w).toBeGreaterThanOrEqual(400);
    expect(hit.y).toBeLessThanOrEqual(300);
    expect(hit.y + hit.h).toBeGreaterThanOrEqual(300);
  });

  it('emits the pin markers into a UiSpace.World draw group', () => {
    const rt = new UiRuntime();
    rt.configure({ getAlertPins: () => PINS });
    const groups = rt.frame(W, H, DPR);
    const world = groups.filter((g) => g.space === UiSpace.World);
    expect(world.length).toBeGreaterThan(0);
    expect(totalVerts(world)).toBeGreaterThan(0);
  });

  it('a pin over the world is consumed by the UI (so a click does not deselect/pan)', () => {
    const rt = new UiRuntime();
    rt.configure({ getAlertPins: () => PINS });
    rt.frame(W, H, DPR);
    expect(rt.consumesPointer(400, 300)).toBe(true);   // over a pin
    expect(rt.consumesPointer(40, 40)).toBe(false);     // empty world
  });

  it('clicking a pin fires onAlertPin with its id', () => {
    const fired: string[] = [];
    const rt = new UiRuntime();
    rt.configure({ getAlertPins: () => PINS, onAlertPin: (id) => fired.push(id) });
    rt.frame(W, H, DPR);
    const hit = rt.hitRegions().find((h) => h.id === 'alert.prayer:n1')!;
    click(rt, ...center(hit));
    expect(fired).toEqual(['prayer:n1']);
  });

  it('a modal (menu) suppresses the pins entirely', () => {
    const rt = new UiRuntime();
    rt.configure({ getAlertPins: () => PINS });
    rt.toggleMenu();
    rt.frame(W, H, DPR);
    expect(rt.hitRegions().some((h) => h.id.startsWith('alert.'))).toBe(false);
  });

  it('renders the selection-survives-zoom pin and reports its click', () => {
    const fired: string[] = [];
    const rt = new UiRuntime();
    rt.configure({
      getAlertPins: () => [{ id: 'selection', kind: 'selection', x: 600, y: 400, surfaced: false }],
      onAlertPin: (id) => fired.push(id),
    });
    rt.frame(W, H, DPR);
    const hit = rt.hitRegions().find((h) => h.id === 'alert.selection')!;
    expect(hit).toBeTruthy();
    click(rt, ...center(hit));
    expect(fired).toEqual(['selection']);
  });

  it('overlapping pins fire ONE action per click — the topmost (selection > surfaced > plain)', () => {
    const fired: string[] = [];
    const rt = new UiRuntime();
    rt.configure({
      getAlertPins: () => [
        { id: 'prayer:a', kind: 'prayer' as const, x: 600, y: 400, surfaced: false },
        { id: 'opp:b', kind: 'opportunity' as const, x: 602, y: 401, surfaced: true }, // overlaps, surfaced → on top
      ],
      onAlertPin: (id) => fired.push(id),
    });
    rt.frame(W, H, DPR);
    click(rt, 601, 400); // inside both hotspots
    expect(fired).toEqual(['opp:b']); // exactly one action, the topmost pin
  });
});

// ── WP-C: tidings (faith/mood turning points) render in the shipped chrome ──
describe('UiRuntime — tiding inbox items + pins (WP-C)', () => {
  const TIDING = {
    id: 'cross:vale',
    kind: 'tiding' as const,
    title: 'Faith rises in Vale',
    detail: '2 soul(s) crossed into belief.',
    salience: 0.2,
    surfaced: false,
    target: { kind: 'settlement' as const, poiId: 'vale' },
    anchor: { x: 5, y: 4 },
  };

  it('a tiding item renders in the inbox panel with the full triage row', () => {
    const rt = new UiRuntime();
    rt.configure({ getInbox: () => [TIDING] });
    rt.frame(W, H, DPR);
    const inboxBtn = rt.hitRegions().find((h) => h.id === 'ui.inbox')!;
    click(rt, ...center(inboxBtn)); // open the inbox panel
    const ids = rt.hitRegions().map((h) => h.id);
    expect(ids).toContain('inbox.act.cross:vale');
    expect(ids).toContain('inbox.look.cross:vale');
    expect(ids).toContain('inbox.ignore.cross:vale');
  });

  it('a tiding pin renders as a world marker and reports its click', () => {
    const fired: string[] = [];
    const rt = new UiRuntime();
    rt.configure({
      getAlertPins: () => [{ id: 'cross:vale', kind: 'tiding' as const, x: 500, y: 350, surfaced: false }],
      onAlertPin: (id) => fired.push(id),
    });
    const groups = rt.frame(W, H, DPR);
    expect(groups.filter((g) => g.space === UiSpace.World).length).toBeGreaterThan(0);
    const hit = rt.hitRegions().find((h) => h.id === 'alert.cross:vale')!;
    expect(hit).toBeTruthy();
    click(rt, ...center(hit));
    expect(fired).toEqual(['cross:vale']);
  });
});

// ── UI v2 W1/D4: World-band map-typography labels (the parked pins' replacement) ──
const LABELS: WorldLabelView[] = [
  { poiId: 'vale', name: 'Vale', x: 400, y: 300, badge: 0, focused: false, contestedBy: null },
  { poiId: 'crossing', name: 'Crossing', x: 800, y: 500, badge: 3, focused: true, contestedBy: 'Om' },
];

describe('UiRuntime — world-band settlement labels (W1/D4)', () => {
  it('draws no labels when the hook reports outside the world band (null)', () => {
    const rt = new UiRuntime();
    rt.configure({ getWorldLabels: () => null });
    rt.frame(W, H, DPR);
    expect(rt.hitRegions().some((h) => h.id.startsWith('wlabel.'))).toBe(false);
  });

  it('renders one clickable label per settlement, hotspot straddling its anchor', () => {
    const rt = new UiRuntime();
    rt.configure({ getWorldLabels: () => LABELS });
    rt.frame(W, H, DPR);
    const ids = rt.hitRegions().filter((h) => h.id.startsWith('wlabel.')).map((h) => h.id).sort();
    expect(ids).toEqual(['wlabel.crossing', 'wlabel.vale']);
    const hit = rt.hitRegions().find((h) => h.id === 'wlabel.vale')!;
    expect(hit.x).toBeLessThanOrEqual(400);
    expect(hit.x + hit.w).toBeGreaterThanOrEqual(400);
  });

  it('emits label geometry into a UiSpace.World draw group', () => {
    const rt = new UiRuntime();
    rt.configure({ getWorldLabels: () => LABELS });
    const groups = rt.frame(W, H, DPR);
    const world = groups.filter((g) => g.space === UiSpace.World);
    expect(world.length).toBeGreaterThan(0);
    expect(totalVerts(world)).toBeGreaterThan(0);
  });

  it('a label over the world is consumed by the UI (so a click does not deselect/pan)', () => {
    const rt = new UiRuntime();
    rt.configure({ getWorldLabels: () => LABELS });
    rt.frame(W, H, DPR);
    // The label floats ABOVE its map anchor (400,300) — probe its actual hotspot
    // rect (like the earlier "renders one clickable label" test) rather than the
    // raw anchor point, which sits on the box's bottom edge.
    const hit = rt.hitRegions().find((h) => h.id === 'wlabel.vale')!;
    expect(rt.consumesPointer(...center(hit))).toBe(true);
    expect(rt.consumesPointer(40, 40)).toBe(false);
  });

  it('clicking a label fires onWorldLabel with its poiId', () => {
    const fired: string[] = [];
    const rt = new UiRuntime();
    rt.configure({ getWorldLabels: () => LABELS, onWorldLabel: (id) => fired.push(id) });
    rt.frame(W, H, DPR);
    const hit = rt.hitRegions().find((h) => h.id === 'wlabel.crossing')!;
    click(rt, ...center(hit));
    expect(fired).toEqual(['crossing']);
  });

  it('a modal (menu) suppresses the labels entirely', () => {
    const rt = new UiRuntime();
    rt.configure({ getWorldLabels: () => LABELS });
    rt.toggleMenu();
    rt.frame(W, H, DPR);
    expect(rt.hitRegions().some((h) => h.id.startsWith('wlabel.'))).toBe(false);
  });
});

// ── Round 9 WP-B: the WebGPU time transport cluster ──────────────────────
function baseTimeStatus(overrides: Partial<TimeStatus> = {}): TimeStatus {
  return {
    requestedRate: 1,
    effectiveRate: 1,
    ladder: [1, 8, 60],
    paused: false,
    clockLabel: 'Y1 spring · 3/96 · 14:00',
    seeking: null,
    ...overrides,
  };
}

describe('UiRuntime — time transport cluster (Round 9 WP-B)', () => {
  it('renders nothing when timeStatus is unwired (gray-box)', () => {
    const rt = new UiRuntime();
    rt.frame(W, H, DPR);
    expect(rt.hitRegions().some((h) => h.id.startsWith('ui.time.'))).toBe(false);
  });

  it('renders the rate ladder FROM the hook data — not hardcoded', () => {
    const rt = new UiRuntime();
    rt.configure({ timeStatus: () => baseTimeStatus({ ladder: [2, 5, 30] }) });
    rt.frame(W, H, DPR);
    const ids = rt.hitRegions().map((h) => h.id);
    expect(ids).toContain('ui.time.rate.2');
    expect(ids).toContain('ui.time.rate.5');
    expect(ids).toContain('ui.time.rate.30');
    expect(ids).not.toContain('ui.time.rate.1'); // the default ladder isn't baked in
    expect(ids).toContain('ui.time.skip');
    expect(ids).toContain('ui.time.pause');
  });

  it('clicking a rate button dispatches set_rate with that rate', () => {
    const sent: TimeCommand[] = [];
    const rt = new UiRuntime();
    rt.configure({ timeStatus: () => baseTimeStatus({ ladder: [1, 8, 60] }), onTimeCommand: (c) => sent.push(c) });
    rt.frame(W, H, DPR);
    const btn = rt.hitRegions().find((h) => h.id === 'ui.time.rate.8')!;
    click(rt, ...center(btn));
    expect(sent).toEqual([{ kind: 'set_rate', rate: 8 }]);
  });

  it('the pause toggle dispatches toggle_pause', () => {
    const sent: TimeCommand[] = [];
    const rt = new UiRuntime();
    rt.configure({ timeStatus: () => baseTimeStatus(), onTimeCommand: (c) => sent.push(c) });
    rt.frame(W, H, DPR);
    const btn = rt.hitRegions().find((h) => h.id === 'ui.time.pause')!;
    click(rt, ...center(btn));
    expect(sent).toEqual([{ kind: 'toggle_pause' }]);
  });

  it('the ⏭ skip button dispatches skip_to_next_event', () => {
    const sent: TimeCommand[] = [];
    const rt = new UiRuntime();
    rt.configure({ timeStatus: () => baseTimeStatus(), onTimeCommand: (c) => sent.push(c) });
    rt.frame(W, H, DPR);
    const btn = rt.hitRegions().find((h) => h.id === 'ui.time.skip')!;
    click(rt, ...center(btn));
    expect(sent).toEqual([{ kind: 'skip_to_next_event' }]);
  });

  it('while seeking, the ladder + skip are replaced by a cancel affordance', () => {
    const rt = new UiRuntime();
    rt.configure({ timeStatus: () => baseTimeStatus({ seeking: { elapsedTicks: 12345, horizonTicks: 999999 } }) });
    rt.frame(W, H, DPR);
    const ids = rt.hitRegions().map((h) => h.id);
    expect(ids).not.toContain('ui.time.rate.1');
    expect(ids).not.toContain('ui.time.skip');
    expect(ids).toContain('ui.time.cancel');
    expect(ids).toContain('ui.time.pause'); // pause stays a live transport control throughout
  });

  it('cancel dispatches cancel_seek', () => {
    const sent: TimeCommand[] = [];
    const rt = new UiRuntime();
    rt.configure({
      timeStatus: () => baseTimeStatus({ seeking: { elapsedTicks: 0, horizonTicks: 100 } }),
      onTimeCommand: (c) => sent.push(c),
    });
    rt.frame(W, H, DPR);
    const btn = rt.hitRegions().find((h) => h.id === 'ui.time.cancel')!;
    click(rt, ...center(btn));
    expect(sent).toEqual([{ kind: 'cancel_seek' }]);
  });

  it('a transport press during an active seek sends cancel_seek FIRST, then the pressed command', () => {
    const sent: TimeCommand[] = [];
    const rt = new UiRuntime();
    rt.configure({
      timeStatus: () => baseTimeStatus({ seeking: { elapsedTicks: 500, horizonTicks: 100000 } }),
      onTimeCommand: (c) => sent.push(c),
    });
    rt.frame(W, H, DPR);
    const pause = rt.hitRegions().find((h) => h.id === 'ui.time.pause')!;
    click(rt, ...center(pause));
    expect(sent).toEqual([{ kind: 'cancel_seek' }, { kind: 'toggle_pause' }]);
  });
});

// ── Round 9 WP-B: the time landing card (rides the UiSpec/whisper-card surface) ──
describe('UiRuntime — time landing card (Round 9 WP-B)', () => {
  it('shows a dismissible modal card built from the landing summary', () => {
    const rt = new UiRuntime();
    rt.showTimeLandingCard({
      title: 'While you watched the sands…',
      body: 'A prayer went unanswered in Verdant Vale.',
      elapsedLabel: '3h 20m passed',
      quiet: false,
    });
    rt.frame(W, H, DPR);
    expect(rt.hasCard()).toBe(true);
    expect(rt.hitRegions().some((h) => h.id === 'card.body')).toBe(true);
    expect(rt.hitRegions().some((h) => h.id === 'card.choice.0')).toBe(true);
  });

  it('a quiet landing still shows a factual card', () => {
    const rt = new UiRuntime();
    rt.showTimeLandingCard({ title: 'A quiet day', body: 'A quiet day passed.', elapsedLabel: '24h passed', quiet: true });
    rt.frame(W, H, DPR);
    expect(rt.hasCard()).toBe(true);
  });

  it('the Continue choice dismisses the card without requiring a real command', () => {
    const rt = new UiRuntime();
    rt.showTimeLandingCard({ title: 'Landing', body: 'Something happened.', elapsedLabel: '1h passed', quiet: false });
    rt.frame(W, H, DPR);
    const btn = rt.hitRegions().find((h) => h.id === 'card.choice.0')!;
    click(rt, ...center(btn));
    expect(rt.hasCard()).toBe(false);
  });

  it('a backdrop click dismisses the landing card like the whisper card', () => {
    const rt = new UiRuntime();
    rt.showTimeLandingCard({ title: 'Landing', body: 'Something happened.', elapsedLabel: '1h passed', quiet: false });
    rt.frame(W, H, DPR);
    click(rt, 8, 8); // outside the centred card
    expect(rt.hasCard()).toBe(false);
  });
});

// ── UI v2 W0/D2: row-granular scroll adopted by the powers + inbox panels ───
function power(i: number): BeliefPowerView {
  return {
    domain: `d${i}`, label: `Power ${i}`, blurb: '', verb: `v${i}`,
    conviction: 1, threshold: 0, unlocked: true, reach: 1, believers: 1,
  };
}
function tiding(i: number): InboxItem {
  return {
    id: `t${i}`, kind: 'tiding', title: `Tiding ${i}`, detail: 'detail',
    salience: 0.1, surfaced: false, target: { kind: 'none' },
  };
}
/** Open the powers/inbox/pantheon panel via a real click on its toggle button. */
function openPanel(rt: UiRuntime, toggleId: 'ui.powers' | 'ui.inbox' | 'ui.pantheon'): void {
  rt.frame(W, H, DPR);
  const btn = rt.hitRegions().find((h) => h.id === toggleId)!;
  click(rt, ...center(btn));
}

describe('UiRuntime — scrollList adoption (D2): powers + inbox panels', () => {
  it('the powers panel windows to only the fully-fitting rows when it overflows', () => {
    const rt = new UiRuntime();
    const powers = Array.from({ length: 20 }, (_, i) => power(i));
    rt.configure({ getBeliefPowers: () => powers });
    openPanel(rt, 'ui.powers');
    const ids = rt.hitRegions().filter((h) => h.id.startsWith('power.cast.')).map((h) => h.id);
    expect(ids).toEqual(['power.cast.v0']); // only the first row fits at this panel height
  });

  it('a list that fits within the visible rows (no overflow) still renders every row, unchanged from pre-D2 behaviour', () => {
    const rt = new UiRuntime();
    const powers = [power(0)]; // rowCount(1) === visibleRows(1) at this panel size — no overflow
    rt.configure({ getBeliefPowers: () => powers });
    openPanel(rt, 'ui.powers');
    const ids = rt.hitRegions().filter((h) => h.id.startsWith('power.cast.')).map((h) => h.id);
    expect(ids).toEqual(['power.cast.v0']);
  });

  it('a wheel tick over the powers list steps exactly 3 rows, and a second tick steps 3 more', () => {
    const rt = new UiRuntime();
    const powers = Array.from({ length: 20 }, (_, i) => power(i));
    rt.configure({ getBeliefPowers: () => powers });
    openPanel(rt, 'ui.powers');
    const region = rt.scrollRegions().find((r) => r.id === 'ui.powers.list')!;
    const cx = region.x + region.w / 2, cy = region.y + region.h / 2;

    expect(rt.wheel(cx, cy, 100)).toBe(true); // deltaY > 0 ⇒ scroll forward, consumed
    rt.frame(W, H, DPR);
    expect(rt.hitRegions().find((h) => h.id.startsWith('power.cast.'))!.id).toBe('power.cast.v3');

    rt.wheel(cx, cy, 100);
    rt.frame(W, H, DPR);
    expect(rt.hitRegions().find((h) => h.id.startsWith('power.cast.'))!.id).toBe('power.cast.v6');
  });

  it('offset is clamped: scrolling far past the end holds the last valid row, and scrolling back up returns to row 0', () => {
    const rt = new UiRuntime();
    const powers = Array.from({ length: 20 }, (_, i) => power(i));
    rt.configure({ getBeliefPowers: () => powers });
    openPanel(rt, 'ui.powers');
    const region = rt.scrollRegions().find((r) => r.id === 'ui.powers.list')!;
    const cx = region.x + region.w / 2, cy = region.y + region.h / 2;

    for (let i = 0; i < 20; i++) rt.wheel(cx, cy, 100); // wildly overshoot
    rt.frame(W, H, DPR);
    const overshotId = rt.hitRegions().find((h) => h.id.startsWith('power.cast.'))!.id;
    expect(overshotId).toBe('power.cast.v19'); // clamped to the last row — never crashes/overshoots

    for (let i = 0; i < 20; i++) rt.wheel(cx, cy, -100);
    rt.frame(W, H, DPR);
    expect(rt.hitRegions().find((h) => h.id.startsWith('power.cast.'))!.id).toBe('power.cast.v0');
  });

  it('a wheel over the inbox panel scrolls its list independently of the powers list', () => {
    const rt = new UiRuntime();
    const items = Array.from({ length: 20 }, (_, i) => tiding(i));
    rt.configure({ getInbox: () => items });
    openPanel(rt, 'ui.inbox');
    const region = rt.scrollRegions().find((r) => r.id === 'ui.inbox.list')!;
    const cx = region.x + region.w / 2, cy = region.y + region.h / 2;
    const before = rt.hitRegions().filter((h) => h.id.startsWith('inbox.look.')).map((h) => h.id);
    expect(before.length).toBeGreaterThan(0);
    expect(before).not.toContain('inbox.look.t19'); // the tail is scrolled off initially

    rt.wheel(cx, cy, 100);
    rt.frame(W, H, DPR);
    const after = rt.hitRegions().filter((h) => h.id.startsWith('inbox.look.')).map((h) => h.id);
    expect(after).not.toEqual(before); // the wheel actually moved the window
  });

  it('a wheel outside any registered scroll region is left alone (returns false, offset unchanged)', () => {
    const rt = new UiRuntime();
    const powers = Array.from({ length: 20 }, (_, i) => power(i));
    rt.configure({ getBeliefPowers: () => powers });
    openPanel(rt, 'ui.powers');
    const before = rt.hitRegions().filter((h) => h.id.startsWith('power.cast.')).map((h) => h.id);
    expect(rt.wheel(4, 4, 100)).toBe(false); // top-left corner — outside the panel
    rt.frame(W, H, DPR);
    const after = rt.hitRegions().filter((h) => h.id.startsWith('power.cast.')).map((h) => h.id);
    expect(after).toEqual(before);
  });

  it('no panel open ⇒ no scroll regions and every wheel is a no-op', () => {
    const rt = new UiRuntime();
    rt.frame(W, H, DPR);
    expect(rt.scrollRegions()).toEqual([]);
    expect(rt.wheel(W / 2, H / 2, 100)).toBe(false);
  });
});

// ── UI v2 W0/D2 + D3: real DOM event routing through `attach()` ─────────────
describe('UiRuntime — attach(): wheel routing + D3 preventDefault on consumed pointers', () => {
  it('a real wheel event over a registered scroll region is consumed (preventDefault + stopPropagation)', () => {
    const canvas = mountedCanvasForInput();
    const rt = new UiRuntime();
    const powers = Array.from({ length: 20 }, (_, i) => power(i));
    rt.configure({ getBeliefPowers: () => powers });
    const teardown = rt.attach(canvas);
    openPanel(rt, 'ui.powers');
    const region = rt.scrollRegions().find((r) => r.id === 'ui.powers.list')!;
    const cx = region.x + region.w / 2, cy = region.y + region.h / 2;

    const ev = new WheelEvent('wheel', { clientX: cx, clientY: cy, deltaY: 100, bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(ev, 'preventDefault');
    const stopPropagation = vi.spyOn(ev, 'stopPropagation');
    canvas.dispatchEvent(ev);
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();

    // and the scroll actually happened (end-to-end, not just the flags)
    rt.frame(W, H, DPR);
    expect(rt.hitRegions().find((h) => h.id.startsWith('power.cast.'))!.id).toBe('power.cast.v3');
    teardown();
  });

  it('a real wheel event away from any scroll region is left alone — world zoom keeps working', () => {
    const canvas = mountedCanvasForInput();
    const rt = new UiRuntime();
    const powers = Array.from({ length: 20 }, (_, i) => power(i));
    rt.configure({ getBeliefPowers: () => powers });
    const teardown = rt.attach(canvas);
    openPanel(rt, 'ui.powers'); // panel is open, but the wheel below lands OUTSIDE it

    const ev = new WheelEvent('wheel', { clientX: W - 4, clientY: H - 4, deltaY: 100, bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(ev, 'preventDefault');
    canvas.dispatchEvent(ev);
    expect(preventDefault).not.toHaveBeenCalled(); // never touched — controls.ts's own listener still sees it

    teardown();
  });

  it('no UI open at all ⇒ every wheel falls through untouched', () => {
    const canvas = mountedCanvasForInput();
    const rt = new UiRuntime();
    const teardown = rt.attach(canvas);
    rt.frame(W, H, DPR);

    const ev = new WheelEvent('wheel', { clientX: W / 2, clientY: H / 2, deltaY: 100, bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(ev, 'preventDefault');
    canvas.dispatchEvent(ev);
    expect(preventDefault).not.toHaveBeenCalled();
    teardown();
  });

  it('D3: a pointerdown the UI consumes (over a widget) gets preventDefault, suppressing the compat mousedown', () => {
    const canvas = mountedCanvasForInput();
    const rt = new UiRuntime();
    const teardown = rt.attach(canvas);
    rt.frame(W, H, DPR);
    const orb = rt.hitRegions().find((h) => h.id === 'ui.orb')!;
    const [x, y] = center(orb);

    const ev = new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(ev, 'preventDefault');
    const stopPropagation = vi.spyOn(ev, 'stopPropagation');
    canvas.dispatchEvent(ev);
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    teardown();
  });

  it('D3: a pointerup the UI consumes (modal menu open — eats everything) gets preventDefault', () => {
    const canvas = mountedCanvasForInput();
    const rt = new UiRuntime();
    const teardown = rt.attach(canvas);
    rt.toggleMenu();
    rt.frame(W, H, DPR);

    const ev = new PointerEvent('pointerup', { clientX: 5, clientY: 5, bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(ev, 'preventDefault');
    canvas.dispatchEvent(ev);
    expect(preventDefault).toHaveBeenCalled();
    teardown();
  });

  it('D3 (control): a pointerdown over the empty world (nothing consumed) is NOT prevented — world click/pan still works', () => {
    const canvas = mountedCanvasForInput();
    const rt = new UiRuntime();
    const teardown = rt.attach(canvas);
    rt.frame(W, H, DPR); // no panel, no menu — HUD only claims its own widgets

    const ev = new PointerEvent('pointerdown', { clientX: W / 2, clientY: H / 2, bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(ev, 'preventDefault');
    const stopPropagation = vi.spyOn(ev, 'stopPropagation');
    canvas.dispatchEvent(ev);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopPropagation).not.toHaveBeenCalled();
    teardown();
  });
});

// ── W4 (D7): the pantheon panel — the rival roster finally visible ──────────
function pantheonRow(overrides: Partial<PantheonRow> = {}): PantheonRow {
  return {
    id: 'rival1', name: 'Sablethorn', isPlayer: false, sigil: '◆', color: '#f00',
    power: 10, followers: 3, stance: 'expand', strongestPoiId: 'vale',
    ...overrides,
  };
}
const PLAYER_ROW: PantheonRow = {
  id: 'player', name: 'You', isPlayer: true, sigil: '⊙', color: '#0af',
  power: 12, followers: 5, stance: '', strongestPoiId: null,
};

describe('UiRuntime — pantheon panel (UI v2 W4/D7)', () => {
  it('the SPIRITS pill shows the roster count and is absent from the panel when closed', () => {
    const rt = new UiRuntime();
    rt.configure({ getPantheon: () => [PLAYER_ROW, pantheonRow()] });
    rt.frame(W, H, DPR);
    const pill = rt.hitRegions().find((h) => h.id === 'ui.pantheon');
    expect(pill).toBeDefined();
    expect(rt.scrollRegions().some((r) => r.id === 'ui.pantheon.list')).toBe(false);
  });

  it('clicking the pill opens the panel and registers a scrollList', () => {
    const rt = new UiRuntime();
    rt.configure({ getPantheon: () => [PLAYER_ROW, pantheonRow()] });
    openPanel(rt, 'ui.pantheon');
    expect(rt.scrollRegions().some((r) => r.id === 'ui.pantheon.list')).toBe(true);
  });

  it('is mutually exclusive with the powers and inbox panels', () => {
    const rt = new UiRuntime();
    rt.configure({
      getPantheon: () => [PLAYER_ROW, pantheonRow()],
      getBeliefPowers: () => [power(0)],
    });
    openPanel(rt, 'ui.pantheon');
    expect(rt.scrollRegions().some((r) => r.id === 'ui.pantheon.list')).toBe(true);

    openPanel(rt, 'ui.powers');
    expect(rt.scrollRegions().some((r) => r.id === 'ui.pantheon.list')).toBe(false);
    expect(rt.scrollRegions().some((r) => r.id === 'ui.powers.list')).toBe(true);
  });

  it('clicking a rival row (with a resolvable strongest settlement) fires onPantheonRow with its id', () => {
    const fired: string[] = [];
    const rt = new UiRuntime();
    rt.configure({
      getPantheon: () => [PLAYER_ROW, pantheonRow({ id: 'rival1' })],
      onPantheonRow: (id) => fired.push(id),
    });
    openPanel(rt, 'ui.pantheon');
    const hit = rt.hitRegions().find((h) => h.id === 'pantheon.row.rival1')!;
    click(rt, ...center(hit));
    expect(fired).toEqual(['rival1']);
  });

  it('the player row is never clickable (no hotspot, onPantheonRow never fires)', () => {
    const fired: string[] = [];
    const rt = new UiRuntime();
    rt.configure({
      getPantheon: () => [PLAYER_ROW, pantheonRow({ id: 'rival1' })],
      onPantheonRow: (id) => fired.push(id),
    });
    openPanel(rt, 'ui.pantheon');
    expect(rt.hitRegions().some((h) => h.id === 'pantheon.row.player')).toBe(false);
  });

  it('clamps a long spirit name + stance inside the panel (W5 — no glyph past the panel edge)', () => {
    const rt = new UiRuntime();
    rt.configure({ getPantheon: () => [
      PLAYER_ROW,
      pantheonRow({ id: 'r', name: 'SABLETHORNTHEUNRELENTINGDEVOUREROFALLMORTALHOPE', stance: 'undermine', followers: 999 }),
    ] });
    openPanel(rt, 'ui.pantheon');
    const groups = rt.frame(W, H, DPR);
    // the pantheon panel lives on the LEFT — window out the top-right time cluster.
    const glyphRight = maxScreenX(groups, UiPage.Bitmap, -Infinity, 800);
    const panelRight = maxScreenX(groups, UiPage.Solid, -Infinity, 800);
    expect(glyphRight).toBeLessThanOrEqual(panelRight); // text stays within the panel bg
  });

  it('a rival with no resolvable strongest settlement is not clickable either', () => {
    const rt = new UiRuntime();
    rt.configure({ getPantheon: () => [PLAYER_ROW, pantheonRow({ id: 'rival1', strongestPoiId: null })] });
    openPanel(rt, 'ui.pantheon');
    expect(rt.hitRegions().some((h) => h.id === 'pantheon.row.rival1')).toBe(false);
  });

  it('an empty pantheon renders no scroll list (no rows to browse)', () => {
    const rt = new UiRuntime();
    rt.configure({ getPantheon: () => [] });
    openPanel(rt, 'ui.pantheon');
    expect(rt.scrollRegions().some((r) => r.id === 'ui.pantheon.list')).toBe(false);
  });
});

// ── W4 (D9): the chronicle browser — the inbox panel's TIDINGS/ANNALS toggle ─
function annal(i: number): AnnalRow {
  return { day: i, title: `Y1 spring, day ${i}`, body: `Entry number ${i} happened, at length.` };
}

describe('UiRuntime — inbox TIDINGS/ANNALS toggle (UI v2 W4/D9)', () => {
  it('defaults to TIDINGS — the toggle row + the existing item list both render', () => {
    const rt = new UiRuntime();
    const items = [tiding(0)];
    rt.configure({ getInbox: () => items, getAnnals: () => [annal(0)] });
    openPanel(rt, 'ui.inbox');
    expect(rt.hitRegions().some((h) => h.id === 'ui.inbox.tab.tidings')).toBe(true);
    expect(rt.hitRegions().some((h) => h.id === 'ui.inbox.tab.annals')).toBe(true);
    expect(rt.scrollRegions().some((r) => r.id === 'ui.inbox.list')).toBe(true);
    expect(rt.scrollRegions().some((r) => r.id === 'ui.annals.list')).toBe(false);
  });

  it('clicking ANNALS switches the panel to the chronicle browser', () => {
    const rt = new UiRuntime();
    rt.configure({ getInbox: () => [tiding(0)], getAnnals: () => [annal(0), annal(1)] });
    openPanel(rt, 'ui.inbox');
    const annalsTab = rt.hitRegions().find((h) => h.id === 'ui.inbox.tab.annals')!;
    click(rt, ...center(annalsTab));

    expect(rt.scrollRegions().some((r) => r.id === 'ui.annals.list')).toBe(true);
    expect(rt.scrollRegions().some((r) => r.id === 'ui.inbox.list')).toBe(false);
  });

  it('clicking TIDINGS after ANNALS switches back', () => {
    const rt = new UiRuntime();
    rt.configure({ getInbox: () => [tiding(0)], getAnnals: () => [annal(0)] });
    openPanel(rt, 'ui.inbox');
    click(rt, ...center(rt.hitRegions().find((h) => h.id === 'ui.inbox.tab.annals')!));
    rt.frame(W, H, DPR);
    click(rt, ...center(rt.hitRegions().find((h) => h.id === 'ui.inbox.tab.tidings')!));

    expect(rt.scrollRegions().some((r) => r.id === 'ui.inbox.list')).toBe(true);
    expect(rt.scrollRegions().some((r) => r.id === 'ui.annals.list')).toBe(false);
  });

  it('an empty chronicle renders a dim "NO ANNALS YET" row instead of a scroll list', () => {
    const rt = new UiRuntime();
    rt.configure({ getInbox: () => [], getAnnals: () => [] });
    openPanel(rt, 'ui.inbox');
    click(rt, ...center(rt.hitRegions().find((h) => h.id === 'ui.inbox.tab.annals')!));
    const groups = rt.frame(W, H, DPR);

    expect(rt.scrollRegions().some((r) => r.id === 'ui.annals.list')).toBe(false);
    expect(rt.hitRegions().some((h) => h.id.startsWith('annal.row.'))).toBe(false);
    expect(totalVerts(groups)).toBeGreaterThan(0); // the "NO ANNALS YET" label still drew something
  });

  it('clicking an annal row presents its full text as a one-shot UiSpec card', () => {
    const rt = new UiRuntime();
    rt.configure({ getInbox: () => [], getAnnals: () => [annal(0)] });
    openPanel(rt, 'ui.inbox');
    click(rt, ...center(rt.hitRegions().find((h) => h.id === 'ui.inbox.tab.annals')!));
    rt.frame(W, H, DPR);
    const row = rt.hitRegions().find((h) => h.id === 'annal.row.0')!;
    click(rt, ...center(row));
    rt.frame(W, H, DPR); // the card takes over the NEXT frame's top-level dispatch

    expect(rt.hasCard()).toBe(true);
    expect(rt.hitRegions().some((h) => h.id === 'card.body')).toBe(true);
    const dismiss = rt.hitRegions().find((h) => h.id === 'card.choice.0')!;
    click(rt, ...center(dismiss));
    expect(rt.hasCard()).toBe(false);
  });
});
