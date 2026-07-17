/**
 * F5 — dispositions (spec §3/§7, fate-arc-abandon): an arc whose goals become
 * unreachable (its shape's seedWhen preconditions collapsed) is ABANDONED within
 * one pulse — never forced — and its still-armed staged beats EXPIRE, so the arc
 * never fires its blow. Plus the landing half of goal teeth: a worked arc whose
 * goals ALL hold LANDS; a merely-seeded arc neither lands nor keeps beats alive
 * past its premise. The sweep is deterministic and sim-side, so the offline
 * (no-LLM) Fate folds honestly too.
 */
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import type { ActiveEvent, GameMap, Tile, WorldSeed } from '@/core/types';
import type { GameState } from '@/core/state';
import { FateArcStore } from '@/sim/fate/arc-store';
import { getArcShape, openArcFromShape } from '@/sim/fate/arc-library';
import { sweepArcs, expireArcBeats } from '@/sim/fate/arc-sweep';
import type { FateArc } from '@/sim/fate/arc-types';
import { FatePulse } from '@/game/fate/fate-pulse';
import { FateBrainService } from '@/game/fate/fate-brain-service';
import type { FateFocus } from '@/game/fate/fate-context';
import { LLMClient, MockLLMProvider, type LLMToolCall } from '@/llm/llm-client';

// ─── harness ──────────────────────────────────────────────────────────────────

