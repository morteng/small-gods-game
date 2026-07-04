import { describe, it, expect } from 'vitest';
import { createLimiter } from '@/render/lpc/concurrency';

const defer = <T>() => {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('createLimiter', () => {
  it('runs at most `max` jobs concurrently, FIFO for the rest', async () => {
    const limit = createLimiter(2);
    const gates = [defer<void>(), defer<void>(), defer<void>()];
    let active = 0, peak = 0;
    const job = (i: number) => limit(async () => {
      active++; peak = Math.max(peak, active);
      await gates[i].promise;
      active--;
      return i;
    });
    const ps = [job(0), job(1), job(2)];
    await new Promise((r) => setTimeout(r, 0));
    expect(peak).toBe(2);          // third job queued
    gates[0].resolve();
    await ps[0];
    await new Promise((r) => setTimeout(r, 0));
    gates[1].resolve(); gates[2].resolve();
    expect(await Promise.all(ps)).toEqual([0, 1, 2]);
    expect(peak).toBe(2);
  });

  it('a rejected job frees its slot', async () => {
    const limit = createLimiter(1);
    const boom = limit(async () => { throw new Error('boom'); });
    const ok = limit(async () => 'ok');
    await expect(boom).rejects.toThrow('boom');
    await expect(ok).resolves.toBe('ok');
  });

  it('rejects a non-positive max', () => {
    expect(() => createLimiter(0)).toThrow();
  });
});
