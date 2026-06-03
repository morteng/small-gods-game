import { describe, it, expect } from 'vitest';
import { EventLog } from '@/core/events';
import { SimClock } from '@/core/clock';
import { getRecentEventDescriptions } from '@/world/npc-helpers';
import type { NpcProperties } from '@/core/types';

function baseProps(ids: number[]): NpcProperties {
  return { recentEventIds: ids } as unknown as NpcProperties;
}

describe('getRecentEventDescriptions', () => {
  it('resolves recentEventIds to descriptions, newest first, capped', () => {
    const log = new EventLog(new SimClock());
    const w = log.append({ type: 'whisper', spiritId: 'player', npcId: 'n1' });
    const d = log.append({ type: 'dream', spiritId: 'player', npcId: 'n1' });
    const props = baseProps([w.id, d.id]);
    const out = getRecentEventDescriptions(props, log);
    expect(out.length).toBe(2);
    expect(out[0]).toContain('Dream');     // newest first
    expect(out[1]).toContain('Whisper');
  });

  it('ignores ids with no matching event and returns [] for none', () => {
    const log = new EventLog(new SimClock());
    expect(getRecentEventDescriptions(baseProps([]), log)).toEqual([]);
    expect(getRecentEventDescriptions(baseProps([42]), log)).toEqual([]);
  });
});
