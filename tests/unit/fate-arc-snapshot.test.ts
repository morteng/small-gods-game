import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { createRng } from '@/core/rng';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { FateArcStore } from '@/sim/fate/arc-store';
import { EventLog } from '@/core/events';
import { captureSnapshot, restoreSnapshot, type Snapshot } from '@/core/snapshot';
import { FatePulse } from '@/game/fate/fate-pulse';
import type { FateFocus } from '@/game/fate/fate-context';
import type { GameMap, Tile, WorldSeed } from '@/core/types';
import type { GameState } from '@/core/state';
import type { FateArc } from '@/sim/fate/arc-types';

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

/** A minimal worldSeed with one POI, so `has_settlements` evaluates true. */
function seed(): WorldSeed {
  return { pois: [{ id: 'p1', name: 'Northvale' }] } as unknown as WorldSeed;
}

function makeState(): GameState {
  const m = map();
  return {
    world: new World(m), map: m, clock: new SimClock(), rng: createRng(1),
    eventLog: new EventLog(new SimClock()), spirits: new Map(),
    worldSeed: seed(),
    plotThreads: new PlotThreadStore(), staging: new StagingBuffer(),
    fateArcs: new FateArcStore(),
  } as unknown as GameState;
}

function openArc(state: GameState): FateArc {
  return state.fateArcs.open({
    shape: 'stub_vigil',
    openedTick: state.clock.now(),
    goals: [{ predicate: 'has_settlements', met: false }],
    applied: [],
    portents: [],
    cast: { poiIds: ['p1'], npcIds: [] },
    stage: 'seeded',
    pressureBudget: 0,
  });
}

describe('fate arcs — snapshot round-trip', () => {
  it('arcs survive capture → mutate-away → restore', () => {
    const state = makeState();
    const arc = openArc(state);
    const snap = captureSnapshot(state);
    // Mutate the live store away after capture.
    state.fateArcs.hydrate([]);
    expect(state.fateArcs.all()).toHaveLength(0);
    restoreSnapshot(state, snap);
    const restored = state.fateArcs.get(arc.id);
    expect(restored).toBeDefined();
    expect(restored!.shape).toBe('stub_vigil');
    expect(restored!.cast.poiIds).toEqual(['p1']);
    expect(state.fateArcs.live()).toHaveLength(1);
  });

  it('a scrub REWINDS arcs: restore an earlier snapshot ⇒ the arc un-happens', () => {
    const state = makeState();
    // Snapshot BEFORE any arc exists (the "earlier" timeline point).
    const before = captureSnapshot(state);
    expect(state.fateArcs.live()).toHaveLength(0);
    // Fate opens an arc "later".
    openArc(state);
    expect(state.fateArcs.live()).toHaveLength(1);
    // Scrub back to before it was seeded → arc state is sim truth, so it un-happens.
    restoreSnapshot(state, before);
    expect(state.fateArcs.all()).toHaveLength(0);
    expect(state.fateArcs.live()).toHaveLength(0);
  });

  it('tolerates a snapshot with no fateArcs field (pre-arc save) → empty arc set', () => {
    const state = makeState();
    openArc(state);
    const snap = captureSnapshot(state);
    delete (snap as Partial<Snapshot>).fateArcs;   // simulate a pre-feature save
    restoreSnapshot(state, snap);
    expect(state.fateArcs.all()).toHaveLength(0);
  });

  it('ArcGoal.met is RECOMPUTED on restore — never trusted from disk (true→derived)', () => {
    const state = makeState();
    openArc(state);
    const snap = captureSnapshot(state);
    // Corrupt the persisted `met` to the WRONG value in both directions.
    for (const a of snap.fateArcs!) for (const g of a.goals) g.met = true;   // has_settlements IS true here
    restoreSnapshot(state, snap);
    // Recomputed against the restored world (one POI) ⇒ has_settlements === true.
    expect(state.fateArcs.all()[0].goals[0].met).toBe(true);
  });

  it('ArcGoal.met recomputes to FALSE when the predicate no longer holds', () => {
    const state = makeState();
    openArc(state);
    const snap = captureSnapshot(state);
    // Persist met: true, but restore into a world with NO settlements.
    for (const a of snap.fateArcs!) for (const g of a.goals) g.met = true;
    (state as { worldSeed: WorldSeed | null }).worldSeed = { pois: [] } as unknown as WorldSeed;
    restoreSnapshot(state, snap);
    expect(state.fateArcs.all()[0].goals[0].met).toBe(false);
  });
});

describe('fate pulse — runtime throttle resets on restore (scrub-ghost)', () => {
  it('reset() unwedges the day cadence after a scrub puts the clock before lastPulseTick', () => {
    const fired: FateFocus[] = [];
    const pulse = new FatePulse({
      getState: () => makeStateWithLiveArc(),
      isOffline: () => false,
      fire: (f) => fired.push(f),
      intervalTicks: 1000,
    });
    pulse.tick(5000);                 // fires, lastPulseTick = 5000
    expect(fired).toHaveLength(1);
    pulse.tick(2000);                 // scrubbed back: 2000 - 5000 < 1000 → wedged shut
    expect(fired).toHaveLength(1);
    pulse.reset();                    // timeline onRestore
    pulse.tick(2000);                 // gate reopened
    expect(fired).toHaveLength(2);
  });
});

/** A state whose arc store already holds one live arc (so the pulse is never idle). */
function makeStateWithLiveArc(): GameState {
  const state = makeState();
  openArc(state);
  return state;
}
