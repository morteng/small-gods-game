import { describe, it, expect, vi } from 'vitest';
import { PersistenceController } from '@/game/persistence-controller';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import type { GameMap, Tile } from '@/core/types';
import type { SaveFile } from '@/core/save-file';

function miniMap(): GameMap {
  const tiles: Tile[][] = [[{ type: 'grass', x: 0, y: 0, walkable: true, state: 'realized' }]];
  return { tiles, width: 1, height: 1, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function freshState() {
  const s = createState();
  s.map = miniMap();
  s.world = new World(s.map);
  return s;
}

function mkController(over: Partial<ConstructorParameters<typeof PersistenceController>[0]> = {}) {
  const writes: SaveFile[] = [];
  const state = over.state ?? freshState();
  const ctrl = new PersistenceController({
    state,
    timeline: { isScrubbed: false } as any,
    now: () => 0,
    throttleMs: 1000,
    // The controller hands the writer a FACTORY (live-reference save); invoke it
    // like the real writer does, synchronously with the persist step.
    write: async (makeSave) => { writes.push(makeSave()); },
    ...over,
  });
  return { ctrl, writes, state };
}

describe('PersistenceController', () => {
  it('coalesces multiple dirty marks into one throttled write', async () => {
    vi.useFakeTimers();
    const { ctrl, writes } = mkController();
    ctrl.start();
    ctrl.markDirty(); ctrl.markDirty(); ctrl.markDirty();
    await vi.advanceTimersByTimeAsync(1100);
    expect(writes.length).toBe(1);
    ctrl.destroy();
    vi.useRealTimers();
  });

  it('does not write while the timeline is scrubbed', async () => {
    vi.useFakeTimers();
    const { ctrl, writes } = mkController({ timeline: { isScrubbed: true } as any });
    ctrl.start();
    ctrl.markDirty();
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes.length).toBe(0);
    ctrl.destroy();
    vi.useRealTimers();
  });

  it('flush() writes immediately when dirty', async () => {
    const { ctrl, writes } = mkController();
    ctrl.start();
    ctrl.markDirty();
    await ctrl.flush();
    expect(writes.length).toBe(1);
    ctrl.destroy();
  });

  it('flush() is a no-op when not dirty', async () => {
    const { ctrl, writes } = mkController();
    ctrl.start();
    await ctrl.flush();
    expect(writes.length).toBe(0);
    ctrl.destroy();
  });

  it('destroy() cancels a pending throttled write', async () => {
    vi.useFakeTimers();
    const { ctrl, writes } = mkController();
    ctrl.start();
    ctrl.markDirty();
    ctrl.destroy();
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes.length).toBe(0);
    vi.useRealTimers();
  });

  it('marks dirty automatically on an eventLog append', async () => {
    const { ctrl, writes, state } = mkController();
    ctrl.start();
    state.eventLog.append({ type: 'power_depleted', spiritId: 'player' });
    await ctrl.flush();
    expect(writes.length).toBe(1);
    ctrl.destroy();
  });

  it('defaults the coalesce window to 30 s (a save stalls the main thread — cadence is a smoothness dial)', async () => {
    vi.useFakeTimers();
    const { ctrl, writes } = mkController({ throttleMs: undefined });
    ctrl.start();
    ctrl.markDirty();
    await vi.advanceTimersByTimeAsync(29_000);
    expect(writes.length).toBe(0);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(writes.length).toBe(1);
    ctrl.destroy();
    vi.useRealTimers();
  });

  it('the built save aliases live state (single-clone contract): the writer must persist synchronously', async () => {
    const { ctrl, state } = mkController();
    ctrl.start();
    ctrl.markDirty();
    let aliased = false;
    (ctrl as any).write = async (makeSave: () => SaveFile) => {
      const save = makeSave();
      aliased = save.map === state.map;
    };
    await ctrl.flush();
    expect(aliased).toBe(true);
    ctrl.destroy();
  });
});
