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
// has hogged the thread for >budget does it yield. This keeps
// single-`setTimeout(0)` test flushes working and adds no latency to fast jobs.
//
// Two refinements from live measurement (a cold boot queues ~320 jobs, buildings
// behind dozens of wall-chunk composes, draining for minutes at 60fps):
// - PRIORITY LANES: 'front' jobs (player-facing building sprites) run before the
//   'back' backlog (wall chunks, plants), so towns look right in seconds even
//   while the wall ring is still composing.
// - ADAPTIVE SLICES: while the backlog is deep the budget widens (fewer paints,
//   ~10fps) so the drain finishes in ~1.2× CPU time instead of ~2×; once the
//   queue is shallow it returns to short slices and full frame rate.

const YIELD_BUDGET_MS = 24;
const BACKLOG_YIELD_BUDGET_MS = 96;
const BACKLOG_THRESHOLD = 12;

export type ComposePriority = 'front' | 'back';

interface QueuedJob {
  run: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

const now = (): number =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

const lanes: [QueuedJob[], QueuedJob[]] = [[], []]; // 0 = front, 1 = back
let pumping = false;
let lastYield = 0;
let pendingCount = 0;

function currentBudget(): number {
  return pendingCount > BACKLOG_THRESHOLD ? BACKLOG_YIELD_BUDGET_MS : YIELD_BUDGET_MS;
}

async function pump(): Promise<void> {
  pumping = true;
  // An idle→active transition starts a fresh time-slice: the FIRST job of a
  // batch never yields (keeps fast paths and single-flush tests synchronous).
  lastYield = now();
  for (;;) {
    const queue = lanes[0].length > 0 ? lanes[0] : lanes[1];
    const job = queue.shift();
    if (!job) break;
    if (now() - lastYield >= currentBudget()) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      lastYield = now();
    }
    const jobStart = now();
    try {
      const result = await job.run();
      pendingCount--;
      job.resolve(result);
    } catch (err) {
      pendingCount--;
      job.reject(err);
    }
    composeStats.done++;
    composeStats.jobCpuMs += now() - jobStart;
    if (pendingCount === 0) composeStats.lastDrainAt = now();
  }
  pumping = false;
}

/**
 * Enqueue a compose job. Jobs run one at a time — FIFO within a lane, with the
 * 'front' lane always drained before the 'back' lane — and the queue yields a
 * macrotask whenever it has held the main thread longer than the budget. The
 * returned promise settles with the job's result; a rejected job never breaks
 * the queue for later jobs.
 */
export function scheduleCompose<T>(
  job: () => Promise<T>,
  opts?: { priority?: ComposePriority },
): Promise<T> {
  pendingCount++;
  composeStats.scheduled++;
  if (composeStats.firstEnqueueAt === 0) composeStats.firstEnqueueAt = now();
  const p = new Promise<T>((resolve, reject) => {
    lanes[opts?.priority === 'front' ? 0 : 1].push({
      run: job,
      resolve: resolve as (v: unknown) => void,
      reject,
    });
  });
  if (!pumping) void pump();
  return p;
}

/** Jobs enqueued but not yet settled — diagnostics only. */
export function composeQueuePending(): number {
  return pendingCount;
}

/** Lifetime queue stats — diagnostics only (surfaced as `__composeStats` in dev). */
export const composeStats = {
  scheduled: 0,
  done: 0,
  jobCpuMs: 0,
  firstEnqueueAt: 0,
  lastDrainAt: 0,
};
if (typeof globalThis !== 'undefined') {
  (globalThis as Record<string, unknown>).__composeStats = composeStats;
}
