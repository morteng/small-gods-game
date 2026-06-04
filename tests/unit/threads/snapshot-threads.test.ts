import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';
import { captureSnapshot, restoreSnapshot } from '@/core/snapshot';
import { World } from '@/world/world';
import type { GameMap, Tile } from '@/core/types';

function attachWorld(state: ReturnType<typeof createState>): void {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 5; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 5; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'void' });
    tiles.push(row);
  }
  const map: GameMap = {
    tiles, width: 5, height: 5, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
  state.map = map;
  state.world = new World(map);
}

describe('snapshot persists threads', () => {
  it('round-trips active threads (snapshot is authoritative)', () => {
    const state = createState();
    attachWorld(state);
    const t = state.plotThreads.open('trial', { kind: 'settlement', poiId: 'p1' }, state.clock.now());
    const snap = captureSnapshot(state);
    state.plotThreads.resolve(t.id, 'resolved', state.clock.now()); // mutate after capture
    restoreSnapshot(state, snap);
    expect(state.plotThreads.get(t.id)!.status).toBe('active');
  });

  it('round-trips armed staged beats', () => {
    const state = createState();
    attachWorld(state);
    state.staging.arm({ subject: { kind: 'settlement', poiId: 'p1' }, trigger: { kind: 'discovery' }, hard: [], stagedTick: 0 });
    const snap = captureSnapshot(state);
    state.staging.hydrate([]); // wipe after capture
    restoreSnapshot(state, snap);
    expect(state.staging.armedFor({ kind: 'settlement', poiId: 'p1' })).toHaveLength(1);
  });

  it('tolerates an old snapshot with no threads/staging fields', () => {
    const state = createState();
    attachWorld(state);
    const snap = captureSnapshot(state);
    delete (snap as { threads?: unknown }).threads;
    delete (snap as { staging?: unknown }).staging;
    expect(() => restoreSnapshot(state, snap)).not.toThrow();
    expect(state.plotThreads.active()).toHaveLength(0);
    expect(state.staging.armedFor({ kind: 'settlement', poiId: 'p1' })).toHaveLength(0);
  });
});
