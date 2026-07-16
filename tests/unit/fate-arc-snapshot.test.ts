import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { createRng } from '@/core/rng';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { FateArcStore } from '@/sim/fate/arc-store';
import { ARC_LIBRARY, getArcShape, openArcFromShape } from '@/sim/fate/arc-library';
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

  it('F3: a library-seeded arc round-trips — goals/budget from the shape, cast binding intact', () => {
    const state = makeState();
    const arc = openArcFromShape(
      state.fateArcs, getArcShape('strongman_dies_abroad')!, { poiIds: ['p1'], npcIds: ['n1'] }, 5,
    );
    const snap = captureSnapshot(state);
    state.fateArcs.hydrate([]);
    restoreSnapshot(state, snap);
    const restored = state.fateArcs.get(arc.id)!;
    expect(restored.shape).toBe('strongman_dies_abroad');
    expect(restored.pressureBudget).toBe(ARC_LIBRARY.strongman_dies_abroad.budget);
    expect(restored.goals.map((g) => g.predicate)).toEqual(
      ARC_LIBRARY.strongman_dies_abroad.goals.map((g) => g.predicate),
    );
    expect(restored.cast).toEqual({ poiIds: ['p1'], npcIds: ['n1'] });
  });

  it('F3: an ABANDONED arc round-trips with its stage and reason (it feeds the chronicler)', () => {
    const state = makeState();
    const arc = openArc(state);
    expect(state.fateArcs.abandon(arc.id, 'the heir came home')).toBe(true);
    const snap = captureSnapshot(state);
    state.fateArcs.hydrate([]);
    restoreSnapshot(state, snap);
    const restored = state.fateArcs.get(arc.id)!;
    expect(restored.stage).toBe('abandoned');
    expect(restored.abandonedReason).toBe('the heir came home');
    expect(state.fateArcs.live()).toHaveLength(0);           // stays folded — never resurrects
  });

  it('F3: abandon() refuses an unknown or already-folded arc', () => {
    const state = makeState();
    const arc = openArc(state);
    expect(state.fateArcs.abandon(999, 'x')).toBe(false);
    expect(state.fateArcs.abandon(arc.id, 'first fold')).toBe(true);
    expect(state.fateArcs.abandon(arc.id, 'second fold')).toBe(false);   // cannot re-fold / overwrite
    expect(state.fateArcs.get(arc.id)!.abandonedReason).toBe('first fold');
  });

  it('F4: the portent LEDGER round-trips — kind/text/beatId intact, discovered preserved as historical fact', () => {
    const state = makeState();
    const arc = openArcFromShape(
      state.fateArcs, getArcShape('strongman_dies_abroad')!, { poiIds: ['p1'], npcIds: [] }, 0,
    );
    expect(state.fateArcs.plantPortent(arc.id, {
      tick: 3, kind: 'dream', discovered: false, text: 'A black sail in every dream.', beatId: 11,
    })).toBe(true);
    expect(state.fateArcs.plantPortent(arc.id, {
      tick: 5, kind: 'sky', discovered: false, text: 'The moon rises wrong.', beatId: 12,
    })).toBe(true);
    state.fateArcs.markPortentDiscovered(11);   // the first omen was found before the save

    const snap = captureSnapshot(state);
    state.fateArcs.hydrate([]);
    restoreSnapshot(state, snap);

    const restored = state.fateArcs.get(arc.id)!;
    expect(restored.portents).toEqual([
      { tick: 3, kind: 'dream', discovered: true, text: 'A black sail in every dream.', beatId: 11 },
      { tick: 5, kind: 'sky', discovered: false, text: 'The moon rises wrong.', beatId: 12 },
    ]);
  });

  it('F4: a scrub REWINDS the ledger with the arc (portents are sim truth)', () => {
    const state = makeState();
    const arc = openArc(state);
    const before = captureSnapshot(state);   // arc live, ledger empty
    state.fateArcs.plantPortent(arc.id, { tick: 9, kind: 'dream', discovered: false, beatId: 1 });
    expect(state.fateArcs.get(arc.id)!.portents).toHaveLength(1);
    restoreSnapshot(state, before);          // scrub back before the omen was planted
    expect(state.fateArcs.get(arc.id)!.portents).toHaveLength(0);
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
