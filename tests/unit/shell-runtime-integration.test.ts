import { describe, it, expect, vi } from 'vitest';
import { UiRuntime } from '@/render/ui/ui-runtime';
import { UiPage, UiSpace, type UiDrawGroup } from '@/render/ui/ui-batcher';
import { Shell } from '@/render/ui/shell/shell';
import type { TitleView } from '@/render/ui/shell/title-screen';

const W = 1280, H = 720, DPR = 2;

function totalVerts(groups: UiDrawGroup[]): number {
  return groups.reduce((s, g) => s + g.vertexCount, 0);
}

const TITLE: TitleView = {
  continueLine: 'DAY 3', continueBlocked: null, hasAnySave: true, buildLine: 'W 118',
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
    for (const g of rt.frame(W, H, DPR)) {
      if (g.space !== UiSpace.Screen || g.page !== UiPage.Solid) continue;
      for (let i = 0; i < g.vertexCount * 8; i += 8) {
        expect(g.vertices[i]).toBeGreaterThanOrEqual(0);
        expect(g.vertices[i]).toBeLessThanOrEqual(W);
        expect(g.vertices[i + 1]).toBeGreaterThanOrEqual(0);
        expect(g.vertices[i + 1]).toBeLessThanOrEqual(H);
      }
    }
  });
});
