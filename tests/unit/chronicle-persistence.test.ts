import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { createRng } from '@/core/rng';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { FateArcStore } from '@/sim/fate/arc-store';
import { ChronicleStore, CHRONICLE_RING_CAP, type ChronicleEntry } from '@/core/chronicle-store';
import { EventLog } from '@/core/events';
import { captureSnapshot, restoreSnapshot } from '@/core/snapshot';
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
    eventLog: new EventLog(new SimClock()), spirits: new Map(),
    plotThreads: new PlotThreadStore(), staging: new StagingBuffer(),
    fateArcs: new FateArcStore(), chronicle: new ChronicleStore(),
  } as unknown as GameState;
}

function annal(dayIndex: number, text = `In this year, on day ${dayIndex}, nothing was recorded.`): ChronicleEntry {
  return { dayIndex, year: 1, season: 'spring', dayOfYear: dayIndex + 1, text, offline: true };
}

describe('chronicle — snapshot persistence', () => {
  it('the ring survives capture → mutate-away → restore', () => {
    const state = makeState();
    state.chronicle.push(annal(0, 'In this year there was a drought, and three died.'));
    state.chronicle.push(annal(1, 'In this year the drought broke.'));
    const snap = captureSnapshot(state);

    state.chronicle.push(annal(2, 'This entry post-dates the snapshot.'));
    restoreSnapshot(state, snap);

    const texts = state.chronicle.entries().map(e => e.text);
    expect(texts).toEqual([
      'In this year there was a drought, and three died.',
      'In this year the drought broke.',
    ]);
    expect(state.chronicle.latest()?.dayIndex).toBe(1);
  });

  it('a scrub to a pre-chronicle snapshot un-happens every annal', () => {
    const state = makeState();
    const before = captureSnapshot(state);
    state.chronicle.push(annal(0));
    restoreSnapshot(state, before);
    expect(state.chronicle.entries()).toHaveLength(0);
    expect(state.chronicle.latest()).toBeNull();
  });

  it('an old snapshot with no chronicle field restores to an empty ring', () => {
    const state = makeState();
    state.chronicle.push(annal(0));
    const snap = captureSnapshot(state);
    delete (snap as { chronicle?: ChronicleEntry[] }).chronicle;   // pre-chronicle save shape
    restoreSnapshot(state, snap);
    expect(state.chronicle.entries()).toHaveLength(0);
  });

  it('the ring stays bounded through push and hydrate', () => {
    const state = makeState();
    for (let d = 0; d < CHRONICLE_RING_CAP + 5; d++) state.chronicle.push(annal(d));
    expect(state.chronicle.entries()).toHaveLength(CHRONICLE_RING_CAP);
    // Oldest evicted, newest kept.
    expect(state.chronicle.entries()[0].dayIndex).toBe(5);
    expect(state.chronicle.latest()?.dayIndex).toBe(CHRONICLE_RING_CAP + 4);

    // Hydrating an over-long array (hand-edited save) clamps to the cap.
    const oversized = Array.from({ length: CHRONICLE_RING_CAP + 3 }, (_, d) => annal(d));
    state.chronicle.hydrate(oversized);
    expect(state.chronicle.entries()).toHaveLength(CHRONICLE_RING_CAP);
    expect(state.chronicle.latest()?.dayIndex).toBe(CHRONICLE_RING_CAP + 2);
  });

  it('serialize is a deep copy — mutating the snapshot never reaches the live ring', () => {
    const state = makeState();
    state.chronicle.push(annal(0, 'immutable'));
    const snap = captureSnapshot(state);
    snap.chronicle![0].text = 'tampered';
    expect(state.chronicle.latest()?.text).toBe('immutable');
  });
});