function map(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 4; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 4; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 4, height: 4, villages: [], seed: 1, success: true,
           worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function makeState(): GameState {
  return {
    world: new World(map()), plotThreads: new PlotThreadStore(),
    staging: new StagingBuffer(), clock: new SimClock(),
    worldSeed: { name: 'T', pois: [{ id: 'poi1', name: 'Northvale' }, { id: 'poi2', name: 'Southmarsh' }] },
    fateArcs: new FateArcStore(),
  } as unknown as GameState;
}

function event(type: ActiveEvent['type'], poiId: string): ActiveEvent {
  return { type, poiId, severity: 0.5, durationTicks: 1000, ticksElapsed: 0 };
}

/** Seed victory_that_loses (seedWhen: settlement_thriving) under a live festival. */
function seedVictoryArc(state: GameState): FateArc {
  state.world!.activeEvents.set('poi1', [event('festival', 'poi1')]);
  return openArcFromShape(state.fateArcs, getArcShape('victory_that_loses')!, { poiIds: ['poi1'], npcIds: [] }, 0);
}

/** Arm a HEAVY beat linked to an arc (as a gate-passing deliberation would). */
function armHeavyBeat(state: GameState, arcId: number) {
  return state.staging.arm({
    subject: { kind: 'settlement', poiId: 'poi1' }, trigger: { kind: 'discovery' },
    hard: [{ verb: 'inject_npc', source: 'fate', target: { kind: 'settlement', poiId: 'poi1' }, payload: { role: 'refugee' }, seq: 0 }],
    arcId, stagedTick: 0,
  });
}

function pulseFor(state: GameState): { pulse: FatePulse; fired: FateFocus[] } {
  const fired: FateFocus[] = [];
  const pulse = new FatePulse({
    getState: () => state, isOffline: () => false, fire: (f) => fired.push(f), intervalTicks: 1000,
  });
  return { pulse, fired };
}

// ─── §7: unreachable ⇒ abandoned within one pulse, beat never fires ─────────────

describe('fate-arc-abandon — the §7 invariant', () => {
  it('an arc whose preconditions collapse abandons within ONE pulse and never fires its beat', () => {
    const state = makeState();
    const arc = seedVictoryArc(state);
    const beat = armHeavyBeat(state, arc.id);
    expect(state.staging.get(beat.id)!.status).toBe('armed');

    // The festival ends — settlement_thriving no longer holds; the premise is gone.
    state.world!.activeEvents.delete('poi1');

    const { pulse } = pulseFor(state);
    pulse.tick(5000);                                       // ONE pulse

    const folded = state.fateArcs.get(arc.id)!;
    expect(folded.stage).toBe('abandoned');
    expect(folded.abandonedReason).toMatch(/preconditions no longer hold/);
    expect(folded.abandonedReason).toMatch(/settlement_thriving/);
    // The staged blow EXPIRED — it can never fire (armed set no longer holds it).
    expect(state.staging.get(beat.id)!.status).toBe('expired');
    expect(state.staging.armedByTrigger('discovery')).toHaveLength(0);
  });

  it('while the preconditions still hold, a pulse does NOT abandon (no false folds)', () => {
    const state = makeState();
    const arc = seedVictoryArc(state);                      // festival stays live
    const beat = armHeavyBeat(state, arc.id);
    const { pulse } = pulseFor(state);
    pulse.tick(5000);
    expect(state.fateArcs.get(arc.id)!.stage).toBe('seeded');
    expect(state.staging.get(beat.id)!.status).toBe('armed');
  });

  it('a non-library arc (the offline stub) is never precondition-folded', () => {
    const state = makeState();
    state.fateArcs.open({
      shape: 'stub_vigil', openedTick: 0, goals: [{ predicate: 'has_settlements', met: false }],
      applied: [], portents: [], cast: { poiIds: [], npcIds: [] }, stage: 'seeded', pressureBudget: 0,
    });
    const { pulse } = pulseFor(state);
    pulse.tick(5000);
    expect(state.fateArcs.live()).toHaveLength(1);          // still standing vigil
  });

  it('the_null_event folds when even has_settlements fails (the world emptied)', () => {
    const state = makeState();
    const arc = openArcFromShape(state.fateArcs, getArcShape('the_null_event')!, { poiIds: [], npcIds: [] }, 0);
    (state as { worldSeed: WorldSeed }).worldSeed = { pois: [] } as unknown as WorldSeed;
    sweepArcs(state);
    expect(state.fateArcs.get(arc.id)!.stage).toBe('abandoned');
  });
});

// ─── goal teeth: landing ────────────────────────────────────────────────────────

describe('fate-arc sweep — landing (goal teeth)', () => {
  it('a WORKED arc (past seeded) whose goals all hold LANDS within one pulse', () => {
    const state = makeState();
    const arc = seedVictoryArc(state);
    // Fate pressed once (seeded → building), and a crisis has since taken hold.
    state.fateArcs.recordPressure({ tick: 1, verb: 'bias_event', args: {}, servedArcs: [arc.id] });
    expect(state.fateArcs.get(arc.id)!.stage).toBe('building');
    state.world!.activeEvents.set('poi2', [event('drought', 'poi2')]);   // settlement_in_crisis holds

    const { pulse } = pulseFor(state);
    pulse.tick(5000);
    expect(state.fateArcs.get(arc.id)!.stage).toBe('landed');
    expect(state.fateArcs.live()).toHaveLength(0);          // landed arcs are finished
  });

  it('a merely-SEEDED arc never lands — an intention Fate did nothing for is a coincidence', () => {
    const state = makeState();
    const arc = seedVictoryArc(state);
    state.world!.activeEvents.set('poi2', [event('drought', 'poi2')]);   // goal already true
    const { pulse } = pulseFor(state);
    pulse.tick(5000);
    expect(state.fateArcs.get(arc.id)!.stage).toBe('seeded');            // no landing unearned
    expect(state.fateArcs.get(arc.id)!.goals[0].met).toBe(true);         // truth recomputed all the same
  });

  it('an arc with NO goals (the_null_event) never lands', () => {
    const state = makeState();
    const arc = openArcFromShape(state.fateArcs, getArcShape('the_null_event')!, { poiIds: ['poi1'], npcIds: [] }, 0);
    state.fateArcs.recordPressure({ tick: 1, verb: 'nudge_severity', args: {}, servedArcs: [arc.id] });
    sweepArcs(state);
    expect(state.fateArcs.get(arc.id)!.stage).toBe('building');          // worked, but goalless ⇒ no landing
  });
});

// ─── the LLM abandon path shares the discipline ─────────────────────────────────

describe('abandon_arc (LLM path) — a folded arc never fires its beat either', () => {
  it('FateBrainService expires the arc\'s still-armed beats on abandon_arc', async () => {
    const state = makeState();
    const arc = seedVictoryArc(state);
    const beat = armHeavyBeat(state, arc.id);
    const calls: LLMToolCall[] = [{ id: 'a0', name: 'abandon_arc', arguments: { arcId: arc.id, reason: 'the feast is over' } }];
    const brain = new FateBrainService({
      getState: () => state, getCapableClient: () => new LLMClient(new MockLLMProvider(0, { cannedToolCalls: calls })),
      isScrubbed: () => false, emitCommand: () => {},
    });
    await brain.deliberate({ kind: 'pulse' });
    expect(state.fateArcs.get(arc.id)!.stage).toBe('abandoned');
    expect(state.fateArcs.get(arc.id)!.abandonedReason).toBe('the feast is over');
    expect(state.staging.get(beat.id)!.status).toBe('expired');
  });
});

// ─── partial-state tolerance ────────────────────────────────────────────────────

describe('sweep — partial-state tolerance (never throws)', () => {
  it('tolerates a state with no arc store and no staging buffer', () => {
    expect(sweepArcs({} as GameState)).toEqual({ landed: [], abandoned: [] });
    expect(expireArcBeats({} as GameState, 1)).toBe(0);
  });

  it('a fired beat is history — expireArcBeats leaves it untouched', () => {
    const state = makeState();
    const arc = seedVictoryArc(state);
    const beat = armHeavyBeat(state, arc.id);
    state.staging.markFired(beat.id);
    expect(expireArcBeats(state, arc.id)).toBe(0);
    expect(state.staging.get(beat.id)!.status).toBe('fired');
  });
});
