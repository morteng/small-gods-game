// src/game/art-settle-gate.ts
//
// Boot gate: hold the loading screen until the building art has SETTLED.
//
// Worldgen-ready is not visually-ready: building/barrier packs keep streaming in
// (IDB loads + composes) for many seconds after the first frame, so fading the
// loading screen at worldgen-ready shows the player grey massing that pops into
// textured buildings piecemeal (user rule 2026-07-13: the player never sees grey
// boxes). "Settled" is observed through two live signals rather than a completion
// event (the art sources have none — packs resolve independently):
//   1. no pending work — compose-queue depth PLUS the art sources' in-flight
//      warm counts (`pending()`). The queue alone misses warm-cache boots,
//      where every pack is an IDB read and the compose queue never fills; and
//   2. the art revision (sum of the sources' `version()` counters, the same
//      signal the draw-cache debounce watches) has been QUIET for `quietMs`.
// The caller must PREWARM every building/barrier before gating (Game does) —
// the frame path only warms viewport entities, so without the prewarm these
// signals go quiet while off-screen towns are still bare grey massing.
// A hard `maxWaitMs` bounds the hold so a wedged source (or a hidden tab, whose
// paused frame loop stops driving demand-loads) can never trap the player on the
// overlay — on timeout we fade anyway and buildings finish streaming in-world.
//
// Clock + sleep are injectable so the polling logic is unit-testable without
// timers.

/** Rev must hold still this long to count as settled — matches the draw-cache
 *  debounce's notion of "the pack stream has gone quiet". */
export const ART_SETTLE_QUIET_MS = 600;
/** Never hold the loading screen longer than this past worldgen-ready. */
export const ART_SETTLE_MAX_WAIT_MS = 25_000;
/** Poll cadence — coarse is fine; this races nothing. */
export const ART_SETTLE_POLL_MS = 200;

export interface ArtSettleGateOpts {
  /** Jobs enqueued on the compose scheduler but not yet settled. */
  pendingComposes(): number;
  /** Live art revision (monotonic; any pack landing bumps it). */
  artRev(): number;
  /** Called each poll with the current pending-compose count (progress label). */
  onProgress?(pending: number): void;
  quietMs?: number;
  maxWaitMs?: number;
  pollMs?: number;
  /** Injectable clock/sleep for tests. */
  now?(): number;
  wait?(ms: number): Promise<void>;
}

/** Resolves 'settled' when composes drained AND the rev has been quiet, or
 *  'timeout' at the hard bound. Never rejects. */
export async function waitForArtSettled(opts: ArtSettleGateOpts): Promise<'settled' | 'timeout'> {
  const quietMs = opts.quietMs ?? ART_SETTLE_QUIET_MS;
  const maxWaitMs = opts.maxWaitMs ?? ART_SETTLE_MAX_WAIT_MS;
  const pollMs = opts.pollMs ?? ART_SETTLE_POLL_MS;
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const start = now();
  let lastRev = opts.artRev();
  let lastRevChange = start;

  for (;;) {
    const t = now();
    const rev = opts.artRev();
    if (rev !== lastRev) {
      lastRev = rev;
      lastRevChange = t;
    }
    const pending = opts.pendingComposes();
    opts.onProgress?.(pending);
    if (pending === 0 && t - lastRevChange >= quietMs) return 'settled';
    if (t - start >= maxWaitMs) return 'timeout';
    await wait(pollMs);
  }
}
