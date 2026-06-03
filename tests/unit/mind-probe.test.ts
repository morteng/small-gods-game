import { describe, it, expect } from 'vitest';
import { mindProbeCost, probeMind } from '@/sim/mind-probe';
import { EventLog } from '@/core/events';
import { SimClock } from '@/core/clock';
import type { Spirit } from '@/core/spirit';

function player(power: number): Spirit {
  return { id: 'player', name: 'You', sigil: '✶', color: '#fff', isPlayer: true, power, manifestation: null } as Spirit;
}
function freshLog(): EventLog {
  return new EventLog(new SimClock());
}

describe('mindProbeCost', () => {
  it('is free at the surface and doubles per depth', () => {
    expect(mindProbeCost(0)).toBe(0);
    expect(mindProbeCost(1)).toBe(1);
    expect(mindProbeCost(2)).toBe(2);
    expect(mindProbeCost(3)).toBe(4);
    expect(mindProbeCost(4)).toBe(8);
    expect(mindProbeCost(5)).toBe(16);
  });
});

describe('probeMind', () => {
  it('spends the depth cost and logs a mind_probed event', () => {
    const log = freshLog();
    const s = player(10);
    const ok = probeMind(s, 3, log, 'npc1'); // depth 3 → cost 4
    expect(ok).toBe(true);
    expect(s.power).toBe(6);
    const found = log.since(0).some(a => a.event.type === 'mind_probed');
    expect(found).toBe(true);
  });

  it('rejects when power is insufficient', () => {
    const log = freshLog();
    const s = player(2);
    expect(probeMind(s, 4, log, 'npc1')).toBe(false); // cost 8 > 2
    expect(s.power).toBe(2);
  });

  it('is free and always succeeds at depth 0 without spending', () => {
    const log = freshLog();
    const s = player(0);
    expect(probeMind(s, 0, log, 'npc1')).toBe(true);
    expect(s.power).toBe(0);
  });
});
