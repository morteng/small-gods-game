import { describe, it, expect } from 'vitest';
import { FatePulse } from '@/game/fate/fate-pulse';
import { FateTrigger } from '@/game/fate/fate-trigger';
import { FateArcStore } from '@/sim/fate/arc-store';
import { STUB_ARC_SHAPE } from '@/sim/fate/arc-stub';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { SimClock } from '@/core/clock';
import { TICKS_PER_DAY } from '@/core/calendar';
import { SATURATED_BEAT_COUNT } from '@/sim/fate/fate-tempo';
import type { GameState } from '@/core/state';
import type { WorldSeed } from '@/core/types';
import type { FateArc } from '@/sim/fate/arc-types';
import type { FateFocus } from '@/game/fate/fate-context';
import type { SimEvent } from '@/core/events';

/** Minimal GameState the pulse actually touches: fateArcs + worldSeed. */
function state(opts?: { settlements?: boolean }): GameState {
  const fateArcs = new FateArcStore();
  const worldSeed = (opts?.settlements ?? true)
    ? ({ pois: [{ id: 'p1', name: 'Northvale' }] } as unknown as WorldSeed)
    : ({ pois: [] } as unknown as WorldSeed);
  return { fateArcs, worldSeed } as unknown as GameState;
}

function openArc(s: GameState): FateArc {
  return s.fateArcs.open({
    shape: 'strongman_dies_abroad', openedTick: 0,
    goals: [{ predicate: 'always', met: false }],
    applied: [], portents: [], cast: { poiIds: [], npcIds: [] },
    stage: 'building', pressureBudget: 3,
  });
}

describe('FatePulse — cadence + idle', () => {
  it('skips entirely when idle: no live arc AND no seed condition', () => {
    const s = state({ settlements: false });   // no POIs ⇒ stub seed condition false
    const fired: FateFocus[] = [];
    const pulse = new FatePulse({ getState: () => s, isOffline: () => true, fire: (f) => fired.push(f), intervalTicks: 1000 });
    pulse.tick(10_000);
    expect(fired).toHaveLength(0);
    expect(s.fateArcs.all()).toHaveLength(0);   // nothing seeded either
  });

  it('offline: seeds the deterministic stub arc when a seed condition is met', () => {
    const s = state();                          // has a settlement, no arcs yet
    const fired: FateFocus[] = [];
    const pulse = new FatePulse({ getState: () => s, isOffline: () => true, fire: (f) => fired.push(f), intervalTicks: 1000 });
    pulse.tick(5000);
    expect(s.fateArcs.all()).toHaveLength(1);
    expect(s.fateArcs.all()[0].shape).toBe(STUB_ARC_SHAPE);
    expect(fired).toHaveLength(1);
    expect(fired[0].kind).toBe('pulse');        // the brain gets a PULSE-framed focus
  });

  it('online (not offline): does NOT seed a stub, but still fires the pulse deliberation when an arc is live', () => {
    const s = state();
    openArc(s);                                  // a live arc ⇒ not idle
    const fired: FateFocus[] = [];
    const pulse = new FatePulse({ getState: () => s, isOffline: () => false, fire: (f) => fired.push(f), intervalTicks: 1000 });
    pulse.tick(5000);
    expect(s.fateArcs.all()).toHaveLength(1);    // no stub added
    expect(s.fateArcs.all()[0].shape).toBe('strongman_dies_abroad');
    expect(fired).toHaveLength(1);
    expect(fired[0].kind).toBe('pulse');
  });

  it('F3 online: fires when a library shape is seedable (no live arc, no stub seeded)', () => {
    const s = state();                           // one settlement ⇒ the_null_event's seedWhen holds
    const fired: FateFocus[] = [];
    const pulse = new FatePulse({ getState: () => s, isOffline: () => false, fire: (f) => fired.push(f), intervalTicks: 1000 });
    pulse.tick(5000);
    expect(fired).toHaveLength(1);               // the LLM gets its chance to seed_arc
    expect(fired[0].kind).toBe('pulse');
    expect(s.fateArcs.all()).toHaveLength(0);    // online never seeds the deterministic stub
  });

  it('F3 online: skips entirely when NO library shape is seedable and no arc is live', () => {
    const s = state({ settlements: false });     // no POIs ⇒ every seedWhen fails
    const fired: FateFocus[] = [];
    const pulse = new FatePulse({ getState: () => s, isOffline: () => false, fire: (f) => fired.push(f), intervalTicks: 1000 });
    pulse.tick(5000);
    expect(fired).toHaveLength(0);
  });

  it('fires ~once per game day (default cadence = TICKS_PER_DAY)', () => {
    const s = state();
    const fired: FateFocus[] = [];
    // Default interval (no override) = one game-day. Offline seeds the stub on day 1;
    // it stays live thereafter, so each subsequent day fires once more.
    const pulse = new FatePulse({ getState: () => s, isOffline: () => true, fire: (f) => fired.push(f) });
    let now = 0;
    for (let day = 0; day < 5; day++) { pulse.tick(now); now += TICKS_PER_DAY; }
    expect(fired).toHaveLength(5);               // exactly one per day, never more
    // A within-day extra tick does NOT re-fire (day cadence gate).
    pulse.tick(now - Math.floor(TICKS_PER_DAY / 2));
    expect(fired).toHaveLength(5);
  });

  it('recomputes goal.met each pulse (never trusts the stored value)', () => {
    const s = state();
    const arc = openArc(s);                      // goal predicate 'always', met stored false
    const pulse = new FatePulse({ getState: () => s, isOffline: () => false, fire: () => {}, intervalTicks: 1000 });
    pulse.tick(5000);
    expect(s.fateArcs.get(arc.id)!.goals[0].met).toBe(true);   // 'always' ⇒ recomputed true
  });
});

