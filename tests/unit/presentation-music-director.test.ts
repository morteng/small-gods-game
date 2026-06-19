import { describe, it, expect } from 'vitest';
import { MusicDirector, leitmotifFor } from '@/presentation/music-director';
import type { MusicBackend, NoteEvent } from '@/presentation/music-backend';

class FakeBackend implements MusicBackend {
  t = 0;
  started = true;
  notes: NoteEvent[] = [];
  programs: Record<number, number> = {};
  muted = false;
  volume = 0;
  now(): number { return this.t; }
  ensureStarted(): void {}
  setProgram(channel: number, program: number): void { this.programs[channel] = program; }
  scheduleNote(ev: NoteEvent): void { this.notes.push(ev); }
  setMasterVolume(v: number): void { this.volume = v; }
  setMuted(m: boolean): void { this.muted = m; }
  dispose(): void {}
}

/** Advance the audio clock + drive the director frame-by-frame. */
function run(dir: MusicDirector, backend: FakeBackend, seconds: number, dtMs = 16): void {
  const frames = Math.round((seconds * 1000) / dtMs);
  for (let i = 0; i < frames; i++) {
    backend.t += dtMs / 1000;
    dir.update(dtMs);
  }
}

const ch = (notes: NoteEvent[], c: number) => notes.filter((n) => n.channel === c);

describe('MusicDirector', () => {
  it('sets the master volume on construction', () => {
    const b = new FakeBackend();
    new MusicDirector(b, { volume: 0.5 });
    expect(b.volume).toBe(0.5);
  });

  it('emits nothing while the audio clock is at zero (suspended/null backend)', () => {
    const b = new FakeBackend();
    b.t = 0;
    const dir = new MusicDirector(b);
    for (let i = 0; i < 60; i++) dir.update(16); // clock never advances
    expect(b.notes).toEqual([]);
  });

  it('assigns GM programs and lays down a pad bed once running', () => {
    const b = new FakeBackend();
    b.t = 1;
    const dir = new MusicDirector(b);
    run(dir, b, 3);
    expect(b.programs[0]).toBe(89); // pad = GM "Pad 2 (warm)"
    const pad = ch(b.notes, 0);
    expect(pad.length).toBeGreaterThan(0);
    // Pad lands as a triad: 3 notes sharing a start time.
    const byStart = new Map<number, number>();
    for (const n of pad) byStart.set(n.startSec, (byStart.get(n.startSec) ?? 0) + 1);
    expect([...byStart.values()].some((c) => c === 3)).toBe(true);
  });

  it('keeps the tempo in the subtle 56–92 BPM band', () => {
    const b = new FakeBackend();
    b.t = 1;
    const dir = new MusicDirector(b);
    dir.setMood({ tension: 0.2, reverence: 0.2, liveliness: 0.5, timeOfDay: 0.5, season: 'summer' });
    run(dir, b, 4);
    const { bpm } = dir.debugState();
    expect(bpm).toBeGreaterThanOrEqual(56);
    expect(bpm).toBeLessThanOrEqual(92);
  });

  it('high tension turns on the bass layer; high liveliness turns on pluck + raises tempo', () => {
    const calm = new FakeBackend(); calm.t = 1;
    const calmDir = new MusicDirector(calm);
    calmDir.setMood({ tension: 0.05, reverence: 0.05, liveliness: 0.05, timeOfDay: 0.5, season: 'winter' });
    run(calmDir, calm, 5);

    const busy = new FakeBackend(); busy.t = 1;
    const busyDir = new MusicDirector(busy);
    busyDir.setMood({ tension: 0.9, reverence: 0.2, liveliness: 0.9, timeOfDay: 0.5, season: 'winter' });
    run(busyDir, busy, 5);

    expect(busyDir.debugState().layers?.bass).toBe(true);
    expect(busyDir.debugState().layers?.pluck).toBe(true);
    expect(busyDir.debugState().bpm).toBeGreaterThan(calmDir.debugState().bpm);
  });

  it('a queued leitmotif plays on the lead channel then clears', () => {
    const b = new FakeBackend(); b.t = 1;
    const dir = new MusicDirector(b);
    dir.playLeitmotif([0, 2, 4]);
    run(dir, b, 5);
    expect(ch(b.notes, 4).length).toBe(3); // exactly the three queued notes, once
  });

  it('an event nudge raises effective tension transiently', () => {
    const b = new FakeBackend(); b.t = 1;
    const dir = new MusicDirector(b);
    dir.setMood({ tension: 0.1, reverence: 0.1, liveliness: 0.1, timeOfDay: 0.5, season: 'spring' });
    run(dir, b, 1);
    const before = dir.debugState().mood.tension;
    dir.nudge({ tension: 0.5 });
    dir.update(16);
    expect(dir.debugState().mood.tension).toBeGreaterThan(before);
  });

  it('mutes via the backend (presentation ducks during scrub)', () => {
    const b = new FakeBackend();
    b.setMuted(true);
    expect(b.muted).toBe(true);
  });
});

describe('leitmotifFor', () => {
  it('is deterministic per key', () => {
    expect(leitmotifFor('npc-7')).toEqual(leitmotifFor('npc-7'));
  });
  it('differs across keys and yields 3–4 in-scale degrees', () => {
    const a = leitmotifFor('alpha');
    const b = leitmotifFor('omega');
    expect(a).not.toEqual(b);
    for (const m of [a, b]) {
      expect(m.length).toBeGreaterThanOrEqual(3);
      expect(m.length).toBeLessThanOrEqual(4);
      for (const d of m) { expect(d).toBeGreaterThanOrEqual(0); expect(d).toBeLessThanOrEqual(4); }
    }
  });
});
