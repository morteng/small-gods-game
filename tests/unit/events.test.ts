import { describe, it, expect, vi } from 'vitest';
import { EventLog, type SimEvent } from '@/core/events';
import { SimClock } from '@/core/clock';

function makeLog(): { log: EventLog; clock: SimClock } {
  const clock = new SimClock();
  return { log: new EventLog(clock), clock };
}

describe('EventLog', () => {
  it('append assigns monotonic ids starting at 1', () => {
    const { log } = makeLog();
    const a = log.append({ type: 'spirit_birth', spiritId: 'p', name: 'Fooob', isPlayer: true });
    const b = log.append({ type: 'spirit_birth', spiritId: 'r', name: 'Grooob', isPlayer: false });
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
  });

  it('append stamps current sim tick as t', () => {
    const { log, clock } = makeLog();
    clock.advance(50);  // ~3 ticks at default rate
    const e = log.append({ type: 'power_depleted', spiritId: 'p' });
    expect(e.t).toBe(clock.now());
  });

  it('subscribers receive events synchronously in append order', () => {
    const { log } = makeLog();
    const seen: number[] = [];
    log.subscribe(e => seen.push(e.id));
    log.append({ type: 'power_depleted', spiritId: 'p' });
    log.append({ type: 'power_depleted', spiritId: 'r' });
    expect(seen).toEqual([1, 2]);
  });

  it('subscribe returns an unsubscribe function', () => {
    const { log } = makeLog();
    const fn = vi.fn();
    const off = log.subscribe(fn);
    log.append({ type: 'power_depleted', spiritId: 'p' });
    off();
    log.append({ type: 'power_depleted', spiritId: 'r' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('since(id) returns events with id > given', () => {
    const { log } = makeLog();
    log.append({ type: 'power_depleted', spiritId: 'a' });
    log.append({ type: 'power_depleted', spiritId: 'b' });
    log.append({ type: 'power_depleted', spiritId: 'c' });
    const r = log.since(1);
    expect(r.map(e => e.id)).toEqual([2, 3]);
  });

  it('range(tStart, tEnd) returns events in [tStart, tEnd)', () => {
    const { log, clock } = makeLog();
    log.append({ type: 'power_depleted', spiritId: 'a' });   // t=0
    clock.advance(100);                                       // t=6
    log.append({ type: 'power_depleted', spiritId: 'b' });
    clock.advance(100);
    log.append({ type: 'power_depleted', spiritId: 'c' });
    const r = log.range(0, 7);
    expect(r.map(e => (e.event as { spiritId: string }).spiritId)).toEqual(['a', 'b']);
  });

  it('size returns total events appended', () => {
    const { log } = makeLog();
    expect(log.size()).toBe(0);
    log.append({ type: 'power_depleted', spiritId: 'p' });
    log.append({ type: 'power_depleted', spiritId: 'q' });
    expect(log.size()).toBe(2);
  });

  it('one throwing subscriber does not block others', () => {
    const { log } = makeLog();
    const ok = vi.fn();
    log.subscribe(() => { throw new Error('boom'); });
    log.subscribe(ok);
    expect(() => log.append({ type: 'power_depleted', spiritId: 'p' })).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