describe('FatePulse — saturation cluster-guard', () => {
  /** Arm N beats staged at `now` so the tempo reads SATURATED. */
  function saturate(s: GameState, now: number, n: number): void {
    const staging = new StagingBuffer();
    for (let i = 0; i < n; i++) {
      staging.arm({ subject: { kind: 'settlement', poiId: 'p1' }, trigger: { kind: 'discovery' }, hard: [], stagedTick: now - i });
    }
    (s as unknown as { staging: StagingBuffer }).staging = staging;
  }

  it('HOLDS (does not fire) when the world is dramatically saturated, but the sweep still ran', () => {
    const s = state();
    // A worked building arc whose goal already holds — the sweep should LAND it,
    // proving sweepArcs ran even though the cluster-guard suppresses the fire.
    const arc = s.fateArcs.open({
      shape: 'strongman_dies_abroad', openedTick: 0,
      goals: [{ predicate: 'always', met: false }],
      applied: [], portents: [], cast: { poiIds: [], npcIds: [] },
      stage: 'building', pressureBudget: 3,
    });
    const now = 10 * TICKS_PER_DAY;
    saturate(s, now, SATURATED_BEAT_COUNT);
    const fired: FateFocus[] = [];
    const pulse = new FatePulse({ getState: () => s, isOffline: () => false, fire: (f) => fired.push(f), intervalTicks: 1000 });
    pulse.tick(now);
    expect(fired).toHaveLength(0);                        // saturated ⇒ held
    expect(s.fateArcs.get(arc.id)!.stage).toBe('landed'); // sweep still ran (arc landed)
  });

  it('consumes the day cadence on a saturation-hold (holds for the interval)', () => {
    const s = state();
    openArc(s);                                           // a live arc ⇒ not idle
    const now = 10 * TICKS_PER_DAY;
    saturate(s, now, SATURATED_BEAT_COUNT);
    const fired: FateFocus[] = [];
    const pulse = new FatePulse({ getState: () => s, isOffline: () => false, fire: (f) => fired.push(f), intervalTicks: 1000 });
    pulse.tick(now);
    expect(fired).toHaveLength(0);
    // Within the same cadence window the day gate blocks re-entry entirely.
    pulse.tick(now + 500);
    expect(fired).toHaveLength(0);
  });

  it('fires normally when the buffer is just BELOW saturation (nominal)', () => {
    const s = state();
    openArc(s);
    const now = 10 * TICKS_PER_DAY;
    saturate(s, now, SATURATED_BEAT_COUNT - 1);           // nominal, not saturated
    const fired: FateFocus[] = [];
    const pulse = new FatePulse({ getState: () => s, isOffline: () => false, fire: (f) => fired.push(f), intervalTicks: 1000 });
    pulse.tick(now);
    expect(fired).toHaveLength(1);
    expect(fired[0].kind).toBe('pulse');
  });
});

describe('FatePulse — shares FateTrigger\'s cooldown', () => {
  function evt(): SimEvent { return { type: 'thread_opened', threadId: 7, shapeId: 'trial', subject: { kind: 'settlement', poiId: 'p1' } }; }

  it('a pulse is suppressed by the SAME cooldown a just-fired event deliberation consumed', () => {
    const clock = new SimClock();
    let now = 1000;
    clock.now = () => now;
    const fired: FateFocus[] = [];
    const trigger = new FateTrigger({
      clock, cooldownTicks: 480, isReady: () => true, onTrigger: (f) => fired.push(f),
    });
    const s = state();
    openArc(s);                                  // a live arc ⇒ pulse never idle
    const pulse = new FatePulse({
      getState: () => s, isOffline: () => false, intervalTicks: 100,
      fire: (f) => { trigger.pulse(f, now); },   // SHARED gate
    });

    // Event deliberation fires at 1000 and anchors the shared cooldown.
    trigger.onEvent({ id: 1, t: 0, event: evt() });
    expect(fired).toHaveLength(1);
    expect(fired[0].kind).toBe('event');

    // Pulse at 1100: its own day gate (100) is clear, but 1100-1000 = 100 < 480 ⇒
    // the SHARED cooldown suppresses the deliberation.
    now = 1100;
    pulse.tick(now);
    expect(fired).toHaveLength(1);

    // Later, past the shared cooldown, the pulse fires.
    now = 1600;                                  // 600 ≥ 480, and day gate (500 ≥ 100) clear
    pulse.tick(now);
    expect(fired).toHaveLength(2);
    expect(fired[1].kind).toBe('pulse');
  });
});
