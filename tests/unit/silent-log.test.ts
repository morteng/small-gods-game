import { describe, it, expect } from 'vitest';
import { SilentEventLog } from '@/core/events';
import { SimClock } from '@/core/clock';

describe('SilentEventLog', () => {
  it('does nothing on append', () => {
    const log = new SilentEventLog(new SimClock());
    const out = log.append({ type: 'system_error', system: 'x', message: 'y' });
    expect(out.id).toBe(0);
    expect(log.size()).toBe(0);
  });

  it('subscribers are never called', () => {
    const log = new SilentEventLog(new SimClock());
    let calls = 0;
    log.subscribe(() => { calls++; });
    log.append({ type: 'system_error', system: 'x', message: 'y' });
    expect(calls).toBe(0);
  });
});
