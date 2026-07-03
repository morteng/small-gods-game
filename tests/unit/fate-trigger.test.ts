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
const rivalClaim = (npcId = 'n1'): SimEvent => ({ type: 'answer_prayer', spiritId: 'rival-1', npcId });
const playerClaim = (npcId = 'n1'): SimEvent => ({ type: 'answer_prayer', spiritId: 'player', npcId });

function harness(opts?: {
  ready?: boolean; now?: number; cooldown?: number;
  rivalClaimThreshold?: number; rivalClaimWindowTicks?: number;
}) {
  const clock = new SimClock();
  let now = opts?.now ?? 1000;
  clock.now = () => now;                      // controllable clock for the test
  const fired: FateFocus[] = [];
  const trig = new FateTrigger({
    clock,
    cooldownTicks: opts?.cooldown ?? 480,
    isReady: () => opts?.ready ?? true,
    onTrigger: (f) => fired.push(f),
    rivalClaimThreshold: opts?.rivalClaimThreshold,
    rivalClaimWindowTicks: opts?.rivalClaimWindowTicks,
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

describe('FateTrigger — rival pressure', () => {
  it('does not fire on a single rival prayer-claim (below threshold)', () => {
    const h = harness({ rivalClaimThreshold: 2 });
    h.trig.onEvent(appended(rivalClaim('n1')));
    expect(h.fired).toHaveLength(0);
  });

  it('fires once the claim count clears the threshold within the window, with the claim as focus', () => {
    const h = harness({ now: 1000, rivalClaimThreshold: 2, rivalClaimWindowTicks: 240 });
    h.trig.onEvent(appended(rivalClaim('n1')));      // 1 → below threshold
    expect(h.fired).toHaveLength(0);
    h.setNow(1100);
    h.trig.onEvent(appended(rivalClaim('n2')));      // 2 within 240 → fires
    expect(h.fired).toHaveLength(1);
    expect(h.fired[0].event.type).toBe('answer_prayer');
    expect(h.fired[0].threadId).toBeUndefined();
  });

  it('never counts the player\'s own answered prayers toward the threshold', () => {
    const h = harness({ rivalClaimThreshold: 2 });
    h.trig.onEvent(appended(playerClaim('n1')));
    h.trig.onEvent(appended(playerClaim('n2')));
    h.trig.onEvent(appended(playerClaim('n3')));
    expect(h.fired).toHaveLength(0);
  });

  it('drops claims that fall outside the sliding window so stale pressure never fires', () => {
    const h = harness({ now: 1000, rivalClaimThreshold: 2, rivalClaimWindowTicks: 240 });
    h.trig.onEvent(appended(rivalClaim('n1')));      // recorded at 1000
    h.setNow(1300);                                  // 300 > 240 → the first claim is pruned
    h.trig.onEvent(appended(rivalClaim('n2')));      // only 1 in-window → no fire
    expect(h.fired).toHaveLength(0);
  });

  it('honours the cooldown between rival-pressure firings', () => {
    // Window wider than the cooldown so pruning does not confound the cooldown gate.
    const h = harness({ now: 1000, cooldown: 480, rivalClaimThreshold: 2, rivalClaimWindowTicks: 1000 });
    h.trig.onEvent(appended(rivalClaim('n1')));
    h.trig.onEvent(appended(rivalClaim('n2')));      // fires at 1000
    expect(h.fired).toHaveLength(1);
    h.setNow(1200);
    h.trig.onEvent(appended(rivalClaim('n3')));      // still ≥ threshold but 200 < 480 → suppressed
    expect(h.fired).toHaveLength(1);
    h.setNow(1500);                                  // 500 ≥ 480 → fires again
    h.trig.onEvent(appended(rivalClaim('n4')));
    expect(h.fired).toHaveLength(2);
  });

  it('does not fire on rival pressure when not ready', () => {
    const h = harness({ ready: false, rivalClaimThreshold: 2 });
    h.trig.onEvent(appended(rivalClaim('n1')));
    h.trig.onEvent(appended(rivalClaim('n2')));
    expect(h.fired).toHaveLength(0);
  });
});
