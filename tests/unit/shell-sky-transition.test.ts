import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Shell } from '@/render/ui/shell/shell';
import {
  beginTransition, clearTransition, skipTransition, transitionPhase,
  EMPTY_SHELL, type TransitionState,
} from '@/render/ui/shell/shell-state';
import { coverageFor, descentCameraOffsetPx, ascentResetDue } from '@/game/sky-transition';

// UI v3 sky/cloud transition spike — sequencing tests for the three rules the
// brief calls out:
//   (a) the descent never starts before the art-settle gate clears;
//   (b) an ascent completing implies the state reset ran, and a skip still
//       forces it;
//   (c) click-to-skip lands the EXACT end state.
// Each is written so it can fail — see the commit message for what was broken
// and restored while writing these.

describe('shell-state — the transition phase clock (pure reducer)', () => {
  it('beginTransition discards the stack and starts the phase clock at 0', () => {
    const s = beginTransition('descent', 1000, 2800);
    expect(s.stack).toEqual([]);
    expect(s.transition).toEqual({ kind: 'descent', startedAtMs: 1000, durationMs: 2800 });
    expect(transitionPhase(s.transition!, 1000)).toBe(0);
  });

  it('transitionPhase is linear and clamped at both ends', () => {
    const t: TransitionState = { kind: 'descent', startedAtMs: 1000, durationMs: 2000 };
    expect(transitionPhase(t, 1000)).toBe(0);
    expect(transitionPhase(t, 2000)).toBe(0.5);
    expect(transitionPhase(t, 3000)).toBe(1);
    expect(transitionPhase(t, 5000)).toBe(1);   // never past 1
    expect(transitionPhase(t, 0)).toBe(0);      // never negative (clock ran backward)
  });

  it('clearTransition is a no-op returning the SAME object when there is none', () => {
    expect(clearTransition(EMPTY_SHELL)).toBe(EMPTY_SHELL);
  });

  it('skipTransition rewinds startedAtMs so the phase reads 1 immediately', () => {
    const s = beginTransition('ascent', 1000, 1500);
    const skipped = skipTransition(s, 1200); // skipped only 200ms in
    expect(transitionPhase(skipped.transition!, 1200)).toBe(1);
    // kind/durationMs untouched
    expect(skipped.transition!.kind).toBe('ascent');
    expect(skipped.transition!.durationMs).toBe(1500);
  });

  it('skipTransition on no transition is a no-op', () => {
    expect(skipTransition(EMPTY_SHELL, 5000)).toBe(EMPTY_SHELL);
  });
});

