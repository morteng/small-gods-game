import { describe, it, expect } from 'vitest';
import { SimClock } from '@/core/clock';
import type { AppendedEvent, SimEvent } from '@/core/events';
import type { FateFocus } from '@/game/fate/fate-context';
import { FateTrigger } from '@/game/fate/fate-trigger';

let nextId = 1;
function appended(event: SimEvent, t = 0): AppendedEvent {
  return { id: nextId++, t, event };
}
const climax: SimEvent = { type: 'thread_advanced', threadId: 5, phase: 'turning', weight: 'climax' };
const rising: SimEvent = { type: 'thread_advanced', threadId: 5, phase: 'hardship', weight: 'rising' };
const opened: SimEvent = { type: 'thread_opened', threadId: 6, shapeId: 'trial', subject: { kind: 'settlement', poiId: 'p1' } };

function harness(opts?: { ready?: boolean; now?: number; cooldown?: number }) {
  const clock = new SimClock();
  let now = opts?.now ?? 1000;
  clock.now = () => now;                      // controllable clock for the test
  const fired: FateFocus[] = [];
  const trig = new FateTrigger({
    clock,
    cooldownTicks: opts?.cooldown ?? 480,
    isReady: () => opts?.ready ?? true,
    onTrigger: (f) => fired.push(f),
  });
  return { trig, fired, setNow: (n: number) => { now = n; } };
}

describe('FateTrigger', () => {
  it('fires on a climax thread_advanced, with the event + threadId as focus', () => {
    const h = harness();
    h.trig.onEvent(appended(climax));
    expect(h.fired).toHaveLength(1);
    expect(h.fired[0].event).toEqual(climax);
    expect(h.fired[0].threadId).toBe(5);
  });

  it('fires on thread_opened', () => {
    const h = harness();
    h.trig.onEvent(appended(opened));
    expect(h.fired).toHaveLength(1);
  });

  it('ignores a non-climax (rising) thread_advanced', () => {
    const h = harness();
    h.trig.onEvent(appended(rising));
    expect(h.fired).toHaveLength(0);
  });

  it('suppresses a second significant event inside the cooldown window', () => {
    const h = harness({ now: 1000, cooldown: 480 });
    h.trig.onEvent(appended(climax));        // fires at 1000
    h.setNow(1300);                          // 300 < 480 → suppressed
    h.trig.onEvent(appended(opened));
    expect(h.fired).toHaveLength(1);
    h.setNow(1500);                          // 500 ≥ 480 → fires again
    h.trig.onEvent(appended(opened));
    expect(h.fired).toHaveLength(2);
  });

  it('does not fire when not ready', () => {
    const h = harness({ ready: false });
    h.trig.onEvent(appended(climax));
    expect(h.fired).toHaveLength(0);
  });
});
