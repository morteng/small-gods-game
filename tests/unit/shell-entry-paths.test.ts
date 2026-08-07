import { describe, it, expect } from 'vitest';
import { Shell } from '@/render/ui/shell/shell';
import type { ScreenId } from '@/render/ui/shell/shell-state';

/**
 * EVERY way into a world must land in the same place: in game, HUD active, no meta
 * screen left drawn.
 *
 * This exists because it did not. `Shell.show()` used `replace`, which collapses
 * only the TOP of the stack, so the outcome depended on how deep the player was
 * when the world started loading:
 *
 *   ['title']          → ['loading'] → hide → []              ✓ HUD (NEW WORLD)
 *   ['title','load']   → ['title','loading'] → hide → ['title'] ✗ title drawn
 *                                                              over the live world
 *
 * A live GPU pass found exactly that: picking a slot on the load screen booted and
 * rendered the world (sim running, 33 FPS) with the title screen still painted on
 * top and no HUD. `show()`/`hide()` are now depth-independent (`reset`), and these
 * tests pin the invariant for every entry path rather than for the one that
 * happened to be shallow.
 *
 * Boot drives the shell through the `LoadingSurface` contract — `show()` when
 * generation begins, `hide()` when the art has settled — so replaying that pair
 * over each starting stack IS the real sequence, with no world or GPU needed.
 */

const TITLE_VIEW = {
  continueLine: 'Y1 SPRING · 2/96',
  continueBlocked: null,
  hasAnySave: true,
  buildLine: 'WORLD 119',
};

function shell(): Shell {
  return new Shell({ now: () => 0, titleView: () => TITLE_VIEW });
}

/** Run one world-entry: whatever boot does to the shell, from `from`. */
function enterWorldFrom(from: readonly ScreenId[]): Shell {
  const s = shell();
  s.reset(from);
  s.show();                       // boot-sequence: loading.show()
  s.setProgress(0.5, 'CARVING RIVERS…');
  s.hide();                       // art settled: loading.hide()
  return s;
}

describe('every world-entry path lands in game with no meta screen', () => {
  const paths: Array<{ name: string; from: ScreenId[] }> = [
    { name: 'title → NEW WORLD', from: ['title'] },
    { name: 'title → CONTINUE', from: ['title'] },
    { name: 'title → LOAD WORLD → pick a slot', from: ['title', 'load'] },
    // Not built yet, but the invariant must already hold for it — the pause menu
    // is IN-GAME, so its load path starts at depth 1 or 2 with no title beneath.
    { name: 'pause menu → load (future)', from: ['pause', 'load'] },
    // Defensive: an arbitrarily deep path must still collapse.
    { name: 'a deep path', from: ['title', 'settings', 'load'] },
  ];

  for (const { name, from } of paths) {
    it(`${name} → HUD, empty stack`, () => {
      const s = enterWorldFrom(from);
      expect(s.top(), `${name} left a screen on top`).toBeNull();
      expect(s.depth(), `${name} left a non-empty stack`).toBe(0);
      expect(s.isActive(), `${name} left the shell modal over the world`).toBe(false);
      // and the agent-facing surface agrees the player is in the world
      const d = s.describe();
      expect(d.screen).toBeNull();
      expect(d.stack).toEqual([]);
      expect(d.choices).toEqual([]);
    });
  }

  it('show() makes the loading screen the WHOLE stack, at any depth', () => {
    for (const from of [['title'], ['title', 'load'], ['pause', 'settings', 'load']] as ScreenId[][]) {
      const s = shell();
      s.reset(from);
      s.show();
      expect(s.top()).toBe('loading');
      expect(s.depth(), `depth after show() from ${from.join('>')}`).toBe(1);
      expect(s.has('title')).toBe(false);
      expect(s.has('load')).toBe(false);
    }
  });

  it('a second show() during the same boot is idempotent', () => {
    // `runBootSequence` calls show() once, but a retry/re-entry must not stack.
    const s = shell();
    s.reset(['title']);
    s.show();
    s.show();
    expect(s.depth()).toBe(1);
    expect(s.top()).toBe('loading');
  });

  it('hide() with no loading screen up is a no-op (never clears a live menu)', () => {
    // Guards the reset in `hide()`: it must only fire for the loading screen, or a
    // stray hide() would dismiss whatever the player actually had open.
    const s = shell();
    s.reset(['title', 'settings']);
    s.hide();
    expect(s.describe().stack).toEqual(['title', 'settings']);
  });

  it('the shell is modal for the WHOLE of a load, then hands over cleanly', () => {
    const s = shell();
    s.reset(['title', 'load']);
    expect(s.isActive()).toBe(true);
    s.show();
    expect(s.isActive(), 'must stay modal while loading').toBe(true);
    s.setProgress(1, 'ENTERING THE WORLD…');
    expect(s.isActive()).toBe(true);
    s.hide();
    expect(s.isActive(), 'must release the frame once the world is up').toBe(false);
  });

  it('quit-to-title then re-entry still lands in game', () => {
    // The full round trip the in-process quit-to-title enables: play → title →
    // load → play. A leaked screen here would strand the player permanently.
    const s = shell();
    s.reset([]);                 // in game
    s.reset(['title']);          // returnToTitle()
    s.push('load');              // LOAD WORLD
    s.show();
    s.hide();
    expect(s.depth()).toBe(0);
    expect(s.isActive()).toBe(false);
  });
});
