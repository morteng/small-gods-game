// src/render/lpc/concurrency.ts
// Tiny promise concurrency limiter. Used to keep the boot-time LPC spritesheet
// storm to a few compositions at a time (image-cache-friendly + main-thread-kind)
// instead of every NPC's sheet at once.

export type Limiter = <T>(job: () => Promise<T>) => Promise<T>;

/**
 * Returns a function that runs jobs with at most `max` in flight; excess jobs
 * queue in FIFO order. A rejected job rejects its own promise but never stalls
 * the queue.
 */
export function createLimiter(max: number): Limiter {
  if (!Number.isInteger(max) || max < 1) throw new Error(`createLimiter: max must be a positive integer, got ${max}`);
  let active = 0;
  const waiting: Array<() => void> = [];

  const release = (): void => {
    active--;
    const next = waiting.shift();
    if (next) next();
  };

  return async <T>(job: () => Promise<T>): Promise<T> => {
    if (active >= max) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active++;
    try {
      return await job();
    } finally {
      release();
    }
  };
}
