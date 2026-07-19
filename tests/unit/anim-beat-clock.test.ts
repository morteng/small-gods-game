import { describe, it, expect } from 'vitest';
import { BeatClock, clipPhase } from '@/render/anim/beat-clock';

describe('BeatClock — beatAt / phaseAt', () => {
  it('reports beat 0 exactly at the anchor', () => {
    const clock = new BeatClock({ bpm: 120, anchorTime: 10 });
    expect(clock.beatAt(10)).toBeCloseTo(0, 12);
    expect(clock.phaseAt(10)).toBeCloseTo(0, 12);
  });

  it('advances one beat per secondsPerBeat at 120 bpm', () => {
    const clock = new BeatClock({ bpm: 120, anchorTime: 0 });
    expect(clock.secondsPerBeat()).toBeCloseTo(0.5, 12);
    expect(clock.beatAt(0.5)).toBeCloseTo(1, 12);
    expect(clock.beatAt(1.25)).toBeCloseTo(2.5, 12);
  });

  it('is negative before the anchor', () => {
    const clock = new BeatClock({ bpm: 60, anchorTime: 10 });
    expect(clock.beatAt(7)).toBeCloseTo(-3, 12);
    expect(clock.phaseAt(7)).toBeCloseTo(0, 12);
    expect(clock.beatAt(7.4)).toBeCloseTo(-2.6, 12);
  });

  it('phaseAt is always in [0, 1)', () => {
    const clock = new BeatClock({ bpm: 90, anchorTime: 3 });
    const spb = clock.secondsPerBeat();
    // mid-beat, forward
    expect(clock.phaseAt(3 + spb * 2.25)).toBeCloseTo(0.25, 10);
    // mid-beat, before the anchor
    const p = clock.phaseAt(3 - spb * 1.75);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(1);
    expect(p).toBeCloseTo(0.25, 10);
  });
});

describe('BeatClock — nextBoundary', () => {
  it('returns now when already exactly on a boundary', () => {
    const clock = new BeatClock({ bpm: 120, anchorTime: 0 });
    expect(clock.nextBoundary(2.0)).toBeCloseTo(2.0, 12); // beat 4
  });

  it('returns now within a 1e-9 epsilon of a boundary', () => {
    const clock = new BeatClock({ bpm: 120, anchorTime: 0 });
    const almost = 2.0 + 1e-11;
    expect(clock.nextBoundary(almost)).toBeCloseTo(almost, 12);
  });

  it('finds the next single-beat boundary mid-beat', () => {
    const clock = new BeatClock({ bpm: 120, anchorTime: 0 }); // 0.5s/beat
    // now=0.2 -> beat 0.4 -> next boundary at beat 1 -> t=0.5
    expect(clock.nextBoundary(0.2)).toBeCloseTo(0.5, 10);
  });

  it('finds the next bar boundary with quantum=4', () => {
    const clock = new BeatClock({ bpm: 120, anchorTime: 0 }); // 0.5s/beat
    // now=0.6 -> beat 1.2 -> next multiple of 4 is beat 4 -> t=2.0
    expect(clock.nextBoundary(0.6, 4)).toBeCloseTo(2.0, 10);
    // exactly on a bar boundary already (beat 8 -> t=4.0)
    expect(clock.nextBoundary(4.0, 4)).toBeCloseTo(4.0, 10);
  });

  it('handles negative beats (before the anchor) correctly', () => {
    const clock = new BeatClock({ bpm: 60, anchorTime: 10 }); // 1s/beat
    // now=7.3 -> beat -2.7 -> next integer boundary is beat -2 -> t=8
    expect(clock.nextBoundary(7.3)).toBeCloseTo(8, 10);
    // now=7 -> beat -3 exactly -> already on boundary
    expect(clock.nextBoundary(7)).toBeCloseTo(7, 10);
    // quantum=4, now=1 -> beat -9 -> next multiple of 4 is -8 -> t=2
    expect(clock.nextBoundary(1, 4)).toBeCloseTo(2, 10);
  });

  it('throws RangeError on non-positive quantum', () => {
    const clock = new BeatClock({ bpm: 120, anchorTime: 0 });
    expect(() => clock.nextBoundary(0, 0)).toThrow(RangeError);
    expect(() => clock.nextBoundary(0, -2)).toThrow(RangeError);
  });
});

