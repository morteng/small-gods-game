/**
 * Timeout guard for IndexedDB operations.
 *
 * A wedged IDB backing store (browser killed mid-write, stale LevelDB lock)
 * can leave `indexedDB.open()` — and transactions on an existing connection —
 * PENDING FOREVER: no success, no error, no blocked event. Anything that
 * awaits such an operation un-guarded hangs for the rest of the session
 * (boot on the loading screen, building art that never arrives, …).
 *
 * Every IDB-backed store therefore races its opens/transactions against this
 * timeout and degrades gracefully (fresh world, vendored/base art, dropped
 * autosave) instead of hanging. 4s is far above any healthy IDB latency.
 */
export const IDB_TIMEOUT_MS = 4000;

export function withIdbTimeout<T>(p: Promise<T>, op: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(
      () => reject(new Error(`IndexedDB ${op} timed out after ${IDB_TIMEOUT_MS}ms (wedged backing store?)`)),
      IDB_TIMEOUT_MS,
    )),
  ]);
}
