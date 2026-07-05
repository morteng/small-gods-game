// src/render/compose-offthread.ts
//
// Off-thread parametric sprite composition (R10 WP-A). A pool of module Web Workers runs
// `composeStructure` in parallel while the main thread stays at 60fps; the backlog drains
// in ~wall-time ÷ pool-size instead of blocking the main thread for ~40s of compose CPU.
//
// WHY a new entry point rather than replacing the scheduler: the three runtime sources
// used to call `scheduleCompose(() => composeStructure(...))` and then reduce the result
// on the main thread. That reduction (`payloadFromResult`) is pure typed arrays, so it can
// run IN the worker — the worker returns the finished `CachedSpritePayload` (zero-copy via
// transferables) and the main thread treats it exactly like an IDB/vendored cache hit
// (`packFromPayload` + write-through). `composePayload` is that entry.
//
// Fallback is first-class: wherever Workers are unavailable (Node, jsdom/vitest) or the
// pool fails to boot, `composePayload` degrades to the ORIGINAL inline path
// (`scheduleCompose` + `composeToPayload`) so ordering/yield behaviour — and the ~3900
// existing tests — stay byte-identical. The inline scheduler (`compose-scheduler.ts`) is
// kept intact and re-exported for any remaining direct callers.
import { composeStructure, type StructureSpec } from '@/assetgen/compose';
import type { CachedSpritePayload } from '@/render/parametric-sprite-cache';
import { composeToPayload, type ComposePayloadOpts } from '@/render/compose-payload';
import {
  scheduleCompose, composeQueuePending, composeStats, type ComposePriority,
} from '@/render/compose-scheduler';

// Re-exported so callers have ONE import surface for compose scheduling + diagnostics.
export { scheduleCompose, composeQueuePending, composeStats };
export type { ComposePriority };
export type { ComposePayloadOpts } from '@/render/compose-payload';

const now = (): number =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

// ── worker protocol ──────────────────────────────────────────────────────────

/** Message the worker posts back — mirrors `compose-worker.ts`. */
interface WorkerReply {
  id: number;
  payload?: CachedSpritePayload | null;
  error?: string;
  cpuMs?: number;
}

// ── pool state ─────────────────────────────────────────────────────────────

type Mode = 'unknown' | 'worker' | 'inline';

interface PoolJob {
  id: number;
  spec: StructureSpec;
  opts?: ComposePayloadOpts;
  priority: ComposePriority;
  resolve: (p: CachedSpritePayload | null) => void;
  reject: (e: unknown) => void;
}

interface WorkerHandle { worker: Worker; busy: PoolJob | null }

let mode: Mode = 'unknown';
let workers: WorkerHandle[] = [];
const frontQueue: PoolJob[] = [];
const backQueue: PoolJob[] = [];
let nextId = 1;
let poolPending = 0;
let warnedFallback = false;

/** Test seam: override how a worker is constructed (so unit tests inject a fake Worker
 *  without a real one). Default constructs the Vite-bundled module worker. */
let workerFactory: (() => Worker) | null = null;

function createWorker(): Worker {
  if (workerFactory) return workerFactory();
  // The literal Vite statically detects to emit + rewrite the worker chunk.
  return new Worker(new URL('./compose-worker.ts', import.meta.url), { type: 'module' });
}

/** Worker mode is worth attempting when a factory is injected (tests) or the runtime has
 *  a real `Worker` (browser). jsdom/Node have neither → permanent inline fallback. */
function workerModePossible(): boolean {
  return workerFactory !== null || typeof (globalThis as { Worker?: unknown }).Worker !== 'undefined';
}

