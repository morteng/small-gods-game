import { describe, it, expect } from 'vitest';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { FateArcStore } from '@/sim/fate/arc-store';
import { TICKS_PER_DAY } from '@/core/calendar';
import type { GameState } from '@/core/state';
import type { FateArc } from '@/sim/fate/arc-types';
import {
  computeFateTempo, pulseShouldHold, describeTempoForFate,
  TEMPO_WINDOW_TICKS, STARVED_SILENCE_TICKS, SATURATED_BEAT_COUNT,
} from '@/sim/fate/fate-tempo';

/** A staging buffer arming one beat per given stagedTick. */
function stagingWithBeats(ticks: number[]): StagingBuffer {
  const staging = new StagingBuffer();
  for (const t of ticks) {
    staging.arm({
      subject: { kind: 'settlement', poiId: 'p1' },
      trigger: { kind: 'discovery' }, hard: [], stagedTick: t,
    });
  }
  return staging;
}

function baseArc(stage: FateArc['stage']): Omit<FateArc, 'id'> {
  return {
    shape: 'strongman_dies_abroad', openedTick: 0,
    goals: [{ predicate: 'always', met: false }],
    applied: [], portents: [], cast: { poiIds: [], npcIds: [] },
    stage, pressureBudget: 3,
  };
}

function state(opts?: {
  beatTicks?: number[]; arcs?: FateArc['stage'][]; portentTicks?: number[];
}): { s: GameState; clock: SimClock } {
  const clock = new SimClock();
  const eventLog = new EventLog(clock);
  const fateArcs = new FateArcStore();
  for (const stage of opts?.arcs ?? []) fateArcs.open(baseArc(stage));
  const staging = stagingWithBeats(opts?.beatTicks ?? []);
  // Portent events land at their given tick — set the clock, then append.
  let cur = 0;
  clock.now = () => cur;
  for (const t of opts?.portentTicks ?? []) {
    cur = t;
    eventLog.append({ type: 'portent_planted', arcId: 1, kind: 'dream', poiId: 'p1', beatId: 1 });
  }
  return { s: { staging, eventLog, fateArcs, clock } as unknown as GameState, clock };
}

describe('computeFateTempo — beat window counting', () => {
  it('counts only beats staged inside TEMPO_WINDOW_TICKS ending at now', () => {
    const now = 10 * TICKS_PER_DAY;
    // Two inside the 3-day window, one just outside it.
    const inA = now - 1;                          // inside
    const inB = now - TEMPO_WINDOW_TICKS;         // boundary (inclusive)
    const out = now - TEMPO_WINDOW_TICKS - 1;     // outside
    const { s } = state({ beatTicks: [inA, inB, out] });
    const t = computeFateTempo(s, now);
    expect(t.beatsInWindow).toBe(2);
    expect(t.ticksSinceLastBeat).toBe(1);         // freshest beat is inA (now-1)
  });

  it('ignores future-dated beats for both count and silence', () => {
    const now = 5 * TICKS_PER_DAY;
    const { s } = state({ beatTicks: [now + TICKS_PER_DAY] });
    const t = computeFateTempo(s, now);
    expect(t.beatsInWindow).toBe(0);
    expect(t.ticksSinceLastBeat).toBe(now);       // no past beat ⇒ silence spans the run
  });
});

