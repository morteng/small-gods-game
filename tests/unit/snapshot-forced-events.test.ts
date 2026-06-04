import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { createRng } from '@/core/rng';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { EventLog } from '@/core/events';
import { captureSnapshot, restoreSnapshot, type Snapshot } from '@/core/snapshot';
import type { GameMap, Tile } from '@/core/types';
import type { GameState } from '@/core/state';

function map(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 2; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 2; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 2, height: 2, villages: [], seed: 1, success: true,
           worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}
function makeState(): GameState {
  const m = map();
  return {
    world: new World(m), map: m, clock: new SimClock(), rng: createRng(1),
    eventLog: new EventLog(), spirits: new Map(),
    plotThreads: new PlotThreadStore(), staging: new StagingBuffer(),
  } as unknown as GameState;
}

describe('snapshot forcedEvents', () => {
  it('round-trips world.forcedEvents through capture/restore', () => {
    const state = makeState();
    state.world.forcedEvents.set('poi1', 'plague');
    const snap = captureSnapshot(state);
    state.world.forcedEvents.clear();          // mutate away after capture
    restoreSnapshot(state, snap);
    expect([...state.world.forcedEvents]).toEqual([['poi1', 'plague']]);
  });

  it('tolerates a snapshot with no forcedEvents field (older save)', () => {
    const state = makeState();
    state.world.forcedEvents.set('poi1', 'drought');
    const snap = captureSnapshot(state);
    delete (snap as Partial<Snapshot>).forcedEvents;   // simulate a pre-feature save
    restoreSnapshot(state, snap);
    expect(state.world.forcedEvents.size).toBe(0);
  });
});
