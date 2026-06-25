import { describe, it, expect } from 'vitest';
import { validateCue, validateCuePack } from '@/presentation/cue-schema';

const GOOD = {
  id: 'x', role: 'swell', bpm: 80, bars: 1, loop: false,
  notes: [{ voice: 'pad', midi: 60, atBeat: 0, durBeats: 2, vel: 40 }],
};

describe('validateCue', () => {
  it('accepts a well-formed cue and preserves optional fields', () => {
    const c = validateCue({ ...GOOD, gain: 0.8, tags: ['miracle'], themeKey: 't', transition: 'cut', beatsPerBar: 3 });
    expect(c).not.toBeNull();
    expect(c!.gain).toBe(0.8);
    expect(c!.tags).toEqual(['miracle']);
    expect(c!.beatsPerBar).toBe(3);
    expect(c!.transition).toBe('cut');
  });

  it('rejects unknown role / missing id / non-array notes', () => {
    expect(validateCue({ ...GOOD, role: 'banger' })).toBeNull();
    expect(validateCue({ ...GOOD, id: '' })).toBeNull();
    expect(validateCue({ ...GOOD, notes: 'nope' })).toBeNull();
  });

  it('rejects a cue with a malformed note (whole cue invalid)', () => {
    expect(validateCue({ ...GOOD, notes: [{ voice: 'kazoo', midi: 60, atBeat: 0, durBeats: 1, vel: 40 }] })).toBeNull();
    expect(validateCue({ ...GOOD, notes: [{ voice: 'pad', midi: 999, atBeat: 0, durBeats: 1, vel: 40 }] })).toBeNull();
  });

  it('rejects out-of-range bpm/bars', () => {
    expect(validateCue({ ...GOOD, bpm: 5 })).toBeNull();
    expect(validateCue({ ...GOOD, bars: 0 })).toBeNull();
  });

  it('orders and clamps a reversed mood range', () => {
    const c = validateCue({ ...GOOD, role: 'bed', loop: true, mood: { tension: [0.8, 0.2] } });
    expect(c!.mood!.tension).toEqual([0.2, 0.8]);
  });

  it('drops a mood range outside 0..1', () => {
    const c = validateCue({ ...GOOD, role: 'bed', loop: true, mood: { tension: [-1, 2] } });
    expect(c!.mood?.tension).toBeUndefined();
  });
});

describe('validateCuePack', () => {
  it('accepts {cues:[...]} and a bare array, dropping invalid entries', () => {
    expect(validateCuePack({ cues: [GOOD, { bad: 1 }] })).toHaveLength(1);
    expect(validateCuePack([GOOD, GOOD])).toHaveLength(2);
    expect(validateCuePack({ nope: true })).toHaveLength(0);
    expect(validateCuePack(null)).toHaveLength(0);
  });
});
