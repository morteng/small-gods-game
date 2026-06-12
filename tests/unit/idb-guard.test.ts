import { describe, it, expect, vi, afterEach } from 'vitest';
import { withIdbTimeout, IDB_TIMEOUT_MS } from '@/services/idb-guard';

afterEach(() => vi.useRealTimers());

describe('withIdbTimeout', () => {
  it('passes a resolving promise through', async () => {
    await expect(withIdbTimeout(Promise.resolve(42), 'read')).resolves.toBe(42);
  });

  it('passes a rejecting promise through', async () => {
    await expect(withIdbTimeout(Promise.reject(new Error('boom')), 'read')).rejects.toThrow('boom');
  });

  it('rejects a forever-pending promise after the timeout (wedged backing store)', async () => {
    vi.useFakeTimers();
    const p = withIdbTimeout(new Promise(() => {}), 'open');
    const assertion = expect(p).rejects.toThrow(/IndexedDB open timed out .*wedged/);
    await vi.advanceTimersByTimeAsync(IDB_TIMEOUT_MS + 1);
    await assertion;
  });
});

describe('save-store under a wedged IndexedDB', () => {
  it('readSave degrades to null (fresh world) instead of hanging boot', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // An open() that NEVER fires success/error/blocked — the observed Chrome
    // failure mode that froze the loading screen (2026-06-12).
    vi.stubGlobal('indexedDB', { open: () => ({ /* no callbacks ever fire */ }) });
    const { readSave, _resetSaveDbForTesting } = await import('@/services/save-store');
    _resetSaveDbForTesting();
    const p = readSave();
    await vi.advanceTimersByTimeAsync(IDB_TIMEOUT_MS + 1);
    await expect(p).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith('[save-store] readSave failed:', expect.objectContaining({
      message: expect.stringContaining('timed out'),
    }));
    vi.unstubAllGlobals();
    warn.mockRestore();
  });
});