describe('BeatClock — setTempo phase continuity', () => {
  it('preserves beatAt(now) exactly at the switch moment', () => {
    const clock = new BeatClock({ bpm: 100, anchorTime: 0 });
    const switchTime = 3.37;
    const beatBefore = clock.beatAt(switchTime);
    clock.setTempo(140, switchTime);
    const beatAfter = clock.beatAt(switchTime);
    expect(beatAfter).toBeCloseTo(beatBefore, 9);
  });

  it('updates spec.bpm and recomputes anchorTime', () => {
    const clock = new BeatClock({ bpm: 100, anchorTime: 0 });
    clock.setTempo(140, 3.37);
    expect(clock.spec.bpm).toBe(140);
    expect(clock.spec.anchorTime).not.toBe(0);
  });

  it('computes correct boundaries after a tempo change', () => {
    const clock = new BeatClock({ bpm: 120, anchorTime: 0 }); // 0.5s/beat
    const switchTime = 1.1; // beat 2.2
    const beatAtSwitch = clock.beatAt(switchTime);
    clock.setTempo(60, switchTime); // 1s/beat, phase continuous
    // next integer beat boundary after beat 2.2 is beat 3, which is
    // (3 - 2.2) = 0.8 beats away at the NEW tempo (1s/beat) -> switchTime + 0.8
    const expected = switchTime + (Math.ceil(beatAtSwitch) - beatAtSwitch) * clock.secondsPerBeat();
    expect(clock.nextBoundary(switchTime)).toBeCloseTo(expected, 9);
    expect(clock.beatAt(clock.nextBoundary(switchTime))).toBeCloseTo(3, 6);
  });

  it('throws RangeError on non-positive or non-finite bpm', () => {
    const clock = new BeatClock({ bpm: 120, anchorTime: 0 });
    expect(() => clock.setTempo(0, 0)).toThrow(RangeError);
    expect(() => clock.setTempo(-10, 0)).toThrow(RangeError);
    expect(() => clock.setTempo(NaN, 0)).toThrow(RangeError);
    expect(() => clock.setTempo(Infinity, 0)).toThrow(RangeError);
  });
});

describe('BeatClock — constructor guards', () => {
  it('throws RangeError on bpm <= 0', () => {
    expect(() => new BeatClock({ bpm: 0, anchorTime: 0 })).toThrow(RangeError);
    expect(() => new BeatClock({ bpm: -5, anchorTime: 0 })).toThrow(RangeError);
  });

  it('throws RangeError on non-finite bpm', () => {
    expect(() => new BeatClock({ bpm: NaN, anchorTime: 0 })).toThrow(RangeError);
    expect(() => new BeatClock({ bpm: Infinity, anchorTime: 0 })).toThrow(RangeError);
  });

  it('throws RangeError on non-finite anchorTime', () => {
    expect(() => new BeatClock({ bpm: 120, anchorTime: NaN })).toThrow(RangeError);
    expect(() => new BeatClock({ bpm: 120, anchorTime: Infinity })).toThrow(RangeError);
  });
});

describe('clipPhase', () => {
  it('loops a clip over its durationBeats, staying in [0, 1)', () => {
    const clock = new BeatClock({ bpm: 120, anchorTime: 0 }); // 0.5s/beat
    // durationBeats=4 -> loop period = 2s
    expect(clipPhase(clock, 0, 4)).toBeCloseTo(0, 10);
    expect(clipPhase(clock, 0.5, 4)).toBeCloseTo(0.25, 10);
    expect(clipPhase(clock, 1.0, 4)).toBeCloseTo(0.5, 10);
    expect(clipPhase(clock, 2.0, 4)).toBeCloseTo(0, 10); // wrapped exactly one loop
    expect(clipPhase(clock, 2.5, 4)).toBeCloseTo(0.25, 10); // wrapped + a quarter
  });

  it('applies a startBeat offset', () => {
    const clock = new BeatClock({ bpm: 120, anchorTime: 0 }); // 0.5s/beat
    // startBeat=2 shifts the loop origin by 2 beats (1s)
    expect(clipPhase(clock, 1.0, 4, 2)).toBeCloseTo(0, 10);
    expect(clipPhase(clock, 1.5, 4, 2)).toBeCloseTo(0.25, 10);
    expect(clipPhase(clock, 0.5, 4, 2)).toBeCloseTo(0.75, 10); // before the offset origin
  });

  it('is always within [0, 1) for a spread of times including negative beats', () => {
    const clock = new BeatClock({ bpm: 137, anchorTime: 5 });
    const samples = [-50, -3.3, -0.001, 0, 0.001, 4.999, 9.5, 100.25];
    for (const t of samples) {
      const u = clipPhase(clock, t, 3.5, 1.25);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });
});
