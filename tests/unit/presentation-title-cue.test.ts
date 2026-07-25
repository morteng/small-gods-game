import { describe, it, expect } from 'vitest';
import { TITLE_CUE, TITLE_CUE_ID } from '@/presentation/cues/title-cue';
import { validateCue } from '@/presentation/cue-schema';
import { BASE_CUES } from '@/presentation/cues/base-cues';
import { CueLibrary } from '@/presentation/cue-library';
import { loopBeats } from '@/presentation/cue-types';

describe('TITLE_CUE — validates against the same trust boundary as any cue', () => {
  it('passes validateCue unchanged (same shape/constraint check as base-cues.ts)', () => {
    const v = validateCue(TITLE_CUE);
    expect(v).not.toBeNull();
    expect(v!.id).toBe(TITLE_CUE_ID);
    expect(v!.role).toBe('bed');
    expect(v!.loop).toBe(true);
  });

  it('is sparse and slow ("better silent than boring", base-cues.ts)', () => {
    expect(TITLE_CUE.bpm).toBeLessThanOrEqual(60);
    // Every note fits inside one loop iteration.
    const total = loopBeats(TITLE_CUE);
    for (const n of TITLE_CUE.notes) expect(n.atBeat + n.durBeats).toBeLessThanOrEqual(total);
    // Sparse: only a handful of events for an 8-bar loop.
    expect(TITLE_CUE.notes.length).toBeLessThanOrEqual(6);
  });

  it('is NOT part of the mood-driven base set — it must never compete for the calm-baseline silence', () => {
    expect(BASE_CUES.some((c) => c.id === TITLE_CUE_ID)).toBe(false);
    const lib = new CueLibrary(); // defaults to BASE_CUES only
    expect(lib.get(TITLE_CUE_ID)).toBeUndefined();
    // Confirms the calm baseline is still silence — TITLE_CUE isn't accidentally
    // filling the gap BASE_CUES leaves on purpose.
    expect(lib.eligibleBed({ tension: 0.1, reverence: 0.1, liveliness: 0.1 })).toBeNull();
  });
});
