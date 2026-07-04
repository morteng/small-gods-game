// src/render/compose-scheduler.ts
//
// Serialized, main-thread-friendly scheduler for runtime sprite composition
// (`composeStructure` and friends). WHY: on first render every visible building,
// wall segment and plant species fires `warm()` → compose. Each compose is
// CPU-heavy (material shading / AO / rasterize) and its promise chain is pure
// microtasks, so N queued composes fuse into ONE long task — measured as a
// 175 SECOND main-thread block on a cold boot, starving image loads (LPC
// spritesheets), input, the progress bar and paint until the whole backlog
// drained. Routing every runtime compose through this queue keeps the total
// work identical but yields a macrotask between time-slices, so the browser
// can paint, deliver image loads and run timers while the backlog composes.
//
// Yielding is TIME-BUDGETED, not per-job: cheap/synchronous-fake composes (unit
// tests, cached specs) run back-to-back in the same turn; only when the queue
// has hogged the thread for >YIELD_BUDGET_MS does it yield. This keeps
// single-`setTimeout(0)` test flushes working and adds no latency to fast jobs.

const YIELD_BUDGET_MS = 24;

const now = (): number =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

let chain: Promise<unknown> = Promise.resolve();
let lastYield = 0;
let pendingCount = 0;

async function maybeYield(): Promise<void> {
  if (now() - lastYield < YIELD_BUDGET_MS) return;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  lastYield = now();
}

/**
 * Enqueue a compose job. Jobs run strictly in enqueue order, one at a time,
 * with a macrotask yield whenever the queue has held the main thread longer
 * than the budget. The returned promise settles with the job's result; a
 * rejected job never breaks the chain for later jobs.
 */
export function scheduleCompose<T>(job: () => Promise<T>): Promise<T> {
  // An idle→active transition starts a fresh time-slice: the FIRST job of a
  // batch never yields (keeps fast paths and single-flush tests synchronous);
  // the budget clock only ticks while the queue is actually holding the thread.
  if (pendingCount === 0) lastYield = now();
  pendingCount++;
  const p = chain.then(async () => {
    await maybeYield();
    return job();
  });
  chain = p.then(
    () => { pendingCount--; },
    () => { pendingCount--; },
  );
  return p;
}

/** Jobs enqueued but not yet settled — diagnostics only. */
export function composeQueuePending(): number {
  return pendingCount;
}
