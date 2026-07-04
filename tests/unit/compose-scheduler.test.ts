import { describe, it, expect } from 'vitest';
import { scheduleCompose, composeQueuePending } from '@/render/compose-scheduler';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const busyWait = (ms: number) => { const t = Date.now(); while (Date.now() - t < ms) { /* hog */ } };

describe('compose-scheduler', () => {
  it('runs jobs strictly in enqueue order and returns their results', async () => {
    const order: number[] = [];
    const results = await Promise.all([
      scheduleCompose(async () => { order.push(1); return 'a'; }),
      scheduleCompose(async () => { order.push(2); return 'b'; }),
      scheduleCompose(async () => { order.push(3); return 'c'; }),
    ]);
    expect(order).toEqual([1, 2, 3]);
    expect(results).toEqual(['a', 'b', 'c']);
  });

  it('cheap jobs settle within a single setTimeout(0) flush (test-flush compatibility)', async () => {
    // Existing source tests flush with ONE setTimeout(0); the queue must not
    // insert a yield before fast jobs or those tests would starve.
    let done = 0;
    void scheduleCompose(async () => { done++; });
    void scheduleCompose(async () => { done++; });
    await sleep(0);
    expect(done).toBe(2);
  });

  it('a rejected job rejects its own promise but later jobs still run', async () => {
    const boom = scheduleCompose(async () => { throw new Error('boom'); });
    const after = scheduleCompose(async () => 'ok');
    await expect(boom).rejects.toThrow('boom');
    await expect(after).resolves.toBe('ok');
  });

  it('yields a macrotask once a batch exceeds the time budget (long tasks are split)', async () => {
    // Two CPU-hogging jobs: without the yield they fuse into one task and a
    // timer queued between them could only fire after BOTH. With the budgeted
    // yield, the timer fires between job 1 and job 2.
    const order: string[] = [];
    void scheduleCompose(async () => { busyWait(30); order.push('job1'); });
    void scheduleCompose(async () => { order.push('job2'); });
    await new Promise<void>((resolve) => setTimeout(() => { order.push('timer'); resolve(); }, 0));
    // give job2 time to finish
    await sleep(10);
    expect(order.indexOf('timer')).toBeGreaterThan(order.indexOf('job1'));
    expect(order.indexOf('timer')).toBeLessThan(order.indexOf('job2'));
  });

  it("drains the 'front' lane before queued 'back' jobs (buildings before wall chunks)", async () => {
    const order: string[] = [];
    // Hold the pump on a slow back job so the rest queue up behind it.
    const gate = scheduleCompose(async () => { await sleep(10); order.push('back-running'); });
    void scheduleCompose(async () => { order.push('back1'); });
    void scheduleCompose(async () => { order.push('back2'); });
    const front = scheduleCompose(async () => { order.push('front1'); }, { priority: 'front' });
    await gate;
    await front;
    await sleep(15);
    expect(order.indexOf('front1')).toBeGreaterThan(order.indexOf('back-running'));
    expect(order.indexOf('front1')).toBeLessThan(order.indexOf('back1'));
    expect(order.indexOf('back1')).toBeLessThan(order.indexOf('back2'));
  });

  it('tracks pending jobs', async () => {
    const before = composeQueuePending();
    const p = scheduleCompose(async () => { await sleep(5); });
    expect(composeQueuePending()).toBe(before + 1);
    await p;
    await sleep(0);
    expect(composeQueuePending()).toBe(before);
  });
});