describe('Shell — sky/cloud transitions', () => {
  it('(a) a descent is null through show()/setProgress()/setChronicle() — ONLY hide() starts it', () => {
    const shell = new Shell({ now: () => 500 });
    expect(shell.transition()).toBeNull();
    shell.show();
    expect(shell.transition()).toBeNull();
    shell.setProgress(0.4, 'Carving rivers…');
    expect(shell.transition()).toBeNull();
    shell.setChronicle(['THE FIRST YEAR PASSED QUIETLY']);
    expect(shell.transition()).toBeNull();
    shell.hide();
    expect(shell.transition()?.kind).toBe('descent');
    expect(shell.transitionPhase(500)).toBe(0);
  });

  it('(a, guard) hide() with no loading screen up starts NO descent either', () => {
    // hide() only reacts when 'loading' is on top — the guard `hide()`'s doc
    // already documents; a stray hide() elsewhere in the shell must not
    // start a descent out of nowhere.
    const shell = new Shell({ now: () => 0 });
    shell.push('title');
    shell.hide();
    expect(shell.transition()).toBeNull();
  });

  it('(a, source guard) boot-sequence.ts calls loading.hide() only AFTER awaiting waitForArtSettled', () => {
    // The Shell-level tests above prove hide() is the ONLY thing that starts a
    // descent; this pins the other half of the guarantee — that hide()'s one
    // call site in the boot sequence textually follows the art-settle await,
    // so "descent starts only once the gate clears" holds by construction,
    // not by convention. Mirrors the WGSL-backtick guard's textual-source style.
    const src = readFileSync('src/game/boot-sequence.ts', 'utf8');
    const awaitIdx = src.indexOf('await waitForArtSettled(');
    const hideIdx = src.indexOf('loading.hide()');
    expect(awaitIdx).toBeGreaterThan(-1);
    expect(hideIdx).toBeGreaterThan(-1);
    expect(hideIdx).toBeGreaterThan(awaitIdx);
    // and there is exactly ONE call site — a second one elsewhere would be a
    // way to sneak a descent in before the gate clears.
    expect(src.split('loading.hide()').length - 1).toBe(1);
  });

  it('beginAscent discards whatever screen was up (a pause menu must not survive over the billowing cloud)', () => {
    const shell = new Shell({ now: () => 0 });
    shell.push('title');
    shell.push('pause'); // 'pause' has no drawer yet but is a legal ScreenId
    shell.beginAscent();
    expect(shell.top()).toBeNull();
    expect(shell.transition()?.kind).toBe('ascent');
  });

  it('transitionActive tracks the transition, independent of the (empty) stack', () => {
    const shell = new Shell({ now: () => 0 });
    expect(shell.transitionActive()).toBe(false);
    shell.beginAscent();
    expect(shell.isActive()).toBe(false);     // the stack is empty — HUD draws
    expect(shell.transitionActive()).toBe(true); // but a transition IS running
  });

  it('(c) click-to-skip lands the EXACT end state — for both kinds', () => {
    let now = 1000;
    const shell = new Shell({ now: () => now });
    shell.beginAscent();
    now = 1200; // only 200 of 1500ms elapsed
    shell.skipTransition();
    const phase = shell.transitionPhase(now)!;
    expect(phase).toBe(1);
    expect(coverageFor('ascent', phase)).toBe(1);       // fully covered
    expect(ascentResetDue('ascent', phase, false)).toBe(true); // and the reset is due

    const descentShell = new Shell({ now: () => now });
    descentShell.show();
    descentShell.hide(); // starts the descent at `now`
    now = 1250; // barely started
    descentShell.skipTransition();
    const dPhase = descentShell.transitionPhase(now)!;
    expect(dPhase).toBe(1);
    expect(coverageFor('descent', dPhase)).toBe(0);          // fully revealed
    expect(descentCameraOffsetPx(dPhase)).toBe(0);           // camera fully settled
  });

  it('clearTransition drops it; a completed descent is expected to self-clear (see Game.tickShellTransition)', () => {
    const shell = new Shell({ now: () => 0 });
    shell.show();
    shell.hide();
    expect(shell.transitionActive()).toBe(true);
    shell.clearTransition();
    expect(shell.transitionActive()).toBe(false);
  });
});

describe('sky-transition — (b) ascent completion implies the reset ran (integration sketch)', () => {
  // `Game.tickShellTransition` is the actual wiring (needs a live Game/canvas
  // to exercise end-to-end); its DECISION is the pure `ascentResetDue` tested
  // exhaustively in sky-transition.test.ts. This test proves the two halves
  // compose: once `Shell` reports phase 1 for an ascent, the pure decision
  // function says the reset is due, exactly once, and stays "already handled"
  // afterward — the same guard `tickShellTransition` reads every frame.
  it('phase reaching 1 flips ascentResetDue true exactly once across repeated frame reads', () => {
    let now = 0;
    const shell = new Shell({ now: () => now });
    shell.beginAscent();
    let fired = false;
    const framesDue: boolean[] = [];
    for (const dt of [0, 400, 900, 1500, 1600, 2000]) {
      now = dt;
      const phase = shell.transitionPhase(now);
      const due = ascentResetDue('ascent', phase, fired);
      framesDue.push(due);
      if (due) fired = true;
    }
    // exactly one frame decided the reset was due
    expect(framesDue.filter(Boolean).length).toBe(1);
    // and it was the first frame at/after the full duration (1500ms)
    expect(framesDue[3]).toBe(true);
  });
});
