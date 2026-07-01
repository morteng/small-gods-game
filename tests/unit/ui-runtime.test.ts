import { describe, it, expect } from 'vitest';
import { UiRuntime } from '@/render/ui/ui-runtime';
import { UiPage, type UiDrawGroup } from '@/render/ui/ui-batcher';
import type { UiHit } from '@/render/ui/ui-context';

const W = 1280, H = 720, DPR = 2;

function totalVerts(groups: UiDrawGroup[]): number {
  return groups.reduce((s, g) => s + g.vertexCount, 0);
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
