import { describe, it, expect } from 'vitest';
import { SimClock } from '@/core/clock';
import { EventLog, type SimEvent } from '@/core/events';

describe('era_skipped event', () => {
  it('round-trips through the event log with all summary fields', () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const captured: SimEvent[] = [];
    log.subscribe(a => captured.push(a.event));
    log.append({
      type: 'era_skipped', fromTick: 0, toTick: 23040, years: 1,
      deaths: 2, births: 3, believersBefore: 5, believersAfter: 6,
    });
    expect(captured).toHaveLength(1);
    const e = captured[0];
    expect(e.type).toBe('era_skipped');
    if (e.type === 'era_skipped') {
      expect(e.years).toBe(1);
      expect(e.deaths).toBe(2);
      expect(e.believersAfter).toBe(6);
    }
  });
});