describe('computeFateTempo — phase thresholds', () => {
  it('is SATURATED at >= SATURATED_BEAT_COUNT in-window beats', () => {
    const now = 10 * TICKS_PER_DAY;
    const ticks = Array.from({ length: SATURATED_BEAT_COUNT }, (_, i) => now - i - 1);
    const { s } = state({ beatTicks: ticks });
    const t = computeFateTempo(s, now);
    expect(t.beatsInWindow).toBe(SATURATED_BEAT_COUNT);
    expect(t.phase).toBe('saturated');
    expect(pulseShouldHold(t)).toBe(true);
  });

  it('is NOMINAL just below the saturation count', () => {
    const now = 10 * TICKS_PER_DAY;
    const ticks = Array.from({ length: SATURATED_BEAT_COUNT - 1 }, (_, i) => now - i - 1);
    const { s } = state({ beatTicks: ticks });
    const t = computeFateTempo(s, now);
    expect(t.phase).toBe('nominal');
    expect(pulseShouldHold(t)).toBe(false);
  });

  it('is STARVED after >= STARVED_SILENCE_TICKS with zero in-window beats', () => {
    const now = 10 * TICKS_PER_DAY;
    // One ancient beat, older than the starvation silence ⇒ no in-window beat.
    const { s } = state({ beatTicks: [now - STARVED_SILENCE_TICKS] });
    const t = computeFateTempo(s, now);
    expect(t.beatsInWindow).toBe(0);
    expect(t.ticksSinceLastBeat).toBe(STARVED_SILENCE_TICKS);
    expect(t.phase).toBe('starved');
    expect(pulseShouldHold(t)).toBe(false);
  });

  it('a never-authored, fresh world reads STARVED only past the silence horizon', () => {
    // 1 day of silence < 4 days ⇒ NOT starved yet (nominal).
    expect(computeFateTempo(state().s, TICKS_PER_DAY).phase).toBe('nominal');
    // Past the 4-day silence horizon with zero beats ⇒ starved.
    expect(computeFateTempo(state().s, STARVED_SILENCE_TICKS).phase).toBe('starved');
  });
});

describe('computeFateTempo — portent + arc momentum counts are exact', () => {
  it('counts portent_planted events inside the window and live building/imminent arcs', () => {
    const now = 10 * TICKS_PER_DAY;
    const { s } = state({
      arcs: ['building', 'imminent', 'imminent', 'seeded'],
      portentTicks: [now - 1, now - 2, now - TEMPO_WINDOW_TICKS - 5 /* outside */],
    });
    const t = computeFateTempo(s, now);
    expect(t.portentsInWindow).toBe(2);
    expect(t.buildingArcs).toBe(1);
    expect(t.imminentArcs).toBe(2);               // seeded is not counted as momentum
    expect(t.tension).toBeGreaterThan(0);
    expect(t.tension).toBeLessThanOrEqual(1);
  });
});

describe('computeFateTempo — guidance + helpers', () => {
  it('guidance is non-empty, mentions the phase, and describeTempoForFate mirrors it', () => {
    const now = 10 * TICKS_PER_DAY;
    const saturated = computeFateTempo(state({ beatTicks: [now - 1, now - 2, now - 3] }).s, now);
    expect(saturated.guidance.length).toBeGreaterThan(0);
    expect(saturated.guidance.toLowerCase()).toContain(saturated.phase);
    expect(describeTempoForFate(saturated)).toBe(saturated.guidance);

    const nominal = computeFateTempo(state({ beatTicks: [now - 1] }).s, now);
    expect(nominal.guidance.toLowerCase()).toContain('nominal');

    const starved = computeFateTempo(state().s, STARVED_SILENCE_TICKS);
    expect(starved.guidance.toLowerCase()).toContain('starved');
  });

  it('tolerates partial state (no staging/eventLog/arcs) without throwing', () => {
    const t = computeFateTempo({} as GameState, 5 * TICKS_PER_DAY);
    expect(t.beatsInWindow).toBe(0);
    expect(t.portentsInWindow).toBe(0);
    expect(t.buildingArcs).toBe(0);
    expect(t.imminentArcs).toBe(0);
    expect(t.phase).toBe('starved');              // silence spans the run, no beats
  });

  it('respects config overrides for the thresholds', () => {
    const now = 10 * TICKS_PER_DAY;
    const t = computeFateTempo(state({ beatTicks: [now - 1, now - 2] }).s, now, { saturatedBeatCount: 2 });
    expect(t.phase).toBe('saturated');
  });
});
