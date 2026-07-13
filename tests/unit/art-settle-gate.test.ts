import { describe, it, expect } from 'vitest';
import { waitForArtSettled, ART_SETTLE_QUIET_MS, ART_SETTLE_MAX_WAIT_MS } from '@/game/art-settle-gate';

// Deterministic harness: virtual clock advanced by the injected wait(), so the
// polling loop runs to completion synchronously with no real timers.
function harness(script: { composes: (t: number) => number; rev: (t: number) => number }) {
  let t = 0;
  const progress: number[] = [];
  return {
    progress,
    run: (opts?: { quietMs?: number; maxWaitMs?: number }) =>
      waitForArtSettled({
        pendingComposes: () => script.composes(t),
        artRev: () => script.rev(t),
        onProgress: (p) => progress.push(p),
        now: () => t,
        wait: (ms) => { t += ms; return Promise.resolve(); },
        pollMs: 100,
        ...opts,
      }),
    time: () => t,
  };
}

describe('waitForArtSettled', () => {
  it('settles once composes drain AND the rev has been quiet', async () => {
    // Rev bumps every 200ms until t=1000; composes pending until t=800.
    const h = harness({
      composes: (t) => (t < 800 ? 3 : 0),
      rev: (t) => Math.floor(Math.min(t, 1000) / 200),
    });
    const outcome = await h.run();
    expect(outcome).toBe('settled');
    // Can't settle before the last rev change (t=1000) + quiet window.
    expect(h.time()).toBeGreaterThanOrEqual(1000 + ART_SETTLE_QUIET_MS);
    expect(h.time()).toBeLessThan(ART_SETTLE_MAX_WAIT_MS);
  });

  it('an already-settled boot (warm cache, nothing pending) fades after one quiet window', async () => {
    const h = harness({ composes: () => 0, rev: () => 7 });
    const outcome = await h.run();
    expect(outcome).toBe('settled');
    expect(h.time()).toBeLessThanOrEqual(ART_SETTLE_QUIET_MS + 100);
  });

  it('a never-settling stream hits the hard timeout instead of trapping the player', async () => {
    const h = harness({
      composes: () => 1,                       // wedged compose
      rev: (t) => Math.floor(t / 100),         // rev never quiets either
    });
    const outcome = await h.run();
    expect(outcome).toBe('timeout');
    expect(h.time()).toBeGreaterThanOrEqual(ART_SETTLE_MAX_WAIT_MS);
    expect(h.time()).toBeLessThan(ART_SETTLE_MAX_WAIT_MS + 200);
  });

  it('quiet rev alone is not enough while composes are pending', async () => {
    // Rev frozen from the start, but composes pend until t=2000 — must not
    // settle at the quiet window; must settle one poll after the drain.
    const h = harness({ composes: (t) => (t < 2000 ? 2 : 0), rev: () => 1 });
    const outcome = await h.run();
    expect(outcome).toBe('settled');
    expect(h.time()).toBeGreaterThanOrEqual(2000);
  });

  it('reports pending counts to the progress callback', async () => {
    const h = harness({ composes: (t) => (t < 300 ? 5 : 0), rev: () => 1 });
    await h.run();
    expect(h.progress[0]).toBe(5);
    expect(h.progress[h.progress.length - 1]).toBe(0);
  });
});