/** Pool size per the WP-A spec: leave two cores for the main thread + the browser, cap at 4. */
function poolSize(): number {
  const hc = (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency;
  return Math.max(1, Math.min(4, (hc ?? 4) - 2));
}

function warnOnce(): void {
  if (warnedFallback) return;
  warnedFallback = true;
  // eslint-disable-next-line no-console
  console.warn('[compose-offthread] worker pool unavailable — composing inline on the main thread');
}

// ── inline fallback ────────────────────────────────────────────────────────

/** The original path: schedule the compose on the main-thread queue, then reduce to a
 *  payload. Preserves the scheduler's lanes + budgeted yield + `composeStats`. */
function runInline(
  spec: StructureSpec, opts: ComposePayloadOpts | undefined, priority: ComposePriority,
): Promise<CachedSpritePayload | null> {
  return scheduleCompose(() => composeToPayload(spec, opts), { priority });
}

// ── pool lifecycle ───────────────────────────────────────────────────────────

function ensureMode(): void {
  if (mode !== 'unknown') return;
  if (!workerModePossible()) { mode = 'inline'; return; }
  const created: WorkerHandle[] = [];
  try {
    const n = poolSize();
    for (let i = 0; i < n; i++) {
      const worker = createWorker();
      const h: WorkerHandle = { worker, busy: null };
      worker.onmessage = (e: MessageEvent<WorkerReply>) => onReply(h, e.data);
      // An uncaught worker error (boot failure / crash) is catastrophic for the pool —
      // permanently fall back for the session rather than retry-storm.
      worker.onerror = () => failPool();
      created.push(h);
    }
    workers = created;
    mode = 'worker';
  } catch {
    // Construction failed (e.g. blocked in this context): tear down partial + go inline.
    for (const h of created) { try { h.worker.terminate(); } catch { /* ignore */ } }
    workers = [];
    mode = 'inline';
    warnOnce();
  }
}

/** Catastrophic pool failure: terminate every worker, switch to inline for the rest of the
 *  session, and re-run all in-flight + queued jobs on the inline path so none are lost. */
function failPool(): void {
  if (mode === 'inline') return;
  mode = 'inline';
  warnOnce();
  const stranded: PoolJob[] = [];
  for (const h of workers) {
    if (h.busy) { stranded.push(h.busy); h.busy = null; }
    try { h.worker.terminate(); } catch { /* ignore */ }
  }
  workers = [];
  stranded.push(...frontQueue.splice(0), ...backQueue.splice(0));
  for (const job of stranded) {
    poolPending--; // scheduleCompose re-counts it under composeStats
    runInline(job.spec, job.opts, job.priority).then(job.resolve, job.reject);
  }
}

function onReply(h: WorkerHandle, reply: WorkerReply): void {
  const job = h.busy;
  if (!job || job.id !== reply.id) return; // stale / post-teardown message
  h.busy = null;
  poolPending--;
  composeStats.done++;
  if (typeof reply.cpuMs === 'number') composeStats.jobCpuMs += reply.cpuMs;
  if (poolPending === 0) composeStats.lastDrainAt = now();
  if (reply.error !== undefined) job.reject(new Error(reply.error));
  else job.resolve(reply.payload ?? null);
  dispatch();
}

function dispatch(): void {
  for (const h of workers) {
    if (h.busy) continue;
    const job = frontQueue.shift() ?? backQueue.shift();
    if (!job) return; // nothing queued — later `dispatch()` calls resume
    h.busy = job;
    try {
      h.worker.postMessage({ id: job.id, spec: job.spec, opts: job.opts });
    } catch {
      // A worker that can't accept a message is unusable — fall the whole pool back.
      h.busy = null;
      frontQueue.unshift(job);
      failPool();
      return;
    }
  }
}

// ── public entry ───────────────────────────────────────────────────────────

/**
 * Compose a spec to its cacheable payload, off the main thread when possible.
 *
 * Worker mode: the spec is dispatched to the pool (front lane before back), the worker
 * runs `composeStructure` + `payloadFromResult`, and the finished payload comes back
 * zero-copy. Fallback (no Worker / pool boot failed): the ORIGINAL inline path
 * (`scheduleCompose` + `composeToPayload`), so ordering/yield/tests are unchanged.
 * Resolves null for a degenerate render (caller caches a null pack); rejects on compose error.
 */
export function composePayload(
  spec: StructureSpec,
  opts?: ComposePayloadOpts,
  o?: { priority?: ComposePriority },
): Promise<CachedSpritePayload | null> {
  ensureMode();
  const priority: ComposePriority = o?.priority ?? 'back';
  if (mode !== 'worker') return runInline(spec, opts, priority);
  return new Promise<CachedSpritePayload | null>((resolve, reject) => {
    const job: PoolJob = { id: nextId++, spec, opts, priority, resolve, reject };
    composeStats.scheduled++;
    if (composeStats.firstEnqueueAt === 0) composeStats.firstEnqueueAt = now();
    poolPending++;
    (priority === 'front' ? frontQueue : backQueue).push(job);
    dispatch();
  });
}

// ── test seams ───────────────────────────────────────────────────────────────

/** Inject a fake-Worker factory (unit tests). Pass null to restore the real factory. */
export function __setComposeWorkerFactoryForTest(f: (() => Worker) | null): void {
  workerFactory = f;
}

/** Reset all pool state between tests (terminates any workers). */
export function __resetComposeOffthreadForTest(): void {
  for (const h of workers) { try { h.worker.terminate(); } catch { /* ignore */ } }
  workers = [];
  frontQueue.length = 0;
  backQueue.length = 0;
  mode = 'unknown';
  poolPending = 0;
  nextId = 1;
  warnedFallback = false;
  workerFactory = null;
}

/** Diagnostics: current pool mode + depth (tests / dev). */
export function __composeOffthreadMode(): { mode: Mode; poolPending: number; workers: number } {
  return { mode, poolPending, workers: workers.length };
}
