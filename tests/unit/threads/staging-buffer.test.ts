import { describe, it, expect } from 'vitest';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import type { ThreadSubject } from '@/sim/threads/thread-types';

const subj: ThreadSubject = { kind: 'settlement', poiId: 'p1' };

describe('StagingBuffer', () => {
  it('arms and finds beats by subject', () => {
    const b = new StagingBuffer();
    b.arm({ subject: subj, trigger: { kind: 'discovery' }, hard: [], stagedTick: 0 });
    expect(b.armedFor(subj)).toHaveLength(1);
    expect(b.armedFor({ kind: 'settlement', poiId: 'other' })).toHaveLength(0);
  });

  it('armedByTrigger filters on trigger kind', () => {
    const b = new StagingBuffer();
    b.arm({ subject: subj, trigger: { kind: 'discovery' }, hard: [], stagedTick: 0 });
    b.arm({ subject: subj, trigger: { kind: 'after_tick', tick: 10 }, hard: [], stagedTick: 0 });
    expect(b.armedByTrigger('after_tick')).toHaveLength(1);
  });

  it('markFired removes a beat from the armed set', () => {
    const b = new StagingBuffer();
    const beat = b.arm({ subject: subj, trigger: { kind: 'discovery' }, hard: [], stagedTick: 0 });
    b.markFired(beat.id);
    expect(b.armedFor(subj)).toHaveLength(0);
    expect(b.get(beat.id)!.status).toBe('fired');
  });

  it('serialize/hydrate round-trips and advances the id counter', () => {
    const b = new StagingBuffer();
    const beat = b.arm({ subject: subj, trigger: { kind: 'discovery' }, hard: [], stagedTick: 0 });
    const b2 = new StagingBuffer();
    b2.hydrate(b.serialize());
    expect(b2.armedFor(subj)).toHaveLength(1);
    const beat2 = b2.arm({ subject: subj, trigger: { kind: 'discovery' }, hard: [], stagedTick: 1 });
    expect(beat2.id).toBeGreaterThan(beat.id);
  });
});
