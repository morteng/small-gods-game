import { describe, it, expect } from 'vitest';
import { FateArcStore } from '@/sim/fate/arc-store';
import { sweepArcs } from '@/sim/fate/arc-sweep';
import type { GameState } from '@/core/state';
import type { ArcGoal, ArcPortent, FateArc } from '@/sim/fate/arc-types';

/** A minimal state carrying only the arc store the sweep reads. */
function state(store: FateArcStore): GameState {
  return { fateArcs: store } as unknown as GameState;
}

/** Open an arc. Shape is an UNKNOWN library key so the abandon branch (seedWhen)
 *  never interferes — the sweep skips shapes it cannot resolve. */
function open(
  store: FateArcStore,
  stage: FateArc['stage'],
  opts?: { budget?: number; goals?: ArcGoal[]; portents?: ArcPortent[] },
): FateArc {
  return store.open({
    shape: 'test_only_shape', openedTick: 0,
    goals: opts?.goals ?? [{ predicate: 'never', met: false }],
    applied: [], portents: opts?.portents ?? [], cast: { poiIds: [], npcIds: [] },
    stage, pressureBudget: opts?.budget ?? 3,
  });
}

describe('arc escalation — sweepArcs building → imminent', () => {
  it('escalates a live building arc whose pressure budget is spent, and reports it', () => {
    const store = new FateArcStore();
    const arc = open(store, 'building', { budget: 0 });          // spent, goals unmet
    const res = sweepArcs(state(store));
    expect(store.get(arc.id)!.stage).toBe('imminent');
    expect(res.escalated).toEqual([arc.id]);
    expect(res.landed).toEqual([]);
  });

  it('escalates a building arc with a discovered portent and >= half its goals met', () => {
    const store = new FateArcStore();
    const arc = open(store, 'building', {
      budget: 3,                                                  // NOT budget-spent
      goals: [{ predicate: 'always', met: false }, { predicate: 'never', met: false }],
      portents: [{ tick: 0, kind: 'dream', discovered: true }],
    });
    const res = sweepArcs(state(store));
    expect(store.get(arc.id)!.stage).toBe('imminent');           // 1 of 2 goals met + discovered portent
    expect(res.escalated).toEqual([arc.id]);
  });

  it('does NOT escalate a building arc that is neither budget-spent nor portent-ready', () => {
    const store = new FateArcStore();
    const arc = open(store, 'building', { budget: 3 });           // budget left, no discovered portent
    const res = sweepArcs(state(store));
    expect(store.get(arc.id)!.stage).toBe('building');
    expect(res.escalated).toEqual([]);
  });

  it('never escalates a seeded arc (only building promotes)', () => {
    const store = new FateArcStore();
    const arc = open(store, 'seeded', { budget: 0 });
    const res = sweepArcs(state(store));
    expect(store.get(arc.id)!.stage).toBe('seeded');
    expect(res.escalated).toEqual([]);
  });

  it('an imminent arc is still live and LANDS when all its goals hold', () => {
    const store = new FateArcStore();
    const arc = open(store, 'imminent', { goals: [{ predicate: 'always', met: false }] });
    const res = sweepArcs(state(store));
    expect(store.get(arc.id)!.stage).toBe('landed');
    expect(res.landed).toEqual([arc.id]);
    expect(res.escalated).toEqual([]);
  });

  it('escalation is idempotent — an already-imminent arc is not re-reported', () => {
    const store = new FateArcStore();
    const arc = open(store, 'imminent', { budget: 0 });          // unmet goals, spent budget
    const res = sweepArcs(state(store));
    expect(store.get(arc.id)!.stage).toBe('imminent');           // unchanged
    expect(res.escalated).toEqual([]);
  });

  it('store.escalate only promotes a building arc', () => {
    const store = new FateArcStore();
    const building = open(store, 'building');
    const seeded = open(store, 'seeded');
    expect(store.escalate(building.id)).toBe(true);
    expect(store.get(building.id)!.stage).toBe('imminent');
    expect(store.escalate(seeded.id)).toBe(false);               // seeded never leapfrogs
    expect(store.escalate(building.id)).toBe(false);             // now imminent — no re-promote
    expect(store.escalate(9999)).toBe(false);                    // unknown id
  });
});
