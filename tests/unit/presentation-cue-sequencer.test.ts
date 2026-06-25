import { describe, it, expect } from 'vitest';
import { CueSequencer, synthLeitmotif } from '@/presentation/cue-sequencer';
import { CueLibrary } from '@/presentation/cue-library';
import type { MusicBackend, NoteEvent } from '@/presentation/music-backend';
import type { MusicCue } from '@/presentation/cue-types';

/** A fake backend with a controllable clock that records scheduled notes. */
class FakeBackend implements MusicBackend {
  started = true;
  clock = 1; // seconds; >0 so the sequencer treats audio as running
  volume = 1;
  muted = false;
  programs = new Map<number, number>();
  notes: NoteEvent[] = [];
  now() { return this.clock; }
  ensureStarted() {}
  setProgram(ch: number, gm: number) { this.programs.set(ch, gm); }
  scheduleNote(ev: NoteEvent) { this.notes.push(ev); }
  setMasterVolume(v: number) { this.volume = v; }
  setMuted(m: boolean) { this.muted = m; }
  dispose() {}
}

const CALM = { tension: 0.1, reverence: 0.1, liveliness: 0.1 };
const LIVELY = { tension: 0.1, reverence: 0.1, liveliness: 0.9 };
const SACRED = { tension: 0.1, reverence: 0.8, liveliness: 0.1 };
const DIRE = { tension: 0.8, reverence: 0.1, liveliness: 0.1 };

describe('CueLibrary.eligibleBed', () => {
  it('returns null when no bed covers the mood (silence is the default)', () => {
    const lib = new CueLibrary();
    expect(lib.eligibleBed(CALM)).toBeNull();
  });

  it('selects the bed whose mood window contains the current mood', () => {
    const lib = new CueLibrary();
    expect(lib.eligibleBed(LIVELY)?.id).toBe('bed_lively');
    expect(lib.eligibleBed(SACRED)?.id).toBe('bed_reverence');
    expect(lib.eligibleBed(DIRE)?.id).toBe('bed_tension');
  });

  it('prefers the most specific (narrowest) eligible bed, deterministically', () => {
    const broad: MusicCue = {
      id: 'aaa_broad', role: 'bed', bpm: 60, bars: 1, loop: true,
      mood: { liveliness: [0, 1] }, notes: [{ voice: 'pad', midi: 60, atBeat: 0, durBeats: 1, vel: 30 }],
    };
    const lib = new CueLibrary();
    lib.add([broad]);
    // bed_lively (liveliness [0.6,1], width 0.4) beats the full-width broad bed.
    expect(lib.eligibleBed(LIVELY)?.id).toBe('bed_lively');
  });
});

describe('CueSequencer', () => {
  it('sets voice programs and schedules an eligible bed on update', () => {
    const b = new FakeBackend();
    const seq = new CueSequencer(b, { volume: 0.4 });
    expect(b.volume).toBe(0.4);
    seq.setMood(LIVELY);
    expect(seq.debugState().bed).toBe('bed_lively');
    seq.update(16);
    expect(b.notes.length).toBeGreaterThan(0);
    // Music voices live on channels 0–5, clear of the SFX bus (6–8).
    expect(b.notes.every((n) => n.channel <= 5)).toBe(true);
  });

  it('plays NOTHING when no bed is eligible (calm → silence)', () => {
    const b = new FakeBackend();
    const seq = new CueSequencer(b);
    seq.setMood(CALM);
    expect(seq.debugState().bed).toBeNull();
    seq.update(16);
    expect(b.notes).toHaveLength(0);
  });

  it('emits nothing while the audio clock is not running (now<=0)', () => {
    const b = new FakeBackend();
    b.clock = 0;
    const seq = new CueSequencer(b);
    seq.setMood(LIVELY);
    seq.update(16);
    expect(b.notes).toHaveLength(0);
  });

  it('schedules further loop iterations as the clock advances', () => {
    const b = new FakeBackend();
    const seq = new CueSequencer(b);
    seq.setMood(SACRED);
    seq.update(16);
    const first = b.notes.length;
    expect(first).toBeGreaterThan(0);
    // Advance well past one loop length and tick again → more notes scheduled.
    b.clock += 10;
    seq.update(16);
    expect(b.notes.length).toBeGreaterThan(first);
  });

  it('triggers a one-shot swell by tag without disturbing the bed', () => {
    const b = new FakeBackend();
    const seq = new CueSequencer(b);
    seq.triggerByTag('miracle');
    expect(b.notes.length).toBeGreaterThan(0);
    expect(seq.debugState().bed).toBeNull(); // a swell is not a bed
  });

  it('triggers an explicit one-shot cue by id', () => {
    const b = new FakeBackend();
    const seq = new CueSequencer(b);
    seq.triggerCue('dirge_death');
    // dirge_death has 5 notes.
    expect(b.notes).toHaveLength(5);
  });

  it('ignores triggerCue for a bed id (beds are not one-shots)', () => {
    const b = new FakeBackend();
    const seq = new CueSequencer(b);
    seq.triggerCue('bed_lively');
    expect(b.notes).toHaveLength(0);
  });

  it('plays a deterministic synth leitmotif for an unknown theme key', () => {
    const b = new FakeBackend();
    const seq = new CueSequencer(b);
    seq.playLeitmotif('npc-7');
    expect(b.notes.length).toBeGreaterThan(0);
    expect(b.notes.every((n) => n.channel === 4)).toBe(true); // 'lead' voice
  });
});

describe('synthLeitmotif', () => {
  it('is deterministic per theme key', () => {
    expect(synthLeitmotif('alpha')).toEqual(synthLeitmotif('alpha'));
  });
  it('differs across keys', () => {
    const a = JSON.stringify(synthLeitmotif('alpha').notes);
    const z = JSON.stringify(synthLeitmotif('omega').notes);
    expect(a).not.toBe(z);
  });
  it('starts on the tonic (degree 0 → C5)', () => {
    expect(synthLeitmotif('whatever').notes[0].midi).toBe(72);
  });
});
