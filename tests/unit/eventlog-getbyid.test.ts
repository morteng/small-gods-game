import { describe, it, expect } from 'vitest';
import { EventLog } from '@/core/events';
import { SimClock } from '@/core/clock';

describe('EventLog.getById', () => {
  it('returns the appended event by id, or undefined', () => {
    const log = new EventLog(new SimClock());
    const a = log.append({ type: 'whisper', spiritId: 's1', npcId: 'n1' });
    const b = log.append({ type: 'dream', spiritId: 's1', npcId: 'n1' });
    expect(log.getById(a.id)?.event.type).toBe('whisper');
    expect(log.getById(b.id)?.event.type).toBe('dream');
    expect(log.getById(9999)).toBeUndefined();
  });
});
