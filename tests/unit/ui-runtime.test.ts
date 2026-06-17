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
