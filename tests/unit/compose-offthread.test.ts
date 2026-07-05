// The off-thread compose pool (WP-A), exercised with a FAKE Worker so no real worker or
// wasm is needed (jsdom has neither). Covers the message round-trip, front-lane priority,
// a job-level error rejecting only that job (pool stays healthy), and construction failure
// permanently falling back to the inline path.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  composePayload,
  __setComposeWorkerFactoryForTest,
  __resetComposeOffthreadForTest,
  __composeOffthreadMode,
} from '@/render/compose-offthread';
import type { CachedSpritePayload } from '@/render/parametric-sprite-cache';
import type { StructureSpec } from '@/assetgen/compose';

// A minimal payload — the pool passes it straight through, so its contents don't matter.
const fakePayload = (tag: string): CachedSpritePayload =>
  ({ w: 1, h: 1, grey: new Uint8ClampedArray(4), normal: new Uint8ClampedArray(4),
     material: new Uint8ClampedArray(4), anchors: { doors: [], vents: [], tags: [{ x: 0, y: 0, kind: tag } as never] } });

interface Posted { id: number; spec: StructureSpec; opts?: unknown }

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  posted: Posted[] = [];
  terminated = false;
  constructor(_url: unknown, _opts: unknown) { FakeWorker.instances.push(this); }
  postMessage(msg: Posted): void { this.posted.push(msg); }
  terminate(): void { this.terminated = true; }
  reply(r: unknown): void { this.onmessage?.({ data: r }); }
  crash(): void { this.onerror?.({}); }
}

const spec = (id: string): StructureSpec => ({ id, parts: [] });

/** Force a 1-worker pool so jobs queue deterministically (3 - 2 = 1). */
function poolSizeOne(): void {
  vi.stubGlobal('navigator', { hardwareConcurrency: 3 });
}

afterEach(() => {
  __resetComposeOffthreadForTest();
  FakeWorker.instances = [];
  vi.unstubAllGlobals();
});

describe('compose-offthread worker pool', () => {
  it('round-trips a job through the worker and resolves with the posted payload', async () => {
    poolSizeOne();
    __setComposeWorkerFactoryForTest(() => new FakeWorker(null, null) as unknown as Worker);
    const p = composePayload(spec('a'), { surfaceTexture: true }, { priority: 'front' });
    expect(__composeOffthreadMode().mode).toBe('worker');
    const w = FakeWorker.instances[0];
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0].id).toBeTypeOf('number');
    expect(w.posted[0].opts).toEqual({ surfaceTexture: true });
    const payload = fakePayload('done');
    w.reply({ id: w.posted[0].id, payload, cpuMs: 7 });
    await expect(p).resolves.toBe(payload);
    expect(w.terminated).toBe(false);
  });

  it("drains the 'front' lane before queued 'back' jobs (pool of 1)", async () => {
    poolSizeOne();
    __setComposeWorkerFactoryForTest(() => new FakeWorker(null, null) as unknown as Worker);
    const back1 = composePayload(spec('back1'), undefined, { priority: 'back' });
    const back2 = composePayload(spec('back2'), undefined, { priority: 'back' });
    const front1 = composePayload(spec('front1'), undefined, { priority: 'front' });
    const w = FakeWorker.instances[0];
    // Only back1 is in flight (1 worker); back2 + front1 are queued.
    expect(w.posted.map((m) => m.spec.id)).toEqual(['back1']);
    w.reply({ id: w.posted[0].id, payload: fakePayload('b1'), cpuMs: 1 });
    await back1;
    // Freed worker picks the FRONT lane next, ahead of the earlier-queued back2.
    expect(w.posted.map((m) => m.spec.id)).toEqual(['back1', 'front1']);
    w.reply({ id: w.posted[1].id, payload: fakePayload('f1'), cpuMs: 1 });
    await front1;
    expect(w.posted.map((m) => m.spec.id)).toEqual(['back1', 'front1', 'back2']);
    w.reply({ id: w.posted[2].id, payload: fakePayload('b2'), cpuMs: 1 });
    await back2;
  });

  it('a job error rejects only that job and does NOT poison the pool', async () => {
    poolSizeOne();
    __setComposeWorkerFactoryForTest(() => new FakeWorker(null, null) as unknown as Worker);
    const bad = composePayload(spec('bad'));
    const w = FakeWorker.instances[0];
    w.reply({ id: w.posted[0].id, error: 'boom' });
    await expect(bad).rejects.toThrow('boom');
    expect(w.terminated).toBe(false);
    expect(__composeOffthreadMode().mode).toBe('worker');
    // A later job still composes on the same live worker.
    const good = composePayload(spec('good'));
    expect(w.posted).toHaveLength(2);
    const payload = fakePayload('ok');
    w.reply({ id: w.posted[1].id, payload, cpuMs: 2 });
    await expect(good).resolves.toBe(payload);
  });

  it('a null payload (degenerate render) resolves null, not an error', async () => {
    poolSizeOne();
    __setComposeWorkerFactoryForTest(() => new FakeWorker(null, null) as unknown as Worker);
    const p = composePayload(spec('empty'));
    const w = FakeWorker.instances[0];
    w.reply({ id: w.posted[0].id, payload: null, cpuMs: 1 });
    await expect(p).resolves.toBeNull();
  });

  it('worker construction failure falls back to inline for the session (warns once)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    __setComposeWorkerFactoryForTest(() => { throw new Error('no worker here'); });
    // Trivial empty spec composes to a tiny payload inline (no wasm geometry needed).
    const p = composePayload(spec('x'));
    expect(__composeOffthreadMode().mode).toBe('inline');
    await p; // settles via the inline path — the point is it doesn't hang
    // A second job stays inline without re-attempting construction.
    await composePayload(spec('y'));
    expect(__composeOffthreadMode().mode).toBe('inline');
    expect(FakeWorker.instances).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('an uncaught worker error re-runs stranded jobs on the inline path', async () => {
    poolSizeOne();
    __setComposeWorkerFactoryForTest(() => new FakeWorker(null, null) as unknown as Worker);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = composePayload(spec('inflight'));
    const w = FakeWorker.instances[0];
    expect(w.posted).toHaveLength(1);
    w.crash(); // catastrophic: pool tears down, stranded job re-runs inline
    expect(__composeOffthreadMode().mode).toBe('inline');
    expect(w.terminated).toBe(true);
    await p; // the empty spec composes inline and settles
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
