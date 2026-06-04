import { describe, it, expect } from 'vitest';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import type { ThreadSubject } from '@/sim/threads/thread-types';

const npc: ThreadSubject = { kind: 'npc', npcId: 'n1' };

describe('PlotThreadStore', () => {
  it('opens at the first phase, active', () => {
    const s = new PlotThreadStore();
    const t = s.open('loss-given-meaning', npc, 100);
    expect(t.phase).toBe('loss');
    expect(t.status).toBe('active');
    expect(s.active()).toHaveLength(1);
  });

  it('advance records a contributing event and reverse-indexes it', () => {
    const s = new PlotThreadStore();
    const t = s.open('loss-given-meaning', npc, 100);
    s.advance(t.id, 'reaching', 42, 110);
    expect(s.get(t.id)!.phase).toBe('reaching');
    expect(s.get(t.id)!.contributingEvents).toHaveLength(1);
    expect(s.threadOfEvent(42)).toBe(t.id);
  });

  it('resolve sets the status and drops it from active()', () => {
    const s = new PlotThreadStore();
    const t = s.open('loss-given-meaning', npc, 100);
    s.resolve(t.id, 'resolved', 120);
    expect(s.get(t.id)!.status).toBe('resolved');
    expect(s.active()).toHaveLength(0);
  });

  it('bySubject finds threads for a subject', () => {
    const s = new PlotThreadStore();
    s.open('loss-given-meaning', npc, 100);
    expect(s.bySubject(npc)).toHaveLength(1);
    expect(s.bySubject({ kind: 'npc', npcId: 'other' })).toHaveLength(0);
  });

  it('serialize/hydrate round-trips and rebuilds the reverse index + id counter', () => {
    const s = new PlotThreadStore();
    const t = s.open('trial', { kind: 'settlement', poiId: 'p1' }, 5);
    s.advance(t.id, 'hardship', 7, 6);
    const s2 = new PlotThreadStore();
    s2.hydrate(s.serialize());
    expect(s2.get(t.id)!.phase).toBe('hardship');
    expect(s2.threadOfEvent(7)).toBe(t.id);
    const t2 = s2.open('trial', { kind: 'settlement', poiId: 'p2' }, 8);
    expect(t2.id).toBeGreaterThan(t.id);
  });
});
